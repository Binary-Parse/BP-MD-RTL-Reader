/**
 * markdown.js — Markdown parsing, wikilink extension, sanitization
 * Near-pure functions: accept marked/DOMPurify/escapeHtml as injected dependencies.
 */

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
    breaks: false,
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
    }]
  });
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
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['id', 'data-target'] });
  }
  return raw;
}
