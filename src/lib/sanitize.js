// Shared "untrusted text" sanitizer.
//
// Used by `harness synthesize` (when wrapping captured failure records or
// learnings excerpts inside <UNTRUSTED_*> tags before passing to the
// Gemini synthesizer prompt) and by `harness reindex` (when sending chunk
// text to the embedding endpoint). Both paths take user-controlled input
// that an attacker could craft to manipulate the upstream call.
//
// Two protections applied:
//
//   1. Strip ASCII control chars (except \t \n \r) and Unicode zero-width /
//      bidi-override chars. These can visually mask content or break out
//      of a tag boundary.
//   2. Escape any closing tag for the wrapper so a payload can't smuggle
//      in </UNTRUSTED_FAILURE_RECORD> or </UNTRUSTED_LEARNINGS_EXCERPTS>
//      and resume top-level prompt context.
//
// Codex caught the original implementation only escaping the failure-record
// tag on PR #6. Generalized here to handle every closing tag we declare,
// and centralized so embedding-side input gets the same hardening.

export const UNTRUSTED_CLOSING_TAGS = [
  '</UNTRUSTED_FAILURE_RECORD>',
  '</UNTRUSTED_LEARNINGS_EXCERPTS>',
  '</UNTRUSTED_RECALL_CONTEXT>',
];

export const FAILURE_RECORD_CLOSING_TAG = '</UNTRUSTED_FAILURE_RECORD>';
export const LEARNINGS_EXCERPTS_CLOSING_TAG =
  '</UNTRUSTED_LEARNINGS_EXCERPTS>';
export const RECALL_CONTEXT_CLOSING_TAG = '</UNTRUSTED_RECALL_CONTEXT>';

export function escapeClosingTag(tag) {
  return tag.replace('</', '<\\/');
}

export function sanitizeUntrusted(text, closingTags = UNTRUSTED_CLOSING_TAGS) {
  if (text === null || text === undefined) return '';
  let s = String(text)
    // Strip ASCII control chars (except \t \n \r) and Unicode zero-width /
    // bidi-override chars that could visually break out of a tag.
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069]/g,
      ''
    )
    // Cap any run of newlines at two: long blank runs make it easier for
    // the model to be visually fooled into thinking a tag closed.
    .replace(/\n{3,}/g, '\n\n');
  for (const tag of closingTags) {
    s = s.replace(new RegExp(tag, 'g'), escapeClosingTag(tag));
  }
  return s;
}
