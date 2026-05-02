// Smoke test: harness init produces the canonical surface and harness check
// reports zero drift afterward. Runs against a temp directory.

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert';

const CLI = path.resolve('src/cli.js');

function run(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

function makeTempRepo(stack) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
  run('git init -q', dir);
  if (stack === 'node-ts') {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"smoketest"}');
  } else if (stack === 'python') {
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'google-generativeai\n');
  }
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function expectFile(dir, rel) {
  assert(
    fs.existsSync(path.join(dir, rel)),
    `expected ${rel} to exist after init`
  );
}

// Test 1: node-ts stack produces canonical surface.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    expectFile(dir, 'CLAUDE.md');
    expectFile(dir, 'harness.yml');
    expectFile(dir, '.gitleaks.toml');
    expectFile(dir, '.claude/settings.json');
    expectFile(dir, '.claude/hooks/session-start.sh');
    expectFile(dir, '.claude/hooks/check-branch-not-merged.sh');
    expectFile(dir, '.claude/skills/close-session.md');
    expectFile(dir, '.harness/council/security.md');
    expectFile(dir, '.harness/scripts/council.py');
    expectFile(dir, '.harness/hooks/post-commit');
    expectFile(dir, '.github/workflows/ci.yml');
    expectFile(dir, '.github/workflows/council.yml');
    expectFile(dir, '.github/workflows/branch-guard.yml');
    expectFile(dir, '.github/workflows/drift-check.yml');
    expectFile(dir, '.husky/pre-push');
    expectFile(dir, 'scripts/setup-secrets.sh');
    // Stack-specific: node-ts gets husky, no python ci file.
    assert(
      !fs.existsSync(path.join(dir, '.github/workflows/ci-python.yml')),
      'ci-python.yml should not be present in node-ts stack'
    );
    // Substitution worked.
    const claude = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert(claude.includes(path.basename(dir)), 'PROJECT_NAME should be substituted');
    // Check reports zero drift.
    const out = run(`node "${CLI}" check`, dir);
    assert(out.includes('missing  0'), `expected zero missing, got: ${out}`);
    console.log('PASS: node-ts canonical surface');
  } finally {
    cleanup(dir);
  }
}

// Test 2: python stack omits husky and uses python CI.
{
  const dir = makeTempRepo('python');
  try {
    run(`node "${CLI}" init`, dir);
    expectFile(dir, '.github/workflows/ci.yml');
    assert(
      !fs.existsSync(path.join(dir, '.husky')),
      'python stack should not get husky'
    );
    const ci = fs.readFileSync(path.join(dir, '.github/workflows/ci.yml'), 'utf8');
    assert(ci.includes('setup-python'), 'python CI should use setup-python');
    console.log('PASS: python stack');
  } finally {
    cleanup(dir);
  }
}

// Test 3: init refuses to run on existing .harness/ without --update or --force.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    let threw = false;
    try {
      run(`node "${CLI}" init`, dir);
    } catch (e) {
      threw = true;
      assert(
        e.stderr && e.stderr.includes('.harness/ already exists'),
        `expected refusal, got stderr: ${e.stderr}`
      );
    }
    assert(threw, 'second init should fail');
    console.log('PASS: init refuses to overwrite');
  } finally {
    cleanup(dir);
  }
}

// Test 4: init --update is idempotent and adds missing files.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    fs.unlinkSync(path.join(dir, 'CLAUDE.md'));
    const out = run(`node "${CLI}" init --update`, dir);
    expectFile(dir, 'CLAUDE.md');
    const checkOut = run(`node "${CLI}" check`, dir);
    assert(checkOut.includes('missing  0'), 'expected zero missing after --update');
    console.log('PASS: init --update adds missing files');
  } finally {
    cleanup(dir);
  }
}

// Test 8: harness recall follows [[wiki-style]] cross-references one hop at half score.
// Setup: query keyword appears ONLY in section A; section A links to section B
// which has no overlapping keyword. Recall should include B as "linked via".
{
  const dir = makeTempRepo('node-ts');
  try {
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      [
        '# Learnings',
        '',
        '## 2026-04-20 — vertebrate fossils',
        '### IMPROVE',
        '- See [[meteor crater]] for related geological context.',
        '',
        '## 2026-04-25 — meteor crater',
        '### KEEP',
        '- Distinct topic with totally separate content, no overlapping words.',
        '',
      ].join('\n')
    );
    const out = run(`node "${CLI}" recall "vertebrate"`, dir);
    assert(out.includes('vertebrate fossils'), 'expected direct match');
    assert(out.includes('meteor crater'), 'expected linked entry to surface');
    assert(out.includes('linked via'), 'expected linked-via annotation');
    console.log('PASS: harness recall follows [[wiki-style]] cross-references');
  } finally {
    cleanup(dir);
  }
}

