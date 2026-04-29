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
