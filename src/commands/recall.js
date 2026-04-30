import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

// Queryable memory retrieval. Surfaces past entries from learnings.md,
// yolo_log.jsonl, last_council.md, failures.jsonl etc. that match the
// query, ranked by keyword density × recency.
//
// Anti-pattern this prevents: institutional knowledge accumulating in
// .harness/ that humans have written but never read again. Pair with
// `harness map` (which grounds plans in code) to ground plans in past
// lessons too.

const DEFAULT_SOURCES = [
  '.harness/learnings.md',
  '.harness/failures.jsonl',
  '.harness/yolo_log.jsonl',
  '.harness/last_council.md',
];

// Dates in chunk headers like "## 2026-04-29 — session label" or
// "ts: 2026-04-30T12:34:56Z" inside JSONL entries.
const DATE_RE = /\b(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;

// Common stop words — don't let them dominate the keyword score.
const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'have', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'this', 'to', 'was', 'were', 'will', 'with', 'when', 'how',
  'what', 'why', 'who', 'do', 'does', 'should', 'would', 'could',
]);

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) || []).filter(
    (w) => w.length > 2 && !STOP.has(w)
  );
}

function chunkMarkdown(content, sourcePath) {
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

function chunkJsonl(content, sourcePath) {
  // Each line is its own chunk.
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

function extractDate(s) {
  const m = s && s.match(DATE_RE);
  return m ? m[1] : null;
}

function recencyWeight(dateStr) {
  // Returns a multiplier in [0.5, 1.0]. More recent = closer to 1.0.
  // Older than 90 days = 0.5.
  if (!dateStr) return 0.7;
  const date = new Date(dateStr);
  if (isNaN(date)) return 0.7;
  const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 0) return 1.0;
  if (ageDays >= 90) return 0.5;
  return 1.0 - (ageDays / 90) * 0.5;
}

function score(chunk, queryTokens) {
  const text = chunk.text.toLowerCase();
  const chunkTokens = new Set(tokenize(chunk.text));
  let raw = 0;
  let uniqueMatches = 0;
  for (const q of queryTokens) {
    const re = new RegExp(`\\b${q}\\b`, 'gi');
    const count = (text.match(re) || []).length;
    if (count > 0) uniqueMatches += 1;
    raw += count;
  }
  if (raw === 0) return 0;
  // Length normalization: penalize very long chunks slightly.
  const lengthPenalty = 1 / (1 + chunk.text.length / 4000);
  return raw * (1 + uniqueMatches) * lengthPenalty * recencyWeight(chunk.date);
}

function loadSources(cwd, sources) {
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

function loadConfiguredSources(cwd) {
  // Read harness.yml for a `recall.sources` list, if present.
  // Tiny YAML parser: just look for the recall block. Keeps us dep-free.
  const cfg = path.join(cwd, 'harness.yml');
  if (!fs.existsSync(cfg)) return DEFAULT_SOURCES;
  const yaml = fs.readFileSync(cfg, 'utf8');
  const m = yaml.match(/^recall:\s*\n((?:[ \t]+.+\n?)+)/m);
  if (!m) return DEFAULT_SOURCES;
  const block = m[1];
  const sourcesMatch = block.match(/sources:\s*\n((?:[ \t]+-\s+.+\n?)+)/);
  if (!sourcesMatch) return DEFAULT_SOURCES;
  const items = [...sourcesMatch[1].matchAll(/^[ \t]+-\s+(.+?)\s*$/gm)].map(
    (m) => m[1].replace(/^['"]|['"]$/g, '')
  );
  return items.length ? items : DEFAULT_SOURCES;
}

function formatExcerpt(chunk, maxLines = 12) {
  const lines = chunk.text.split('\n');
  if (lines.length <= maxLines) return chunk.text;
  return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines)`;
}

export async function recall(query, options) {
  const cwd = process.cwd();
  if (!query || !query.trim()) {
    console.error(chalk.red('Pass a query: harness recall "<topic>"'));
    process.exit(1);
  }

  const sources = options.source && options.source.length
    ? options.source
    : loadConfiguredSources(cwd);

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    console.error(chalk.yellow(`Query "${query}" has no significant tokens after stop-word removal.`));
    process.exit(1);
  }

  const chunks = loadSources(cwd, sources);
  if (chunks.length === 0) {
    console.error(chalk.yellow(`No chunks found in sources: ${sources.join(', ')}`));
    process.exit(0);
  }

  const scored = chunks
    .map((c) => ({ chunk: c, score: score(c, queryTokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const limit = options.limit || 5;
  const top = scored.slice(0, limit);

  if (top.length === 0) {
    console.log(chalk.dim(`No matches in ${chunks.length} chunks across ${sources.length} sources.`));
    process.exit(0);
  }

  console.log(`# Recall: "${query}"`);
  console.log(`_${top.length} of ${scored.length} matching chunks (scanned ${chunks.length} total) — ranked by keyword × recency_`);
  console.log();

  for (const { chunk, score } of top) {
    const dateLabel = chunk.date ? ` — ${chunk.date}` : '';
    console.log(`---`);
    console.log(`**Source:** \`${chunk.source}\`${dateLabel}  _(score ${score.toFixed(2)})_`);
    console.log();
    console.log(formatExcerpt(chunk));
    console.log();
  }
}
