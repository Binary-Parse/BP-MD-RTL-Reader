// @ts-check
/**
 * toolbar-extended.spec.js — the writing-toolbar overhaul (deep-research follow-up):
 *  - block inserts (callout/table/code/hr) never split the caret's line;
 *  - inline wrap word-expands on an empty selection;
 *  - new marks: highlight ==, underline <u>, sub ~x~, sup ^x^ (render in editor + preview);
 *  - clear-formatting, footnote insert, indent/outdent;
 *  - active-state button highlighting; Ctrl+1–6 heading shortcut;
 *  - interactive table controls (show in table; +/- row & col) + Tab cell navigation.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function open(page, content) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.getActiveCmAdapter, null, { timeout: 8000 });
  await page.evaluate((c) => { window._appState.files = [{ name: 't.md', path: 't.md', content: c, dirty: false }]; window.renderFile(0); window.setViewMode('edit'); }, content); // T-F17: these test the editor → edit mode
  await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
}
const val = (page) => page.evaluate(() => window.getActiveCmAdapter().getValue());
const caret = (page, p) => page.evaluate((p) => window.getActiveCmAdapter().setSelection({ start: p, end: p }), p);
const select = (page, s, e) => page.evaluate(([s, e]) => window.getActiveCmAdapter().setSelection({ start: s, end: e }), [s, e]);

test.describe('block inserts never split the caret line', () => {
  for (const [btn, marker] of [['tbCallout', '> [!NOTE]'], ['tbTable', '| Column'], ['tbCodeBlock', '```'], ['tbRule', '---']]) {
    test(`${btn} inserts on its own line (caret mid-word)`, async ({ page }) => {
      await open(page, 'hello world\n');
      await caret(page, 1); // between "h" and "ello"
      await page.click(`#${btn}`);
      const v = await val(page);
      expect(v.startsWith('hello world')).toBe(true); // the line is intact, not "h\n...\nello world"
      expect(v).toContain(marker);
    });
  }
});

test.describe('new inline marks', () => {
  async function wrapWord(page, btn) {
    await open(page, 'hello world\n');
    await select(page, 6, 11); // "world"
    await page.click(`#${btn}`);
    return val(page);
  }
  test('highlight ==', async ({ page }) => { expect(await wrapWord(page, 'tbHighlight')).toBe('hello ==world==\n'); });
  test('underline <u>', async ({ page }) => { expect(await wrapWord(page, 'tbUnderline')).toBe('hello <u>world</u>\n'); });
  test('subscript ~', async ({ page }) => { expect(await wrapWord(page, 'tbSub')).toBe('hello ~world~\n'); });
  test('superscript ^', async ({ page }) => { expect(await wrapWord(page, 'tbSup')).toBe('hello ^world^\n'); });

  test('marks render in BOTH the editor and the preview', async ({ page }) => {
    await open(page, '# H\n\nthis ==hi== and X^2^ and H~2~O and <u>u</u>\n');
    await caret(page, 0); // active line 1 → marks on line 3 render
    await page.waitForTimeout(250);
    const ed = await page.evaluate(() => ({
      hl: document.querySelectorAll('.cm-mount .cm-hl').length,
      sup: document.querySelectorAll('.cm-mount .cm-sup').length,
      sub: document.querySelectorAll('.cm-mount .cm-sub').length,
      u: document.querySelectorAll('.cm-mount .cm-u').length,
    }));
    expect(ed).toEqual({ hl: 1, sup: 1, sub: 1, u: 1 });
    const pv = await page.evaluate(() => ({
      mark: document.querySelectorAll('#noteContent mark').length,
      sup: document.querySelectorAll('#noteContent sup').length,
      sub: document.querySelectorAll('#noteContent sub').length,
      u: document.querySelectorAll('#noteContent u').length,
    }));
    expect(pv).toEqual({ mark: 1, sup: 1, sub: 1, u: 1 });
  });
});

test('a wide image is constrained to the editor width (no horizontal overflow)', async ({ page }) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="300"><rect width="2000" height="300" fill="#44aaaa"/></svg>';
  const url = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await open(page, `# T\n\n![chart](${url})\n\ntail\n`);
  await caret(page, 0); // off the image line so the block widget renders
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const img = document.querySelector('.cm-mount .cm-lp-image img') || document.querySelector('.cm-mount .cm-lp-block img');
    const content = document.querySelector('.cm-mount .cm-content');
    const scroller = document.querySelector('.cm-mount .cm-scroller');
    return {
      imgW: img ? Math.round(img.getBoundingClientRect().width) : -1,
      contentW: Math.round(content.getBoundingClientRect().width),
      maxW: img ? getComputedStyle(img).maxWidth : null,
      horiz: scroller.scrollWidth > scroller.clientWidth + 1,
    };
  });
  expect(r.maxW).toBe('100%');
  expect(r.imgW).toBeLessThanOrEqual(r.contentW + 1); // a 2000px image fits the column
  expect(r.horiz).toBe(false); // no horizontal scrollbar
});

test('clear formatting strips inline markers from the selection', async ({ page }) => {
  await open(page, 'a **bold** b\n');
  await select(page, 2, 10); // "**bold**"
  await page.click('#tbClear');
  expect(await val(page)).toBe('a bold b\n');
});

test('footnote insert adds a ref + a definition stub', async ({ page }) => {
  await open(page, 'see here\n');
  await caret(page, 3);
  await page.click('#tbFootnote');
  expect(await val(page)).toBe('see[^1] here\n\n[^1]: ');
});

test('indent / outdent add and remove leading spaces', async ({ page }) => {
  await open(page, '- item\n');
  await caret(page, 2);
  await page.click('#tbIndent');
  expect(await val(page)).toBe('  - item\n');
  await caret(page, 2);
  await page.click('#tbOutdent');
  expect(await val(page)).toBe('- item\n');
});

test('Ctrl+1–6 sets heading level', async ({ page }) => {
  await open(page, 'plain line\n');
  await page.click('.cm-mount .cm-content');
  await caret(page, 3);
  await page.keyboard.press('Control+3');
  expect(await val(page)).toBe('### plain line\n');
});

test('active-state highlights the construct at the caret', async ({ page }) => {
  await open(page, 'a **bold** here\n');
  await caret(page, 5); // inside **bold**
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => document.getElementById('tbBold').classList.contains('is-active'))).toBe(true);
  await caret(page, 0);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => document.getElementById('tbBold').classList.contains('is-active'))).toBe(false);
});

test.describe('interactive table controls', () => {
  const T = 'intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nafter\n';
  test('controls appear only inside a table; +Row / +Col edit it', async ({ page }) => {
    await open(page, T);
    await page.evaluate(() => { const a = window.getActiveCmAdapter(); a.setSelection({ start: 0, end: 0 }); }); // in "intro"
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => document.getElementById('tableControls').classList.contains('show'))).toBe(false);
    await page.evaluate(() => { const a = window.getActiveCmAdapter(); const p = a.getValue().indexOf('1 |'); a.setSelection({ start: p, end: p }); });
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => document.getElementById('tableControls').classList.contains('show'))).toBe(true);
    await page.click('#tcRowAfter');
    expect(await val(page)).toContain('| 1 | 2 |\n|  |  |');
    await page.evaluate(() => { const a = window.getActiveCmAdapter(); const p = a.getValue().indexOf('A |'); a.setSelection({ start: p, end: p }); });
    await page.click('#tcColAfter');
    expect(await val(page)).toContain('| A |  | B |');
  });

  test('Tab navigates to the next cell inside a table', async ({ page }) => {
    await open(page, '| A | B |\n| --- | --- |\n| 1 | 2 |\n');
    await page.click('.cm-mount .cm-content');
    await page.evaluate(() => { const a = window.getActiveCmAdapter(); const p = a.getValue().indexOf('1'); a.setSelection({ start: p, end: p }); });
    await page.keyboard.press('Tab');
    const ch = await page.evaluate(() => { const a = window.getActiveCmAdapter(); const s = a.getSelection(); return a.getValue().slice(s.start, s.start + 1); });
    expect(ch).toBe('2');
  });
});
