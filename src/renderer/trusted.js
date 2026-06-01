/**
 * trusted.js — the single hardened render/sanitize stage (T-AI2).
 * Pure: all heavy deps (DOMPurify, KaTeX, Mermaid) are injected so this is
 * unit-testable in Node. Centralizes XSS/DoS defenses for every content sink.
 */

// Link schemes safe to keep as href in rendered output.
const SAFE_HREF = /^(https?:|mailto:|tel:|#|bpmd:)/i;

/** Sanitize general HTML produced by the Markdown pipeline. */
export function sanitizeHtml(html, DOMPurify) {
  if (!DOMPurify || typeof DOMPurify.sanitize !== 'function') return '';
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['id', 'data-target', 'dir', 'lang'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  });
}

/** Sanitize Mermaid SVG output (EC-B3): SVG profile, no script/foreignObject. */
export function sanitizeSvg(svg, DOMPurify) {
  if (!DOMPurify || typeof DOMPurify.sanitize !== 'function') return '';
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
    FORBID_ATTR: ['onload', 'onerror'],
  });
}

/** Hardened KaTeX options (EC-B4): no \href trust, bounded macro expansion. */
export function katexOptions(overrides = {}) {
  return {
    trust: false,
    throwOnError: false,
    maxExpand: 1000,
    maxSize: 500,
    strict: 'ignore',
    ...overrides,
  };
}

/** Whether a link href is safe to keep (EC-B5/B6). */
export function isSafeHref(href) {
  return typeof href === 'string' && SAFE_HREF.test(href.trim());
}

/**
 * Full trusted render: Markdown → HTML → sanitize.
 * @param {string} md
 * @param {{marked, DOMPurify, escapeHtml?}} deps
 */
export function renderTrusted(md, { marked, DOMPurify, escapeHtml } = {}) {
  if (!marked || typeof marked.parse !== 'function') {
    return escapeHtml ? escapeHtml(md) : String(md ?? '');
  }
  const raw = marked.parse(md || '');
  return sanitizeHtml(raw, DOMPurify);
}
