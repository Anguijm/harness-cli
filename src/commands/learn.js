import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { loadDecisions } from '../lib/memory.js';

/**
 * Council angle catalog — all known angles with descriptions.
 * Used to score relevance when extracting from plans.
 */
const KNOWN_ANGLES = [
  'security', 'architecture', 'product', 'bugs', 'usefulness',
  'guide', 'cool', 'performance', 'testing', 'devops',
];

/**
 * harness learn — meta-agent that reads completed plans and generates reusable recipes.
 *
 * Scans .harness/plans/ for completed plans (those with matching successful
 * decision log entries), extracts patterns, and writes SKILL.md recipe files
 * to .harness/recipes/ that the `harness recipe` command can load.
 */
export async function learn(options) {
  const cwd = process.cwd();

  if (options.fromSession) {
    return learnFromSession(cwd);
  }

  return learnFromPlans(cwd);
}

// ---------------------------------------------------------------------------
// Learn from all completed plans in .harness/plans/
// ---------------------------------------------------------------------------

async function learnFromPlans(cwd) {
  const plansDir = path.join(cwd, '.harness', 'plans');
  const recipesDir = path.join(cwd, '.harness', 'recipes');

  if (!fs.existsSync(plansDir)) {
    console.error(chalk.red('\n  No .harness/plans/ directory found. Run `harness plan` or `harness recipe` first.\n'));
    process.exit(1);
  }

  const planFiles = fs.readdirSync(plansDir)
    .filter(f => f.endsWith('.md'))
    .sort();

  if (planFiles.length === 0) {
    console.error(chalk.red('\n  No plan files found in .harness/plans/\n'));
    process.exit(1);
  }

  // Load decisions to find which plans had successful builds
  const decisions = loadDecisions(cwd);
  const completedPlans = findCompletedPlans(planFiles, decisions);

  if (completedPlans.length === 0) {
    console.log(chalk.yellow('\n  No completed plans with successful builds found.'));
    console.log(chalk.dim('  Falling back to all available plans...\n'));
    // Fall back to analyzing all plans
    completedPlans.push(...planFiles.map(f => ({
      file: f,
      decision: null,
    })));
  }

  console.log(chalk.bold(`\n  harness learn — analyzing ${completedPlans.length} plan(s)\n`));

  fs.mkdirSync(recipesDir, { recursive: true });

  let generated = 0;

  for (const entry of completedPlans) {
    const planPath = path.join(plansDir, entry.file);
    const planContent = fs.readFileSync(planPath, 'utf8');

    const extraction = extractFromPlan(planContent, entry.decision);
    const recipeName = deriveRecipeName(extraction, entry);

    // Skip if recipe already exists
    const recipeFile = path.join(recipesDir, `${recipeName}.md`);
    if (fs.existsSync(recipeFile)) {
      console.log(chalk.dim(`  skip: ${recipeName}.md (already exists)`));
      continue;
    }

    const recipeContent = generateRecipeMd(recipeName, extraction);
    fs.writeFileSync(recipeFile, recipeContent);

    console.log(chalk.green(`  created: ${recipeName}.md`));
    console.log(chalk.dim(`    type: ${extraction.projectType}  angles: [${extraction.angles.map(a => a.angle).join(', ')}]`));
    generated++;
  }

  console.log(chalk.bold(`\n  ${generated} recipe(s) generated in .harness/recipes/\n`));

  if (generated > 0) {
    console.log(chalk.dim('  Use with: harness recipe <name> (custom recipes auto-loaded from .harness/recipes/)'));
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Learn from the most recent session (--from-session)
// ---------------------------------------------------------------------------

async function learnFromSession(cwd) {
  const plansDir = path.join(cwd, '.harness', 'plans');
  const recipesDir = path.join(cwd, '.harness', 'recipes');
  const aiderPath = path.join(cwd, '.harness', 'aider-instructions.txt');
  const mainPlanPath = path.join(cwd, '.harness', 'plan.md');

  // Find the most recent plan
  let planContent = '';
  let planSource = '';

  if (fs.existsSync(plansDir)) {
    const planFiles = fs.readdirSync(plansDir).filter(f => f.endsWith('.md')).sort();
    if (planFiles.length > 0) {
      const latest = planFiles[planFiles.length - 1];
      planContent = fs.readFileSync(path.join(plansDir, latest), 'utf8');
      planSource = `plans/${latest}`;
    }
  }

  if (!planContent && fs.existsSync(mainPlanPath)) {
    planContent = fs.readFileSync(mainPlanPath, 'utf8');
    planSource = 'plan.md';
  }

  if (!planContent) {
    console.error(chalk.red('\n  No plan found. Run `harness plan` or `harness recipe` first.\n'));
    process.exit(1);
  }

  // Read aider instructions for additional context
  let aiderContent = '';
  if (fs.existsSync(aiderPath)) {
    aiderContent = fs.readFileSync(aiderPath, 'utf8');
  }

  // Get the most recent decision
  const decisions = loadDecisions(cwd);
  const latestDecision = decisions.length > 0 ? decisions[decisions.length - 1] : null;

  console.log(chalk.bold('\n  harness learn --from-session'));
  console.log(chalk.dim(`  Source: ${planSource}`));
  if (aiderContent) console.log(chalk.dim('  Aider instructions: found'));
  if (latestDecision) console.log(chalk.dim(`  Decision log: ${latestDecision.type || 'unknown'} (${latestDecision.timestamp?.slice(0, 10) || '?'})`));
  console.log();

  const extraction = extractFromPlan(planContent, latestDecision, aiderContent);
  const recipeName = deriveRecipeName(extraction, { file: planSource, decision: latestDecision });

  fs.mkdirSync(recipesDir, { recursive: true });

  const recipeFile = path.join(recipesDir, `${recipeName}.md`);
  const recipeContent = generateRecipeMd(recipeName, extraction);
  fs.writeFileSync(recipeFile, recipeContent);

  console.log(chalk.green(`  Recipe draft created: .harness/recipes/${recipeName}.md`));
  console.log(chalk.dim(`    type: ${extraction.projectType}  angles: [${extraction.angles.map(a => a.angle).join(', ')}]`));
  console.log(chalk.dim(`    edge cases: ${extraction.edgeCases.length}`));
  console.log();
  console.log(chalk.dim('  Review and edit the recipe, then use with: harness recipe ' + recipeName));
  console.log();
}

// ---------------------------------------------------------------------------
// Plan analysis / extraction
// ---------------------------------------------------------------------------

/**
 * Match plan files to decision log entries that look successful.
 */
function findCompletedPlans(planFiles, decisions) {
  const completed = [];

  for (const file of planFiles) {
    // Match by timestamp prefix (plan files are named like 2026-04-01T12-00-00.md)
    // Convert filename back to ISO: 2026-04-01T12-00-00 -> 2026-04-01T12:00:00
    const base = file.replace('.md', '');
    const tMatch = base.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
    const isoTs = tMatch ? `${tMatch[1]}T${tMatch[2]}:${tMatch[3]}:${tMatch[4]}Z` : null;

    // Find a decision whose timestamp is close or whose planFile references this
    const match = decisions.find(d => {
      if (!d.timestamp) return false;
      // Direct plan file reference
      if (d.planFile && (d.planFile.includes(file) || file.includes(d.planFile.replace(/.*\//, '')))) {
        return true;
      }
      // Timestamp proximity (within 120 seconds)
      if (isoTs) {
        try {
          const planTime = new Date(isoTs);
          const decTime = new Date(d.timestamp);
          return Math.abs(planTime - decTime) < 120000;
        } catch { return false; }
      }
      return false;
    });

    // Consider it "completed" if it has a decision with avgScore >= 5
    if (match && (match.avgScore === undefined || match.avgScore >= 5)) {
      completed.push({ file, decision: match });
    }
  }

  return completed;
}

/**
 * Extract structured info from a plan's markdown content.
 */
function extractFromPlan(planContent, decision, aiderContent = '') {
  const lines = planContent.split('\n');
  const lower = planContent.toLowerCase();
  const combined = planContent + '\n' + aiderContent;

  // 1. Determine project type
  const projectType = classifyProjectType(lower, decision);

  // 2. Extract architectural decisions
  const archDecisions = extractArchDecisions(lines);

  // 3. Determine relevant council angles + weights
  const angles = scoreAngles(planContent, decision);

  // 4. Extract edge cases
  const edgeCases = extractEdgeCases(lines);

  // 5. Build plan template from structure
  const planTemplate = extractPlanTemplate(lines);

  // 6. Extract trigger patterns
  const trigger = deriveTrigger(projectType, combined);

  return {
    projectType,
    archDecisions,
    angles,
    edgeCases,
    planTemplate,
    trigger,
  };
}

function classifyProjectType(lowerContent, decision) {
  if (decision?.recipe) return decision.recipe;
  if (decision?.type === 'recipe' && decision?.recipe) return decision.recipe;

  const signals = {
    devtool: ['cli', 'command', 'tool', 'utility', 'developer tool', 'scaffold'],
    api: ['endpoint', 'api', 'route', 'rest', 'graphql', 'handler', 'middleware'],
    feature: ['feature', 'add support', 'implement', 'user story', 'requirement'],
    bugfix: ['fix', 'bug', 'regression', 'patch', 'hotfix', 'issue'],
    refactor: ['refactor', 'cleanup', 'simplify', 'reorganize', 'migrate', 'technical debt'],
  };

  let best = 'feature';
  let bestCount = 0;

  for (const [type, keywords] of Object.entries(signals)) {
    const count = keywords.reduce((n, kw) => n + (lowerContent.includes(kw) ? 1 : 0), 0);
    if (count > bestCount) {
      bestCount = count;
      best = type;
    }
  }

  return best;
}

function extractArchDecisions(lines) {
  const decisions = [];
  let inDecisions = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Look for architecture/decision headings
    if (/^#{1,3}\s.*(architecture|decision|design|approach|strategy)/i.test(trimmed)) {
      inDecisions = true;
      continue;
    }

    // End on next heading
    if (inDecisions && /^#{1,3}\s/.test(trimmed) && !/decision|design|approach/i.test(trimmed)) {
      inDecisions = false;
    }

    // Collect bullet points in decision sections
    if (inDecisions && /^[-*]\s/.test(trimmed)) {
      decisions.push(trimmed.replace(/^[-*]\s+/, ''));
    }

    // Also catch standalone "Decision:" or "Approach:" lines
    if (/^[-*]\s+\**(decision|approach|strategy)\**/i.test(trimmed)) {
      decisions.push(trimmed.replace(/^[-*]\s+/, ''));
    }
  }

  // If we didn't find dedicated sections, extract from bullet points after headings
  if (decisions.length === 0) {
    let afterHeading = false;
    for (const line of lines) {
      if (/^#{1,3}\s/.test(line.trim())) {
        afterHeading = true;
        continue;
      }
      if (afterHeading && /^[-*]\s/.test(line.trim())) {
        decisions.push(line.trim().replace(/^[-*]\s+/, ''));
        if (decisions.length >= 8) break;
      }
      if (line.trim() === '') afterHeading = false;
    }
  }

  return decisions.slice(0, 10);
}

function scoreAngles(planContent, decision) {
  const lower = planContent.toLowerCase();

  // Start from decision scores if available
  const weights = {};

  if (decision?.scores) {
    for (const [angle, score] of Object.entries(decision.scores)) {
      weights[angle] = score;
    }
  }

  // Keyword-based scoring for all known angles
  const angleKeywords = {
    security: ['security', 'auth', 'encrypt', 'xss', 'injection', 'csrf', 'sanitize', 'vulnerability'],
    architecture: ['architecture', 'pattern', 'layer', 'module', 'separation', 'interface', 'abstract'],
    product: ['user', 'experience', 'ux', 'flow', 'requirement', 'story', 'persona'],
    bugs: ['bug', 'error', 'exception', 'edge case', 'regression', 'crash', 'fail'],
    usefulness: ['useful', 'practical', 'developer', 'workflow', 'productivity', 'ergonomic'],
    guide: ['guide', 'documentation', 'example', 'tutorial', 'onboarding', 'readme'],
    cool: ['elegant', 'innovative', 'clever', 'creative', 'novel', 'impressive'],
    performance: ['performance', 'fast', 'cache', 'optimize', 'latency', 'throughput', 'memory'],
    testing: ['test', 'spec', 'coverage', 'assert', 'mock', 'fixture', 'regression test'],
    devops: ['deploy', 'ci', 'cd', 'pipeline', 'docker', 'container', 'infrastructure'],
  };

  for (const [angle, keywords] of Object.entries(angleKeywords)) {
    if (weights[angle]) continue; // Already from decision scores
    const hits = keywords.reduce((n, kw) => n + (lower.split(kw).length - 1), 0);
    if (hits > 0) {
      weights[angle] = Math.min(10, Math.round(hits * 1.5));
    }
  }

  // Return top angles sorted by weight
  return Object.entries(weights)
    .filter(([, w]) => w >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([angle, weight]) => ({ angle, weight }));
}

function extractEdgeCases(lines) {
  const cases = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim().toLowerCase();

    // Lines mentioning edge cases, caveats, warnings (skip headings)
    if (/edge case|caveat|warning|gotcha|watch out|important note|beware/i.test(lines[i]) && !/^#{1,4}\s/.test(lines[i].trim())) {
      const text = lines[i].trim().replace(/^[-*]\s+/, '');
      if (text.length > 10) cases.push(text);
    }

    // Bullet points under edge case headings
    if (/^#{1,3}\s.*(edge|caveat|warning|consideration|risk)/i.test(lines[i])) {
      for (let j = i + 1; j < lines.length && j < i + 15; j++) {
        if (/^#{1,3}\s/.test(lines[j])) break;
        if (/^[-*]\s/.test(lines[j].trim())) {
          cases.push(lines[j].trim().replace(/^[-*]\s+/, ''));
        }
      }
    }
  }

  return [...new Set(cases)].slice(0, 8);
}

function extractPlanTemplate(lines) {
  // Extract the heading structure as a template skeleton
  const structure = [];
  let lastLevel = 0;

  for (const line of lines) {
    const match = line.match(/^(#{1,4})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      const heading = match[2].trim();
      // Generalize headings: remove specifics, keep structure
      const generalized = heading
        .replace(/\d{4}[-/]\d{2}[-/]\d{2}/g, '<date>')
        .replace(/v\d+\.\d+(\.\d+)?/g, '<version>');
      structure.push({ level, heading: generalized });
      lastLevel = level;
    }
  }

  return structure;
}

function deriveTrigger(projectType, content) {
  const triggers = {
    devtool: 'When building a new CLI tool, developer utility, or standalone helper script',
    api: 'When building or modifying API endpoints, routes, or server-side handlers',
    feature: 'When adding a new user-facing feature or capability to an existing project',
    bugfix: 'When diagnosing and fixing a specific bug, error, or regression',
    refactor: 'When reorganizing, simplifying, or cleaning up existing code without changing behavior',
  };

  return triggers[projectType] || triggers.feature;
}

// ---------------------------------------------------------------------------
// Recipe name derivation
// ---------------------------------------------------------------------------

function deriveRecipeName(extraction, entry) {
  const type = extraction.projectType;
  const ts = entry.file
    ? entry.file.replace('.md', '').slice(0, 10).replace(/[^a-z0-9]/gi, '')
    : new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Try to derive a meaningful suffix from the decision description
  let suffix = '';
  if (entry.decision?.description) {
    suffix = entry.decision.description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 3)
      .join('-');
  }

  if (suffix) {
    return `${type}-${suffix}`;
  }

  return `${type}-${ts}`;
}

// ---------------------------------------------------------------------------
// Recipe Markdown generation
// ---------------------------------------------------------------------------

/**
 * Generate a SKILL.md recipe file that matches the format expected by
 * the recipe command's RECIPES object — loadable as a custom recipe.
 */
function generateRecipeMd(name, extraction) {
  const angleList = extraction.angles.map(a => `${a.angle} (${a.weight}/10)`).join(', ');
  const angleNames = extraction.angles.map(a => a.angle);

  const lines = [
    `# Recipe: ${name}`,
    '',
    `> Auto-generated by \`harness learn\` — review and refine before use.`,
    '',
    '## Trigger',
    '',
    extraction.trigger,
    '',
    '## Type',
    '',
    extraction.projectType,
    '',
    '## Council Angles',
    '',
    `Weights: ${angleList}`,
    '',
    '```json',
    JSON.stringify(angleNames, null, 2),
    '```',
    '',
    '## Plan Template',
    '',
    '```markdown',
  ];

  // Build template from extracted structure
  if (extraction.planTemplate.length > 0) {
    for (const s of extraction.planTemplate) {
      lines.push(`${'#'.repeat(s.level)} ${s.heading}`);
    }
  } else {
    lines.push('# <Project Name>');
    lines.push('## Architecture');
    lines.push('## Implementation Steps');
    lines.push('## Testing');
    lines.push('## Edge Cases');
  }

  lines.push('```');
  lines.push('');

  // Architectural decisions
  if (extraction.archDecisions.length > 0) {
    lines.push('## Successful Patterns');
    lines.push('');
    for (const d of extraction.archDecisions) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  // Edge cases
  if (extraction.edgeCases.length > 0) {
    lines.push('## Edge Cases Learned');
    lines.push('');
    for (const e of extraction.edgeCases) {
      lines.push(`- ${e}`);
    }
    lines.push('');
  }

  // Loadable recipe block — this is what `harness recipe` uses
  lines.push('## Recipe Definition');
  lines.push('');
  lines.push('<!-- harness-recipe');
  lines.push(JSON.stringify({
    name,
    description: `${capitalize(extraction.projectType)} recipe learned from past session`,
    angles: angleNames.length > 0 ? angleNames : ['architecture', 'security', 'product'],
    template: buildTemplateString(extraction),
  }, null, 2));
  lines.push('-->');
  lines.push('');

  return lines.join('\n');
}

function buildTemplateString(extraction) {
  const parts = [`{description}`];

  parts.push('');
  parts.push('Requirements:');

  if (extraction.archDecisions.length > 0) {
    for (const d of extraction.archDecisions.slice(0, 5)) {
      parts.push(`- ${d}`);
    }
  } else {
    parts.push('- Follow established patterns from past successful builds');
  }

  if (extraction.edgeCases.length > 0) {
    parts.push('');
    parts.push('Watch out for:');
    for (const e of extraction.edgeCases.slice(0, 4)) {
      parts.push(`- ${e}`);
    }
  }

  return parts.join('\n');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
