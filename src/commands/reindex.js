// harness reindex — build / refresh the vector embedding index used by
// `harness recall` for semantic blend.
//
// Default: incremental — only embed chunks whose content hash isn't
// already in the index. --full discards the existing index and re-embeds
// everything (e.g., when switching embedding models). --dry-run reports
// what would change without making any API calls.
//
// Index file is .harness/embeddings.json, gitignored — derivable cache
// rather than load-bearing artifact. Recall falls back to keyword-only
// behavior when the index is missing, stale, or invalid.

import path from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import fs from 'fs';
import {
  loadSources,
  loadConfiguredSources,
} from '../lib/recall_corpus.js';
import {
  chunkContentHash,
  loadIndex,
  saveIndex,
  emptyIndex,
  embed,
  DEFAULT_EMBEDDING_MODEL,
  EXIT_CONFIG_OR_RUNTIME_ERROR,
} from '../lib/embeddings.js';

function loadEmbeddingModel(cwd) {
  // recall.embedding_model from harness.yml, falls back to library default.
  // Falls back silently on parse failure (loadConfiguredSources already
  // emits a warning on the same condition for the sources list).
  const cfg = path.join(cwd, 'harness.yml');
  if (!fs.existsSync(cfg)) return DEFAULT_EMBEDDING_MODEL;
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(cfg, 'utf8'));
  } catch {
    return DEFAULT_EMBEDDING_MODEL;
  }
  const m = parsed && parsed.recall && parsed.recall.embedding_model;
  return typeof m === 'string' && m.length > 0 ? m : DEFAULT_EMBEDDING_MODEL;
}

export async function reindex(options) {
  const cwd = process.cwd();
  const dryRun = !!options.dryRun;
  const full = !!options.full;
  const model = options.model || loadEmbeddingModel(cwd);

  const sources = loadConfiguredSources(cwd);
  const chunks = loadSources(cwd, sources);
  if (chunks.length === 0) {
    console.error(
      chalk.yellow(
        `No chunks found in sources: ${sources.join(', ')}. Nothing to embed.`
      )
    );
    process.exit(0);
  }

  // If --full or model changed, throw away the existing index. Otherwise
  // start from what we have so unchanged chunks are reused.
  const existing = full ? null : loadIndex(cwd);
  const indexModelChanged =
    existing && existing.model && existing.model !== model;
  const startFresh = full || !existing || indexModelChanged;
  if (indexModelChanged && !full) {
    console.log(
      chalk.yellow(
        `Existing index used model "${existing.model}"; rebuilding for "${model}".`
      )
    );
  }
  const index = startFresh ? emptyIndex(model) : existing;

  // Compute the set of content hashes still present in the corpus so we
  // can drop stale entries that no longer correspond to any chunk.
  const liveHashes = new Set(chunks.map((c) => chunkContentHash(c.text)));

  const toEmbed = [];
  for (const c of chunks) {
    const hash = chunkContentHash(c.text);
    if (!index.entries[hash]) toEmbed.push({ chunk: c, hash });
  }

  // Drop entries that no longer correspond to any chunk in the corpus.
  // Keeps the index from growing unboundedly as content evolves.
  const droppedHashes = [];
  for (const hash of Object.keys(index.entries)) {
    if (!liveHashes.has(hash)) {
      droppedHashes.push(hash);
      delete index.entries[hash];
    }
  }

  console.log(chalk.bold('harness reindex'));
  console.log(`  model        ${model}`);
  console.log(`  sources      ${sources.length}`);
  console.log(`  chunks       ${chunks.length}`);
  console.log(`  to embed     ${toEmbed.length}`);
  console.log(`  reused       ${chunks.length - toEmbed.length}`);
  console.log(`  dropped      ${droppedHashes.length} (no longer in corpus)`);
  console.log();

  if (dryRun) {
    console.log(
      chalk.dim(
        'Dry run. Re-run without --dry-run to call the embedding API and write .harness/embeddings.json.'
      )
    );
    process.exit(0);
  }

  if (toEmbed.length === 0 && droppedHashes.length === 0) {
    console.log(
      chalk.green('Index is up to date. No API calls made.')
    );
    process.exit(0);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const stub = process.env.HARNESS_EMBED_STUB_RESPONSE;
  if (!apiKey && !stub) {
    console.error(
      chalk.red(
        'GEMINI_API_KEY not set. `harness reindex` requires it (or HARNESS_EMBED_STUB_RESPONSE for tests).'
      )
    );
    process.exit(EXIT_CONFIG_OR_RUNTIME_ERROR);
  }

  let embedded = 0;
  for (const { chunk, hash } of toEmbed) {
    let vector;
    try {
      vector = await embed({ text: chunk.text, apiKey, model });
    } catch (e) {
      console.error(
        chalk.red(
          `Embedding failed for chunk in ${chunk.source} (${e.message}). Halting; ${embedded} chunk(s) saved so far.`
        )
      );
      // Save partial progress so the next run picks up where this one
      // left off — incremental mode means every successful embed is
      // worth keeping.
      if (embedded > 0 || droppedHashes.length > 0) saveIndex(cwd, index);
      process.exit(EXIT_CONFIG_OR_RUNTIME_ERROR);
    }
    index.entries[hash] = {
      vector,
      source: chunk.source,
      date: chunk.date || null,
    };
    embedded += 1;
    if (embedded % 10 === 0) {
      console.log(chalk.dim(`  ... ${embedded}/${toEmbed.length} embedded`));
    }
  }

  saveIndex(cwd, index);
  console.log();
  console.log(
    chalk.bold(
      `Wrote .harness/embeddings.json — ${Object.keys(index.entries).length} entr${Object.keys(index.entries).length === 1 ? 'y' : 'ies'}, ${embedded} freshly embedded.`
    )
  );
  process.exit(0);
}
