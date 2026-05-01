// Shared persona discovery for harness check, harness research, and any
// future command that needs to enumerate the active reviewer panel.
//
// Two modes:
//   - Canonical (default) — the 7 angle reviewers harness ships with.
//   - Specialized — repo has declared `council.specialized: true` in
//     harness.yml; the active set is .harness/council/*.md minus README
//     and lead-architect (the synthesizer is required in both modes,
//     not part of the panel).
//
// `harness research` and the council both want the same active set, so
// both should call `loadActivePersonas(cwd)` rather than duplicating the
// glob+filter logic.

import fs from 'fs';
import path from 'path';
import { loadHarnessConfig } from './config.js';

// Canonical reviewer personas — the 7 angle reviewers that the harness
// ships with by default. Specialized-personas repos replace these with
// domain-specific reviewers (e.g., sportsdata uses data-quality /
// statistical-validity / etc.). lead-architect.md and council/README.md
// are NOT in this list — they're required even in specialized mode but
// they're the synthesizer, not panel members.
export const CANONICAL_REVIEWER_PERSONAS = new Set([
  '.harness/council/accessibility.md',
  '.harness/council/architecture.md',
  '.harness/council/bugs.md',
  '.harness/council/cost.md',
  '.harness/council/maintainability.md',
  '.harness/council/product.md',
  '.harness/council/security.md',
]);

// Files in .harness/council/ that are never panel members regardless of
// mode. The synthesizer (lead-architect) and the README aren't reviewers.
const NON_PANEL_FILES = new Set(['README.md', 'lead-architect.md']);

/**
 * Returns true when harness.yml has `council.specialized: true`.
 * Throws if the config exists but is unparseable — callers that need
 * silent fallback should catch and decide.
 */
export function isSpecializedMode(cwd) {
  const cfg = loadHarnessConfig(cwd);
  if (!cfg.exists) return false;
  if (!cfg.ok) {
    const err = new Error(`harness.yml could not be parsed: ${cfg.error.message}`);
    err.cause = cfg.error;
    err.cfgPath = path.join(cwd, 'harness.yml');
    throw err;
  }
  return (
    cfg.parsed && cfg.parsed.council && cfg.parsed.council.specialized === true
  );
}

/**
 * Discover the active reviewer persona panel for a repo.
 *
 * @param {string} cwd
 * @returns {Array<{name: string, relPath: string, prompt: string}>}
 *   `name` is the bare filename without extension (e.g., "security").
 *   `relPath` is the repo-relative path (e.g., ".harness/council/security.md").
 *   `prompt` is the file's full text content.
 *
 * In canonical mode: returns the 7 canonical personas (skips any that are
 * missing from disk; the absence is a drift issue for `harness check` to
 * report, not for callers here).
 * In specialized mode: returns every .md file under .harness/council/
 * except README.md and lead-architect.md.
 */
export function loadActivePersonas(cwd) {
  const councilDir = path.join(cwd, '.harness/council');
  const specialized = isSpecializedMode(cwd);

  let candidates;
  if (specialized) {
    if (!fs.existsSync(councilDir)) return [];
    candidates = fs
      .readdirSync(councilDir)
      .filter((f) => f.endsWith('.md') && !NON_PANEL_FILES.has(f))
      .map((f) => `.harness/council/${f}`);
  } else {
    candidates = [...CANONICAL_REVIEWER_PERSONAS];
  }

  const out = [];
  for (const relPath of candidates) {
    const abs = path.join(cwd, relPath);
    if (!fs.existsSync(abs)) continue;
    const prompt = fs.readFileSync(abs, 'utf8');
    const name = path.basename(relPath, '.md');
    out.push({ name, relPath, prompt });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
