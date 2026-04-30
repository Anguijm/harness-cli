import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import {
  buildContext,
  detectStack,
  planFiles,
  readTemplate,
  isExecutable,
} from '../lib/template.js';

export async function init(options) {
  const cwd = process.cwd();
  const stack = options.stack === 'auto' || !options.stack ? detectStack(cwd) : options.stack;

  if (stack === 'unknown') {
    console.error(
      chalk.red(
        'Could not auto-detect stack. Pass --stack=node-ts or --stack=python explicitly.'
      )
    );
    process.exit(1);
  }

  const ctx = buildContext({ cwd, stack });
  const plan = planFiles(stack);

  // Default mode (no --update, no --force): refuse if .harness/ exists.
  const harnessExists = fs.existsSync(path.join(cwd, '.harness'));
  if (harnessExists && !options.update && !options.force) {
    console.error(
      chalk.red('.harness/ already exists.') +
        ' Use ' +
        chalk.cyan('harness init --update') +
        ' to add missing files (preserves existing), or ' +
        chalk.cyan('--force') +
        ' to overwrite.'
    );
    process.exit(1);
  }

  let written = 0;
  let skipped = 0;
  let overwritten = 0;

  for (const [tplRelPath, targetRelPath] of plan) {
    const targetAbs = path.join(cwd, targetRelPath);
    const targetDir = path.dirname(targetAbs);

    fs.mkdirSync(targetDir, { recursive: true });

    const exists = fs.existsSync(targetAbs);
    let content;
    try {
      content = readTemplate(tplRelPath, ctx);
    } catch (e) {
      console.error(chalk.red(`Failed to read template ${tplRelPath}: ${e.message}`));
      continue;
    }

    if (exists && !options.force) {
      skipped += 1;
      if (options.verbose) {
        console.log(chalk.dim(`  skip   ${targetRelPath} (exists)`));
      }
      continue;
    }

    fs.writeFileSync(targetAbs, content);
    if (isExecutable(targetRelPath)) {
      fs.chmodSync(targetAbs, 0o755);
    }

    if (exists) {
      overwritten += 1;
      console.log(chalk.yellow(`  overwrite ${targetRelPath}`));
    } else {
      written += 1;
      console.log(chalk.green(`  write  ${targetRelPath}`));
    }
  }

  console.log();
  console.log(
    chalk.bold(
      `Done. ${written} written, ${overwritten} overwritten, ${skipped} skipped (exists).`
    )
  );
  console.log(chalk.dim(`Stack: ${stack}, Project: ${ctx.PROJECT_NAME}`));

  if (written > 0 || overwritten > 0) {
    console.log();
    console.log(chalk.cyan('Next steps:'));
    console.log(chalk.dim('  1. bash .harness/scripts/install_hooks.sh'));
    console.log(chalk.dim('  2. pip install -r .harness/scripts/requirements.txt'));
    console.log(chalk.dim('  3. Set GEMINI_API_KEY locally and as a repo secret'));
    console.log(chalk.dim('  4. Edit .harness/council/*.md to specialize personas for this repo'));
    console.log(chalk.dim('  5. harness check  — verify drift status'));
  }
}
