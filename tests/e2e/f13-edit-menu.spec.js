// @ts-check
/**
 * f13-edit-menu.spec.js — T-F13: the Edit menu / keyboard commands act on the SINGLE CM6
 * editor (copy/cut/paste/select-all/undo/redo), since the textarea + rendered-preview model
 * is gone. In the Playwright (non-Electron) origin these run through the renderer fallback in
 * edit-commands.js → the CM6 adapter; in Electron the same commands forward natively to the
 * focused CM6 surface. Coverage here replaces the deleted textarea-era edit tests.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = `file:///${path.resolve(__dirname, '../../index.html').replace(/\\/g, '/')}`;

async function open(page, content) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.evaluate((c) => {
    window._appState.files = [{ name: 'e.md', path: 'e.md', handle: null, content: c, dirty: false }];
    window.renderFile(0);
  }, content);
  await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
  await page.locator('.cm-mount .cm-content').click();
}
const cmValue = (page) => page.evaluate(() => window.getActiveCmAdapter().getValue());
const cmSelect = (page, s, e) => page.evaluate(([a, b]) => window.getActiveCmAdapter().setSelection({ start: a, end: b }), [s, e]);
const mockClipboard = (page, read = '') => page.evaluate((r) => {
  try { Object.defineProperty(navigator, 'clipboard', { value: { __buf: r, readText() { return Promise.resolve(this.__buf); }, writeText(t) { this.__buf = t; return Promise.resolve(); } }, configurable: true }); } catch (_) {}
}, read);

test.describe('[T-F13] Edit menu / commands act on the CM6 editor', () => {
  test('selectAll selects the whole document', async ({ page }) => {
    await open(page, 'alpha beta gamma');
    await cmSelect(page, 0, 0);
    await page.evaluate(() => window.execEditCmd('selectAll'));
    const sel = await page.evaluate(() => { const c = window.getActiveCmAdapter(); return { ...c.getSelection(), len: c.getValue().length }; });
    expect(sel.start).toBe(0);
    expect(sel.end).toBe(sel.len);
  });

  test('copy writes the CM6 selection to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, 'copy me text');
    await mockClipboard(page);
    await cmSelect(page, 0, 7);
    await page.evaluate(() => window.execEditCmd('copy'));
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('copy me');
  });

  test('cut removes the selection and copies it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, 'cut THIS text');
    await mockClipboard(page);
    await cmSelect(page, 4, 8);
    await page.evaluate(() => window.execEditCmd('cut'));
    await page.waitForTimeout(50);
    expect(await cmValue(page)).toBe('cut  text');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('THIS');
  });

  test('paste inserts clipboard text at the selection', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page, 'beforeafter');
    await mockClipboard(page, 'MIDDLE');
    await cmSelect(page, 6, 6); // between "before" and "after"
    await page.evaluate(() => window.execEditCmd('paste'));
    await page.waitForTimeout(100);
    expect(await cmValue(page)).toBe('beforeMIDDLEafter');
  });

  test('undo then redo round-trips an edit in CM6', async ({ page }) => {
    await open(page, 'base');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' X');
    expect(await cmValue(page)).toBe('base X');
    await page.evaluate(() => window.execEditCmd('undo'));
    await page.waitForTimeout(50);
    expect(await cmValue(page)).toBe('base');
    await page.evaluate(() => window.execEditCmd('redo'));
    await page.waitForTimeout(50);
    expect(await cmValue(page)).toBe('base X');
  });
});

test.describe('[T-F13] Obsidian-style list/blockquote continuation on Enter', () => {
  test('Enter continues a bullet list with the same marker', async ({ page }) => {
    await open(page, '- one');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('two');
    expect(await cmValue(page)).toBe('- one\n- two');
  });

  test('Enter continues a blockquote', async ({ page }) => {
    await open(page, '> quote');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('more');
    expect(await cmValue(page)).toBe('> quote\n> more');
  });

  test('Enter increments an ordered list', async ({ page }) => {
    await open(page, '1. first');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');
    expect(await cmValue(page)).toBe('1. first\n2. second');
  });

  test('Enter continues a task item with a fresh unchecked box', async ({ page }) => {
    await open(page, '- [x] done');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('next');
    expect(await cmValue(page)).toBe('- [x] done\n- [ ] next');
  });

  test('Enter on an EMPTY item exits the list (removes the marker)', async ({ page }) => {
    await open(page, '- ');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('plain');
    expect(await cmValue(page)).toBe('\nplain');
  });
});
