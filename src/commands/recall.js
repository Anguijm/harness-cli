import path from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { findChunkBySlug, extractLinks } from '../lib/links.js';
import {
  loadSources,
  loadConfiguredSources,
} from '../lib/recall_corpus.js';
import {
  loadIndex,
  chunkContentHash,
  cosineSimilarity,
  embed,
} from '../lib/embeddings.js';
import fs from 'fs';

// Queryable memory retrieval. Surfaces past entries from learnings.md,
// yolo_log.jsonl, last_council.md, failures.jsonl etc. that match the
// query, ranked by keyword density × recency × (optional) vector similarity.
//
// Anti-pattern this prevents: institutional knowledge accumulating in
// .harness/ that humans have written but never read again. Pair with
// `harness map` (which grounds plans in code) to ground plans in past
// lessons too.
//
// Vector blend (priority #6): if .harness/embeddings.json exists and is
// fresh for the current corpus, recall embeds the query, computes cosine
// similarity against every chunk's stored vector, and blends the result
// with the keyword × recency score. The blend surfaces semantic matches
// that share no literal tokens with the query (e.g., "council kept
// hallucinating accessibility rules" finding a chunk titled "a11y
// persona invented i18n requirements"). Falls back to keyword-only
// behavior when no index exists, when it's stale, or with --no-vector.

// Common stop words — don't let them dominate the keyword score.
const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'have', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
  'the', 'this', 'to', 'was', 'were', 'will', 'with', 'when', 'how',
  'what', 'why', 'who', 'do', 'does', 'should', 'would', 'could',
]);

// Score multiplier for chunks reached via [[link]]: 0.5. Heuristic chosen
// to keep linked context relevant but subordinate to direct matches.
// Increasing toward 1.0 lets linked items displace more relevant direct
// hits; below ~0.25 they don't surface meaningfully when direct matches
// also exist. (Documented per maintainability remediation, PR #3 R1.)
const LINKED_SCORE_MULTIPLIER = 0.5;

// Vector contribution weight in the final blend. The vector contribution
// is rescaled by max_keyword_score before adding, so a weight of 0.5
// reads as "half the influence of the top keyword match." Larger values
// let semantic matches outrank exact-keyword hits, which is rarely what
// the user wants on a small corpus; 0.5 is the documented default and
// per-repo override flows through harness.yml `recall.vector_weight`.
const DEFAULT_VECTOR_WEIGHT = 0.5;

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z][a-z0-9_-]+/g) || []).filter(
    (w) => w.length > 2 && !STOP.has(w)
  );
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