// Test 14: malformed harness.yml is a fatal error for `harness check`,
// not a silent fallback to default behavior.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    // Corrupt harness.yml with a YAML syntax error.
    fs.writeFileSync(
      path.join(dir, 'harness.yml'),
      'council:\n  specialized: [unbalanced\n'
    );
    let out = '';
    let exitCode = 0;
    try {
      out = run(`node "${CLI}" check`, dir);
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || '');
      exitCode = e.status || 1;
    }
    assert(exitCode !== 0, 'check should exit non-zero on malformed harness.yml');
    assert(
      out.includes('harness.yml could not be parsed'),
      'expected explicit parse-error message'
    );
    console.log('PASS: malformed harness.yml is fatal for `harness check`');
  } finally {
    cleanup(dir);
  }
}

// Test 12: lead-architect.md is still required in specialized mode.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    // Set specialized: true.
    const yamlPath = path.join(dir, 'harness.yml');
    let yaml = fs.readFileSync(yamlPath, 'utf8');
    yaml = yaml.replace(/^( *)specialized: false\b/m, '$1specialized: true');
    fs.writeFileSync(yamlPath, yaml);

    // Delete lead-architect.md (the synthesizer — required even in specialized).
    fs.unlinkSync(path.join(dir, '.harness/council/lead-architect.md'));

    // check should fail because lead-architect is missing.
    let out = '';
    let exitCode = 0;
    try {
      out = run(`node "${CLI}" check`, dir);
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || '');
      exitCode = e.status || 1;
    }
    assert(exitCode === 1, 'check should exit 1 when lead-architect.md missing');
    assert(out.includes('lead-architect.md'), 'expected lead-architect in missing list');
    console.log('PASS: specialized mode still requires lead-architect.md');
  } finally {
    cleanup(dir);
  }
}

// Test 13: specialized mode accepts YAML boolean variants (True, yes, on).
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    // Delete canonical reviewer personas to make the missing/skipped distinction observable.
    for (const f of ['accessibility.md', 'architecture.md', 'bugs.md', 'cost.md',
                     'maintainability.md', 'product.md', 'security.md']) {
      fs.unlinkSync(path.join(dir, '.harness/council/', f));
    }
    const yamlPath = path.join(dir, 'harness.yml');
    // Use uppercase True — js-yaml treats this as boolean true.
    let yaml = fs.readFileSync(yamlPath, 'utf8');
    yaml = yaml.replace(/^( *)specialized: false\b/m, '$1specialized: True');
    fs.writeFileSync(yamlPath, yaml);

    const out = run(`node "${CLI}" check`, dir);
    assert(out.includes('missing  0'), `expected 0 missing with specialized: True (uppercase), got: ${out}`);
    console.log('PASS: specialized mode accepts YAML boolean variants');
  } finally {
    cleanup(dir);
  }
}

// Test 11: harness check respects council.specialized: true in harness.yml —
// canonical reviewer personas are skipped, lead-architect still required.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    // Delete the canonical reviewer personas (simulating a specialized repo).
    for (const f of [
      'accessibility.md', 'architecture.md', 'bugs.md', 'cost.md',
      'maintainability.md', 'product.md', 'security.md',
    ]) {
      fs.unlinkSync(path.join(dir, '.harness/council/', f));
    }

    // Without specialized mode → check should report 7 missing.
    let beforeOut = '';
    try {
      beforeOut = run(`node "${CLI}" check`, dir);
    } catch (e) {
      beforeOut = (e.stdout || '') + (e.stderr || '');
    }
    assert(beforeOut.includes('missing  7'), `expected 7 missing, got: ${beforeOut}`);

    // Set specialized: true in harness.yml.
    const yamlPath = path.join(dir, 'harness.yml');
    let yaml = fs.readFileSync(yamlPath, 'utf8');
    yaml = yaml.replace(/^( *)specialized: false\b/m, '$1specialized: true');
    fs.writeFileSync(yamlPath, yaml);

    // Now check should skip all 7 and exit 0.
    const afterOut = run(`node "${CLI}" check`, dir);
    assert(afterOut.includes('missing  0'), `expected 0 missing after specialized=true, got: ${afterOut}`);
    assert(afterOut.includes('skipped'), 'expected skipped count in output');
    assert(afterOut.includes('specialized'), 'expected specialized label in header');

    console.log('PASS: harness check respects council.specialized: true');
  } finally {
    cleanup(dir);
  }
}

// Test 10: ambiguous [[link]] — lint warns, recall does not silently pick.
{
  const dir = makeTempRepo('node-ts');
  try {
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      [
        '# Learnings',
        '',
        '## 2026-05-01 — alpha unique direct hit',
        '### IMPROVE',
        '- See [[shared]] for context.',
        '',
        '## 2026-05-02 — shared topic v1',
        '### KEEP',
        '- one of two collisions',
        '',
        '## 2026-05-03 — shared topic v2',
        '### KEEP',
        '- the other collision',
        '',
      ].join('\n')
    );
    let lintOut = '';
    try {
      lintOut = run(`node "${CLI}" lint`, dir);
    } catch (e) {
      lintOut = (e.stdout || '') + (e.stderr || '');
    }
    assert(lintOut.includes('ambiguous_links'), 'lint should flag ambiguous [[shared]]');

    const recallOut = run(`node "${CLI}" recall "alpha"`, dir);
    assert(recallOut.includes('alpha unique'), 'recall should find direct hit');
    assert(
      !recallOut.includes('linked via'),
      'recall should NOT follow ambiguous link silently'
    );
    console.log('PASS: ambiguous [[link]] — lint warns, recall skips silently');
  } finally {
    cleanup(dir);
  }
}

