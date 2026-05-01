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

console.log('All tests passed.');
