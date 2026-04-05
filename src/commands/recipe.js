import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import readline from 'readline';
import { runCouncil } from '../lib/council.js';
import { loadConfig } from '../lib/config.js';
import { logSession } from '../lib/memory.js';

/**
 * Recipe presets — pre-loaded council configurations for common workflows.
 */
const RECIPES = {
  devtool: {
    description: 'Build a developer utility tool',
    angles: ['usefulness', 'guide', 'cool', 'architecture'],
    template: (desc) =>
      `Build a developer utility tool: ${desc}\n\n` +
      `Requirements:\n` +
      `- Must be easy to install and use from the CLI or as a library\n` +
      `- Clear help text and usage examples\n` +
      `- Handle edge cases gracefully with helpful error messages\n` +
      `- Keep dependencies minimal`,
  },
  bugfix: {
    description: 'Fix a specific bug',
    angles: ['bugs', 'security', 'architecture'],
    template: (desc) =>
      `Fix the following bug: ${desc}\n\n` +
      `Requirements:\n` +
      `- Identify the root cause, not just the symptom\n` +
      `- Add a regression test covering this bug\n` +
      `- Verify no side effects on adjacent functionality\n` +
      `- Document the fix in commit message`,
  },
  feature: {
    description: 'Add a feature to existing project',
    angles: ['architecture', 'product', 'security'],
    template: (desc) =>
      `Add the following feature: ${desc}\n\n` +
      `Requirements:\n` +
      `- Integrate cleanly with the existing architecture\n` +
      `- Follow established patterns and conventions in the codebase\n` +
      `- Include user-facing documentation or help text\n` +
      `- Add tests for the new functionality`,
  },
  refactor: {
    description: 'Refactor/cleanup existing code',
    angles: ['architecture', 'security', 'bugs'],
    template: (desc) =>
      `Refactor the following: ${desc}\n\n` +
      `Requirements:\n` +
      `- Preserve all existing behavior (no functional changes)\n` +
      `- Improve readability, maintainability, or performance\n` +
      `- Reduce duplication where possible\n` +
      `- Ensure all existing tests still pass`,
  },
  api: {
    description: 'Build or modify an API endpoint',
    angles: ['security', 'architecture', 'product'],
    template: (desc) =>
      `Build or modify the following API endpoint: ${desc}\n\n` +
      `Requirements:\n` +
      `- Validate all inputs; reject malformed requests with clear errors\n` +
      `- Follow REST conventions (proper status codes, idempotency)\n` +
      `- Include authentication/authorization checks\n` +
      `- Document the endpoint (method, path, request/response schema)`,
  },
};

export async function recipe(type, options) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);

  // Validate recipe type
  if (!RECIPES[type]) {
    console.error(chalk.red(`\n  Unknown recipe: "${type}"`));
    console.log(chalk.dim('  Available recipes:'));
    for (const [name, r] of Object.entries(RECIPES)) {
      console.log(`    ${chalk.cyan(name.padEnd(12))} ${r.description}`);
    }
    process.exit(1);
  }

  const rec = RECIPES[type];

  console.log(chalk.bold(`\n  harness recipe: ${type}`));
  console.log(chalk.dim(`  ${rec.description}\n`));

  // Get one-line description from user (or from --description flag)
  let userDesc = options.description;
  if (!userDesc) {
    userDesc = await ask(chalk.cyan('  Describe what you need in one line: '));
  }

  if (!userDesc || !userDesc.trim()) {
    console.error(chalk.red('\n  Description is required.\n'));
    process.exit(1);
  }

  const fullPrompt = rec.template(userDesc.trim());

  console.log(chalk.dim(`\n  Prompt prepared. Council angles: [${rec.angles.join(', ')}]`));

  // Gather project context from memory
  const contextFile = path.join(cwd, '.harness', 'memory', 'context.md');
  const context = fs.existsSync(contextFile) ? fs.readFileSync(contextFile, 'utf8') : '';

  // Run council with the recipe's angles
  const councilDir = path.join(cwd, '.harness', 'council');
  const defaultModel = options.model || config.council?.default_model || config.council?.model || 'claude-sonnet-4-6';
  const modelOverrides = config.council?.model_overrides || {};

  const result = await runCouncil(fullPrompt, {
    angles: rec.angles,
    model: defaultModel,
    defaultModel,
    modelOverrides,
    councilDir,
    context,
  });

  // Save plan
  const outputFile = options.output || '.harness/plan.md';
  const outputPath = path.join(cwd, outputFile);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.plan);

  // Also save to timestamped archive
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archiveDir = path.join(cwd, '.harness', 'plans');
  fs.mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.join(archiveDir, `${ts}.md`);
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
  const aiderInstructions = generateHandoff(userDesc.trim(), type, result.plan, config);
  const handoffPath = path.join(cwd, '.harness', 'aider-instructions.txt');
  fs.writeFileSync(handoffPath, aiderInstructions);

  console.log(chalk.green('\n  Plan approved. Handoff ready.\n'));
  console.log(chalk.dim('  To execute with Aider:'));
  console.log(chalk.cyan('  aider --message-file .harness/aider-instructions.txt\n'));
  console.log(chalk.dim('  To execute with Claude Code:'));
  console.log(chalk.cyan('  claude "Read .harness/plan.md and implement it exactly."\n'));

  // Log to memory
  logSession(cwd, {
    type: 'recipe',
    recipe: type,
    description: userDesc.trim(),
    scores: Object.fromEntries(result.reviews.map(r => [r.angle, r.score])),
    avgScore,
    planFile: outputFile,
    timestamp: new Date().toISOString(),
  });
}

function generateHandoff(description, recipeType, plan, config) {
  const lines = [
    '# Implementation Instructions',
    '',
    `## Recipe: ${recipeType}`,
    '',
    `## Original Request`,
    description,
    '',
    '## Approved Architecture Plan',
    '',
    plan,
    '',
    '## Execution Rules',
    '- Follow the plan exactly. Do not deviate from the architecture decisions.',
    '- Implement steps in order. Each step should be independently testable.',
    '- Security requirements are non-negotiable.',
    '- Handle all edge cases listed in the plan.',
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
