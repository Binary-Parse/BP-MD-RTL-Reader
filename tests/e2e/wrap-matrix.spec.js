// @ts-check
/**
 * wrap-matrix.spec.js — defect W1 (owner report 2026-10-10): wrapping in tables, code and every
 * other block must be right in every mode.
 *
 * Rules (the requirement, not the current behaviour):
 *   1  the page never scrolls sideways and nothing is drawn outside the paper column;
 *   2  prose, headings, list items, blockquotes, callouts and footnotes wrap; a token with no
 *      break opportunity (a long URL, a long identifier) breaks instead of overflowing;
 *   3  table cells wrap; a table that still cannot fit scrolls inside its own frame only;
 *   4  fenced code wraps inside its block: no horizontal scrollbar, indentation kept, the block
 *      stays LTR in an RTL note, and the copied text has no inserted line breaks;
 *   5  display math and Mermaid diagrams stay inside their own box (scaled or scrolled there);
 *   6  the exported HTML, on screen and laid out for print (PDF), follows the same rules;
 *   7  the editor follows the same rules for its text and for the tables and code it renders.
 *
 * Matrix: {reading, edit, exported HTML, exported HTML in print layout} x {LTR note, RTL note}
 *         x {1280, 800, 640 (= 1280 at 200 % zoom), 400 (= 800 at 200 % zoom)} CSS px.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

const LONG_URL = 'https://example.com/' + 'a-very-long-path-segment-without-any-space/'.repeat(8);
const LONG_TOKEN = 'averyveryverylongidentifierwithnobreakopportunity'.repeat(6);
const CODE_LINE = 'const result = ' + Array.from({ length: 40 }, (_, i) => `value${i}`).join(' + ') + ';';
const INDENTED = '        return deeplyIndented(' + 'argument, '.repeat(30) + 'last);';
const WIDE_HEAD = '| ' + Array.from({ length: 12 }, (_, i) => `Column ${i + 1}`).join(' | ') + ' |';
const WIDE_RULE = '| ' + Array.from({ length: 12 }, () => '---').join(' | ') + ' |';
const WIDE_ROW = '| ' + Array.from({ length: 12 }, (_, i) => `cell ${i + 1} text`).join(' | ') + ' |';

function note(rtl) {
  const p = rtl
    ? 'هذه فقرة عربية طويلة تحتوي على كلمات كثيرة حتى تلتف على أكثر من سطر داخل عمود القراءة ولا تخرج عنه أبدًا. '.repeat(3)
    : 'This is a long paragraph with many words so that it has to wrap over several lines inside the reading column. '.repeat(3);
  const word = rtl ? 'نص' : 'text';
  return [
    `# ${rtl ? 'عنوان طويل جدًا' : 'A very long heading'} ${LONG_TOKEN}`,
    '',
    p,
    '',
    `${word} ${LONG_URL} ${word}`,
    '',
    `${word} \`${LONG_TOKEN}\` ${word}`,
    '',
    `## ${rtl ? 'عنوان فرعي' : 'Second heading'} ${(rtl ? 'كلمة ' : 'word ').repeat(40)}`,
    '',
    `> ${p}`,
    `> ${LONG_URL}`,
    '',
    '> [!note]',
    `> ${p} ${LONG_TOKEN}`,
    '',
    `- ${p}`,
    `- ${LONG_URL}`,
    `  - ${word} ${LONG_TOKEN}`,
    '',
    `1. ${p}`,
    '',
    WIDE_HEAD, WIDE_RULE, WIDE_ROW,
    '',
    `| ${word} | ${word} |`,
    '| --- | --- |',
    `| ${p} | ${LONG_URL} |`,
    `| ${LONG_TOKEN} | ${word} |`,
    '',
    '```js',
    CODE_LINE,
    'function indented() {',
    INDENTED,
    '}',
    '```',
    '',
    '$$',
    Array.from({ length: 30 }, (_, i) => `x_{${i}}`).join(' + ') + ' = 0',
    '$$',
    '',
    '```mermaid',
    'graph LR',
    Array.from({ length: 14 }, (_, i) => `  N${i}[Node number ${i}] --> N${i + 1}[Node number ${i + 1}]`).join('\n'),
    '```',
    '',
    `${word}[^1]`,
    '',
    `[^1]: ${p} ${LONG_URL}`,
    '',
  ].join('\n');
}

/**
 * Geometry report, run inside the page. `columnSelector` is the element that IS the column.
 * Returns every violation of rules 1-5 as a short string; an empty list means the layout holds.
 */
