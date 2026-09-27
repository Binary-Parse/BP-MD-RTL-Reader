/**
 * @vitest-environment jsdom
 *
 * mermaid.test.js — T-F16 Mermaid diagram DOM helper. jsdom-tested with an injected
 * fake mermaid + sanitize (the real mermaid/SVG-sanitize are exercised by the e2e).
 */
import { describe, test, expect, vi } from 'vitest';
import { renderMermaid } from '../../src/renderer/markdown/mermaid.js';

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

// audit UX-09: a hanging or failing render must not stall the note, and must not fail
// silently — the source block stays and a localized caption says why.
describe('renderMermaid failure states (audit UX-09)', () => {
  test('a parse failure keeps the block and inserts the visible caption after it', async () => {
    const boom = { render: async () => { throw new Error('parse error'); } };
    const root = frag('<pre><code class="language-mermaid">not a diagram</code></pre>');
    await renderMermaid(root, { mermaid: boom, errorText: 'Diagram failed' });
    const pre = root.querySelector('pre');
    expect(pre.getAttribute('data-mermaid-error')).toBe('1');
    const cap = root.querySelector('.mermaid-error');
    expect(cap).not.toBeNull();
    expect(cap.textContent).toBe('Diagram failed');
    expect(pre.nextElementSibling).toBe(cap); // directly after the fallback block
  });

  test('a hanging render times out after 8s, keeps the block, and captions it', async () => {
    vi.useFakeTimers();
    try {
      const hang = { render: () => new Promise(() => { /* never settles */ }) };
      const root = frag('<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>');
      const pending = renderMermaid(root, { mermaid: hang, errorText: 'Timed out' });
      await vi.advanceTimersByTimeAsync(8001);
      await pending;
      expect(root.querySelector('pre').getAttribute('data-mermaid-error')).toBe('1');
      expect(root.querySelector('.mermaid-error').textContent).toBe('Timed out');
      expect(root.querySelector('.mermaid')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test('the first diagram hanging does NOT stop the second from rendering', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const firstHangs = {
        render: (id, src) => {
          calls += 1;
          if (calls === 1) return new Promise(() => { /* hang */ });
          return Promise.resolve({ svg: `<svg data-id="${id}"><text>${src}</text></svg>` });
        },
      };
      const root = frag('<pre><code class="language-mermaid">first</code></pre><pre><code class="language-mermaid">second</code></pre>');
      const pending = renderMermaid(root, { mermaid: firstHangs, errorText: 'Timed out' });
      await vi.advanceTimersByTimeAsync(8001);
      await pending;
      // The hung first block fell back; the second rendered normally.
      expect(root.querySelectorAll('pre[data-mermaid-error]').length).toBe(1);
      expect(root.querySelectorAll('.mermaid').length).toBe(1);
      expect(root.querySelector('.mermaid').textContent).toContain('second');
    } finally {
      vi.useRealTimers();
    }
  });

  test('no errorText → no caption is inserted (unit harnesses keep the old shape)', async () => {
    const boom = { render: async () => { throw new Error('nope'); } };
    const root = frag('<pre><code class="language-mermaid">bad</code></pre>');
    await renderMermaid(root, { mermaid: boom });
    expect(root.querySelector('.mermaid-error')).toBeNull();
    expect(root.querySelector('pre[data-mermaid-error]')).not.toBeNull();
  });
});
