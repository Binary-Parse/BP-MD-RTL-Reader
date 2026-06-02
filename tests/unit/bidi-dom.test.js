/**
 * @vitest-environment jsdom
 *
 * bidi-dom.test.js — T-R1/R2 DOM application layer. Drives the real DOM helpers
 * (built on the pure src/renderer/bidi.js core) against a jsdom document so the
 * per-block direction + inline isolation logic is unit-tested without Playwright.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { applyBlockDirection, isolateInlineRuns, applyBidi } from '../../src/renderer/bidi-dom.js';
import { escapeHtml } from '../../src/renderer/i18n.js';

function frag(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('applyBlockDirection (T-R1)', () => {
  test('Arabic block → dir/data-dir rtl + lang="ar" (EC-C6)', () => {
    const root = frag('<p>مرحبا بالعالم</p>');
    applyBlockDirection(root);
    const p = root.querySelector('p');
    expect(p.getAttribute('dir')).toBe('rtl');
    expect(p.getAttribute('data-dir')).toBe('rtl');
    expect(p.getAttribute('lang')).toBe('ar');
  });

  test('English block → dir ltr, no lang', () => {
    const root = frag('<p>Hello world</p>');
    applyBlockDirection(root);
    const p = root.querySelector('p');
    expect(p.getAttribute('dir')).toBe('ltr');
    expect(p.hasAttribute('lang')).toBe(false);
  });

  test('first-strong wins over majority (English-first mixed → ltr)', () => {
    const root = frag('<p>Hello مرحبا مرحبا مرحبا</p>');
    applyBlockDirection(root);
    expect(root.querySelector('p').getAttribute('dir')).toBe('ltr');
  });

  test('English-first block with one Arabic word does NOT get lang=ar (EC-C6)', () => {
    const root = frag('<p>This paragraph mentions مرحبا once</p>');
    applyBlockDirection(root);
    const p = root.querySelector('p');
    expect(p.getAttribute('dir')).toBe('ltr');
    expect(p.hasAttribute('lang')).toBe(false); // lang only on RTL-dominant blocks
  });

  test('neutral-only block inherits baseDir', () => {
    const root = frag('<p>123 — !!</p>');
    applyBlockDirection(root, 'rtl');
    expect(root.querySelector('p').getAttribute('dir')).toBe('rtl');
  });

  test('applies to headings, list items, blockquotes, table cells', () => {
    const root = frag(`
      <h2>عنوان</h2>
      <ul><li>عنصر عربي</li><li>english item</li></ul>
      <blockquote>اقتباس</blockquote>
      <table><tr><th>اسم</th><td>Value</td></tr></table>
    `);
    applyBlockDirection(root);
    expect(root.querySelector('h2').getAttribute('dir')).toBe('rtl');
    const lis = root.querySelectorAll('li');
    expect(lis[0].getAttribute('dir')).toBe('rtl');
    expect(lis[1].getAttribute('dir')).toBe('ltr');
    expect(root.querySelector('blockquote').getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('th').getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('td').getAttribute('dir')).toBe('ltr');
  });

  test('null / non-element root is a safe no-op', () => {
    expect(() => applyBlockDirection(null)).not.toThrow();
    expect(applyBlockDirection(null)).toBeNull();
  });
});

describe('isolateInlineRuns (T-R2)', () => {
  test('English inline code inside an RTL block is wrapped in <bdi>', () => {
    const root = frag('<p>شغّل الأمر <code>main.js</code> الآن</p>');
    applyBidi(root, { escape: escapeHtml });
    const code = root.querySelector('code');
    expect(code.parentNode.nodeName).toBe('BDI');
  });

  test('a number inside an RTL block is wrapped in <bdi>', () => {
    const root = frag('<p>لدينا 42 صفحة</p>');
    applyBidi(root, { escape: escapeHtml });
    const bdis = [...root.querySelectorAll('p[dir="rtl"] bdi')].map(b => b.textContent);
    expect(bdis).toContain('42');
  });

  test('a #tag inside an RTL block is wrapped in <bdi>', () => {
    const root = frag('<p>هذا #ملاحظة مهم</p>');
    applyBidi(root, { escape: escapeHtml });
    const tags = [...root.querySelectorAll('bdi')].map(b => b.textContent);
    expect(tags).toContain('#ملاحظة');
  });

  test('a date keeps all its parts in ONE <bdi> (no reversal of 2026-06-01)', () => {
    const root = frag('<p>التاريخ 2026-06-01 مهم</p>');
    applyBidi(root, { escape: escapeHtml });
    const numericBdis = [...root.querySelectorAll('bdi')].map(b => b.textContent).filter(t => /\d/.test(t));
    expect(numericBdis).toEqual(['2026-06-01']); // exactly one isolate, intact
  });

  test('a time and a range also stay intact in a single <bdi>', () => {
    const root = frag('<p>من 10-20 في 12:30</p>');
    applyBidi(root, { escape: escapeHtml });
    const numericBdis = [...root.querySelectorAll('bdi')].map(b => b.textContent).filter(t => /\d/.test(t));
    expect(numericBdis.sort()).toEqual(['10-20', '12:30']);
  });

  test('an opposite-direction (LTR) link inside an RTL block is wrapped', () => {
    const root = frag('<p>انظر <a href="https://x">GitHub</a> هنا</p>');
    applyBidi(root, { escape: escapeHtml });
    expect(root.querySelector('a').parentNode.nodeName).toBe('BDI');
  });

  test('an Arabic (same-direction) link inside an RTL block is NOT wrapped', () => {
    const root = frag('<p>انظر <a href="https://x">مرجع</a> هنا</p>');
    applyBidi(root, { escape: escapeHtml });
    expect(root.querySelector('a').parentNode.nodeName).toBe('P');
  });

  test('LTR blocks are left clean (no bdi noise around numbers/code)', () => {
    const root = frag('<p>Chapter 3 see <code>main.js</code></p>');
    applyBidi(root, { escape: escapeHtml });
    expect(root.querySelectorAll('bdi').length).toBe(0);
    expect(root.querySelector('code').parentNode.nodeName).toBe('P');
  });

  test('code blocks (<pre><code>) are never isolated', () => {
    const root = frag('<p dir="rtl">نص</p><pre dir="rtl"><code>const x = 1;</code></pre>');
    applyBidi(root, { escape: escapeHtml });
    expect(root.querySelector('pre code').closest('bdi')).toBeNull();
  });

  test('escapes special characters in isolated text runs (no HTML injection)', () => {
    const root = frag('<p>قيمة 1<2 نهاية</p>');
    applyBidi(root, { escape: escapeHtml });
    // "1" is a number run → bdi; "<2" must remain literal text, not a tag.
    expect(root.querySelector('p').textContent).toContain('1<2');
    expect(root.querySelector('p').querySelector('script')).toBeNull();
  });

  test('idempotent: running twice does not double-wrap', () => {
    const root = frag('<p>رقم 7 و <code>x.js</code></p>');
    applyBidi(root, { escape: escapeHtml });
    const after1 = root.querySelectorAll('bdi').length;
    applyBidi(root, { escape: escapeHtml });
    expect(root.querySelectorAll('bdi').length).toBe(after1);
  });

  test('null root is a safe no-op', () => {
    expect(() => isolateInlineRuns(null)).not.toThrow();
  });

  test('does not isolate digits inside a Mermaid diagram (T-F16 composition)', () => {
    const root = frag('<p>مخطط <span class="mermaid" dir="ltr"><svg><text>step 2</text></svg></span> هنا</p>');
    applyBidi(root, { escape: escapeHtml });
    expect(root.querySelector('.mermaid bdi')).toBeNull();
  });

  test('does not isolate digits inside KaTeX math (T-F9 composition)', () => {
    const root = frag('<p>قيمة <span class="math-inline" dir="ltr"><span class="katex">x<span class="mord">2</span></span></span> هنا</p>');
    applyBidi(root, { escape: escapeHtml });
    // the "2" lives inside .katex → must NOT be wrapped in a <bdi>
    expect(root.querySelector('.katex bdi')).toBeNull();
  });

  test('default identity escape still isolates a number run', () => {
    const root = frag('<p dir="rtl">صفحة 7 هنا</p>');
    isolateInlineRuns(root, 'rtl'); // no escape arg → default (s) => s
    expect([...root.querySelectorAll('bdi')].map(b => b.textContent)).toContain('7');
  });
});

describe('applyBidi guards', () => {
  test('null root is a safe no-op', () => {
    expect(() => applyBidi(null)).not.toThrow();
    expect(applyBidi(null)).toBeNull();
  });
});

describe('applyBidi (combined)', () => {
  test('mixed AR/EN document: each block gets its own direction', () => {
    const root = frag(`
      <h1>مرحبا</h1>
      <p>فقرة عربية مع 42 و <code>main.js</code></p>
      <p>An English paragraph</p>
    `);
    applyBidi(root, { baseDir: 'rtl', escape: escapeHtml });
    expect(root.querySelector('h1').getAttribute('dir')).toBe('rtl');
    const ps = root.querySelectorAll('p');
    expect(ps[0].getAttribute('dir')).toBe('rtl');
    expect(ps[0].getAttribute('lang')).toBe('ar');
    expect(ps[1].getAttribute('dir')).toBe('ltr');
    expect(ps[0].querySelectorAll('bdi').length).toBeGreaterThan(0);
    expect(ps[1].querySelectorAll('bdi').length).toBe(0);
  });
});
