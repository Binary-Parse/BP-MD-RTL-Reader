/**
 * @vitest-environment jsdom
 *
 * highlight.test.js — T-F9 code syntax highlighting DOM helper. jsdom-tested with
 * an injected fake hljs + sanitize (like trusted.test.js / callouts.test.js).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { highlightCode, clearHighlightCache } from '../../src/renderer/markdown/highlight.js';

const fakeHljs = {
  getLanguage: (l) => (['js', 'python'].includes(l) ? {} : undefined),
  highlight: (text, { language }) => ({ value: `<span class="hljs-keyword">${language}</span>${text}` }),
  highlightAuto: (text) => ({ value: `<span class="hljs-string">auto</span>${text}` }),
};
function frag(html) { const d = document.createElement('div'); d.innerHTML = html; return d; }

describe('highlightCode (T-F9)', () => {
  // The highlight cache (audit PERF-01) is process-wide; clear it so each case starts from
  // a cold cache and observes its own stub.
  beforeEach(() => clearHighlightCache());

  test('highlights a fenced code block by language; adds .hljs', () => {
    const root = frag('<pre><code class="language-js">const x = 1;</code></pre>');
    highlightCode(root, { hljs: fakeHljs });
    const code = root.querySelector('pre code');
    expect(code.classList.contains('hljs')).toBe(true);
    expect(code.innerHTML).toContain('hljs-keyword');
    expect(code.innerHTML).toContain('js'); // language passed through
  });

  test('auto-highlights when the language is unknown/absent', () => {
    const root = frag('<pre><code>some code</code></pre>');
    highlightCode(root, { hljs: fakeHljs });
    expect(root.querySelector('code').innerHTML).toContain('hljs-string');
  });

  test('code blocks are forced dir="ltr" (must not flip with R1/R2)', () => {
    const root = frag('<pre dir="rtl"><code class="language-js">x</code></pre>');
    highlightCode(root, { hljs: fakeHljs });
    expect(root.querySelector('pre').getAttribute('dir')).toBe('ltr');
  });

  test('output goes through the injected sanitize (no raw untrusted innerHTML)', () => {
    const root = frag('<pre><code class="language-js">danger</code></pre>');
    const seen = [];
    highlightCode(root, { hljs: fakeHljs, sanitize: (h) => { seen.push(h); return h.replace('hljs-keyword', 'X'); } });
    expect(seen.length).toBe(1);
    expect(root.querySelector('code').innerHTML).toContain('X'); // sanitize transform applied
  });

  test('inline <code> (not inside <pre>) is NOT highlighted', () => {
    const root = frag('<p>see <code>inline</code></p>');
    highlightCode(root, { hljs: fakeHljs });
    expect(root.querySelector('code').classList.contains('hljs')).toBe(false);
  });

  test('idempotent: running twice does not re-highlight', () => {
    const root = frag('<pre><code class="language-js">x</code></pre>');
    highlightCode(root, { hljs: fakeHljs });
    const once = root.querySelector('code').innerHTML;
    highlightCode(root, { hljs: fakeHljs });
    expect(root.querySelector('code').innerHTML).toBe(once);
  });

  test('does not highlight ```mermaid blocks (left for the diagram renderer, T-F16)', () => {
    const root = frag('<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>');
    highlightCode(root, { hljs: fakeHljs });
    expect(root.querySelector('code').classList.contains('hljs')).toBe(false);
  });

  test('null root / missing hljs → safe no-op', () => {
    expect(() => highlightCode(null, { hljs: fakeHljs })).not.toThrow();
    const root = frag('<pre><code>x</code></pre>');
    highlightCode(root, {}); // no hljs
    expect(root.querySelector('code').classList.contains('hljs')).toBe(false);
  });

  test('a thrown highlighter error leaves the block unchanged', () => {
    const root = frag('<pre><code class="language-js">x</code></pre>');
    const boom = { getLanguage: () => ({}), highlight: () => { throw new Error('boom'); } };
    expect(() => highlightCode(root, { hljs: boom })).not.toThrow();
    expect(root.querySelector('code').classList.contains('hljs')).toBe(false);
  });

  test('oversized code blocks remain literal and never reach the synchronous highlighter', () => {
    const root = frag(`<pre><code class="language-js">${'x'.repeat(300000)}</code></pre>`);
    const hljs = { getLanguage: vi.fn(() => ({})), highlight: vi.fn(() => ({ value: 'bad' })) };
    highlightCode(root, { hljs });
    expect(hljs.highlight).not.toHaveBeenCalled();
    expect(root.querySelector('code').classList.contains('hljs')).toBe(false);
    expect(root.querySelector('code').getAttribute('data-render-skipped')).toBe('oversize');
  });
});

// audit PERF-02: auto-detection is bounded to a common subset and skipped for large blocks,
// instead of running hljs.highlightAuto across all ~192 registered languages per block.
describe('bounded auto-detection (audit PERF-02)', () => {
  // The hljs result cache (audit PERF-01) is process-wide; clear it so each case below
  // observes its OWN stub's calls.
  beforeEach(() => clearHighlightCache());

  test('an unlabeled small snippet auto-detects through a <= 20-language subset', () => {
    const subsetCalls = [];
    const hljs = {
      highlight: () => ({ value: 'named' }),
      highlightAuto: (code, subset) => {
        subsetCalls.push({ code, subset });
        return { value: '<span class="hljs-string">auto</span>' };
      },
    };
    const root = frag('<pre><code>some code</code></pre>');
    highlightCode(root, { hljs });
    expect(subsetCalls).toHaveLength(1);
    expect(Array.isArray(subsetCalls[0].subset)).toBe(true);
    expect(subsetCalls[0].subset.length).toBeLessThanOrEqual(20);
    expect(root.querySelector('code').classList.contains('hljs')).toBe(true);
    expect(root.querySelector('code').innerHTML).toContain('hljs-string');
  });

  test('a block larger than 4096 bytes skips auto-detection entirely and stays plain', () => {
    const hljs = { highlight: () => ({ value: 'named' }), highlightAuto: vi.fn(() => ({ value: 'bad' })) };
    const big = 'x'.repeat(4097);
    const root = frag(`<pre><code>${big}</code></pre>`);
    highlightCode(root, { hljs });
    expect(hljs.highlightAuto).not.toHaveBeenCalled();
    const code = root.querySelector('code');
    expect(code.classList.contains('hljs')).toBe(false);
    expect(code.innerHTML).toBe(big); // untouched plain text
  });

  test('a 4096-byte block is still auto-detected (the guard is inclusive)', () => {
    const hljs = { highlight: () => ({ value: 'named' }), highlightAuto: vi.fn(() => ({ value: 'ok' })) };
    const root = frag(`<pre><code>${'x'.repeat(4096)}</code></pre>`);
    highlightCode(root, { hljs });
    expect(hljs.highlightAuto).toHaveBeenCalledTimes(1);
  });

  test('a named language goes through hljs.highlight, never auto-detection', () => {
    const hljs = {
      getLanguage: (l) => (l === 'python' ? {} : undefined),
      highlight: vi.fn(() => ({ value: '<span class="hljs-keyword">named</span>' })),
      highlightAuto: vi.fn(() => ({ value: 'auto' })),
    };
    const root = frag('<pre><code class="language-python">print(1)</code></pre>');
    highlightCode(root, { hljs });
    expect(hljs.highlight).toHaveBeenCalledTimes(1);
    expect(hljs.highlightAuto).not.toHaveBeenCalled();
    expect(root.querySelector('code').innerHTML).toContain('named');
  });
});

// audit PERF-01: identical blocks are not re-highlighted on every render tick.
describe('highlight cache (audit PERF-01)', () => {
  beforeEach(() => clearHighlightCache());

  test('the same (language, source) block is highlighted once across two renders', () => {
    const hljs = {
      getLanguage: () => ({}),
      highlight: vi.fn(() => ({ value: '<span class="k">js</span>' })),
    };
    const first = frag('<pre><code class="language-js">const a = 1;</code></pre>');
    highlightCode(first, { hljs });
    const second = frag('<pre><code class="language-js">const a = 1;</code></pre>');
    highlightCode(second, { hljs });
    expect(hljs.highlight).toHaveBeenCalledTimes(1);
    expect(second.querySelector('code').innerHTML).toBe(first.querySelector('code').innerHTML);
    expect(second.querySelector('code').classList.contains('hljs')).toBe(true);
  });

  test('sanitize still runs on every insertion (the cached value is pre-sanitize)', () => {
    const hljs = { getLanguage: () => ({}), highlight: vi.fn(() => ({ value: 'raw-keyword' })) };
    const seen = [];
    const sanitize = (h) => { seen.push(h); return h.replace('raw-keyword', 'SAFE'); };
    highlightCode(frag('<pre><code class="language-js">q</code></pre>'), { hljs, sanitize });
    const second = frag('<pre><code class="language-js">q</code></pre>');
    highlightCode(second, { hljs, sanitize });
    expect(hljs.highlight).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['raw-keyword', 'raw-keyword']);
    expect(second.querySelector('code').innerHTML).toContain('SAFE');
  });

  test('different source under the same language is a cache miss', () => {
    const hljs = { getLanguage: () => ({}), highlight: vi.fn(() => ({ value: 'v' })) };
    highlightCode(frag('<pre><code class="language-js">one</code></pre>'), { hljs });
    highlightCode(frag('<pre><code class="language-js">two</code></pre>'), { hljs });
    expect(hljs.highlight).toHaveBeenCalledTimes(2);
  });

  test('clearHighlightCache() forces a re-highlight', () => {
    const hljs = { getLanguage: () => ({}), highlight: vi.fn(() => ({ value: 'v' })) };
    highlightCode(frag('<pre><code class="language-js">z</code></pre>'), { hljs });
    clearHighlightCache();
    highlightCode(frag('<pre><code class="language-js">z</code></pre>'), { hljs });
    expect(hljs.highlight).toHaveBeenCalledTimes(2);
  });
});
