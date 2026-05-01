import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  buildContext,
  detectStack,
  planFiles,
  readTemplate,
} from '../lib/template.js';
import { loadHarnessConfig } from '../lib/config.js';

// Canonical reviewer personas — the 7 angle reviewers that the harness ships
// with by default. Specialized-personas repos (council.specialized: true in
// harness.yml) replace these with domain-specific reviewers (e.g., sportsdata
// uses data-quality / statistical-validity / etc.) and skip the canonical 7
// in drift checks. lead-architect.md and council/README.md are NOT in this
// list — they're required even in specialized mode.
const CANONICAL_REVIEWER_PERSONAS = new Set([
  '.harness/council/accessibility.md',
  '.harness/council/architecture.md',
  '.harness/council/bugs.md',
  '.harness/council/cost.md',
  '.harness/council/maintainability.md',
  '.harness/council/product.md',
  '.harness/council/security.md',
]);

function isSpecializedMode(cwd) {
  const cfg = loadHarnessConfig(cwd);
  if (!cfg.exists) return false;
  if (!cfg.ok) {
    // Bugs reviewer R2 PR #4: malformed harness.yml should be a fatal
    // error in `harness check`, not silent fallback to default behavior.
    // Otherwise a typo causes drift-check to start reporting canonical
    // personas as missing with no indication the config is the problem.
    console.error(
      chalk.red(`harness.yml could not be parsed: ${cfg.error.message}`)
    );
    console.error(
      chalk.dim(
        `  Path: ${path.join(cwd, 'harness.yml')}\n  Fix the YAML syntax error and re-run.`
      )
    );
    process.exit(2);
  }
  return (
    cfg.parsed && cfg.parsed.council && cfg.parsed.council.specialized === true
  );
}

// Read-only drift report. Compares each canonical template file against the
// repo's copy and prints a status per file:
//   missing  — file is in template but not in repo
//   ok       — content matches the canonical template (after placeholder sub)
//   modified — content differs (user-customized, or template has updated)
//   skipped  — repo is in specialized mode and this is a canonical reviewer
//              persona that's been deliberately replaced
//
// Exit 0 if no missing files (excluding skipped). Exit 1 if any missing.
// Modified files do not fail — repos are expected to specialize personas
// and the security checklist.
export async function check(options) {
  const cwd = process.cwd();
  const stack = options.stack === 'auto' || !options.stack ? detectStack(cwd) : options.stack;

  if (stack === 'unknown') {
    console.error(chalk.red('Could not auto-detect stack. Pass --stack explicitly.'));
    process.exit(2);
  }

  const ctx = buildContext({ cwd, stack });
  const plan = planFiles(stack);
  const specialized = isSpecializedMode(cwd);

  const counts = { missing: 0, ok: 0, modified: 0, skipped: 0 };
  const lists = { missing: [], modified: [], skipped: [] };

  for (const [tplRelPath, targetRelPath] of plan) {
    // Specialized mode: skip canonical reviewer personas. Their replacements
    // (e.g. data-quality.md) live alongside; we don't enforce the canonical
    // set when the repo has declared it uses its own.
    if (specialized && CANONICAL_REVIEWER_PERSONAS.has(targetRelPath)) {
      counts.skipped += 1;
      lists.skipped.push(targetRelPath);
      continue;
    }

    const targetAbs = path.join(cwd, targetRelPath);
    let canonical;
    try {
      canonical = readTemplate(tplRelPath, ctx);
    } catch (e) {
      console.error(chalk.red(`Failed to read template ${tplRelPath}: ${e.message}`));
      continue;
    }

    if (!fs.existsSync(targetAbs)) {
      counts.missing += 1;
      lists.missing.push(targetRelPath);
      continue;
    }

    const actual = fs.readFileSync(targetAbs, 'utf8');
    if (actual === canonical) {
      counts.ok += 1;
    } else {
      counts.modified += 1;
      lists.modified.push(targetRelPath);
    }
  }

  console.log(chalk.bold(`harness drift report — ${ctx.PROJECT_NAME} (stack: ${stack}${specialized ? ', specialized personas' : ''})`));
  console.log();
  console.log(`  ${chalk.green('ok      ')} ${counts.ok}`);
  console.log(`  ${chalk.yellow('modified')} ${counts.modified}`);
  console.log(`  ${chalk.red('missing ')} ${counts.missing}`);
  if (specialized) {
    console.log(`  ${chalk.dim('skipped ')} ${counts.skipped} ${chalk.dim('(canonical reviewer personas — repo declared specialized)')}`);
  }
  console.log();

  if (lists.missing.length) {
    console.log(chalk.red('Missing files (run `harness init --update` to add):'));
    for (const f of lists.missing) console.log(chalk.dim(`  - ${f}`));
    console.log();
  }
  if (lists.modified.length && options.verbose) {
    console.log(chalk.yellow('Modified files (likely customized — review manually if needed):'));
    for (const f of lists.modified) console.log(chalk.dim(`  - ${f}`));
    console.log();
  }
  if (lists.skipped.length && options.verbose) {
    console.log(chalk.dim('Skipped (specialized mode):'));
    for (const f of lists.skipped) console.log(chalk.dim(`  - ${f}`));
    console.log();
  }

  process.exit(counts.missing > 0 ? 1 : 0);
}
