/**
 * markdown.js — Markdown parsing, wikilink extension, sanitization
 * Near-pure functions: accept marked/DOMPurify/escapeHtml as injected dependencies.
 */

import { sanitizeHtml } from './trusted.js';
import { footnoteExtension } from './footnotes.js';
import { installRenderGuard, cachedStart, beginRender, endRender, markLimited } from './render-guard.js';
import { escapeHtml as esc } from '../i18n.js';
import { attachSourceLines, dirMarkerExtension, srcLineRenderer, withSourceLines } from './block-direction.js';

// audit SEC-11: a wikilink alias is author-controlled text rendered into element content.
// The TARGET already had its quotes stripped (an attribute-value guard); the alias needs
// real escaping (escapeHtml, from the dependency-free i18n.js).

export function wikilinkTokenizer(src) {
  const m = /^\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/.exec(src);
  if (m) {
    return {
      type: 'wikilink',
      raw: m[0],
      target: m[1].trim(),
      alias: m[2]?.trim() || m[1].trim()
    };
  }
  return undefined;
}

export function wikilinkRenderer(token) {
  const safe = token.target.replace(/['"]/g, '');
  return `<a class="wikilink" data-target="${safe}">${esc(token.alias)}</a>`;
}

const dirMarker = dirMarkerExtension();
let tagSourceLines = false;

export function configureMarked(marked) {
  if (!marked || typeof marked.use !== 'function') return;
  marked.use({
    gfm: true,
    breaks: true,
    extensions: [{
      name: 'wikilink',
      level: 'inline',
      start: cachedStart((src) => src.indexOf('[[')),
      tokenizer: wikilinkTokenizer,
      renderer: wikilinkRenderer,
    }, {
      // Highlight ==text== → <mark> (Typora/Obsidian). Inner is inline-parsed so **bold** etc.
      // still work inside. Requires non-space right after == so "a == b" stays literal text.
      name: 'highlight', level: 'inline',
      start: cachedStart((src) => src.indexOf('==')),
      tokenizer(src) {
        const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
        if (m) return { type: 'highlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
    }, {
      // Subscript ~text~ (single tilde) → <sub>. The negative lookarounds keep GFM
      // strikethrough ~~text~~ working (handed off to the core tokenizer).
      name: 'subscript', level: 'inline',
      // 2: the pattern looks one character back, so the first two are tested on their own.
      start: cachedStart((src) => { const i = src.search(/(?<![~\\])~(?!~)/); return i < 0 ? undefined : i; }, 2),
      tokenizer(src) {
        const m = /^(?<![~])~(?!~)([^~\s][^~\n]*?)~(?!~)/.exec(src);
        if (m) return { type: 'subscript', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<sub>${this.parser.parseInline(t.tokens)}</sub>`; },
    }, {
      // Superscript ^text^ → <sup> (no spaces inside, e.g. X^2^).
      name: 'superscript', level: 'inline',
      start: cachedStart((src) => src.indexOf('^')),
      tokenizer(src) {
        const m = /^\^([^^\s]+?)\^/.exec(src);
        if (m) return { type: 'superscript', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<sup>${this.parser.parseInline(t.tokens)}</sup>`; },
    },
    // A block's pinned direction, `<!-- dir: rtl -->` above it (block-direction.js).
    dirMarker,
    { name: 'srcLine', renderer: srcLineRenderer }],
    // Each rendered top-level block learns its first source line, for the reading view's
    // direction badge. Only while parseMarkdown asks for it: exports never carry the marks.
    hooks: { processAllTokens: (tokens) => (tagSourceLines ? withSourceLines(tokens) : tokens) },
  });
  // Footnotes (R11): marked core doesn't support GFM footnotes — add them as a
  // separate extension+hooks bundle ([^id] refs + [^id]: defs → end-of-doc list).
  marked.use(footnoteExtension());
  // audit M4: a time budget for the inline tokenizers, and cached `start` hints.
  installRenderGuard(marked);
}

// ── Callouts (T-F14): GitHub/Obsidian `> [!NOTE]` admonitions ───────────────
export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution', 'info'];

/**
 * Parse the first line of a blockquote for a callout marker.
 * @param {string} line e.g. "[!WARNING] Be careful" or "[!note]"
 * @returns {{type:string, title:string}|null}
 */
export function parseCalloutHeader(line) {
  const m = /^\s*\[!(\w+)\]\s*(.*)$/.exec(line || '');
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (!CALLOUT_TYPES.includes(type)) return null;
  const title = (m[2] && m[2].trim()) || (type.charAt(0).toUpperCase() + type.slice(1));
  return { type, title };
}

let renderLimited = false;
/** True when the last parseMarkdown call emitted part of the note as literal text (audit M4). */
export function lastRenderLimited() { return renderLimited; }

export function parseMarkdown(md, { marked, DOMPurify, escapeHtml, fragment = false, sourceLines = false } = {}) {
  if (!marked || typeof marked.parse !== 'function') {
    return escapeHtml ? escapeHtml(md) : String(md);
  }
  const text = md || '';
  let raw;
  // audit M4: one render may not stall the window (see render-guard.js).
  beginRender(text.length);
  tagSourceLines = sourceLines;
  try {
    raw = marked.parse(text);
  } catch (error) {
    // Thousands of nested `>` overflow marked's recursion: show the text instead of failing.
    if (!(error instanceof RangeError)) throw error;
    markLimited();
    raw = `<pre>${esc(text)}</pre>`;
  } finally {
    tagSourceLines = false;
    renderLimited = endRender();
  }
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
    const out = sanitizeHtml(raw, DOMPurify, { fragment });
    return sourceLines && typeof out === 'object' ? attachSourceLines(out) : out;
  }
  return '';
}
