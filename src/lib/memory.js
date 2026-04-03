import fs from 'fs';
import path from 'path';

/**
 * Append a session entry to the decisions log.
 */
export function logSession(cwd, entry) {
  const logFile = path.join(cwd, '.harness', 'memory', 'decisions.json');
  let decisions = [];
  if (fs.existsSync(logFile)) {
    try { decisions = JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch(e) {}
  }
  decisions.push(entry);
  fs.writeFileSync(logFile, JSON.stringify(decisions, null, 2));
}

/**
 * Load all past decisions.
 */
export function loadDecisions(cwd) {
  const logFile = path.join(cwd, '.harness', 'memory', 'decisions.json');
  if (!fs.existsSync(logFile)) return [];
  try { return JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch(e) { return []; }
}

/**
 * Get a summary of past decisions for context injection.
 */
export function getMemorySummary(cwd) {
  const decisions = loadDecisions(cwd);
  if (decisions.length === 0) return '';

  const recent = decisions.slice(-5);
  const lines = ['## Recent Architectural Decisions\n'];
  for (const d of recent) {
    lines.push(`- **${d.description}** (${d.timestamp?.slice(0, 10) || 'unknown'})`);
    if (d.scores) {
      const scores = Object.entries(d.scores).map(([k, v]) => `${k}:${v}`).join(', ');
      lines.push(`  Council: ${scores} (avg ${d.avgScore?.toFixed(1) || '?'})`);
    }
  }
  return lines.join('\n');
}