function loadVectorConfig(cwd) {
  // recall.vector_weight from harness.yml — used to scale the vector
  // contribution in the blend. Defaults to DEFAULT_VECTOR_WEIGHT when
  // unset; falls back silently if harness.yml is unparseable (loadConfiguredSources
  // already warns on the same parse failure for the sources list).
  const cfg = path.join(cwd, 'harness.yml');
  if (!fs.existsSync(cfg)) return { weight: DEFAULT_VECTOR_WEIGHT };
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(cfg, 'utf8'));
  } catch {
    return { weight: DEFAULT_VECTOR_WEIGHT };
  }
  const recall = parsed && parsed.recall;
  if (!recall) return { weight: DEFAULT_VECTOR_WEIGHT };
  const w = recall.vector_weight;
  if (typeof w === 'number' && w >= 0 && w <= 5) {
    return { weight: w };
  }
  return { weight: DEFAULT_VECTOR_WEIGHT };
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

  // === Vector blend (priority #6) ===
  // Try to load .harness/embeddings.json. If present and every chunk in
  // the current corpus is hashed in the index, embed the query and add a
  // cosine-similarity component to each chunk's score. If the index is
  // missing, partial, or the user passed --no-vector, fall back to
  // keyword-only behavior (recall stays useful without an index).
  const useVector = options.vector !== false;
  let vectorScores = null;
  if (useVector) {
    const index = loadIndex(cwd);
    if (index && index.entries) {
      const allHashed = chunks.every((c) =>
        Object.prototype.hasOwnProperty.call(
          index.entries,
          chunkContentHash(c.text)
        )
      );
      if (!allHashed) {
        console.error(
          chalk.dim(
            'recall: vector index is stale — some chunks are unhashed; run `harness reindex` for full semantic blend. Proceeding with keyword-only.'
          )
        );
      } else {
        try {
          const queryVec = await embed({
            text: query,
            apiKey: process.env.GEMINI_API_KEY,
            model: index.model,
          });
          const cfg = loadVectorConfig(cwd);
          vectorScores = new Map();
          for (const c of chunks) {
            const entry = index.entries[chunkContentHash(c.text)];
            if (!entry || !Array.isArray(entry.vector)) continue;
            const sim = cosineSimilarity(queryVec, entry.vector);
            vectorScores.set(c.text, { sim, weight: cfg.weight });
          }
        } catch (e) {
          // Fail-soft on the query-embed path: recall should never break
          // if the API hiccups. Tell the user, then continue keyword-only.
          console.error(
            chalk.dim(
              `recall: query embedding failed (${e.message}). Proceeding with keyword-only.`
            )
          );
          vectorScores = null;
        }
      }
    }
  }

  const keywordScored = chunks.map((c) => ({
    chunk: c,
    keywordScore: score(c, queryTokens),
    via: null,
  }));
  const maxKeyword = keywordScored.reduce(
    (m, x) => Math.max(m, x.keywordScore),
    0
  );
  // Blend: keyword score + (cosine × weight × max_keyword_score). Scaling
  // the vector contribution by max_keyword puts both terms on the same
  // numeric scale, so vector_weight reads as "fraction of a top keyword
  // hit." Without scaling, raw cosine values (0–1) would always be
  // dwarfed by keyword scores that climb into the tens.
  const scored = keywordScored
    .map((x) => {
      let total = x.keywordScore;
      if (vectorScores && maxKeyword > 0) {
        const v = vectorScores.get(x.chunk.text);
        if (v) total += Math.max(0, v.sim) * v.weight * maxKeyword;
      } else if (vectorScores && maxKeyword === 0) {
        // No keyword hits at all — fall back to raw cosine on a [0,1]
        // scale so semantically-relevant chunks can still surface.
        const v = vectorScores.get(x.chunk.text);
        if (v) total = Math.max(0, v.sim);
      }
      return { chunk: x.chunk, score: total, via: null };
    })
    .filter((x) => x.score > 0);

  // Follow [[wiki-style]] cross-references one hop deep. Linked chunks
  // are added to the candidate pool at half score, then the combined
  // pool is re-sorted and sliced to `limit`. This means linked context
  // can replace lower-scoring direct hits when more relevant, but
  // never extends the result count past the user's limit. (Bugs
  // reviewer R1 PR #3: previous behavior expanded the limit AND
  // skipped re-sort, both incorrect.)
  const seen = new Set(scored.map((s) => s.chunk.text));
  const linked = [];
  for (const hit of scored) {
    const links = extractLinks(hit.chunk.text);
    for (const linkText of links) {
      const { chunk: target, ambiguous } = findChunkBySlug(chunks, linkText);
      if (!target) continue;
      // Skip ambiguous resolutions — silently picking the first of
      // several plausible matches is worse than not following the link.
      // `harness lint` separately surfaces these as ambiguous_links
      // warnings so the author can disambiguate. (Bugs reviewer R2 PR #3.)
      if (ambiguous) continue;
      if (seen.has(target.text)) continue;
      seen.add(target.text);
      linked.push({
        chunk: target,
        score: hit.score * LINKED_SCORE_MULTIPLIER,
        via: linkText,
      });
    }
  }

  const limit = options.limit || 5;
  const top = [...scored, ...linked]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const directInTop = top.filter((t) => !t.via).length;
  const linkedInTop = top.filter((t) => t.via).length;

  if (top.length === 0) {
    console.log(chalk.dim(`No matches in ${chunks.length} chunks across ${sources.length} sources.`));
    process.exit(0);
  }

  console.log(`# Recall: "${query}"`);
  console.log(`_${directInTop} direct match${directInTop === 1 ? '' : 'es'}, ${linkedInTop} linked from those (scanned ${chunks.length} chunks total, limit ${limit})_`);
  console.log();

  for (const { chunk, score, via } of top) {
    const dateLabel = chunk.date ? ` — ${chunk.date}` : '';
    const viaLabel = via ? `  _(linked via [[${via}]])_` : '';
    console.log(`---`);
    console.log(`**Source:** \`${chunk.source}\`${dateLabel}  _(score ${score.toFixed(2)})_${viaLabel}`);
    console.log();
    console.log(formatExcerpt(chunk));
    console.log();
  }
}