function wrapReport(columnSelector) {
  const TOLERANCE = 1.5;
  const column = document.querySelector(columnSelector);
  if (!column) return ['no column element: ' + columnSelector];
  const col = column.getBoundingClientRect();
  const out = [];
  const describe = (el) => {
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + cls;
  };
  // Rule 1: nothing scrolls sideways from the column's container up to the viewport. The column
  // itself is skipped: the app draws the paper sheet as a pseudo-element wider than the text
  // column on purpose, and what the column's own content does is covered element by element below.
  for (let el = column.parentElement || column; el; el = el.parentElement) {
    const extra = el.scrollWidth - el.clientWidth;
    if (extra > TOLERANCE) out.push(`page scrolls sideways at ${describe(el)} by ${Math.round(extra)}px`);
  }
  const ownBox = (el) => el.matches('.table-frame, .math-block, .mermaid, .katex-display');
  const insideOwnBox = (el) => {
    for (let p = el.parentElement; p && p !== column; p = p.parentElement) if (ownBox(p)) return true;
    return false;
  };
  for (const el of column.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'absolute' || style.position === 'fixed') continue;
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue; // SVG internals: the <svg> box is what counts
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const boxed = insideOwnBox(el);
    if (!boxed) {
      // Rules 1, 3, 5: the box itself is inside the column.
      const over = Math.max(col.left - rect.left, rect.right - col.right);
      if (over > TOLERANCE) out.push(`${describe(el)} is outside the column by ${Math.round(over)}px`);
      // Rule 2: its content does not spill out of it (a long token that did not break).
      if (!ownBox(el) && style.display !== 'inline' && el.scrollWidth - el.clientWidth > TOLERANCE) {
        out.push(`${describe(el)} content overflows by ${Math.round(el.scrollWidth - el.clientWidth)}px`);
      }
    }
  }
  // Rule 4: fenced code.
  for (const pre of column.querySelectorAll('pre')) {
    if (pre.closest('.mermaid') || pre.dataset.mermaidError !== undefined) continue;
    const style = getComputedStyle(pre);
    const code = pre.querySelector('code') || pre;
    const ws = getComputedStyle(code).whiteSpace;
    if (pre.scrollWidth - pre.clientWidth > TOLERANCE) out.push(`pre scrolls sideways by ${Math.round(pre.scrollWidth - pre.clientWidth)}px`);
    if (!/pre-wrap|break-spaces/.test(ws)) out.push(`code white-space is ${ws}`);
    if (style.direction !== 'ltr') out.push(`pre direction is ${style.direction}`);
  }
  return out;
}

async function boot(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.getActiveCmAdapter, null, { timeout: 8000 });
}

async function openNote(page, rtl, mode) {
  await page.evaluate(([content, viewMode]) => {
    window._appState.files = [{ name: 'wrap.md', path: 'wrap.md', content, dirty: false }];
    window.renderFile(0);
    window.setViewMode(viewMode);
  }, [note(rtl), mode]);
}

const WIDTHS = [1280, 800, 640, 400];

for (const rtl of [false, true]) {
  const lang = rtl ? 'RTL' : 'LTR';

  test.describe(`W1 wrap, ${lang} note`, () => {
    for (const width of WIDTHS) {
      test(`reading mode at ${width}px: nothing leaves the column`, async ({ page }) => {
        await boot(page, width);
        await openNote(page, rtl, 'reading');
        await page.waitForSelector('#noteContent pre');
        await page.waitForSelector('#noteContent .mermaid svg', { timeout: 15000 });
        await page.waitForSelector('#noteContent .katex');
        expect(await page.evaluate(wrapReport, '#noteContent')).toEqual([]);
      });

      test(`edit mode at ${width}px: nothing leaves the editor column`, async ({ page }) => {
        await boot(page, width);
        await openNote(page, rtl, 'edit');
        await page.waitForSelector('.cm-content');
        expect(await page.evaluate(wrapReport, '.cm-content')).toEqual([]);
      });

      test(`exported HTML at ${width}px: nothing leaves the page`, async ({ page, context }) => {
        await boot(page, width);
        await openNote(page, rtl, 'reading');
        await page.waitForSelector('#noteContent .mermaid svg', { timeout: 15000 });
        const html = await page.evaluate(async () => (await window.buildExportDoc(window._appState.files[0])).fullHtml);
        const out = await context.newPage();
        await out.setViewportSize({ width, height: 900 });
        await out.setContent(html);
        expect(await out.evaluate(wrapReport, 'body')).toEqual([]);
      });
    }

    test('exported HTML laid out for print (A4): nothing is cut at the page edge', async ({ page, context }) => {
      await boot(page, 1280);
      await openNote(page, rtl, 'reading');
      await page.waitForSelector('#noteContent .mermaid svg', { timeout: 15000 });
      const html = await page.evaluate(async () => (await window.buildExportDoc(window._appState.files[0])).fullHtml);
      const out = await context.newPage();
      await out.setViewportSize({ width: 794, height: 1123 }); // A4 at 96 dpi
      await out.emulateMedia({ media: 'print' });
      await out.setContent(html);
      expect(await out.evaluate(wrapReport, 'body')).toEqual([]);
    });
  });
}

test.describe('W1 rule 4: code keeps its text', () => {
  test('indentation is kept and the copied text has no inserted line breaks', async ({ page }) => {
    await boot(page, 800);
    await openNote(page, false, 'reading');
    await page.waitForSelector('#noteContent pre code');
    const text = await page.evaluate(() => document.querySelector('#noteContent pre code').textContent);
    expect(text.replace(/\n$/, '').split('\n')).toEqual([CODE_LINE, 'function indented() {', INDENTED, '}']);
    // the long line really is drawn on more than one visual line
    const lines = await page.evaluate(() => {
      const pre = document.querySelector('#noteContent pre');
      return pre.getBoundingClientRect().height / parseFloat(getComputedStyle(pre).lineHeight);
    });
    expect(lines).toBeGreaterThan(6);
    // the indented line starts to the right of the unindented one
    const indent = await page.evaluate(() => {
      const code = document.querySelector('#noteContent pre code');
      const range = document.createRange();
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let offset = 0;
      const full = code.textContent;
      const want = full.indexOf('return deeplyIndented');
      const first = full.indexOf('function indented');
      const at = (target) => {
        const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        let seen = 0;
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (seen + n.length > target) { range.setStart(n, target - seen); range.setEnd(n, target - seen + 1); return range.getBoundingClientRect().left; }
          seen += n.length;
        }
        return null;
      };
      void walker; void offset;
      return at(want) - at(first);
    });
    expect(indent).toBeGreaterThan(30);
  });
});
