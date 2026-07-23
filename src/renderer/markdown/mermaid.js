/**
 * mermaid.js — Mermaid diagram rendering (T-F16), applied to the rendered DOM.
 *
 * Replaces each ```mermaid fenced block (`<pre><code class="language-mermaid">`) with
 * its rendered SVG, routed through an injected `sanitize` (the SVG-profile sanitizer,
 * which strips script/foreignObject) and wrapped in a `dir="ltr"` `.mermaid` container
 * so diagrams never flip with the per-line RTL pass (R1/R2). Rendering is async and
 * per-block: a diagram that fails to parse leaves its code block intact as a fallback.
 * mermaid is injected → jsdom-testable; the real engine is lazy-loaded + vendored.
 */

export async function renderMermaid(root, { mermaid, sanitize = (s) => s, idPrefix = 'mmd' } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function' || !mermaid || typeof mermaid.render !== 'function') return root;
  const blocks = [...root.querySelectorAll('pre > code.language-mermaid')];
  for (let i = 0; i < blocks.length; i++) {
    const code = blocks[i];
    const pre = code.parentElement;
    if (!pre || pre.dataset.mermaidDone) continue;
    pre.dataset.mermaidDone = '1'; // idempotent: never re-render the same block
    const src = code.textContent || '';
    let svg;
    try {
      ({ svg } = await mermaid.render(`${idPrefix}-${i}`, src));
    } catch (_) {
      pre.setAttribute('data-mermaid-error', '1'); // keep the code block as a fallback
      continue;
    }
    const div = root.ownerDocument.createElement('div');
    div.className = 'mermaid';
    div.setAttribute('dir', 'ltr'); // diagrams are LTR (compose with R1/R2)
    div.innerHTML = sanitize(svg);
    pre.replaceWith(div);
  }
  return root;
}
