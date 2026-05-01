#!/usr/bin/env node
import { Command } from 'commander';
import { init } from './commands/init.js';
import { check } from './commands/check.js';
import { map } from './commands/map.js';
import { recall } from './commands/recall.js';
import { lint } from './commands/lint.js';
import { plan } from './commands/plan.js';
import { review } from './commands/review.js';
import { recipe } from './commands/recipe.js';
import { learn } from './commands/learn.js';
import { synthesize } from './commands/synthesize.js';
import { reindex } from './commands/reindex.js';
import { research } from './commands/research.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('harness')
  .description('AI development harness — plan, council, build methodology')
  .version('0.2.0');

program
  .command('init')
  .description('Initialize the canonical harness in current project')
  .option('-s, --stack <stack>', 'Project stack (node-ts, python, auto)', 'auto')
  .option('-u, --update', 'Add missing files; preserve existing files')
  .option('-f, --force', 'Overwrite existing files (destructive)')
  .option('-v, --verbose', 'Print every file action')
  .action(init);

program
  .command('check')
  .description('Read-only drift report against the canonical template')
  .option('-s, --stack <stack>', 'Project stack (node-ts, python, auto)', 'auto')
  .option('-v, --verbose', 'List modified files in addition to missing ones')
  .action(check);

program
  .command('map <description>')
  .description('Repository Impact Map — ground a plan in the actual codebase before writing it')
  .option('-w, --write', 'Prepend the impact block to .harness/active_plan.md (replaces any prior block)')
  .option('-l, --limit <n>', 'Max files to list (default 30)', (v) => parseInt(v, 10), 30)
  .option('-v, --verbose', 'Print candidate terms to stderr')
  .action(map);

program
  .command('recall <query>')
  .description('Surface past entries from .harness/ memory ranked by keyword × recency × (optional) vector similarity')
  .option('-l, --limit <n>', 'Max results (default 5)', (v) => parseInt(v, 10), 5)
  .option('-s, --source <path...>', 'Override default sources (repeatable)')
  .option('--no-vector', 'Skip the vector blend even if .harness/embeddings.json exists')
  .action(recall);

program
  .command('reindex')
  .description('Build / refresh .harness/embeddings.json so harness recall can blend semantic similarity with keyword × recency')
  .option('--full', 'Discard existing index and re-embed everything')
  .option('--dry-run', 'Report what would change without calling the embedding API')
  .option('-m, --model <name>', 'Override the embedding model (default text-embedding-004)')
  .action(reindex);

program
  .command('research <description>')
  .description('Run the active reviewer panel in parallel against a feature description; writes a ## Research block to .harness/active_plan.md')
  .option('--dry-run', 'Print the persona list + context preview without calling Gemini')
  .option('--no-write', 'Print the Research block to stdout instead of writing to active_plan.md')
  .option('--max-personas <n>', 'Cap personas per run (default = all active)', (v) => parseInt(v, 10))
  .option('-m, --model <name>', 'Override the Gemini model (default gemini-2.5-pro)')
  .action(research);

program
  .command('lint')
  .description('Health-check .harness/ memory: stale references, orphans, schema violations, duplicate signals, empty sections, future dates')
  .option('-f, --fix', 'Auto-fix safe issues (currently: remove orphan failures.jsonl entries)')
  .option('--json', 'Also print issues as JSON for tooling')
  .action(lint);

program
  .command('plan <description>')
  .description('Generate an architecture plan via AI council')
  .option('-c, --council <angles...>', 'Council angles to run', [
    'security',
    'architecture',
    'product',
  ])
  .option('-m, --model <model>', 'LLM model for council', 'claude-sonnet-4-6')
  .option('-o, --output <file>', 'Output plan file', '.harness/active_plan.md')
  .option('--no-interactive', 'Skip circuit breaker (for cron/CI)')
  .action(plan);

program
  .command('review [file]')
  .description('Run council review on existing code or plan')
  .option('-c, --council <angles...>', 'Council angles to run', [
    'security',
    'architecture',
    'product',
  ])
  .action(review);

program
  .command('recipe <type>')
  .description('Run a recipe preset (devtool, bugfix, feature, refactor, api)')
  .option('-d, --description <desc>', 'One-line description (skips interactive prompt)')
  .option('-m, --model <model>', 'LLM model for council', 'claude-sonnet-4-6')
  .option('-o, --output <file>', 'Output plan file', '.harness/active_plan.md')
  .option('--no-interactive', 'Skip circuit breaker (for cron/CI)')
  .action(recipe);

program
  .command('learn')
  .description('Generate reusable recipes from completed plans')
  .option('--from-session', 'Learn from the most recent plan + aider-instructions')
  .action(learn);

program
  .command('synthesize')
  .description('Auto-draft synthesis pages in learnings.md from duplicate-signal failure clusters')
  .option('--apply', 'Call Gemini and append draft sections to learnings.md (default: dry-run)')
  .option('--cluster <hash>', 'Process only the cluster with this signature hash')
  .option('--max <n>', 'Maximum clusters to process per --apply run', (v) => parseInt(v, 10))
  .option('-m, --model <name>', 'Gemini model to use')
  .action(synthesize);

program
  .command('status')
  .description('Show harness state: last plan, memory, session history')
  .action(() => {
    console.log(chalk.dim('harness status — coming in v0.3'));
  });

program.parse();
