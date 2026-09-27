/**
 * highlight.js — code syntax highlighting (T-F9), applied to the rendered DOM.
 *
 * Re-highlights fenced code blocks (`<pre><code>`) with an injected highlight.js,
 * routing the highlighter's HTML through an injected `sanitize` (no raw untrusted
 * innerHTML) and forcing `dir="ltr"` on every code block so code never flips with
 * the per-line RTL pass (R1/R2). Operates on an injected root → jsdom-testable.
 */

import { MAX_CODE_BYTES, utf8ByteLength } from '../limits.js';

// Auto-detection used to run hljs.highlightAuto over all 192 registered languages —
// 15–170ms PER BLOCK, re-paid on every render (audit PERF-02). Restrict it to a common
// subset and skip auto-detection entirely for large blocks (they render as plain text).
const AUTO_SUBSET = [
  'javascript', 'typescript', 'python', 'bash', 'shell', 'json', 'xml', 'css',
  'sql', 'yaml', 'markdown', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby',
];
const AUTO_DETECT_MAX_BYTES = 4096;

// Highlight cache (audit PERF-01): the highlighted HTML for a given (language, source) is
// deterministic, and the same blocks are re-highlighted on every render tick. The RAW
// highlighted value is cached; sanitize() still runs on every insertion. Cleared wholesale
// at the cap (simple, no LRU).
const CACHE_MAX = 500;
const hlCache = new Map();
export function clearHighlightCache() { hlCache.clear(); }

export function highlightCode(root, { hljs, sanitize = (s) => s } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function' || !hljs || typeof hljs.highlight !== 'function') return root;
  root.querySelectorAll('pre > code').forEach((code) => {
    if (code.classList.contains('language-mermaid')) return; // diagrams are rendered, not highlighted (T-F16)
    const pre = code.parentElement;
    if (pre) pre.setAttribute('dir', 'ltr'); // code is always LTR (compose with R1/R2)
    if (code.classList.contains('hljs')) return; // already highlighted (idempotent)

    const m = /\blanguage-([\w-]+)/.exec(code.className || '');
    const lang = m && m[1];
    const text = code.textContent || '';
    if (utf8ByteLength(text) > MAX_CODE_BYTES) {
      code.setAttribute('data-render-skipped', 'oversize');
      return;
    }
    const key = (lang || '?') + '\u0000' + text;
    let value = hlCache.get(key);
    if (value === undefined) {
      try {
        value = (lang && typeof hljs.getLanguage === 'function' && hljs.getLanguage(lang))
          ? hljs.highlight(text, { language: lang }).value
          : (typeof hljs.highlightAuto === 'function' && utf8ByteLength(text) <= AUTO_DETECT_MAX_BYTES
            ? hljs.highlightAuto(text, AUTO_SUBSET).value
            : null);
      } catch (_) {
        return; // a highlighter error must not break rendering
      }
      if (hlCache.size >= CACHE_MAX) hlCache.clear();
      hlCache.set(key, value);
    }
    if (value == null) return;
    code.innerHTML = sanitize(value);
    code.classList.add('hljs');
  });
  return root;
}
