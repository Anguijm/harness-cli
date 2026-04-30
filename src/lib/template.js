// Shared template-walking + placeholder substitution.
//
// Source layout (under harness-cli/templates/):
//   claude/          → .claude/ in target
//   harness/         → .harness/ in target
//   github/          → .github/ in target
//   husky/           → .husky/ in target (node-ts stack only)
//   gitleaks.toml    → .gitleaks.toml in target
//   CLAUDE.md        → CLAUDE.md in target
//   harness.yml      → harness.yml in target
//
// Workflows are stack-conditional:
//   templates/github/workflows/ci-node.yml   → .github/workflows/ci.yml (node-ts)
//   templates/github/workflows/ci-python.yml → .github/workflows/ci.yml (python)

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATES_DIR = path.join(__dirname, '..', '..', 'templates');

// Placeholder context for substitution.
export function buildContext({ cwd, stack }) {
  const projectName = detectProjectName(cwd);
  const ctx = { PROJECT_NAME: projectName, STACK: stack };
  if (stack === 'node-ts') {
    ctx.LANGUAGE = 'typescript';
    ctx.INSTALL_CMD = 'npm ci';
    ctx.LINT_CMD = 'npm run lint';
    ctx.TYPECHECK_CMD = 'npm run typecheck';
    ctx.TEST_CMD = 'npm test';
  } else if (stack === 'python') {
    ctx.LANGUAGE = 'python';
    ctx.INSTALL_CMD = 'pip install -r requirements.txt';
    ctx.LINT_CMD = 'ruff check .';
    ctx.TYPECHECK_CMD = 'pyright';
    ctx.TEST_CMD = 'pytest';
  } else {
    ctx.LANGUAGE = '';
    ctx.INSTALL_CMD = '';
    ctx.LINT_CMD = '';
    ctx.TYPECHECK_CMD = '';
    ctx.TEST_CMD = '';
  }
  return ctx;
}

// Prefer the git remote name (more accurate for templated clones where the
// local dir may not match the repo name). Fall back to the directory
// basename when there's no remote.
export function detectProjectName(cwd) {
  try {
    const remote = execSync('git remote get-url origin 2>/dev/null', {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (remote) {
      const name = path.basename(remote, '.git');
      if (name) return name;
    }
  } catch {
    // No remote, no git, or git error — fall back.
  }
  return path.basename(cwd);
}

export function detectStack(cwd) {
  if (fs.existsSync(path.join(cwd, 'package.json'))) return 'node-ts';
  if (
    fs.existsSync(path.join(cwd, 'pyproject.toml')) ||
    fs.existsSync(path.join(cwd, 'requirements.txt'))
  )
    return 'python';
  return 'unknown';
}

// Substitute {{KEY}} placeholders. Pass binary files through unchanged.
export function substitute(content, ctx) {
  if (typeof content !== 'string') return content;
  return content.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) =>
    ctx[key] !== undefined ? ctx[key] : m
  );
}

// Build the list of (templateAbsPath, targetRelPath) pairs for a given stack.
// targetRelPath is relative to repo root.
export function planFiles(stack) {
  const plan = [];

  // Top-level files.
  plan.push(['CLAUDE.md', 'CLAUDE.md']);
  plan.push(['harness.yml', 'harness.yml']);
  plan.push(['gitleaks.toml', '.gitleaks.toml']);

  // Recursive directory mappings.
  const dirMappings = [
    ['claude', '.claude'],
    ['harness', '.harness'],
    ['github', '.github'],
    ['scripts', 'scripts'],
  ];
  if (stack === 'node-ts') {
    dirMappings.push(['husky', '.husky']);
  }

  for (const [src, dst] of dirMappings) {
    walkDir(path.join(TEMPLATES_DIR, src), src, plan, dst);
  }

  // Stack-specific CI workflow renaming.
  // Remove the wrong-stack one from the plan; rename the right one to ci.yml.
  const planWithCi = [];
  for (const [tpl, target] of plan) {
    if (target === '.github/workflows/ci-node.yml') {
      if (stack === 'node-ts') {
        planWithCi.push([tpl, '.github/workflows/ci.yml']);
      }
    } else if (target === '.github/workflows/ci-python.yml') {
      if (stack === 'python') {
        planWithCi.push([tpl, '.github/workflows/ci.yml']);
      }
    } else {
      planWithCi.push([tpl, target]);
    }
  }

  return planWithCi;
}

function walkDir(absDir, srcRel, plan, dstRel) {
  if (!fs.existsSync(absDir)) return;
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const childSrcRel = path.join(srcRel, entry.name);
    const childDstRel = path.join(dstRel, entry.name);
    if (entry.isDirectory()) {
      walkDir(path.join(absDir, entry.name), childSrcRel, plan, childDstRel);
    } else {
      plan.push([childSrcRel, childDstRel]);
    }
  }
}

// Read a template file and apply placeholder substitution.
export function readTemplate(tplRelPath, ctx) {
  const absPath = path.join(TEMPLATES_DIR, tplRelPath);
  const content = fs.readFileSync(absPath, 'utf8');
  return substitute(content, ctx);
}

// Files that should remain executable when written.
export function isExecutable(relPath) {
  return (
    relPath.includes('hooks/') ||
    relPath.endsWith('.sh') ||
    relPath.startsWith('.husky/') ||
    relPath === '.husky/pre-push'
  );
}