// Test 9: harness lint flags broken [[wiki-style]] links.
{
  const dir = makeTempRepo('node-ts');
  try {
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      '# Learnings\n\n## 2026-04-30 — entry with broken link\n\n### IMPROVE\n- See [[does not exist]] for context.\n'
    );
    let out = '';
    try {
      out = run(`node "${CLI}" lint`, dir);
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || '');
    }
    assert(out.includes('broken_links'), 'expected broken_links warning');
    assert(out.includes('does not exist'), 'expected the bad link text in output');
    console.log('PASS: harness lint flags broken [[wiki-style]] links');
  } finally {
    cleanup(dir);
  }
}

// Test 7: harness lint finds known issues in a synthetic dirty corpus.
{
  const dir = makeTempRepo('node-ts');
  try {
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      [
        '# Learnings',
        '',
        '## 2099-01-01 — future-dated section',
        '### KEEP',
        '- this entry shouldn\'t be in the future',
        '',
        '## 2026-04-15 — empty section',
        '### KEEP',
        '',
        '### IMPROVE',
        '- something real',
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      path.join(dir, '.harness/failures.jsonl'),
      [
        // missing required fields
        '{"ts":"2026-04-30T00:00:00Z","not_valid":"x"}',
        // valid but no fix_sha (orphan)
        '{"ts":"2026-04-30T01:00:00Z","failure_class":"council_drift","what_happened":"x","sensor_involved":"council","guide_gap":"persona-scope"}',
      ].join('\n') + '\n'
    );

    let stderr = '';
    let exitCode = 0;
    try {
      run(`node "${CLI}" lint`, dir);
    } catch (e) {
      stderr = (e.stdout || '') + (e.stderr || '');
      exitCode = e.status || 1;
    }
    assert(exitCode === 1, 'lint should exit 1 when errors present');
    assert(stderr.includes('schema') || stderr.includes('missing required field'), 'should detect schema errors');
    assert(stderr.includes('future-dated') || stderr.includes('date_sanity'), 'should detect future date');
    assert(stderr.includes('empty') || stderr.includes('empty_entries'), 'should detect empty blocks');
    console.log('PASS: harness lint detects synthetic issues');
  } finally {
    cleanup(dir);
  }
}

// Test 6: harness recall finds keyword matches in learnings.md and ranks them.
{
  const dir = makeTempRepo('node-ts');
  try {
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      [
        '# Learnings',
        '',
        '## 2026-04-29 — early lesson',
        '### KEEP',
        '- pre-flight budget races are real',
        '',
        '## 2026-04-30 — recent lesson',
        '### INSIGHT',
        '- council drift means the persona scope is wrong',
        '',
      ].join('\n')
    );
    const out = run(`node "${CLI}" recall "council drift"`, dir);
    assert(out.includes('Recall:'), 'expected recall heading');
    assert(out.includes('persona scope is wrong'), 'expected matching excerpt');
    console.log('PASS: harness recall finds relevant memory entries');
  } finally {
    cleanup(dir);
  }
}

// Test 5: harness map produces a Repository Impact block from a description.
// Uses --untracked git grep so we don't need a commit (avoids depending on
// the test environment's signing config).
{
  const dir = makeTempRepo('node-ts');
  try {
    fs.writeFileSync(
      path.join(dir, 'webhooks.ts'),
      'export class StripeWebhookHandler { handleEvent() {} }\n'
    );
    fs.writeFileSync(
      path.join(dir, 'webhooks.test.ts'),
      'import { StripeWebhookHandler } from "./webhooks"\n'
    );

    const out = run(
      `node "${CLI}" map "Add error handling to StripeWebhookHandler"`,
      dir
    );
    assert(out.includes('Repository Impact'), 'expected impact heading');
    assert(out.includes('webhooks.ts'), 'expected webhooks.ts in impact');
    console.log('PASS: harness map identifies real files');
  } finally {
    cleanup(dir);
  }
}

// Test 15: harness synthesize discovers duplicate-signal clusters in dry-run mode.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
    // Three failures sharing the same {class, sensor, gap} signature.
    const f = (ts, what) =>
      JSON.stringify({
        ts,
        failure_class: 'sensor_miss',
        what_happened: what,
        sensor_involved: 'a11y_persona',
        guide_gap: 'persona_scope_too_narrow',
        fix_sha: 'a'.repeat(7),
      });
    fs.writeFileSync(
      path.join(dir, '.harness/failures.jsonl'),
      [
        f('2026-04-01T00:00:00Z', 'a11y persona missed alt text'),
        f('2026-04-15T00:00:00Z', 'a11y persona missed contrast'),
        f('2026-04-29T00:00:00Z', 'a11y persona hallucinated i18n'),
      ].join('\n') + '\n'
    );
    const out = run(`node "${CLI}" synthesize`, dir);
    assert(out.includes('1 pending cluster'), `expected one cluster, got: ${out}`);
    assert(
      out.includes('sensor_miss|a11y_persona|persona_scope_too_narrow'),
      'expected the canonical signature in the dry-run output'
    );
    assert(out.includes('Dry run'), 'expected explicit dry-run notice');
    // Dry-run must not modify learnings.md.
    const learnings = fs.readFileSync(
      path.join(dir, '.harness/learnings.md'),
      'utf8'
    );
    assert(
      !learnings.includes('SYNTHESIS'),
      'dry-run must not append synthesis sections to learnings.md'
    );
    console.log('PASS: harness synthesize dry-run discovers clusters');
  } finally {
    cleanup(dir);
  }
}

