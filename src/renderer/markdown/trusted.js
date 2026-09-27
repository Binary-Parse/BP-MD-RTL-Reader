/**
 * trusted.js — the single hardened render/sanitize stage (T-AI2).
 * Pure: all heavy deps (DOMPurify, KaTeX, Mermaid) are injected so this is
 * unit-testable in Node. Centralizes XSS/DoS defenses for every content sink.
 */

// Link schemes safe to keep as href in rendered output.
const SAFE_HREF = /^(https?:|mailto:|tel:|#|bpmd:)/i;
/** Relative URLs (no scheme) plus SAFE_HREF; blocks javascript:/data-html:/protocol-relative.
 * The protocol-relative lookahead rejects every slash-family opening (`//`, `/\`, `\/`, `\\`):
 * browsers normalize `\` to `/` in special URLs, so `\\evil.com` IS `//evil.com`. */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel|bpmd):|#|data:image\/|(?![a-z][a-z0-9+.-]*:)(?!\/[\\/])(?!\\)).*$/i;
/** Same protocol-relative block as a plain string guard (regexp + guard, belt and braces). */
const PROTOCOL_RELATIVE_START = /^[\\/][\\/]/;

// data: URIs are embedded-image payloads, not navigation targets: they stay on the
// media elements the URI allow-list exists for, and are stripped from anything that
// can navigate (`<a href="data:...">`, or any other non-media src).
const DATA_MEDIA_ELEMENTS = new Set(['img', 'source', 'audio', 'video']);

function stripNonMediaDataUris(DOMPurify) {
  if (!DOMPurify || typeof DOMPurify.addHook !== 'function' || typeof DOMPurify.removeHook !== 'function') return null;
  const hook = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (DATA_MEDIA_ELEMENTS.has(String(node.nodeName || '').toLowerCase())) return;
    for (const attr of ['href', 'src']) {
      const value = node.getAttribute ? node.getAttribute(attr) : null;
      if (typeof value === 'string' && value.trim().toLowerCase().startsWith('data:')) node.removeAttribute(attr);
    }
  };
  DOMPurify.addHook('afterSanitizeAttributes', hook);
  return hook;
}

/** Sanitize general HTML produced by the Markdown pipeline. */
export function sanitizeHtml(html, DOMPurify) {
  if (!DOMPurify || typeof DOMPurify.sanitize !== 'function') return '';
  // The data:-on-navigators rule needs the post-sanitize attribute hook; it is
  // registered around this one call and removed again so the injected instance
  // is never left with a lingering hook for the other sanitize stages.
  const hook = stripNonMediaDataUris(DOMPurify);
  try {
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ['id', 'data-target', 'dir', 'lang'],
      // Keep the inline formatting tags the toolbar/extensions emit: <mark> (==highlight==),
      // <u> (underline), <sub>/<sup> (~sub~ / ^sup^). All are in DOMPurify's default allow-list
      // except where a profile narrows it; ADD_TAGS makes the intent explicit + future-proof.
      ADD_TAGS: ['mark', 'u', 'sub', 'sup'],
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
      // `style` here forbids the inline style="" ATTRIBUTE (FORBID_TAGS above only
      // drops the <style> ELEMENT) — kills CSS-exfil via inline styles. Math keeps its
      // positioning styles through the separate sanitizeMath stage; marked emits table
      // alignment as the `align` attribute, not inline style, so this is loss-free.
      FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
      ALLOWED_URI_REGEXP,
    });
  } finally {
    if (hook) DOMPurify.removeHook('afterSanitizeAttributes', hook);
  }
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

/**
 * Sanitize KaTeX output (T-F9). KaTeX emits HTML spans (with positioning inline
 * styles) plus MathML (and occasionally SVG), so we allow those profiles + the
 * `style` attribute it needs, while dropping any active/script content.
 */
export function sanitizeMath(html, DOMPurify) {
  if (!DOMPurify || typeof DOMPurify.sanitize !== 'function') return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    // Keep KaTeX's accessible MathML (semantics + the x-tex annotation), but NOT
    // <annotation-xml> (a MathML→HTML escape hatch / known XSS vector).
    ADD_TAGS: ['semantics', 'annotation'],
    ADD_ATTR: ['style', 'aria-hidden', 'encoding'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'foreignObject', 'annotation-xml'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    // A PLAIN STRING assigned to an innerHTML sink is re-run through the app-wide
    // 'default' Trusted Types policy (trusted-types-policy.js), whose narrower config
    // strips <semantics>/<annotation> and silently undoes the allow-list above. A
    // TrustedHTML value is not a string, so it reaches the DOM sanitized exactly as
    // configured here — without widening the default policy for every other sink.
    RETURN_TRUSTED_TYPE: true,
  });
}

/** Hardened KaTeX options (EC-B4): no \href trust, bounded macro expansion. */
export function katexOptions(overrides = {}) {
  const rest = (overrides && typeof overrides === 'object') ? { ...overrides } : {};
  delete rest.trust;
  return {
    throwOnError: false,
    maxExpand: 1000,
    maxSize: 500,
    strict: 'ignore',
    ...rest,
    trust: false,
  };
}

/** Whether a link href is safe to keep (EC-B5/B6). */
export function isSafeHref(href) {
  return typeof href === 'string' && SAFE_HREF.test(href.trim());
}

export function isAllowedHref(href) {
  if (typeof href !== 'string') return false;
  const value = href.trim();
  return ALLOWED_URI_REGEXP.test(value) && !PROTOCOL_RELATIVE_START.test(value);
}

/** Minimal HTML escape for the no-marked fallback — it must never be a raw-HTML sink. */
const MINIMAL_ESCAPE = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/**
 * Full trusted render: Markdown → HTML → sanitize.
 * @param {string} md
 * @param {{marked, DOMPurify, escapeHtml?}} deps
 */
export function renderTrusted(md, { marked, DOMPurify, escapeHtml } = {}) {
  if (!marked || typeof marked.parse !== 'function') {
    return (typeof escapeHtml === 'function') ? escapeHtml(md ?? '') : MINIMAL_ESCAPE(md ?? '');
  }
  const raw = marked.parse(md || '');
  return sanitizeHtml(raw, DOMPurify);
}
