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
import { loadHarnessConfig } from '../lib/config.js';

// Progress reporting cadence during a large reindex — prints a status
// line every Nth embed so the operator sees the run isn't stalled. 10 is
// a balance: too low spams the console; too high lets a stalled-but-
// running embed look frozen for minutes.
const PROGRESS_REPORT_EVERY = 10;

function loadEmbeddingModel(cwd) {
  // recall.embedding_model from harness.yml, falls back to library default.
  // Falls back silently on parse failure (loadConfiguredSources already
  // emits a warning on the same condition for the sources list).
  const cfg = loadHarnessConfig(cwd);
  if (!cfg.ok) return DEFAULT_EMBEDDING_MODEL;
  const m = cfg.parsed && cfg.parsed.recall && cfg.parsed.recall.embedding_model;
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

  // Codex P2 PR #7: only require an API key when we'd actually call the
  // embedding API. A prune-only run (toEmbed === 0, droppedHashes > 0)
  // just rewrites the index to drop stale hashes — no upstream call
  // needed and bailing here would leave the cleanup undone.
  const apiKey = process.env.GEMINI_API_KEY;
  const stub = process.env.HARNESS_EMBED_STUB_RESPONSE;
  if (toEmbed.length > 0 && !apiKey && !stub) {
    console.error(
      chalk.red(
        'GEMINI_API_KEY not set. `harness reindex` requires it (or HARNESS_EMBED_STUB_RESPONSE for tests).'
      )
    );
    process.exit(EXIT_CONFIG_OR_RUNTIME_ERROR);
  }

  // Exclusive lock around the read-modify-write on .harness/embeddings.json.
  // Without this, two concurrent `reindex` runs can race on the write and
  // last-writer-wins silently destroys the other's embeddings — same
  // failure mode the synthesize lock guards against on learnings.md.
  // Bugs reviewer R1 PR #7 flagged this. `wx` is atomic
  // create-if-not-exists; failure means another run holds the lock or a
  // previous run crashed before releasing.
  const lockPath = path.join(cwd, '.harness/.reindex.lock');
  let lockFd;
  try {
    fs.mkdirSync(path.join(cwd, '.harness'), { recursive: true });
    lockFd = fs.openSync(lockPath, 'wx');
    fs.writeSync(
      lockFd,
      `pid ${process.pid} acquired ${new Date().toISOString()}\n`
    );
  } catch (e) {
    if (e.code === 'EEXIST') {
      console.error(
        chalk.red(
          `Another harness reindex appears to be running (lock file exists at ${path.relative(cwd, lockPath)}).`
        )
      );
      console.error(
        chalk.dim(
          '  If no other run is in progress, the previous run crashed before releasing — delete the lock file and retry.'
        )
      );
      process.exit(EXIT_CONFIG_OR_RUNTIME_ERROR);
    }
    throw e;
  }

  let exitCode = 0;
  let embedded = 0;
  try {
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
        exitCode = EXIT_CONFIG_OR_RUNTIME_ERROR;
        break;
      }
      index.entries[hash] = {
        vector,
        source: chunk.source,
        date: chunk.date || null,
      };
      embedded += 1;
      if (embedded % PROGRESS_REPORT_EVERY === 0) {
        console.log(chalk.dim(`  ... ${embedded}/${toEmbed.length} embedded`));
      }
    }

    if (exitCode === 0) {
      saveIndex(cwd, index);
      console.log();
      console.log(
        chalk.bold(
          `Wrote .harness/embeddings.json — ${Object.keys(index.entries).length} entr${Object.keys(index.entries).length === 1 ? 'y' : 'ies'}, ${embedded} freshly embedded.`
        )
      );
    }
  } finally {
    try {
      fs.closeSync(lockFd);
    } catch {
      // intentionally swallowed — releasing the lock is best-effort
    }
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // intentionally swallowed — releasing the lock is best-effort
    }
  }

  if (exitCode !== 0) process.exit(exitCode);
  process.exit(0);
}
