/**
 * @vitest-environment jsdom
 *
 * math.test.js — T-F9 KaTeX math. The marked extension captures RAW TeX before
 * Markdown can corrupt it; restoreMath swaps placeholders for sanitized KaTeX.
 * Unit-tested with injected fakes; an integration test uses REAL marked to prove
 * LaTeX survives uncorrupted.
 */
import { describe, test, expect } from 'vitest';
import { Marked } from 'marked';
import { mathExtension, mathPlaceholder, restoreMath } from '../../src/renderer/math.js';
import { configureMarked } from '../../src/renderer/markdown.js';

// A katex that records the TeX it receives, so we can assert it was uncorrupted.
function recordingKatex() {
  const calls = [];
  return {
    calls,
    renderToString: (tex, opts) => {
      calls.push({ tex, display: !!(opts && opts.displayMode) });
      return `<span class="katex"><math><annotation encoding="application/x-tex">${tex}</annotation></math></span>`;
    },
  };
}
const idDOMPurify = { sanitize: (h) => h };
function frag(html) { const d = document.createElement('div'); d.innerHTML = html; return d; }

describe('mathExtension tokenizer', () => {
  const ext = mathExtension().extensions[0];
  test('matches block $$...$$ (display) and inline $...$', () => {
    expect(ext.tokenizer('$$\\frac12$$ rest')).toMatchObject({ tex: '\\frac12', display: true });
    expect(ext.tokenizer('$E=mc^2$ rest')).toMatchObject({ tex: 'E=mc^2', display: false });
  });
  test('does not match currency-like "$5 and $10"', () => {
    expect(ext.tokenizer('$5 and $10 total')).toBeUndefined();
  });
  test('start() points marked at the first $', () => {
    expect(ext.start('abc $x$')).toBe(4);
    expect(ext.start('no math here')).toBeUndefined();
  });
  test('renderer emits a placeholder carrying the raw TeX', () => {
    const ph = ext.renderer({ tex: 'a \\, b', display: false });
    expect(ph.charCodeAt(0)).toBe(0xE000);
    expect(ph.charCodeAt(ph.length - 1)).toBe(0xE001);
  });
  test('oversized expressions remain literal before placeholder amplification', () => {
    const tex = 'x'.repeat(40000);
    const rendered = ext.renderer({ tex, display: false });
    expect(rendered).toBe(`$${tex}$`);
    expect(rendered.charCodeAt(0)).not.toBe(0xE000);
  });
});

describe('restoreMath (jsdom)', () => {
  const opts = () => ({ katex: recordingKatex(), DOMPurify: idDOMPurify });
  test('inline placeholder → dir="ltr" math span; block → math-block display', () => {
    const root = frag(`<p>x ${mathPlaceholder('E=mc^2', false)} y</p><p>${mathPlaceholder('\\int', true)}</p>`);
    restoreMath(root, opts());
    const inline = root.querySelector('.math-inline');
    expect(inline.getAttribute('dir')).toBe('ltr');
    expect(inline.querySelector('.katex')).not.toBeNull();
    expect(root.querySelector('.math-block')).not.toBeNull();
  });

  test('passes the RAW TeX (backslashes, *, _) to KaTeX uncorrupted', () => {
    const k = recordingKatex();
    const root = frag(`<p>${mathPlaceholder('a \\, b \\\\ c *x* _y_', false)}</p>`);
    restoreMath(root, { katex: k, DOMPurify: idDOMPurify });
    expect(k.calls[0].tex).toBe('a \\, b \\\\ c *x* _y_');
  });

  test('does not touch placeholders inside code/pre', () => {
    const root = frag(`<pre><code>${mathPlaceholder('x', false)}</code></pre><p>${mathPlaceholder('y', false)}</p>`);
    restoreMath(root, opts());
    expect(root.querySelector('pre .math-inline')).toBeNull();
    expect(root.querySelector('p .math-inline')).not.toBeNull();
  });

  test('a render failure keeps the literal $tex$', () => {
    const boom = { renderToString: () => { throw new Error('bad'); } };
    const root = frag(`<p>${mathPlaceholder('\\bad', false)}</p>`);
    restoreMath(root, { katex: boom, DOMPurify: idDOMPurify });
    expect(root.querySelector('.math-inline')).toBeNull();
    expect(root.querySelector('p').textContent).toBe('$\\bad$');
  });

  test('null root / missing katex → safe no-op', () => {
    expect(() => restoreMath(null, opts())).not.toThrow();
    const root = frag(`<p>${mathPlaceholder('x', false)}</p>`);
    restoreMath(root, {});
    expect(root.querySelector('.math-inline')).toBeNull();
  });
});

describe('integration with real marked — LaTeX is NOT corrupted (the F9 fix)', () => {
  function md() {
    const m = new Marked();
    configureMarked(m);
    m.use(mathExtension());
    return m;
  }
  test('markdown-active chars and escapes survive ($a*b*c$, $$x \\, y \\\\ z$$)', () => {
    const html = md().parse('inline $a*b*c$ and\n\n$$x \\, y \\\\ z$$\n');
    const k = recordingKatex();
    restoreMath(frag(html), { katex: k, DOMPurify: idDOMPurify });
    const texts = k.calls.map((c) => c.tex);
    expect(texts).toContain('a*b*c');        // emphasis chars NOT turned into <em>
    expect(texts).toContain('x \\, y \\\\ z'); // \, thin-space + \\ line-break preserved
  });
  test('a $-sign inside a fenced code block is NOT treated as math', () => {
    const html = md().parse('```bash\necho $HOME and $PATH\n```\n');
    const k = recordingKatex();
    restoreMath(frag(html), { katex: k, DOMPurify: idDOMPurify });
    expect(k.calls).toHaveLength(0);
  });
});
