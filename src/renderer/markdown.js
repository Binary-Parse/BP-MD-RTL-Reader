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