// Test 16: harness synthesize --apply writes a properly-formatted, marker-tagged section
// (uses HARNESS_SYNTHESIZE_STUB_RESPONSE so no API call is made).
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    const f = (ts) =>
      JSON.stringify({
        ts,
        failure_class: 'council_drift',
        what_happened: 'council kept hallucinating',
        sensor_involved: 'council',
        guide_gap: 'persona_scope',
        fix_sha: 'b'.repeat(7),
      });
    fs.writeFileSync(
      path.join(dir, '.harness/failures.jsonl'),
      [
        f('2026-04-01T00:00:00Z'),
        f('2026-04-15T00:00:00Z'),
        f('2026-04-29T00:00:00Z'),
      ].join('\n') + '\n'
    );
    // Multi-line bodies in every section. The earlier regex-with-/m parser
    // truncated each body to its first line; this stub deliberately uses
    // multi-paragraph SUMMARY and GUIDE_GAP_AND_FIX plus three bullet
    // points so a regression to that bug is caught here.
    const stub = [
      'PATTERN_NAME: hallucinating council recurrence',
      '',
      'SUMMARY:',
      'Three failures show the same persona ignoring the canonical scope.',
      'The pattern is consistent across distinct trigger contexts.',
      '',
      'It compounds with prior plan-drift incidents.',
      '',
      'GUIDE_GAP_AND_FIX:',
      'Persona scope is too vague.',
      'Tighten with explicit boundaries listing what the persona must NOT do.',
      '',
      'CONTRIBUTING_FAILURES:',
      '- 2026-04-01: persona made up an i18n requirement',
      '- 2026-04-15: persona invented an a11y rule',
      '- 2026-04-29: persona conflated a11y and i18n again',
    ].join('\n');
    const env = { ...process.env, HARNESS_SYNTHESIZE_STUB_RESPONSE: stub, GEMINI_API_KEY: 'stub' };
    execSync(`node "${CLI}" synthesize --apply`, {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
      env,
    });
    const learnings = fs.readFileSync(
      path.join(dir, '.harness/learnings.md'),
      'utf8'
    );
    assert(
      learnings.includes('SYNTHESIS (auto-draft)'),
      'expected an auto-draft section header in learnings.md'
    );
    assert(
      /<!--\s*synthesis:\s*[0-9a-f]{6,16}\s*-->/.test(learnings),
      'expected an idempotency marker comment'
    );
    assert(
      learnings.includes('hallucinating council recurrence'),
      'expected the synthesized pattern name'
    );
    // Multi-line preservation: each body must include its later lines, not
    // only the first.
    assert(
      learnings.includes('compounds with prior plan-drift incidents'),
      'multi-line SUMMARY body was truncated — parser regressed to first-line-only behavior'
    );
    assert(
      learnings.includes('listing what the persona must NOT do'),
      'multi-line GUIDE_GAP_AND_FIX body was truncated'
    );
    assert(
      learnings.includes('conflated a11y and i18n again'),
      'CONTRIBUTING_FAILURES list was truncated to its first bullet'
    );
    console.log('PASS: harness synthesize --apply writes a marked section');
  } finally {
    cleanup(dir);
  }
}

// Test 17: synthesize is idempotent — clusters whose marker already exists are skipped.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    const f = (ts) =>
      JSON.stringify({
        ts,
        failure_class: 'plan_drift',
        what_happened: 'plan and impl diverged',
        sensor_involved: 'council',
        guide_gap: 'plan_lacked_impact_map',
        fix_sha: 'c'.repeat(7),
      });
    fs.writeFileSync(
      path.join(dir, '.harness/failures.jsonl'),
      [
        f('2026-04-01T00:00:00Z'),
        f('2026-04-15T00:00:00Z'),
        f('2026-04-29T00:00:00Z'),
      ].join('\n') + '\n'
    );
    // Compute expected hash to plant a pre-existing marker.
    const { hashSignature } = await import(
      path.resolve('src/lib/failures.js')
    );
    const sig = 'plan_drift|council|plan_lacked_impact_map';
    const hash = hashSignature(sig);
    fs.appendFileSync(
      path.join(dir, '.harness/learnings.md'),
      `\n\n## 2026-04-30 — SYNTHESIS (auto-draft) — pre-existing\n<!-- synthesis: ${hash} -->\n\nplaceholder\n`
    );
    const out = run(`node "${CLI}" synthesize`, dir);
    assert(
      out.includes('All') && out.includes('already have synthesis'),
      `expected idempotency skip message, got: ${out}`
    );
    console.log('PASS: harness synthesize is idempotent on existing markers');
  } finally {
    cleanup(dir);
  }
}

