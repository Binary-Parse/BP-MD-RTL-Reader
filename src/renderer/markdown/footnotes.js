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
          const n = indexOf(token.id);
          return `<sup class="fn-ref" id="fnref-${n}"><a href="#fn-${n}">${n}</a></sup>`;
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
      preprocess(md) { order.length = 0; defs.clear(); return md; },
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
