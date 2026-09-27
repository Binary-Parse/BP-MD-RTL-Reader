/**
 * footnotes.js — GFM-style footnotes for marked (R11).
 *
 * marked core + `gfm:true` does NOT implement footnotes, so this adds a custom
 * inline/block extension pair plus parse hooks:
 *   • `[^id]`      → a numbered superscript reference linking to the note body
 *   • `[^id]: …`   → a definition, collected and rendered as an ordered
 *                    `<section class="footnotes">` at the end, each with a backlink.
 *
 * Numbering follows first-reference order (GFM behaviour). Definition bodies are
 * emitted as escaped plain text — the whole output is DOMPurify-sanitized
 * downstream by parseMarkdown(), and `#fn-*`/`#fnref-*` hrefs are safe fragments.
 *
 * Pure factory: returns a marked `use()` config object. State (ref order +
 * definitions) lives in the closure and is reset by the preprocess hook on every
 * parse, so a single registration is safe to reuse across documents.
 */

const REF_RE = /^\[\^([^\]\s]+)\]/;
// A definition: `[^id]: text`, plus continuation lines until a blank line or the
// next definition. Up to 3 leading spaces are allowed (CommonMark indent tolerance).
const DEF_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?![ \t]*\n)(?! {0,3}\[\^)[^\n]*)*)\n?/;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function footnoteExtension() {
  const order = [];        // ref ids in first-appearance (render) order
  const defs = new Map();  // id -> definition body text
  const refCounts = new Map(); // footnote number -> occurrence count (unique ref ids)
  const indexOf = (id) => {
    let i = order.indexOf(id);
    if (i === -1) { order.push(id); i = order.length - 1; }
    return i + 1; // 1-based footnote number
  };

  return {
    extensions: [
      {
        name: 'footnoteRef',
        level: 'inline',
        // Stryker disable next-line all: marked's `start` is a SCAN-POSITION HINT, not
        // correctness — when it returns a wrong index/undefined, marked falls back to
        // full scanning and the tokenizer still matches, so these mutants are equivalent.
        start(src) { const i = src.search(/\[\^[^\]\s]+\]/); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = REF_RE.exec(src);
          if (m) return { type: 'footnoteRef', raw: m[0], id: m[1] };
        },
        renderer(token) {
          // MD-01: a reference with no definition is NOT a footnote — GFM renders the
          // marker as literal text, and a dangling numbered link to an empty list item
          // (plus a stranded <hr>/<ol>) is a visible defect. Definitions are pre-scanned
          // in the preprocess hook, so this check is position-independent.
          if (!defs.has(token.id)) return esc(token.raw);
          const n = indexOf(token.id);
          const k = (refCounts.get(n) || 0) + 1;
          refCounts.set(n, k);
          // The FIRST occurrence keeps the plain `fnref-N` id (the note body's backlink
          // target); later occurrences of the same footnote get a per-occurrence id, so
          // no two elements ever share an id (duplicate ids are fatal for epubcheck).
          const refId = k === 1 ? `fnref-${n}` : `fnref-${n}-${k}`;
          return `<sup class="fn-ref" id="${refId}"><a href="#fn-${n}">${n}</a></sup>`;
        },
      },
      {
        name: 'footnoteDef',
        level: 'block',
        // Stryker disable next-line all: a perf scan-hint (see footnoteRef.start) — equivalent.
        start(src) { const i = src.search(/^ {0,3}\[\^[^\]\s]+\]:/m); return i < 0 ? undefined : i; },
        tokenizer(src) {
          const m = DEF_RE.exec(src);
          if (m) {
            defs.set(m[1], (m[2] || '').replace(/\n[ \t]*/g, ' ').trim());
            return { type: 'footnoteDef', raw: m[0], id: m[1] };
          }
        },
        renderer() { return ''; }, // body is emitted by the postprocess hook below
      },
    ],
    hooks: {
      // Reset per-document state before each parse so reuse across notes is clean.
      // Definitions are PRE-SCANNED from the raw markdown (MD-01): a reference that
      // appears before its definition — or with none at all — must know at render time
      // whether it is a real footnote, and block tokenizers run in document order only.
      preprocess(md) {
        order.length = 0; defs.clear(); refCounts.clear();
        for (const m of String(md).matchAll(/^ {0,3}\[\^([^\]\s]+)\]:/gm)) {
          if (!defs.has(m[1])) defs.set(m[1], '');
        }
        return md;
      },
      // Append the collected footnotes as a numbered list (reference order), each
      // with a ↩ backlink to its first reference. No-op when nothing was referenced.
      postprocess(html) {
        if (order.length === 0) return html;
        const items = order.map((id, idx) => {
          const n = idx + 1;
          const body = defs.has(id) ? esc(defs.get(id)) : '';
          return `<li id="fn-${n}" class="fn-item">${body} <a href="#fnref-${n}" class="fn-back" aria-label="Back to reference ${n}">↩</a></li>`;
        }).join('');
        return `${html}\n<section class="footnotes"><hr><ol>${items}</ol></section>`;
      },
    },
  };
}
