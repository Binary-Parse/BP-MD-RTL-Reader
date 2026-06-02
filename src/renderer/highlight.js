/**
 * highlight.js — code syntax highlighting (T-F9), applied to the rendered DOM.
 *
 * Re-highlights fenced code blocks (`<pre><code>`) with an injected highlight.js,
 * routing the highlighter's HTML through an injected `sanitize` (no raw untrusted
 * innerHTML) and forcing `dir="ltr"` on every code block so code never flips with
 * the per-line RTL pass (R1/R2). Operates on an injected root → jsdom-testable.
 */

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
    let value;
    try {
      value = (lang && typeof hljs.getLanguage === 'function' && hljs.getLanguage(lang))
        ? hljs.highlight(text, { language: lang }).value
        : (typeof hljs.highlightAuto === 'function' ? hljs.highlightAuto(text).value : null);
    } catch (_) {
      return; // a highlighter error must not break rendering
    }
    if (value == null) return;
    code.innerHTML = sanitize(value);
    code.classList.add('hljs');
  });
  return root;
}