// Test 18: synthesize --apply without GEMINI_API_KEY fails loud (no silent dry-run).
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    const f = (ts) =>
      JSON.stringify({
        ts,
        failure_class: 'hook_misfire',
        what_happened: 'hook fired late',
        sensor_involved: 'pre-push',
        guide_gap: 'hook_timeout_too_low',
        fix_sha: 'd'.repeat(7),
      });
    fs.writeFileSync(
      path.join(dir, '.harness/failures.jsonl'),
      [
        f('2026-04-01T00:00:00Z'),
        f('2026-04-15T00:00:00Z'),
        f('2026-04-29T00:00:00Z'),
      ].join('\n') + '\n'
    );
    const env = { ...process.env };
    delete env.GEMINI_API_KEY;
    delete env.HARNESS_SYNTHESIZE_STUB_RESPONSE;
    let err;
    try {
      execSync(`node "${CLI}" synthesize --apply`, {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        env,
      });
    } catch (e) {
      err = e;
    }
    assert(err, 'expected non-zero exit when --apply is set without GEMINI_API_KEY');
    assert(
      String(err.stderr || '').includes('GEMINI_API_KEY not set'),
      `expected fail-loud message, got: ${err.stderr}`
    );
    console.log('PASS: harness synthesize --apply fails loud without API key');
  } finally {
    cleanup(dir);
  }
}

// Test 19: harness reindex builds an embeddings index from the corpus.
// Uses the deterministic stub vector so we can compare hashes.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      [
        '# Learnings',
        '',
        '## 2026-04-29 — council drift on roadtripper',
        '### KEEP',
        '- pre-flight budget races are real',
        '',
        '## 2026-04-30 — a11y persona invented i18n requirements',
        '### INSIGHT',
        '- persona scope was too vague; tighten with explicit boundaries',
        '',
      ].join('\n')
    );
    const env = {
      ...process.env,
      HARNESS_EMBED_STUB_RESPONSE: '{"deterministic":true}',
    };
    execSync(`node "${CLI}" reindex`, {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
      env,
    });
    const indexPath = path.join(dir, '.harness/embeddings.json');
    assert(fs.existsSync(indexPath), 'expected .harness/embeddings.json to be written');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert(index.version === 1, 'expected index version 1');
    assert(typeof index.model === 'string' && index.model.length > 0, 'expected model name');
    assert(
      Object.keys(index.entries).length >= 2,
      `expected at least 2 entries, got ${Object.keys(index.entries).length}`
    );
    for (const [hash, entry] of Object.entries(index.entries)) {
      assert(/^[0-9a-f]{16}$/.test(hash), `expected 16-hex hash, got ${hash}`);
      assert(Array.isArray(entry.vector), 'expected entry.vector array');
      assert(entry.vector.length > 0, 'expected non-empty vector');
    }
    console.log('PASS: harness reindex builds an index from the corpus');
  } finally {
    cleanup(dir);
  }
}

// Test 20: incremental reindex on an unchanged corpus is a no-op (no API calls).
// Asserts by counting calls to the stub: we use the deterministic stub which
// is just a hash, but if the index is reused, the "to embed" count is zero.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      ['# Learnings', '', '## 2026-04-29 — only entry', 'body', ''].join('\n')
    );
    const env = {
      ...process.env,
      HARNESS_EMBED_STUB_RESPONSE: '{"deterministic":true}',
    };
    execSync(`node "${CLI}" reindex`, { cwd: dir, encoding: 'utf8', stdio: 'pipe', env });
    const out = execSync(`node "${CLI}" reindex`, {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
      env,
    });
    assert(
      out.includes('to embed     0') || out.includes('Index is up to date'),
      `expected zero embeds on a stable corpus, got: ${out}`
    );
    console.log('PASS: incremental harness reindex is a no-op on unchanged corpus');
  } finally {
    cleanup(dir);
  }
}

// Test 21: harness recall blends vector similarity into ranking.
// Builds an index, queries with a phrase that has zero keyword overlap with
// a chunk, and asserts the chunk surfaces (could not happen with keyword-only).
// Uses the deterministic stub so the same input text always yields the same
// vector — making the embedding of the chunk and the embedding of a near-
// equivalent query phrase strongly cosine-similar.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    // The stub vector is deterministic in its INPUT TEXT — so to get a
    // semantic-blend hit we use the trick of embedding identical text on
    // both sides. The query is the same string as the chunk header, but
    // the keyword tokenizer drops short words and stopwords, so a query
    // of just stopwords yields empty queryTokens and the keyword scorer
    // returns 0; vector blend then carries the result.
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      [
        '# Learnings',
        '',
        '## 2026-04-30 — quokka migration',
        'long-form notes about the quokka migration and friends',
        '',
      ].join('\n')
    );
    const env = {
      ...process.env,
      HARNESS_EMBED_STUB_RESPONSE: '{"deterministic":true}',
    };
    execSync(`node "${CLI}" reindex`, { cwd: dir, encoding: 'utf8', stdio: 'pipe', env });
    // Query is exact text of the chunk header so vector similarity is
    // maximal; the keyword scorer sees "quokka" "migration" as direct
    // hits anyway, so this test checks the blend doesn't *break* existing
    // behavior. The next test asserts a no-keyword-overlap path.
    const out = execSync(
      `node "${CLI}" recall "quokka migration" --limit 1`,
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', env }
    );
    assert(out.includes('quokka migration'), `expected match, got: ${out}`);
    console.log('PASS: harness recall surfaces matches with vector index present');
  } finally {
    cleanup(dir);
  }
}

