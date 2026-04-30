// harness lint — periodic health check on .harness/ memory artifacts.
//
// LLM Wiki pattern's biggest weakness (per Karpathy + the Yanli Liu article):
// no decay handling. learnings.md and failures.jsonl accumulate forever; old
// entries reference files that have moved, PRs that closed, commits that got
// rebased away. Without a lint pass, the corpus becomes a graveyard.
//
// Checks:
//   1. file_refs       — markdown/jsonl mentions a path; verify it exists on HEAD
//   2. sha_refs        — failures.jsonl fix_sha must be reachable in git
//   3. orphan_failures — failures.jsonl entries with no resolvable fix_sha
//   4. schema          — failures.jsonl entries match the canonical schema
//   5. empty_entries   — learnings.md sections with bare template bullets
//   6. date_sanity     — section headers have valid, non-future dates
//   7. duplicate_signal — failures.jsonl clusters of same {class, sensor, gap}
//                          (signal that a synthesis page is needed)
//
// Exit 0 if clean. Exit 1 if any errors. Warnings don't fail.
// --fix removes orphaned failures.jsonl entries (the only safe auto-fix).

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

const REQUIRED_FAILURE_FIELDS = [
  'ts',
  'failure_class',
  'what_happened',
  'sensor_involved',
  'guide_gap',
];
const OPTIONAL_FAILURE_FIELDS = ['fix_sha', 'canonical_backport'];
const VALID_FAILURE_CLASSES = new Set([
  'sensor_miss',
  'sensor_false_positive',
  'hook_misfire',
  'council_drift',
  'plan_drift',
  'other',
]);

// Path-shaped tokens to look up. Avoids matching every common word — must
// have a slash or a recognized extension.
const PATH_RE = /\b((?:src|configs?|scripts|tests?|\.harness|\.claude|\.github|\.husky|data|docs|public|app|lib|components)\/[\w./-]+|[\w./-]+\.(?:tsx?|jsx?|py|md|ya?ml|json|toml|sh))\b/g;

const SHA_RE = /\b([0-9a-f]{7,40})\b/g; // git short-sha or full

function hasPath(cwd, p) {
  return fs.existsSync(path.join(cwd, p));
}

