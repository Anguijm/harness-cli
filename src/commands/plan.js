import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import readline from 'readline';
import { runCouncil } from '../lib/council.js';
import { loadConfig } from '../lib/config.js';
import { logSession } from '../lib/memory.js';

export async function plan(description, options) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  console.log(chalk.bold('\n  harness plan'));
  console.log(chalk.dim(`  "${description}"\n`));

  // Gather project context from memory
  const contextFile = path.join(cwd, '.harness', 'memory', 'context.md');
  const context = fs.existsSync(contextFile) ? fs.readFileSync(contextFile, 'utf8') : '';

  // Run council
  const councilDir = path.join(cwd, '.harness', 'council');
  const angles = options.council || config.council?.angles || ['security', 'architecture', 'product'];
  const model = options.model || config.council?.model || 'claude-sonnet-4-6';

  const result = await runCouncil(description, {
    angles,
    model,
    councilDir,
    context
  });

  // Save plan
  const outputFile = options.output || '.harness/plan.md';
  const outputPath = path.join(cwd, outputFile);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.plan);

  // Also save to timestamped archive
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(cwd, '.harness', 'plans', `${ts}.md`);
  fs.writeFileSync(archivePath, result.plan);

  // Display plan preview
  console.log(chalk.dim('─'.repeat(60)));
  const preview = result.plan.split('\n').slice(0, 25).join('\n');
  console.log(preview);
  if (result.plan.split('\n').length > 25) {
    console.log(chalk.dim(`\n  ... ${result.plan.split('\n').length - 25} more lines in ${outputFile}`));
  }
  console.log(chalk.dim('─'.repeat(60)));

  // Council summary
  console.log(chalk.bold('\n  Council Scores:'));
  const avgScore = result.reviews.reduce((s, r) => s + r.score, 0) / result.reviews.length;
  for (const r of result.reviews) {
    const color = r.score >= 8 ? chalk.green : r.score >= 5 ? chalk.yellow : chalk.red;
    console.log(`    ${r.angle.padEnd(15)} ${color(r.score + '/10')}`);
  }
  console.log(`    ${'average'.padEnd(15)} ${chalk.bold(avgScore.toFixed(1) + '/10')}`);

  // Circuit breaker
  if (options.interactive !== false) {
    console.log();
    const answer = await ask(chalk.cyan('  Accept plan? [Y/n/edit] '));
    const choice = answer.trim().toLowerCase();

    if (choice === 'n' || choice === 'no') {
      console.log(chalk.red('\n  Plan rejected. Run again with different description.\n'));
      return;
    }

    if (choice === 'e' || choice === 'edit') {
      console.log(chalk.yellow(`\n  Edit the plan at: ${outputFile}`));
      console.log(chalk.yellow('  Then run: harness handoff\n'));
      return;
    }
  }

  // Generate Aider handoff
  const aiderInstructions = generateHandoff(description, result.plan, config);
  const handoffPath = path.join(cwd, '.harness', 'aider-instructions.txt');
  fs.writeFileSync(handoffPath, aiderInstructions);

  console.log(chalk.green('\n  Plan approved. Handoff ready.\n'));
  console.log(chalk.dim('  To execute with Aider:'));
  console.log(chalk.cyan(`  aider --message-file .harness/aider-instructions.txt\n`));
  console.log(chalk.dim('  To execute with Claude Code:'));
  console.log(chalk.cyan(`  claude "Read .harness/plan.md and implement it exactly."\n`));

  // Log to memory
  logSession(cwd, {
    type: 'plan',
    description,
    scores: Object.fromEntries(result.reviews.map(r => [r.angle, r.score])),
    avgScore,
    planFile: outputFile,
    timestamp: new Date().toISOString()
  });
}

function generateHandoff(description, plan, config) {
  const lines = [
    `# Implementation Instructions`,
    ``,
    `## Original Request`,
    description,
    ``,
    `## Approved Architecture Plan`,
    ``,
    plan,
    ``,
    `## Execution Rules`,
    `- Follow the plan exactly. Do not deviate from the architecture decisions.`,
    `- Implement steps in order. Each step should be independently testable.`,
    `- Security requirements are non-negotiable.`,
    `- Handle all edge cases listed in the plan.`,
    `- After implementation, run: ${config.commands?.test || 'npm test'}`,
  ];
  return lines.join('\n');
}

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => { rl.close(); resolve(answer); });
  });
}
