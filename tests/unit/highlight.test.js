/**
 * @vitest-environment jsdom
 *
 * highlight.test.js — T-F9 code syntax highlighting DOM helper. jsdom-tested with
 * an injected fake hljs + sanitize (like trusted.test.js / callouts.test.js).
 */
import { describe, test, expect } from 'vitest';
import { highlightCode } from '../../src/renderer/highlight.js';

const fakeHljs = {
  getLanguage: (l) => (['js', 'python'].includes(l) ? {} : undefined),
  highlight: (text, { language }) => ({ value: `<span class="hljs-keyword">${language}</span>${text}` }),
  highlightAuto: (text) => ({ value: `<span class="hljs-string">auto</span>${text}` }),
};
function frag(html) { const d = document.createElement('div'); d.innerHTML = html; return d; }

describe('highlightCode (T-F9)', () => {
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
});
