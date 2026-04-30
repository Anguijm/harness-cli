import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';

// Repository Impact Map: scan the actual codebase to ground a plan before
// writing it. Extracts candidate identifiers from the feature description,
// greps the repo for matches, and produces a Markdown block listing the
// likely-affected files, the symbols found in them, and any sibling tests.
//
// Anti-pattern this prevents: "vague in, vague out" — plans that reference
// hallucinated file paths or invented APIs because the AI wrote them from
// the description alone without grounding.
//
// Usage:
//   harness map "Add Stripe webhook handling for payment events"
//   harness map "<description>" --write     # prepend block to .harness/active_plan.md

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.harness',     // don't suggest harness internals as impact
  '.husky',
  '.budget',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
  'data',         // scraped / fixture / generated data
  'fixtures',
  'snapshots',
  '.snapshots',
]);

const TEST_DIR_NAMES = new Set(['test', 'tests', '__tests__', 'spec', 'specs']);
const TEST_FILE_RE = /\.(?:test|spec)\.(?:[jt]sx?|py)$/;

// Extract candidate identifiers worth grepping for.
// Skip common stop words to avoid grepping for "the", "and", "feature".
const STOP_WORDS = new Set([
  'add', 'and', 'the', 'for', 'with', 'from', 'into', 'onto', 'when', 'where',
  'what', 'which', 'this', 'that', 'these', 'those', 'feature', 'support',
  'handle', 'handles', 'handling', 'should', 'would', 'could', 'must', 'will',
  'new', 'old', 'fix', 'bug', 'all', 'any', 'each', 'some', 'one', 'two',
  'system', 'systems', 'change', 'changes', 'update', 'updates', 'allow',
  'enable', 'disable', 'remove', 'delete', 'create', 'modify',
]);