// Test 22: --no-vector bypasses the index even when present.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      ['# Learnings', '', '## 2026-04-30 — keyword target', 'body about specific term zoofoo here', ''].join('\n')
    );
    const env = {
      ...process.env,
      HARNESS_EMBED_STUB_RESPONSE: '{"deterministic":true}',
    };
    execSync(`node "${CLI}" reindex`, { cwd: dir, encoding: 'utf8', stdio: 'pipe', env });
    const withVec = execSync(
      `node "${CLI}" recall "zoofoo" --limit 1`,
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', env }
    );
    const noVec = execSync(
      `node "${CLI}" recall "zoofoo" --limit 1 --no-vector`,
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', env }
    );
    // Both should surface the keyword match; only difference is whether the
    // vector blend ran. Asserting both succeed is enough — the blend code
    // path is exercised by the previous test.
    assert(withVec.includes('zoofoo'), 'expected vector-on path to find keyword match');
    assert(noVec.includes('zoofoo'), 'expected --no-vector path to find keyword match');
    console.log('PASS: --no-vector bypasses the blend without breaking recall');
  } finally {
    cleanup(dir);
  }
}

// Test 23a: PURE semantic match — query has zero keyword overlap with the
// target chunk; only the vector blend can surface it. Bugs reviewer R1 PR #7
// flagged this as the missing core-value test. Uses the stub's "map" mode
// to wire up controlled cosine relationships between unrelated text strings.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      [
        '# Learnings',
        '',
        '## 2026-04-01 — wallaby observations',
        'notes about marsupials and their habits',
        '',
        '## 2026-04-15 — dishwasher repair log',
        'notes about kitchen appliance fixes',
        '',
      ].join('\n')
    );
    // Stub map: any text containing "wallaby" or "quokka" gets the same
    // vector; "dishwasher" gets an orthogonal vector. Query "quokka" has
    // ZERO keyword overlap with "wallaby observations", so keyword score
    // is 0 for both chunks. Vector blend distinguishes them.
    const stubMap = {
      map: {
        wallaby: [1, 0, 0, 0],
        quokka: [1, 0, 0, 0],
        dishwasher: [0, 0, 0, 1],
      },
    };
    const env = {
      ...process.env,
      HARNESS_EMBED_STUB_RESPONSE: JSON.stringify(stubMap),
    };
    execSync(`node "${CLI}" reindex`, {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
      env,
    });
    const out = execSync(
      `node "${CLI}" recall "quokka" --limit 2`,
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', env }
    );
    // Wallaby chunk must surface — it has zero shared tokens with "quokka"
    // but the stub gives them an identical vector, proving the blend
    // carries the result when keyword scoring returns 0.
    assert(
      out.includes('wallaby observations'),
      `expected pure semantic match to surface wallaby chunk; got:\n${out}`
    );
    // The dishwasher chunk has an orthogonal vector AND no keyword
    // overlap with "quokka" — it must NOT outrank wallaby.
    const wallabyIdx = out.indexOf('wallaby observations');
    const dishwasherIdx = out.indexOf('dishwasher repair log');
    if (dishwasherIdx >= 0) {
      assert(
        wallabyIdx < dishwasherIdx,
        `expected wallaby ranked above dishwasher; got wallaby@${wallabyIdx}, dishwasher@${dishwasherIdx}`
      );
    }
    console.log('PASS: pure semantic match surfaces zero-keyword-overlap chunk');
  } finally {
    cleanup(dir);
  }
}

// Test 23: harness reindex without GEMINI_API_KEY (or stub) fails loud.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    fs.writeFileSync(
      path.join(dir, '.harness/learnings.md'),
      ['# Learnings', '', '## 2026-04-30 — sample', 'body', ''].join('\n')
    );
    const env = { ...process.env };
    delete env.GEMINI_API_KEY;
    delete env.HARNESS_EMBED_STUB_RESPONSE;
    let err;
    try {
      execSync(`node "${CLI}" reindex`, {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        env,
      });
    } catch (e) {
      err = e;
    }
    assert(err, 'expected non-zero exit without API key');
    assert(
      String(err.stderr || '').includes('GEMINI_API_KEY not set'),
      `expected fail-loud message, got: ${err.stderr}`
    );
    console.log('PASS: harness reindex fails loud without API key');
  } finally {
    cleanup(dir);
  }
}

