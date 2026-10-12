/**
 * outline.js — document outline (T-F7). Pure: extracts h1–h6 from Markdown via
 * the injected marked lexer and computes the scroll-synced active heading.
 */
import { slugify } from '../bidi.js';

const ATX_OPEN = /^ {0,3}(#{1,6})(?=[ \t\r]|$)/; // \r: a CRLF line ending is not heading text

/**
 * Parse one line as a CommonMark ATX heading (spec 0.31.2 §4.2): 1–6 `#`, then a space/tab or the
 * end of the line, up to three spaces of indentation. The optional closing `#` run is dropped only
 * when a space/tab (or the content start) precedes it. A single left-to-right scan: the former
 * regex `(.+?)[ \t]*#*[ \t]*$` backtracked cubically on trailing whitespace (audit H9: `# Title` +
 * 2500 spaces froze the renderer for 13.6 s).
 * @param {string} line
 * @returns {{level:number, text:string}|null}
 */
export function parseAtxHeading(line) {
  if (typeof line !== 'string') return null;
  const open = ATX_OPEN.exec(line);
  if (!open) return null;
  let text = line.slice(open[0].length).trim(); // String.prototype.trim is linear; also drops a CR
  let close = text.length;
  while (text[close - 1] === '#') close--; // index -1 reads undefined and stops the scan
  // a closing run counts only when it is the whole content or follows a space/tab
  if (close === 0 || text[close - 1] === ' ' || text[close - 1] === '\t') text = text.slice(0, close).trim();
  return { level: open[1].length, text };
}

const FENCE_LINE = /^[ \t]{0,3}(```|~~~)/;
/** True for a line that opens or closes a fenced code block (the outline's fence toggle). */
export function isFenceLine(line) {
  return FENCE_LINE.test(line);
}

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
    if (isFenceLine(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const atx = parseAtxHeading(line);
    if (atx) {
      out.push({ pos: starts[i], level: atx.level, text: atx.text });
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
