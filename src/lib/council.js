import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

/**
 * Run the council: parallel expert reviews + lead architect resolution.
 * Returns { reviews: [{angle, score, response}], plan: string }
 */
export async function runCouncil(featureDescription, options = {}) {
  const {
    angles = ['security', 'architecture', 'product'],
    model = 'claude-sonnet-4-6',
    defaultModel = model,
    modelOverrides = {},
    councilDir = '.harness/council',
    context = ''
  } = options;

  const client = new Anthropic();

  // Load persona prompts
  const personas = angles.map(angle => {
    const promptFile = path.join(councilDir, `${angle}.md`);
    if (!fs.existsSync(promptFile)) {
      throw new Error(`Council persona not found: ${promptFile}`);
    }
    return {
      angle,
      systemPrompt: fs.readFileSync(promptFile, 'utf8')
    };
  });

  // Load resolver prompt
  const resolverFile = path.join(councilDir, 'resolver.md');
  if (!fs.existsSync(resolverFile)) {
    throw new Error(`Resolver prompt not found: ${resolverFile}`);
  }
  const resolverPrompt = fs.readFileSync(resolverFile, 'utf8');

  // Build the feature context
  const userMessage = buildUserMessage(featureDescription, context);

  // Phase 1: Run all council members in parallel
  console.log(chalk.cyan('\n  Council convening...'));
  const reviewPromises = personas.map(async (persona) => {
    const angleModel = modelOverrides[persona.angle] || defaultModel;
    const start = Date.now();
    process.stdout.write(chalk.dim(`    ${persona.angle}: thinking... [${angleModel}]`));

    const response = await client.messages.create({
      model: angleModel,
      max_tokens: 2000,
      system: persona.systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    const text = response.content[0].text;
    const score = extractScore(text);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    // Clear line and rewrite
    process.stdout.write(`\r    ${persona.angle}: ${scoreColor(score)}${score}/10${chalk.reset} (${elapsed}s) [${angleModel}]\n`);

    return { angle: persona.angle, score, response: text, model: angleModel };
  });

  const reviews = await Promise.all(reviewPromises);

  // Phase 2: Resolve via Lead Architect
  console.log(chalk.cyan('\n  Lead Architect resolving...'));
  const resolverInput = buildResolverInput(featureDescription, reviews, context);

  const resolverResponse = await client.messages.create({
    model: defaultModel,
    max_tokens: 4000,
    system: resolverPrompt,
    messages: [{ role: 'user', content: resolverInput }]
  });

  const plan = resolverResponse.content[0].text;
  console.log(chalk.green('  Plan generated.\n'));

  return { reviews, plan };
}

function buildUserMessage(feature, context) {
  let msg = `## Feature Request\n\n${feature}\n`;
  if (context) {
    msg += `\n## Project Context\n\n${context}\n`;
  }
  return msg;
}

function buildResolverInput(feature, reviews, context) {
  let msg = `## Feature Request\n\n${feature}\n`;
  if (context) {
    msg += `\n## Project Context\n\n${context}\n`;
  }
  msg += '\n## Council Reviews\n\n';
  for (const r of reviews) {
    msg += `### ${r.angle.toUpperCase()} Expert (Score: ${r.score}/10)\n\n${r.response}\n\n---\n\n`;
  }
  return msg;
}

function extractScore(text) {
  const match = text.match(/SCORE:\s*(\d+)/i) || text.match(/(\d+)\s*\/\s*10/);
  return match ? parseInt(match[1], 10) : 0;
}

function scoreColor(score) {
  if (score >= 8) return chalk.green;
  if (score >= 5) return chalk.yellow;
  return chalk.red;
}
