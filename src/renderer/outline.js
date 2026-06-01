/**
 * outline.js — document outline (T-F7). Pure: extracts h1–h6 from Markdown via
 * the injected marked lexer and computes the scroll-synced active heading.
 */
import { slugify } from './bidi.js';

/**
 * Extract headings (levels 1–6) with Arabic-aware slugs.
 * @param {string} md
 * @param {{marked}} deps  marked with a `.lexer` (marked@1+)
 * @returns {Array<{level:number, text:string, slug:string}>}
 */
export function extractHeadings(md, { marked } = {}) {
  if (!md || !marked || typeof marked.lexer !== 'function') return [];
  const tokens = marked.lexer(md);
  const out = [];
  const seen = new Map();
  for (const t of tokens) {
    if (t.type === 'heading' && t.depth >= 1 && t.depth <= 6) {
      const text = String(t.text || '').trim();
      let slug = slugify(text);
      // de-duplicate slugs (GitHub style: -1, -2 …)
      if (seen.has(slug)) {
        const n = seen.get(slug) + 1;
        seen.set(slug, n);
        slug = `${slug}-${n}`;
      } else {
        seen.set(slug, 0);
      }
      out.push({ level: t.depth, text, slug });
    }
  }
  return out;
}

/**
 * Index of the active heading for a given scroll position (scroll-sync).
 * @param {number} scrollTop
 * @param {number[]} offsets  heading offsetTops, ascending
 * @returns {number} index of the last heading at/above scrollTop (>=0)
 */
export function activeHeading(scrollTop, offsets) {
  if (!Array.isArray(offsets) || offsets.length === 0) return -1;
  let idx = 0;
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] <= scrollTop + 1) idx = i; else break;
  }
  return idx;
}
