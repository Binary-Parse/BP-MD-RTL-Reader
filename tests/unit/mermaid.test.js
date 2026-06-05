/**
 * @vitest-environment jsdom
 *
 * mermaid.test.js — T-F16 Mermaid diagram DOM helper. jsdom-tested with an injected
 * fake mermaid + sanitize (the real mermaid/SVG-sanitize are exercised by the e2e).
 */
import { describe, test, expect } from 'vitest';
import { renderMermaid } from '../../src/renderer/mermaid.js';

const fakeMermaid = { render: async (id, src) => ({ svg: `<svg data-id="${id}"><text>${src}</text></svg>` }) };
function frag(html) { const d = document.createElement('div'); d.innerHTML = html; return d; }

describe('renderMermaid (T-F16)', () => {
  test('replaces a ```mermaid block with a dir="ltr" .mermaid diagram (sanitized SVG)', async () => {
    const root = frag('<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>');
    await renderMermaid(root, { mermaid: fakeMermaid });
    expect(root.querySelector('pre')).toBeNull();
    const div = root.querySelector('.mermaid');
    expect(div.getAttribute('dir')).toBe('ltr');
    expect(div.querySelector('svg')).not.toBeNull();
    expect(div.textContent).toContain('graph TD');
  });

  test('SVG goes through the injected sanitize (no raw untrusted innerHTML)', async () => {
    const root = frag('<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>');
    const seen = [];
    await renderMermaid(root, { mermaid: fakeMermaid, sanitize: (s) => { seen.push(s); return s.replace('<text>', '<text data-clean="1">'); } });
    expect(seen.length).toBe(1);
    expect(root.querySelector('.mermaid text').getAttribute('data-clean')).toBe('1');
  });

  test('a render error keeps the code block as a fallback (per-block)', async () => {
    const boom = { render: async () => { throw new Error('parse error'); } };
    const root = frag('<pre><code class="language-mermaid">not a diagram</code></pre>');
    await renderMermaid(root, { mermaid: boom });
    expect(root.querySelector('.mermaid')).toBeNull();
    const pre = root.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre.getAttribute('data-mermaid-error')).toBe('1');
  });

  test('non-mermaid code blocks are untouched', async () => {
    const root = frag('<pre><code class="language-js">const x = 1;</code></pre>');
    await renderMermaid(root, { mermaid: fakeMermaid });
    expect(root.querySelector('pre')).not.toBeNull();
    expect(root.querySelector('.mermaid')).toBeNull();
  });

  test('idempotent: each block is rendered at most once across passes (proves the done-guard)', async () => {
    const spy = { n: 0, render: async (id, src) => { spy.n++; return { svg: `<svg>${src}</svg>` }; } };
    const root = frag('<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>');
    await renderMermaid(root, { mermaid: spy });
    await renderMermaid(root, { mermaid: spy });
    expect(spy.n).toBe(1); // NOT re-rendered — gated by data-mermaidDone, not just <pre> removal
    expect(root.querySelectorAll('.mermaid').length).toBe(1);
  });

  test('a block that errored is NOT retried on a later pass (the <pre> survives but is guarded)', async () => {
    const spy = { n: 0, render: async () => { spy.n++; throw new Error('bad'); } };
    const root = frag('<pre><code class="language-mermaid">bad diagram</code></pre>');
    await renderMermaid(root, { mermaid: spy });
    await renderMermaid(root, { mermaid: spy });
    expect(spy.n).toBe(1); // the done-guard prevents a second attempt on the still-present <pre>
    expect(root.querySelector('pre[data-mermaid-error]')).not.toBeNull();
  });

  test('null root / missing mermaid → safe no-op', async () => {
    await expect(renderMermaid(null, { mermaid: fakeMermaid })).resolves.toBeNull();
    const root = frag('<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>');
    await renderMermaid(root, {});
    expect(root.querySelector('.mermaid')).toBeNull();
  });
});
