// Vector-embedding index for harness recall.
//
// Stores per-chunk embeddings in .harness/embeddings.json so `harness
// recall` can blend semantic similarity with the existing keyword × recency
// score. Index is content-hash keyed, so unchanged chunks are reused
// across reindex runs (incremental is the default; --full forces re-embed).
//
// API key flows via the `x-goog-api-key` header (PR #6 R2 fix), never as
// a URL query parameter. Sanitizer strips control chars and zero-width
// Unicode before sending text upstream — same discipline synthesize uses.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { sanitizeUntrusted } from './sanitize.js';

export const INDEX_VERSION = 1;
export const INDEX_PATH = '.harness/embeddings.json';
// Default Gemini embedding model. text-embedding-004 produces 768-dim
// vectors; cheaper than the older text-embedding-001 and good enough for
// the corpus sizes harness repos hit (≤ a few hundred chunks).
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-004';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Exit code shared with synthesize for any config / runtime / API error.
export const EXIT_CONFIG_OR_RUNTIME_ERROR = 2;

export function chunkContentHash(text) {
  // 16 hex chars = 64 bits — same length and rationale as synthesize's
  // signature hash. Collision probability < 3e-10 at 100K chunks.
  return crypto
    .createHash('sha256')
    .update(text)
    .digest('hex')
    .slice(0, 16);
}

export function loadIndex(cwd) {
  const p = path.join(cwd, INDEX_PATH);
  if (!fs.existsSync(p)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    // Corrupt file — caller treats as missing; reindex regenerates from
    // scratch. We don't try to repair, since the cost of regeneration is
    // small and silent partial recovery would mask data corruption.
    return null;
  }
  if (
    !parsed ||
    parsed.version !== INDEX_VERSION ||
    typeof parsed.entries !== 'object' ||
    parsed.entries === null
  ) {
    return null;
  }
  return parsed;
}

export function saveIndex(cwd, index) {
  const p = path.join(cwd, INDEX_PATH);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(index, null, 2));
}

export function emptyIndex(model) {
  return { version: INDEX_VERSION, model, entries: {} };
}

// Default Gemini caller — direct fetch to the embedding REST endpoint.
// Test seam: callers can override via the `fetchImpl` parameter.
async function callGeminiEmbedDefault({ text, apiKey, model, fetchImpl }) {
  const fetcher = fetchImpl || fetch;
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:embedContent`;
  const body = {
    content: { parts: [{ text }] },
  };
  const res = await fetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '<unreadable>');
    throw new Error(
      `Gemini embed API ${res.status} ${res.statusText}: ${errText.slice(0, 300)}`
    );
  }
  const json = await res.json();
  const vector = json?.embedding?.values;
  if (!Array.isArray(vector) || vector.length === 0 || !vector.every((v) => typeof v === 'number')) {
    throw new Error(
      `Gemini embed returned no vector. Response head: ${JSON.stringify(json).slice(0, 300)}`
    );
  }
  return vector;
}

export async function embed({ text, apiKey, model, fetchImpl } = {}) {
  // Sanitize before sending upstream — strip control / zero-width chars
  // for the same reasons synthesize does (consistency + some providers'
  // moderation can be confused by exotic Unicode).
  const safeText = sanitizeUntrusted(text);

  // Test seam: HARNESS_EMBED_STUB_RESPONSE returns a fixed vector instead
  // of calling Gemini. Used only by smoke tests; documented here as
  // test-only. The same caveat applies as synthesize's stub: no
  // production code path sets it.
  const stub = process.env.HARNESS_EMBED_STUB_RESPONSE;
  if (stub) {
    try {
      const parsed = JSON.parse(stub);
      if (
        Array.isArray(parsed) &&
        parsed.every((v) => typeof v === 'number')
      ) {
        return parsed;
      }
      // Stub can also be a function name => deterministic vector from text
      if (parsed && parsed.deterministic === true) {
        return deterministicVectorFromText(safeText);
      }
    } catch {
      // fall through to throwing below
    }
    throw new Error(
      'HARNESS_EMBED_STUB_RESPONSE must be a JSON array of numbers or {"deterministic":true}.'
    );
  }

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY required for embedding calls.');
  }
  return callGeminiEmbedDefault({
    text: safeText,
    apiKey,
    model: model || DEFAULT_EMBEDDING_MODEL,
    fetchImpl,
  });
}

// Deterministic per-text vector for the stub path. Hashes the text and
// uses the digest bytes as a 32-dim float vector, normalized to unit
// length. Stable across runs for a given text, so tests can assert
// cosine similarity behaviors without coupling to a real model.
export function deterministicVectorFromText(text) {
  const digest = crypto.createHash('sha256').update(String(text)).digest();
  const dim = 32;
  const vec = new Array(dim);
  for (let i = 0; i < dim; i++) {
    // Map each byte to [-0.5, 0.5]; gives texts with overlapping prefixes
    // and overlapping content correlated (but not equal) vectors.
    vec[i] = (digest[i % digest.length] / 255) - 0.5;
  }
  // Normalize to unit length so cosine similarity is well-defined.
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) {
    throw new Error('cosineSimilarity expects two number arrays');
  }
  if (a.length !== b.length) {
    throw new Error(
      `cosineSimilarity vectors must be same length (got ${a.length} vs ${b.length})`
    );
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}