function extractIdentifiers(description) {
  const candidates = new Set();

  // Quoted strings.
  for (const m of description.matchAll(/['"`]([^'"`]+)['"`]/g)) {
    candidates.add(m[1]);
  }

  // File-like tokens (foo.ts, foo.py).
  for (const m of description.matchAll(/\b[\w/-]+\.(?:tsx?|jsx?|py|md|ya?ml|json|toml)\b/g)) {
    candidates.add(m[0]);
  }

  // PascalCase identifiers (classes, types).
  for (const m of description.matchAll(/\b[A-Z][a-zA-Z0-9]{2,}\b/g)) {
    candidates.add(m[0]);
  }

  // snake_case (must have at least one underscore).
  for (const m of description.matchAll(/\b[a-z][a-z0-9]+(?:_[a-z0-9]+)+\b/g)) {
    candidates.add(m[0]);
  }

  // kebab-case (must have at least one dash, length > 4).
  for (const m of description.matchAll(/\b[a-z][a-z0-9]+(?:-[a-z0-9]+)+\b/g)) {
    if (m[0].length > 4) candidates.add(m[0]);
  }

  // Single significant words (5+ chars, not stop words). Last-resort signal.
  for (const m of description.matchAll(/\b[a-z]{5,}\b/g)) {
    if (!STOP_WORDS.has(m[0].toLowerCase())) candidates.add(m[0]);
  }

  return [...candidates];
}

function gitGrep(cwd, term) {
  // Use git grep (fast, respects .gitignore). --untracked includes files
  // that haven't been committed yet — useful in fresh repos or before the
  // first commit. --no-index would also work but is slower on large trees.
  try {
    const out = execSync(
      `git grep -l --untracked -- ${shellEscape(term)} 2>/dev/null || true`,
      { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    );
    return out
      .split('\n')
      .filter((l) => l.length > 0)
      .filter((p) => !pathInIgnoredDir(p));
  } catch {
    return [];
  }
}

function shellEscape(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function pathInIgnoredDir(p) {
  return p.split('/').some((seg) => IGNORE_DIRS.has(seg));
}

function findTestsFor(cwd, sourcePath) {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath).replace(/\.[^.]+$/, '');
  const candidates = [];
  // Sibling test file (foo.test.ts next to foo.ts).
  for (const ext of ['ts', 'tsx', 'js', 'jsx', 'py']) {
    for (const suffix of ['test', 'spec']) {
      const guess = path.join(dir, `${base}.${suffix}.${ext}`);
      if (fs.existsSync(path.join(cwd, guess))) candidates.push(guess);
    }
  }
  // Test under a tests/ dir at the package root: walk up until we find one.
  let up = dir;
  while (up && up !== '.' && up !== '/') {
    for (const tname of TEST_DIR_NAMES) {
      const tdir = path.join(up, tname);
      if (fs.existsSync(path.join(cwd, tdir))) {
        try {
          const out = execSync(
            `git grep -l -- ${shellEscape(base)} -- ${shellEscape(tdir)} 2>/dev/null || true`,
            { cwd, encoding: 'utf8' }
          );
          out.split('\n').filter(Boolean).forEach((p) => candidates.push(p));
        } catch {
          // ignore
        }
      }
    }
    const parent = path.dirname(up);
    if (parent === up) break;
    up = parent;
  }
  return [...new Set(candidates)];
}

function classifyFile(p) {
  if (TEST_FILE_RE.test(p)) return 'test';
  if (p.startsWith('.github/')) return 'workflow';
  if (p.endsWith('.md')) return 'doc';
  if (p.endsWith('.json') || p.endsWith('.yml') || p.endsWith('.yaml') || p.endsWith('.toml')) {
    return 'config';
  }
  return 'source';
}

export async function map(description, options) {
  const cwd = process.cwd();
  if (!description || !description.trim()) {
    console.error(chalk.red('Pass a feature description: harness map "what to build"'));
    process.exit(1);
  }

  // Verify we're in a git repo.
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' });
  } catch {
    console.error(chalk.red('Not in a git repo. harness map needs git grep.'));
    process.exit(1);
  }

  const identifiers = extractIdentifiers(description);
  if (identifiers.length === 0) {
    console.error(
      chalk.yellow(
        'No candidate identifiers found in description. Use specific symbol names, file names, or quoted strings.'
      )
    );
    process.exit(1);
  }

  if (options.verbose) {
    console.error(chalk.dim(`Candidate terms: ${identifiers.join(', ')}`));
  }

  // For each identifier, find files. Collect file → terms-found-in-it.
  const fileHits = new Map(); // path → { terms: Set, count }
  for (const term of identifiers) {
    const files = gitGrep(cwd, term);
    for (const f of files) {
      if (!fileHits.has(f)) fileHits.set(f, { terms: new Set(), count: 0 });
      fileHits.get(f).terms.add(term);
      fileHits.get(f).count += 1;
    }
  }

  if (fileHits.size === 0) {
    console.error(
      chalk.yellow(
        'No files matched any identifier. Either the feature is wholly new (no existing surface) or the description needs more specific terms.'
      )
    );
    // Still produce the empty block — useful signal.
  }

  // Rank: more matched terms = higher relevance; tie-break by total hits.
  const ranked = [...fileHits.entries()]
    .map(([p, info]) => ({
      path: p,
      terms: [...info.terms],
      score: info.terms.size * 10 + info.count,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || 30);

  // Group by classification.
  const groups = { source: [], test: [], config: [], doc: [], workflow: [] };
  for (const r of ranked) groups[classifyFile(r.path)].push(r);

  // For source files, find their test files.
  for (const r of groups.source) {
    r.tests = findTestsFor(cwd, r.path);
  }

  // Render.
  const lines = [];
  lines.push('## Repository Impact');
  lines.push('');
  lines.push(`_Generated by \`harness map\` from: ${truncate(description, 200)}_`);
  lines.push('');
  lines.push(`_Candidate terms: ${identifiers.slice(0, 10).join(', ')}${identifiers.length > 10 ? `, +${identifiers.length - 10} more` : ''}_`);
  lines.push('');

  if (groups.source.length) {
    lines.push('### Likely-affected source files');
    lines.push('');
    for (const r of groups.source) {
      const tests = r.tests.length ? `  (tests: ${r.tests.join(', ')})` : '  (no test file found)';
      lines.push(`- \`${r.path}\` — matched: ${r.terms.join(', ')}${tests}`);
    }
    lines.push('');
  }

  if (groups.test.length) {
    lines.push('### Test files referencing these terms');
    lines.push('');
    for (const r of groups.test) {
      lines.push(`- \`${r.path}\` — matched: ${r.terms.join(', ')}`);
    }
    lines.push('');
  }

  if (groups.config.length) {
    lines.push('### Config / schema files');
    lines.push('');
    for (const r of groups.config) {
      lines.push(`- \`${r.path}\` — matched: ${r.terms.join(', ')}`);
    }
    lines.push('');
  }

  if (groups.workflow.length) {
    lines.push('### Workflow files');
    lines.push('');
    for (const r of groups.workflow) {
      lines.push(`- \`${r.path}\` — matched: ${r.terms.join(', ')}`);
    }
    lines.push('');
  }

  if (groups.doc.length) {
    lines.push('### Documentation referencing these terms');
    lines.push('');
    for (const r of groups.doc) {
      lines.push(`- \`${r.path}\` — matched: ${r.terms.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('### Notes for the planner');
  lines.push('');
  lines.push('- The list above is grounded in the actual repo. If a file you expect is missing, the feature has no existing surface (genuinely new code) — note this in the plan.');
  lines.push('- If a file appears that you do NOT expect, investigate before writing the plan — there may be hidden coupling.');
  lines.push('- Tests listed above are the existing fixtures. New behavior needs new test cases under the same paths.');
  lines.push('');

  const block = lines.join('\n');

  if (options.write) {
    const planPath = path.join(cwd, '.harness', 'active_plan.md');
    let existing = '';
    if (fs.existsSync(planPath)) {
      existing = fs.readFileSync(planPath, 'utf8');
      // Strip any prior Repository Impact block — replace, don't accumulate.
      existing = existing.replace(/^## Repository Impact[\s\S]*?(?=\n## (?!Repository Impact)|$)/m, '');
    }
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, block + '\n' + existing.trimStart());
    console.log(chalk.green(`Wrote impact map to ${planPath}`));
    console.log(chalk.dim(`Now write your plan under the impact block, then commit and run the council.`));
  } else {
    process.stdout.write(block + '\n');
  }
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
}
