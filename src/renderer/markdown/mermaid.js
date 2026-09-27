/**
 * mermaid.js — Mermaid diagram rendering (T-F16), applied to the rendered DOM.
 *
 * Replaces each ```mermaid fenced block (`<pre><code class="language-mermaid">`) with
 * its rendered SVG, routed through an injected `sanitize` (the SVG-profile sanitizer,
 * which strips script/foreignObject) and wrapped in a `dir="ltr"` `.mermaid` container
 * so diagrams never flip with the per-line RTL pass (R1/R2). Rendering is async and
 * per-block with a TIMEOUT (audit UX-09: one hanging render used to stall every later
 * diagram in the note forever); a parse failure or timeout leaves the code block as a
 * fallback plus a visible caption (`errorText`) instead of silent raw source.
 * mermaid is injected → jsdom-testable; the real engine is lazy-loaded + vendored.
 */

const RENDER_TIMEOUT_MS = 8000;

export async function renderMermaid(root, { mermaid, sanitize = (s) => s, idPrefix = 'mmd', errorText = '' } = {}) {
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
      let timer;
      const rendered = await Promise.race([
        mermaid.render(`${idPrefix}-${i}`, src),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('mermaid-timeout')), RENDER_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
      ({ svg } = rendered);
    } catch (_) {
      pre.setAttribute('data-mermaid-error', '1'); // keep the code block as a fallback
      if (errorText) {
        const cap = root.ownerDocument.createElement('div');
        cap.className = 'mermaid-error';
        cap.textContent = errorText;
        pre.after(cap);
      }
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
