/**
 * @vitest-environment jsdom
 *
 * bidi-dom.test.js — T-R1/R2 DOM application layer. Drives the real DOM helpers
 * (built on the pure src/renderer/bidi.js core) against a jsdom document so the
 * per-block direction + inline isolation logic is unit-tested without Playwright.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { applyBlockDirection, isolateInlineRuns, applyBidi, applyTableDirection } from '../../src/renderer/bidi-dom.js';
import { escapeHtml } from '../../src/renderer/i18n.js';

function frag(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('applyTableDirection (T-R9 table column mirror)', () => {
  test('Arabic-first table → table dir="rtl" (columns mirror)', () => {
    const root = frag('<table><thead><tr><th>المفتاح</th><th>Value</th></tr></thead><tbody><tr><td>واحد</td><td>1</td></tr></tbody></table>');
    applyBidi(root, { baseDir: 'ltr', escape: escapeHtml });
    expect(root.querySelector('table').getAttribute('dir')).toBe('rtl');
  });
  test('English-first table stays ltr', () => {
    const root = frag('<table><thead><tr><th>Name</th><th>قيمة</th></tr></thead></table>');
    applyBidi(root, { baseDir: 'ltr', escape: escapeHtml });
    expect(root.querySelector('table').getAttribute('dir')).toBe('ltr');
  });
  test('neutral-only table inherits the base direction', () => {
    const root = frag('<table><tr><td>123</td><td>456</td></tr></table>');
    applyBidi(root, { baseDir: 'rtl', escape: escapeHtml });
    expect(root.querySelector('table').getAttribute('dir')).toBe('rtl');
  });
  test('per-cell dir is UNCHANGED (explicit, not "auto" — protects the Arabic-font CSS)', () => {
    const root = frag('<table><tr><td>واحد</td><td>two</td></tr></table>');
    applyBidi(root, { baseDir: 'ltr', escape: escapeHtml });
    const cells = root.querySelectorAll('td');
    expect(cells[0].getAttribute('dir')).toBe('rtl'); // Arabic cell
    expect(cells[1].getAttribute('dir')).toBe('ltr'); // English cell — NOT 'auto'
  });
  test('still isolates inline neutral runs inside RTL cells (table pass composes)', () => {
    const root = frag('<table><tr><td>صفحة 42 هنا</td></tr></table>');
    applyBidi(root, { baseDir: 'rtl', escape: escapeHtml });
    expect(root.querySelector('td bdi')).toBeTruthy(); // the 42 is still wrapped
  });
  test('safe no-op on a null/non-element root', () => {
    expect(() => applyTableDirection(null)).not.toThrow();
    expect(applyTableDirection(null)).toBe(null);
  });
});

describe('applyBlockDirection (T-R1)', () => {
  test('Arabic block → dir/data-dir rtl + script marker without invented language (EC-C6)', () => {
    const root = frag('<p>مرحبا بالعالم</p>');
    applyBlockDirection(root);
    const p = root.querySelector('p');
    expect(p.getAttribute('dir')).toBe('rtl');
    expect(p.getAttribute('data-dir')).toBe('rtl');
    expect(p.hasAttribute('lang')).toBe(false);
    expect(p.getAttribute('data-script')).toBe('arabic');
  });

  test('English block → dir ltr, no lang', () => {
    const root = frag('<p>Hello world</p>');
    applyBlockDirection(root);
    const p = root.querySelector('p');
    expect(p.getAttribute('dir')).toBe('ltr');
    expect(p.hasAttribute('lang')).toBe(false);
  });

  test('preserves author-provided language and uses a non-language script marker for font selection', () => {
    const root = frag('<p lang="fa">متن فارسی</p><p lang="ur">اردو متن</p><p>نص عربي</p>');
    applyBlockDirection(root);
    const ps = root.querySelectorAll('p');
    expect(ps[0].getAttribute('lang')).toBe('fa');
    expect(ps[1].getAttribute('lang')).toBe('ur');
    expect(ps[2].hasAttribute('lang')).toBe(false);
    expect([...ps].every(p => p.getAttribute('data-script') === 'arabic')).toBe(true);
  });

  test('dominant-script wins: Arabic-majority block that OPENS with English → rtl + Arabic-script marker', () => {
    // Previously first-strong returned ltr here ("Hello" leads), which left Arabic headings/
    // paragraphs that open with an English word or number wrongly laid out left-to-right.
    const root = frag('<p>Hello مرحبا مرحبا مرحبا</p>');
    applyBlockDirection(root);
    const p = root.querySelector('p');
    expect(p.getAttribute('dir')).toBe('rtl');
    expect(p.getAttribute('data-script')).toBe('arabic');
  });

  test('Arabic heading that opens with an English brand/number → rtl (the reported header bug)', () => {
    const root = frag('<h1>API دليل المستخدم الكامل</h1><h2>2024 إصدار جديد من البرنامج</h2>');
    applyBlockDirection(root);
    expect(root.querySelector('h1').getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('h2').getAttribute('dir')).toBe('rtl');
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
    // audit UX-01: the surrounding prose must stay a strict Arabic majority for the block
    // itself to resolve rtl (18 Arabic vs 14 Latin letters here).
    const root = frag('<p>شغّل الأمر التالي <code>src/main/index.js</code> الآن</p>');
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

  test('RTL-H1: digit runs carry dir="ltr" — a bare auto bdi would inherit RTL and flip separators', () => {
    const root = frag('<p>التاريخ 2026-06-01 والوقت 12:30</p>');
    applyBidi(root, { escape: escapeHtml });
    const bdis = [...root.querySelectorAll('bdi')];
    expect(bdis.map(b => [b.textContent, b.getAttribute('dir')])).toEqual([
      ['2026-06-01', 'ltr'],
      ['12:30', 'ltr'],
    ]);
  });

  test('RTL-H1: #tags keep the bare auto isolate (their letters anchor the direction)', () => {
    const root = frag('<p>الوسم #note_2026 مهم</p>');
    applyBidi(root, { escape: escapeHtml });
    const tag = [...root.querySelectorAll('bdi')].find(b => (b.textContent || '').startsWith('#'));
    expect(tag.getAttribute('dir')).toBeNull();
  });

  test('RTL-H1: inline code isolation carries dir="ltr" so a neutral-only snippet cannot inherit RTL', () => {
    const root = frag('<p>الوقت <code>12:30</code> الآن</p>');
    applyBidi(root, { escape: escapeHtml });
    const bdi = root.querySelector('bdi');
    expect(bdi.getAttribute('dir')).toBe('ltr');
    expect(bdi.querySelector('code')).toBeTruthy();
  });

  test('RTL-H2: a neutral-text link (wikilink date) gets its digit run isolated inside the anchor', () => {
    const root = frag('<p>الموعد <a data-target="2026-06-01">2026-06-01</a> ثابت</p>');
    applyBidi(root, { escape: escapeHtml });
    const inner = root.querySelector('a bdi');
    expect(inner.getAttribute('dir')).toBe('ltr');
    expect(inner.textContent).toBe('2026-06-01');
  });

  test('RTL-H2: a URL-named link is never fragmented — its digits are one identifier', () => {
    const root = frag('<p>راجع <a href="https://example.com/2026/06/01">https://example.com/2026/06/01</a> التقرير</p>');
    applyBidi(root, { escape: escapeHtml });
    expect(root.querySelector('a').querySelector('bdi')).toBeNull();
  });

  test('RTL-H2: a link already isolated as opposite-direction is not re-isolated inside', () => {
    const root = frag('<p>انظر <a href="https://x">GitHub 2026</a> هنا</p>');
    applyBidi(root, { escape: escapeHtml });
    const outer = root.querySelector('a').closest('bdi');
    expect(outer).toBeTruthy();
    expect(outer.querySelector('bdi')).toBeNull();
  });

  test('an Arabic (same-direction) link inside an RTL block is NOT wrapped', () => {
    const root = frag('<p>انظر <a href="https://x">مرجع</a> هنا</p>');
    applyBidi(root, { escape: escapeHtml });
    expect(root.querySelector('a').parentNode.nodeName).toBe('P');
  });

  test('LTR blocks are left clean (no bdi noise around numbers/code)', () => {
    const root = frag('<p>Chapter 3 see <code>src/main/index.js</code></p>');
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
      <p>فقرة عربية طويلة مع 42 و <code>src/main/index.js</code></p>
      <p>An English paragraph</p>
    `);
    applyBidi(root, { baseDir: 'rtl', escape: escapeHtml });
    expect(root.querySelector('h1').getAttribute('dir')).toBe('rtl');
    const ps = root.querySelectorAll('p');
    expect(ps[0].getAttribute('dir')).toBe('rtl');
    expect(ps[0].getAttribute('data-script')).toBe('arabic');
    expect(ps[1].getAttribute('dir')).toBe('ltr');
    expect(ps[0].querySelectorAll('bdi').length).toBeGreaterThan(0);
    expect(ps[1].querySelectorAll('bdi').length).toBe(0);
  });
});

describe('forced direction (toggle / front-matter overrides per-block auto)', () => {
  test('forceDir="rtl" forces an English block to rtl, but adds NO spurious lang=ar', () => {
    const root = frag('<p>An English paragraph</p>');
    applyBlockDirection(root, 'ltr', 'rtl');
    const p = root.querySelector('p');
    expect(p.getAttribute('dir')).toBe('rtl');
    expect(p.hasAttribute('lang')).toBe(false); // ARABIC.test guard: no Arabic → no lang
  });

  test('forceDir="ltr" forces an Arabic block to ltr', () => {
    const root = frag('<p>مرحبا بالعالم</p>');
    applyBlockDirection(root, 'ltr', 'ltr');
    expect(root.querySelector('p').getAttribute('dir')).toBe('ltr');
  });

  test('forceDir="rtl" forces a 50/50 English-led block to rtl (the reported bug at DOM layer)', () => {
    const root = frag('<p>Name قيمة</p>'); // auto: exact tie → inherits ltr (audit UX-01)
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('p').getAttribute('dir')).toBe('ltr'); // sanity: auto
    applyBlockDirection(root, 'ltr', 'rtl');
    expect(root.querySelector('p').getAttribute('dir')).toBe('rtl'); // forced
  });

  test('applyTableDirection honors forceDir over dominant-script', () => {
    const root = frag('<table><tr><th>Name</th><th>قيمة</th></tr></table>');
    applyTableDirection(root, 'ltr', 'rtl');
    expect(root.querySelector('table').getAttribute('dir')).toBe('rtl');
  });

  test('applyBidi({forceDir:"rtl"}) forces every block rtl but STILL isolates English/number runs in <bdi>', () => {
    const root = frag('<h1>Release Notes</h1><p>See version 2.0 in <code>app.js</code></p>');
    applyBidi(root, { baseDir: 'ltr', escape: escapeHtml, forceDir: 'rtl' });
    expect(root.querySelector('h1').getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('p').getAttribute('dir')).toBe('rtl');
    // Inline isolation must still fire off the (now forced) rtl block: the LTR <code> and the
    // number "2.0" are wrapped so they don't reorder under the forced RTL base.
    expect(root.querySelector('code').parentNode.nodeName).toBe('BDI');
    expect([...root.querySelectorAll('bdi')].map((b) => b.textContent)).toContain('2.0');
  });

  test('regression: omitting forceDir keeps the exact per-block auto result', () => {
    const html = '<h1>مرحبا</h1><p>An English paragraph</p>';
    const a = frag(html); applyBlockDirection(a, 'ltr');
    const b = frag(html); applyBlockDirection(b, 'ltr', null);
    expect(a.querySelector('h1').getAttribute('dir')).toBe('rtl');
    expect(a.querySelector('p').getAttribute('dir')).toBe('ltr');
    expect(b.querySelector('h1').getAttribute('dir')).toBe('rtl');
    expect(b.querySelector('p').getAttribute('dir')).toBe('ltr');
  });

  test('forced direction applies to the whole callout wrapper and title', () => {
    const root = frag('<aside class="callout" role="note"><div class="callout-title">Warning</div><div class="callout-body"><p>مرحبا</p></div></aside>');
    applyBidi(root, { forceDir: 'rtl' });
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('.callout-title').closest('[dir]').getAttribute('dir')).toBe('rtl');
  });
});

// audit UX-02: container blocks measure only their PROSE — the letters inside fenced code,
// inline code, diagrams and math are identifiers, not prose, and used to out-number (and so
// wrongly flip) a genuinely Arabic callout/list item/table cell.
describe('code/math text is excluded from container-block direction (audit UX-02)', () => {
  const CODEISH_SNIPPET = 'const payload = { enable: true, retries: 3 };';

  test('an Arabic callout containing a Latin-dense snippet stays dir=rtl', () => {
    const root = frag(`<blockquote class="callout">
      <p>ملاحظة عربية قصيرة</p>
      <pre><code>${CODEISH_SNIPPET}</code></pre>
    </blockquote>`);
    // Sanity: the raw text IS Latin-dominant (15 Arabic vs 29 Latin letters) — the old
    // measurement would have flipped this callout to dir="ltr".
    expect(root.querySelector('blockquote').textContent).toContain(CODEISH_SNIPPET);

    applyBlockDirection(root, 'ltr');

    const blockquote = root.querySelector('blockquote');
    expect(blockquote.getAttribute('dir')).toBe('rtl');
    expect(blockquote.getAttribute('data-script')).toBe('arabic');
    expect(blockquote.querySelector('pre code')).not.toBeNull(); // the snippet is untouched
  });

  test('a plain Arabic paragraph with no code is unchanged', () => {
    const root = frag('<p>ملاحظة عربية قصيرة</p>');
    applyBlockDirection(root, 'ltr');
    const p = root.querySelector('p');
    expect(p.getAttribute('dir')).toBe('rtl');
    expect(p.getAttribute('data-script')).toBe('arabic');
  });
});

// RTL-M1 (2026-09-26): the table-level pass counts the same text the per-block pass
// counts — code cells are stripped, so a Latin identifier in one cell no longer leaves
// an otherwise-Arabic table unmirrored.
describe('applyTableDirection code-cell stripping (RTL-M1)', () => {
  test('an Arabic table with a code-heavy cell keeps dir="rtl"', () => {
    const root = frag('<table><thead><tr><th>الاسم</th><th>الوصف</th></tr></thead><tbody><tr><td>دالة</td><td><code>Array.prototype.flatMap.call(arguments, thisArg)</code></td></tr></tbody></table>');
    applyBidi(root, { baseDir: 'ltr', escape: escapeHtml });
    expect(root.querySelector('table').getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('th').getAttribute('dir')).toBe('rtl');
  });
});
