/**
 * markdown.js — Markdown parsing, wikilink extension, sanitization
 * Near-pure functions: accept marked/DOMPurify/escapeHtml as injected dependencies.
 */

import { sanitizeHtml } from './trusted.js';
import { footnoteExtension } from './footnotes.js';

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
  return `<a class="wikilink" data-target="${safe}">${token.alias}</a>`;
}

export function configureMarked(marked) {
  if (!marked || typeof marked.use !== 'function') return;
  marked.use({
    gfm: true,
    breaks: true,
    extensions: [{
      name: 'wikilink',
      level: 'inline',
      start(src) { return src.indexOf('[['); },
      tokenizer(src) {
        const m = /^\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), alias: m[2]?.trim() || m[1].trim() };
      },
      renderer(t) {
        const safe = t.target.replace(/['"]/g, '');
        return `<a class="wikilink" data-target="${safe}">${t.alias}</a>`;
      }
    }, {
      // Highlight ==text== → <mark> (Typora/Obsidian). Inner is inline-parsed so **bold** etc.
      // still work inside. Requires non-space right after == so "a == b" stays literal text.
      name: 'highlight', level: 'inline',
      start(src) { return src.indexOf('=='); },
      tokenizer(src) {
        const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
        if (m) return { type: 'highlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
    }, {
      // Subscript ~text~ (single tilde) → <sub>. The negative lookarounds keep GFM
      // strikethrough ~~text~~ working (handed off to the core tokenizer).
      name: 'subscript', level: 'inline',
      start(src) { const i = src.search(/(?<![~\\])~(?!~)/); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^(?<![~])~(?!~)([^~\s][^~\n]*?)~(?!~)/.exec(src);
        if (m) return { type: 'subscript', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<sub>${this.parser.parseInline(t.tokens)}</sub>`; },
    }, {
      // Superscript ^text^ → <sup> (no spaces inside, e.g. X^2^).
      name: 'superscript', level: 'inline',
      start(src) { return src.indexOf('^'); },
      tokenizer(src) {
        const m = /^\^([^\^\s]+?)\^/.exec(src);
        if (m) return { type: 'superscript', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<sup>${this.parser.parseInline(t.tokens)}</sup>`; },
    }]
  });
  // Footnotes (R11): marked core doesn't support GFM footnotes — add them as a
  // separate extension+hooks bundle ([^id] refs + [^id]: defs → end-of-doc list).
  marked.use(footnoteExtension());
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

export function parseMarkdown(md, { marked, DOMPurify, escapeHtml } = {}) {
  if (!marked || typeof marked.parse !== 'function') {
    return escapeHtml ? escapeHtml(md) : String(md);
  }
  const raw = marked.parse(md || '');
  if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
    // Route the viewer through the SINGLE hardened sanitize stage (AI2 follow-up to
    // B4): strips inline `style=`, <iframe>/<object>/<embed>, and on* handlers so the
    // sanitizer — not CSP alone — is the control (defense-in-depth). Still keeps the
    // outline/wikilink hooks (id, data-target) and the bidi attrs (dir, lang); KaTeX
    // (post-processed via sanitizeMath) and code highlighting already use this stage.
    return sanitizeHtml(raw, DOMPurify);
  }
  return raw;
}
