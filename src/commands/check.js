import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  buildContext,
  detectStack,
  planFiles,
  readTemplate,
} from '../lib/template.js';

// Read-only drift report. Compares each canonical template file against the
// repo's copy and prints a status per file:
//   missing  — file is in template but not in repo
//   ok       — content matches the canonical template (after placeholder sub)
//   modified — content differs (user-customized, or template has updated)
//
// Exit 0 if no missing files. Exit 1 if any missing. Modified files do not
// fail — repos are expected to specialize personas and the security checklist.
export async function check(options) {
  const cwd = process.cwd();
  const stack = options.stack === 'auto' || !options.stack ? detectStack(cwd) : options.stack;

  if (stack === 'unknown') {
    console.error(chalk.red('Could not auto-detect stack. Pass --stack explicitly.'));
    process.exit(2);
  }

  const ctx = buildContext({ cwd, stack });
  const plan = planFiles(stack);

  const counts = { missing: 0, ok: 0, modified: 0 };
  const lists = { missing: [], modified: [] };

  for (const [tplRelPath, targetRelPath] of plan) {
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

  console.log(chalk.bold(`harness drift report — ${ctx.PROJECT_NAME} (stack: ${stack})`));
  console.log();
  console.log(`  ${chalk.green('ok      ')} ${counts.ok}`);
  console.log(`  ${chalk.yellow('modified')} ${counts.modified}`);
  console.log(`  ${chalk.red('missing ')} ${counts.missing}`);
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

  process.exit(counts.missing > 0 ? 1 : 0);
}
