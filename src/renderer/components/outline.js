/**
 * outline.js — document outline (T-F7). Pure: extracts h1–h6 from Markdown via
 * the injected marked lexer and computes the scroll-synced active heading.
 */
import { slugify } from '../bidi.js';

/** Exact source records for ATX and Setext headings, excluding fenced code. */
export function sourceHeadingPositions(md) {
  const lines = String(md || '').split('\n');
  const starts = [];
  let off = 0;
  for (const line of lines) { starts.push(off); off += line.length + 1; }
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]{0,3}(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const atx = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (atx) {
      out.push({ pos: starts[i], level: atx[1].length, text: atx[2].trim() });
      continue;
    }
    const setext = i + 1 < lines.length && /^[ \t]{0,3}(=+|-+)[ \t]*$/.exec(lines[i + 1]);
    if (line.trim() && setext) {
      out.push({ pos: starts[i], level: setext[1][0] === '=' ? 1 : 2, text: line.trim() });
      i++;
    }
  }
  return out;
}

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