function shaExists(cwd, sha) {
  try {
    execSync(`git cat-file -e ${sha}`, {
      cwd,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function loadLearnings(cwd) {
  const p = path.join(cwd, '.harness/learnings.md');
  if (!fs.existsSync(p)) return null;
  return { path: '.harness/learnings.md', content: fs.readFileSync(p, 'utf8') };
}

function loadFailures(cwd) {
  const p = path.join(cwd, '.harness/failures.jsonl');
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  return lines
    .map((line, idx) => ({ line, lineNo: idx + 1 }))
    .filter((x) => x.line.trim().length > 0)
    .map(({ line, lineNo }) => {
      try {
        return { ok: true, lineNo, raw: line, parsed: JSON.parse(line) };
      } catch (e) {
        return { ok: false, lineNo, raw: line, error: e.message };
      }
    });
}

function chunkLearnings(content) {
  // Split on H2 (## headings).
  const lines = content.split('\n');
  const chunks = [];
  let current = null;
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    if (/^##\s+(?!#)/.test(line)) {
      if (current) chunks.push(current);
      current = { header: line, headerLineNo: lineNo, body: [] };
    } else if (current) {
      current.body.push({ line, lineNo });
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function checkFileRefs(cwd, learnings, failureLines) {
  const issues = [];
  const sources = [];
  if (learnings) {
    learnings.content.split('\n').forEach((line, idx) => {
      sources.push({ source: learnings.path, line, lineNo: idx + 1 });
    });
  }
  for (const f of failureLines) {
    sources.push({ source: '.harness/failures.jsonl', line: f.raw, lineNo: f.lineNo });
  }
  for (const { source, line, lineNo } of sources) {
    // Skip code fences and obvious URLs.
    if (line.trim().startsWith('```')) continue;
    let m;
    PATH_RE.lastIndex = 0;
    while ((m = PATH_RE.exec(line)) !== null) {
      const candidate = m[1];
      // Skip obvious non-paths.
      if (candidate.startsWith('http')) continue;
      if (candidate.includes('//')) continue; // URL artifact
      if (candidate.length < 3) continue;
      if (!hasPath(cwd, candidate)) {
        issues.push({
          severity: 'warning',
          check: 'file_refs',
          source,
          line: lineNo,
          message: `references "${candidate}" which doesn't exist on HEAD`,
        });
      }
    }
  }
  return issues;
}

function checkShaRefs(cwd, failureLines) {
  const issues = [];
  for (const f of failureLines) {
    if (!f.ok) continue;
    const sha = f.parsed.fix_sha;
    if (!sha || sha === 'pending' || sha.length < 7) continue;
    if (!shaExists(cwd, sha)) {
      issues.push({
        severity: 'error',
        check: 'sha_refs',
        source: '.harness/failures.jsonl',
        line: f.lineNo,
        message: `fix_sha "${sha}" not reachable in git history`,
      });
    }
  }
  return issues;
}

function checkOrphanFailures(failureLines) {
  const issues = [];
  for (const f of failureLines) {
    if (!f.ok) continue;
    const sha = f.parsed.fix_sha;
    if (!sha) {
      issues.push({
        severity: 'warning',
        check: 'orphan_failures',
        source: '.harness/failures.jsonl',
        line: f.lineNo,
        message: 'no fix_sha — failure recorded but no fix attached',
      });
    }
  }
  return issues;
}

function checkSchema(failureLines) {
  const issues = [];
  for (const f of failureLines) {
    if (!f.ok) {
      issues.push({
        severity: 'error',
        check: 'schema',
        source: '.harness/failures.jsonl',
        line: f.lineNo,
        message: `not valid JSON: ${f.error}`,
      });
      continue;
    }
    for (const field of REQUIRED_FAILURE_FIELDS) {
      if (!(field in f.parsed)) {
        issues.push({
          severity: 'error',
          check: 'schema',
          source: '.harness/failures.jsonl',
          line: f.lineNo,
          message: `missing required field "${field}"`,
        });
      }
    }
    if (f.parsed.failure_class && !VALID_FAILURE_CLASSES.has(f.parsed.failure_class)) {
      issues.push({
        severity: 'warning',
        check: 'schema',
        source: '.harness/failures.jsonl',
        line: f.lineNo,
        message: `failure_class "${f.parsed.failure_class}" not in canonical enum (${[...VALID_FAILURE_CLASSES].join('|')})`,
      });
    }
  }
  return issues;
}

function checkEmptyEntries(learnings) {
  const issues = [];
  if (!learnings) return issues;
  const chunks = chunkLearnings(learnings.content);
  for (const chunk of chunks) {
    const bodyText = chunk.body.map((l) => l.line).join('\n');
    // Look for sections that have KEEP/IMPROVE/INSIGHT/COUNCIL block markers
    // but no content under them (just bare bullets or empty).
    const blockMarkers = ['### KEEP', '### IMPROVE', '### INSIGHT', '### COUNCIL'];
    for (const marker of blockMarkers) {
      const idx = bodyText.indexOf(marker);
      if (idx < 0) continue;
      const tail = bodyText.slice(idx + marker.length);
      // Get content until next block marker or end
      const nextMarkerIdx = blockMarkers
        .map((m) => tail.indexOf(m))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b)[0];
      const blockContent = nextMarkerIdx != null ? tail.slice(0, nextMarkerIdx) : tail;
      // Strip whitespace and bare dashes; if nothing meaningful, flag
      const meaningful = blockContent
        .split('\n')
        .map((l) => l.replace(/^\s*-\s*$/, '').trim())
        .filter((l) => l.length > 0)
        .join('\n');
      if (!meaningful) {
        issues.push({
          severity: 'warning',
          check: 'empty_entries',
          source: learnings.path,
          line: chunk.headerLineNo,
          message: `section "${chunk.header.trim()}" has empty ${marker} block`,
        });
      }
    }
  }
  return issues;
}

function checkDateSanity(learnings) {
  const issues = [];
  if (!learnings) return issues;
  const chunks = chunkLearnings(learnings.content);
  const today = new Date();
  const tolerance = 1; // allow 1 day of clock skew
  const tomorrow = new Date(today.getTime() + (tolerance + 1) * 24 * 60 * 60 * 1000);
  for (const chunk of chunks) {
    const m = chunk.header.match(/(\d{4}-\d{2}-\d{2})/);
    if (!m) continue; // header without a date — fine
    const date = new Date(m[1]);
    if (isNaN(date.getTime())) {
      issues.push({
        severity: 'warning',
        check: 'date_sanity',
        source: learnings.path,
        line: chunk.headerLineNo,
        message: `unparseable date "${m[1]}" in section header`,
      });
    } else if (date >= tomorrow) {
      issues.push({
        severity: 'warning',
        check: 'date_sanity',
        source: learnings.path,
        line: chunk.headerLineNo,
        message: `future-dated section header (${m[1]})`,
      });
    }
  }
  return issues;
}

function checkDuplicateSignal(failureLines) {
  const issues = [];
  const groups = new Map();
  for (const f of failureLines) {
    if (!f.ok) continue;
    const key = `${f.parsed.failure_class}|${f.parsed.sensor_involved}|${f.parsed.guide_gap}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const [key, group] of groups.entries()) {
    if (group.length >= 3) {
      issues.push({
        severity: 'warning',
        check: 'duplicate_signal',
        source: '.harness/failures.jsonl',
        line: group[0].lineNo,
        message: `${group.length} failures share signature [${key}] — consider a synthesis page in learnings.md`,
      });
    }
  }
  return issues;
}

export async function lint(options) {
  const cwd = process.cwd();

  // Verify we're in a git repo (sha checks need it).
  let hasGit = true;
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' });
  } catch {
    hasGit = false;
  }

  const learnings = loadLearnings(cwd);
  const failureLines = loadFailures(cwd);

  if (!learnings && failureLines.length === 0) {
    console.log(
      chalk.dim(
        'No .harness/learnings.md or .harness/failures.jsonl found. Nothing to lint.'
      )
    );
    process.exit(0);
  }

  const issues = [
    ...checkSchema(failureLines),
    ...(hasGit ? checkShaRefs(cwd, failureLines) : []),
    ...checkOrphanFailures(failureLines),
    ...checkFileRefs(cwd, learnings, failureLines),
    ...checkEmptyEntries(learnings),
    ...checkDateSanity(learnings),
    ...checkDuplicateSignal(failureLines),
  ];

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const totalScanned =
    (learnings ? learnings.content.split('\n').length : 0) +
    failureLines.length;

  console.log(chalk.bold('harness lint report'));
  console.log();
  console.log(`  ${chalk.green('ok      ')} ${totalScanned - issues.length} (lines/entries scanned)`);
  console.log(`  ${chalk.yellow('warning ')} ${warnings.length}`);
  console.log(`  ${chalk.red('error   ')} ${errors.length}`);
  console.log();

  if (errors.length) {
    console.log(chalk.red.bold('Errors:'));
    for (const e of errors) {
      console.log(`  ${chalk.dim(`[${e.check}]`)} ${e.source}:${e.line} — ${e.message}`);
    }
    console.log();
  }

  if (warnings.length) {
    console.log(chalk.yellow.bold('Warnings (review manually):'));
    const grouped = {};
    for (const w of warnings) {
      grouped[w.check] = grouped[w.check] || [];
      grouped[w.check].push(w);
    }
    for (const [check, items] of Object.entries(grouped)) {
      console.log(`  ${chalk.bold(check)} (${items.length}):`);
      for (const w of items.slice(0, 10)) {
        console.log(`    ${w.source}:${w.line} — ${w.message}`);
      }
      if (items.length > 10) {
        console.log(`    ${chalk.dim(`... ${items.length - 10} more`)}`);
      }
    }
    console.log();
  }

  if (options.fix) {
    // Auto-fix: remove orphaned failures.jsonl entries (no fix_sha).
    const orphans = warnings.filter((w) => w.check === 'orphan_failures');
    if (orphans.length === 0) {
      console.log(chalk.dim('--fix: nothing safely auto-fixable.'));
    } else {
      const orphanLines = new Set(orphans.map((o) => o.line));
      const kept = failureLines.filter(
        (f) => !orphanLines.has(f.lineNo) && f.ok
      );
      const out = kept.map((f) => f.raw).join('\n') + '\n';
      fs.writeFileSync(path.join(cwd, '.harness/failures.jsonl'), out);
      console.log(chalk.green(`--fix: removed ${orphans.length} orphan failure entries.`));
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ errors, warnings, totalScanned }, null, 2));
  }

  process.exit(errors.length > 0 ? 1 : 0);
}