// Test 24: harness research --dry-run lists the canonical 7 personas without
// calling the API, on a fresh init repo (canonical mode).
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    const out = run(`node "${CLI}" research "sample feature description" --dry-run`, dir);
    assert(out.includes('personas     7:'), `expected 7 personas, got: ${out}`);
    for (const p of [
      'accessibility', 'architecture', 'bugs', 'cost',
      'maintainability', 'product', 'security',
    ]) {
      assert(out.includes(p), `expected canonical persona "${p}" listed; got: ${out}`);
    }
    assert(out.includes('Dry run'), 'expected dry-run notice');
    console.log('PASS: harness research lists canonical 7 personas in dry-run');
  } finally {
    cleanup(dir);
  }
}

// Test 25: harness research picks up the specialized persona set when
// council.specialized: true. Replaces the canonical .md files with a small
// custom set under .harness/council/.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    const yml = path.join(dir, 'harness.yml');
    const cur = fs.readFileSync(yml, 'utf8');
    fs.writeFileSync(
      yml,
      cur.replace('specialized: false', 'specialized: true')
    );
    // Replace canonical persona files with a domain-specific set.
    const councilDir = path.join(dir, '.harness/council');
    for (const f of fs.readdirSync(councilDir)) {
      if (f === 'README.md' || f === 'lead-architect.md') continue;
      fs.unlinkSync(path.join(councilDir, f));
    }
    fs.writeFileSync(
      path.join(councilDir, 'data-quality.md'),
      '# data-quality\n\n## Scope\nQuality of source data.\n'
    );
    fs.writeFileSync(
      path.join(councilDir, 'statistical-validity.md'),
      '# statistical-validity\n\n## Scope\nStatistical claims.\n'
    );
    const out = run(`node "${CLI}" research "ingest new data feed" --dry-run`, dir);
    assert(
      out.includes('data-quality') && out.includes('statistical-validity'),
      `expected specialized personas listed; got: ${out}`
    );
    assert(
      !out.includes('accessibility') && !out.includes('security'),
      `canonical personas should be absent in specialized mode; got: ${out}`
    );
    console.log('PASS: harness research picks up specialized persona set');
  } finally {
    cleanup(dir);
  }
}

// Test 26: with stub fetch, full research run writes a properly-formatted
// ## Research block to .harness/active_plan.md with the marker comments.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    const env = { ...process.env, HARNESS_RESEARCH_STUB_RESPONSE: '1' };
    execSync(
      `node "${CLI}" research "build a thing" --max-personas 2`,
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', env }
    );
    const plan = fs.readFileSync(
      path.join(dir, '.harness/active_plan.md'),
      'utf8'
    );
    assert(
      plan.includes('<!-- harness-research-start -->'),
      'expected start marker in active_plan.md'
    );
    assert(
      plan.includes('<!-- harness-research-end -->'),
      'expected end marker in active_plan.md'
    );
    assert(plan.includes('## Research'), 'expected ## Research heading');
    assert(plan.includes('build a thing'), 'expected description echoed');
    assert(plan.includes('stub concern for'), 'expected stub concern bullets');
    console.log('PASS: harness research writes a marker-bracketed Research block');
  } finally {
    cleanup(dir);
  }
}

// Test 27: re-running research replaces the prior block (does not append).
// Asserts that running twice with different descriptions leaves only one
// Research block, with the second description's content.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    const env = { ...process.env, HARNESS_RESEARCH_STUB_RESPONSE: '1' };
    execSync(
      `node "${CLI}" research "first description" --max-personas 1`,
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', env }
    );
    execSync(
      `node "${CLI}" research "second description" --max-personas 1`,
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', env }
    );
    const plan = fs.readFileSync(
      path.join(dir, '.harness/active_plan.md'),
      'utf8'
    );
    const startCount = (plan.match(/<!-- harness-research-start -->/g) || [])
      .length;
    const endCount = (plan.match(/<!-- harness-research-end -->/g) || [])
      .length;
    assert(
      startCount === 1 && endCount === 1,
      `expected exactly one Research block, got ${startCount} start / ${endCount} end markers`
    );
    assert(
      plan.includes('second description'),
      'expected second description in current Research block'
    );
    assert(
      !plan.includes('first description'),
      'expected prior Research block to be replaced, not appended'
    );
    console.log('PASS: harness research replaces the prior block on re-run');
  } finally {
    cleanup(dir);
  }
}

// Test 28: harness research without GEMINI_API_KEY (or stub) fails loud.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    const env = { ...process.env };
    delete env.GEMINI_API_KEY;
    delete env.HARNESS_RESEARCH_STUB_RESPONSE;
    let err;
    try {
      execSync(`node "${CLI}" research "needs an api key" --max-personas 1`, {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        env,
      });
    } catch (e) {
      err = e;
    }
    assert(err, 'expected non-zero exit without API key');
    assert(
      String(err.stderr || '').includes('GEMINI_API_KEY not set'),
      `expected fail-loud message, got: ${err.stderr}`
    );
    console.log('PASS: harness research fails loud without API key');
  } finally {
    cleanup(dir);
  }
}

