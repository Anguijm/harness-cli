// Shared link/slug utilities for harness lint + recall.
//
// Background: learnings.md sections may cross-reference each other via
// [[wiki-style]] links. Both `harness lint` (broken-link detection) and
// `harness recall` (follow links one hop at half score) need the same
// link-resolution rules. Keeping this in one place prevents implementation
// drift — a real concern called out by the council on PR #3 round 1
// (architecture + bugs reviewers both flagged the duplication).

// Wiki-style link: [[some text]] resolves to a learnings.md section by
// slug-normalized header match.
export const LINK_RE = /\[\[([^\]]+)\]\]/g;

// Slug normalization: lowercase, dashes for non-alphanumeric runs, strip
// edges. Stable across header punctuation differences ("API: V2!" and
// "api v2" both → "api-v2").
export function normalizeSlug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Header slug for a learnings chunk. Strips "## " prefix and any leading
// "YYYY-MM-DD — " date marker so links read against the human-meaningful
// part of the header rather than the date.
export function chunkHeaderSlug(chunk) {
  const firstLine = chunk.header
    ? chunk.header
    : (chunk.text || '').split('\n')[0] || '';
  const stripped = firstLine
    .replace(/^##\s+/, '')
    .replace(/^\d{4}-\d{2}-\d{2}\s*[—–-]?\s*/, '');
  return normalizeSlug(stripped);
}

// Resolve a link to a chunk. Direction: linkText must be a prefix of the
// section's slug (treating the link as a shortened reference to a longer
// header). The reverse direction was a real bug: `[[council-drift]]`
// could resolve to `## council` because the header's full slug "council"
// is a prefix of the link "council-drift" — which inverts the intended
// shortened-link semantic. (Caught by the bugs reviewer on PR #3 R1.)
//
// Returns { chunk, ambiguous } where `ambiguous` is true if two or more
// chunks tied for the match — caller decides whether to error or pick one.
export function findChunkBySlug(chunks, linkText) {
  const targetSlug = normalizeSlug(linkText);
  if (!targetSlug) return { chunk: null, ambiguous: false };
  // Exact match wins outright.
  const exact = chunks.filter((c) => chunkHeaderSlug(c) === targetSlug);
  if (exact.length === 1) return { chunk: exact[0], ambiguous: false };
  if (exact.length > 1) return { chunk: exact[0], ambiguous: true };
  // Prefix match: link is a shortened form of the section header.
  const prefix = chunks.filter((c) =>
    chunkHeaderSlug(c).startsWith(targetSlug)
  );
  if (prefix.length === 1) return { chunk: prefix[0], ambiguous: false };
  if (prefix.length > 1) return { chunk: prefix[0], ambiguous: true };
  return { chunk: null, ambiguous: false };
}

export function extractLinks(text) {
  const links = [];
  let m;
  // Use a fresh regex each time — global flags carry .lastIndex state
  // between calls, which is a footgun when the export is reused.
  const re = new RegExp(LINK_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    links.push(m[1].trim());
  }
  return links;
}
