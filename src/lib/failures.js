// Shared failures.jsonl loading + cluster detection.
//
// Used by `harness lint` (to warn about duplicate-signal clusters) and
// `harness synthesize` (to draft synthesis pages from those clusters). One
// source of truth so the two commands can never disagree on what counts as
// a cluster.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const DUPLICATE_SIGNAL_THRESHOLD = 3;

export function loadFailures(cwd) {
  const p = path.join(cwd, '.harness/failures.jsonl');
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  return lines
    .map((line, idx) => ({ line, lineNo: idx + 1 }))
    .filter((x) => x.line.trim().length > 0)
    .map(({ line, lineNo }) => {
      try {
        return { ok: true, lineNo, raw: line, parsed: JSON.parse(line) };
      } catch (e) {
        return { ok: false, lineNo, raw: line, error: e.message };
      }
    });
}

// Group well-formed failures by their canonical signature.
// Signature is `failure_class | sensor_involved | guide_gap` — the same triple
// the steering loop uses to decide whether a guide is the broken thing.
//
// Returns an array of { signature, signatureHash, failures }, sorted by group
// size descending (largest cluster first).
export function findDuplicateSignalClusters(
  failureLines,
  threshold = DUPLICATE_SIGNAL_THRESHOLD
) {
  const groups = new Map();
  for (const f of failureLines) {
    if (!f.ok) continue;
    const key = `${f.parsed.failure_class}|${f.parsed.sensor_involved}|${f.parsed.guide_gap}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const clusters = [];
  for (const [signature, failures] of groups.entries()) {
    if (failures.length < threshold) continue;
    clusters.push({
      signature,
      signatureHash: hashSignature(signature),
      failures,
    });
  }
  clusters.sort((a, b) => b.failures.length - a.failures.length);
  return clusters;
}

// Deterministic short hash of a cluster signature, used as the idempotency
// marker in learnings.md. 8 hex chars = ~32 bits; collision-resistant enough
// across the dozen-or-so clusters a long-lived repo will accumulate.
export function hashSignature(signature) {
  return crypto
    .createHash('sha256')
    .update(signature)
    .digest('hex')
    .slice(0, 8);
}