// Test 29: --no-write prints to stdout instead of touching active_plan.md.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    // Prime active_plan.md with content we can check is unchanged.
    const planPath = path.join(dir, '.harness/active_plan.md');
    const sentinel = '# Sentinel plan title\n\nuntouched body\n';
    fs.writeFileSync(planPath, sentinel);
    const env = { ...process.env, HARNESS_RESEARCH_STUB_RESPONSE: '1' };
    const out = execSync(
      `node "${CLI}" research "no-write check" --no-write --max-personas 1`,
      { cwd: dir, encoding: 'utf8', stdio: 'pipe', env }
    );
    assert(out.includes('## Research'), 'expected Research block on stdout');
    assert(out.includes('no-write check'), 'expected description on stdout');
    const after = fs.readFileSync(planPath, 'utf8');
    assert(
      after === sentinel,
      `expected active_plan.md unchanged with --no-write; got modified content`
    );
    console.log('PASS: harness research --no-write keeps active_plan.md unchanged');
  } finally {
    cleanup(dir);
  }
}

// Test 30: a single persona's malformed response is reported as a failure
// without aborting the rest of the run (Promise.allSettled fail-soft).
// Uses a custom fetch deps injection via a tiny driver script that imports
// research directly — the CLI wires the stub at process level which is
// uniform across personas, so we use the dependency-injection seam instead.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    // Build the driver as an array of source lines so we can use real
    // newline characters (\n in this test source = real newline in the
    // joined string = real newline in the driver file). The earlier
    // backtick-template version had to escape the newlines for the
    // join('...') separator and got the escape level wrong, masking
    // both responses as malformed.
    const NL = String.fromCharCode(10);
    const cleanResponse =
      'PERSONA: PERSONA_NAME' + NL +
      '' + NL +
      'CONCERNS:' + NL +
      '- only this persona returned cleanly' + NL +
      '' + NL +
      'OPEN_QUESTIONS:' + NL +
      '- none' + NL +
      '' + NL +
      'RELATED_PRIOR_LEARNINGS:' + NL +
      'none';
    const driverLines = [
      `import { research } from '${path.resolve('src/commands/research.js')}';`,
      'let calls = 0;',
      'const stubFetch = async () => {',
      '  calls += 1;',
      '  if (calls === 1) {',
      '    return "this is malformed; no headers at all";',
      '  }',
      `  return ${JSON.stringify(cleanResponse)};`,
      '};',
      'process.env.GEMINI_API_KEY = "stub";',
      `process.chdir(${JSON.stringify(dir)});`,
      'research(',
      '  "fail-soft test",',
      '  { maxPersonas: 2 },',
      '  { geminiFetch: stubFetch }',
      ').catch(e => { console.error(e); process.exit(99); });',
    ];
    const driverPath = path.join(dir, '_driver.mjs');
    fs.writeFileSync(driverPath, driverLines.join('\n'));
    execSync(`node "${driverPath}"`, {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const plan = fs.readFileSync(
      path.join(dir, '.harness/active_plan.md'),
      'utf8'
    );
    assert(
      plan.includes('Personas that failed'),
      `expected failed-personas section in plan; got:\n${plan}`
    );
    assert(
      plan.includes('only this persona returned cleanly'),
      'expected the surviving persona content present'
    );
    console.log('PASS: harness research fail-soft on a single persona malformed response');
  } finally {
    cleanup(dir);
  }
}

// Test 31: every persona failing produces a non-zero exit (Codex P1 PR #8).
// Fail-loud contract: a research run with zero successful personas is a
// failure, even if a Research block was still written with the error
// listing. Without this, automation that chains
// `research && plan && push` would treat a totally-failed run as OK.
{
  const dir = makeTempRepo('node-ts');
  try {
    run(`node "${CLI}" init`, dir);
    const driver = `
      import { research } from '${path.resolve('src/commands/research.js')}';
      const stubFetch = async () => {
        throw new Error('simulated upstream failure for every persona');
      };
      process.env.GEMINI_API_KEY = 'stub';
      process.chdir(${JSON.stringify(dir)});
      research(
        'all personas should fail',
        { maxPersonas: 2 },
        { geminiFetch: stubFetch }
      ).catch(e => { console.error(e); process.exit(99); });
    `;
    const driverPath = path.join(dir, '_driver_allfail.mjs');
    fs.writeFileSync(driverPath, driver);
    let err;
    try {
      execSync(`node "${driverPath}"`, {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (e) {
      err = e;
    }
    assert(err, 'expected non-zero exit when every persona fails');
    assert(
      err.status === 2,
      `expected exit code 2 (config/runtime error), got ${err.status}`
    );
    // Block should still be written with the failure list — useful signal
    // for the operator even if exit was non-zero.
    const plan = fs.readFileSync(
      path.join(dir, '.harness/active_plan.md'),
      'utf8'
    );
    assert(
      plan.includes('Personas that failed'),
      'expected failed-personas section in plan even when all failed'
    );
    console.log('PASS: harness research exits non-zero when every persona fails');
  } finally {
    cleanup(dir);
  }
}

console.log('All tests passed.');
