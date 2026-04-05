#!/usr/bin/env node
import { Command } from 'commander';
import { init } from './commands/init.js';
import { plan } from './commands/plan.js';
import { review } from './commands/review.js';
import { recipe } from './commands/recipe.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('harness')
  .description('AI development harness — plan, council, build methodology')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize harness in current project')
  .option('-s, --stack <stack>', 'Project stack (node, python, go)', 'node')
  .option('-f, --framework <framework>', 'Framework (react, express, fastapi)')
  .action(init);

program
  .command('plan <description>')
  .description('Generate an architecture plan via AI council')
  .option('-c, --council <angles...>', 'Council angles to run', ['security', 'architecture', 'product'])
  .option('-m, --model <model>', 'LLM model for council', 'claude-sonnet-4-6')
  .option('-o, --output <file>', 'Output plan file', '.harness/plan.md')
  .option('--no-interactive', 'Skip circuit breaker (for cron/CI)')
  .action(plan);

program
  .command('review [file]')
  .description('Run council review on existing code or plan')
  .option('-c, --council <angles...>', 'Council angles to run', ['security', 'architecture', 'product'])
  .action(review);

program
  .command('recipe <type>')
  .description('Run a recipe preset (devtool, bugfix, feature, refactor, api)')
  .option('-d, --description <desc>', 'One-line description (skips interactive prompt)')
  .option('-m, --model <model>', 'LLM model for council', 'claude-sonnet-4-6')
  .option('-o, --output <file>', 'Output plan file', '.harness/plan.md')
  .option('--no-interactive', 'Skip circuit breaker (for cron/CI)')
  .action(recipe);

program
  .command('status')
  .description('Show harness state: last plan, memory, session history')
  .action(() => {
    console.log(chalk.dim('harness status — coming in v0.2'));
  });

program.parse();
