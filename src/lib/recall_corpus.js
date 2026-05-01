// Shared corpus-loading + chunking for harness recall and harness reindex.
//
// Both commands need the same chunk identity: reindex computes embeddings
// per chunk and stores them keyed on a content hash; recall later looks
// up those hashes. If the two commands diverged in how they split a file
// into chunks, every reindex would invalidate the index from the recall
// side and cause cache thrashing. One implementation here, both import.

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { loadHarnessConfig } from './config.js';

export const DEFAULT_SOURCES = [
  '.harness/learnings.md',
  '.harness/failures.jsonl',
  '.harness/yolo_log.jsonl',
  '.harness/last_council.md',
];

// Dates in chunk headers like "## 2026-04-29 — session label" or
// "ts: 2026-04-30T12:34:56Z" inside JSONL entries.
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;

export function extractDate(s) {
  const m = s && s.match(DATE_RE);
  return m ? m[1] : null;
}

export function chunkMarkdown(content, sourcePath) {
  // Split on H2 (## ...) headings. Each chunk = heading + body until next H2.
  const lines = content.split('\n');
  const chunks = [];
  let current = null;
  for (const line of lines) {
    if (/^##\s+(?!#)/.test(line)) {
      if (current) chunks.push(current);
      current = { header: line, body: [], source: sourcePath };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) chunks.push(current);
  // If no H2 headings at all, treat the whole file as one chunk.
  if (chunks.length === 0) {
    chunks.push({ header: '', body: lines, source: sourcePath });
  }
  return chunks.map((c) => ({
    text: (c.header + '\n' + c.body.join('\n')).trim(),
    source: c.source,
    date: extractDate(c.header) || extractDate(c.body.join('\n')),
  }));
}

export function chunkJsonl(content, sourcePath) {
  return content
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      let date = null;
      try {
        const obj = JSON.parse(line);
        date = obj.ts || obj.timestamp || obj.date || null;
      } catch {
        // not JSON — fall back to regex
      }
      if (!date) date = extractDate(line);
      return { text: line, source: sourcePath, date };
    });
}

export function loadSources(cwd, sources) {
  const chunks = [];
  for (const rel of sources) {
    const abs = path.isAbsolute(rel) ? rel : path.join(cwd, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf8');
    if (rel.endsWith('.jsonl')) {
      chunks.push(...chunkJsonl(content, rel));
    } else {
      chunks.push(...chunkMarkdown(content, rel));
    }
  }
  return chunks;
}

export function loadConfiguredSources(cwd) {
  // Read harness.yml for a `recall.sources` list, if present.
  // Bugs reviewer R2 PR #4: don't silently fall back to defaults when
  // harness.yml is unparseable — the user's `recall.sources` config is
  // being ignored, and they should know. recall is a read-only command,
  // so warn loudly but don't abort (defaults still produce useful output).
  const cfg = loadHarnessConfig(cwd);
  if (!cfg.ok) {
    console.error(
      chalk.yellow(
        `harness.yml could not be parsed (${cfg.error.message.split('\n')[0]}); falling back to default recall sources.`
      )
    );
    return DEFAULT_SOURCES;
  }
  const sources = cfg.parsed && cfg.parsed.recall && cfg.parsed.recall.sources;
  if (!Array.isArray(sources) || sources.length === 0) return DEFAULT_SOURCES;
  return sources;
}
