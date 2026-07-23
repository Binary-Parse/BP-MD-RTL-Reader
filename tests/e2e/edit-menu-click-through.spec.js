// @ts-check
/**
 * Edit menu click-through tests.
 *
 * Unlike the prior click-audit, these tests don't call `execEditCmd()` directly.
 * They open the Edit menu via a real .tb-menu-item click, then click the
 * matching .dd-item to fire its action through the same path a user takes.
 *
 * This catches the bug where focus moves to the menu DIV before the handler
 * runs, so `document.activeElement` no longer points at the textarea.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

// T-F13: CM6 is the sole editor. Load text into it, then drive selections via the exposed
// adapter (window.getActiveCmAdapter) so the menu commands act on the real editor surface.
async function setupWithText(page, text) {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });
  await page.evaluate((t) => {
    const S = window._appState;
    S.files = [{ name: 'edit.md', path: 'edit.md', handle: null, content: t, dirty: false }];
    window.renderFile(0);
  }, text);
  await page.locator('.cm-mount .cm-editor').first().waitFor({ state: 'visible', timeout: 8000 });
  await page.locator('.cm-mount .cm-content').click();
  await page.waitForTimeout(50);
}
const cmValue = (page) => page.evaluate(() => window.getActiveCmAdapter().getValue());
const cmSelect = (page, start, end) => page.evaluate(([s, e]) => window.getActiveCmAdapter().setSelection({ start: s, end: e }), [start, end]);

async function clickEditMenuItem(page, label) {
  await page.click('.tb-menu-item[data-menu="edit"]');
  await page.waitForTimeout(100);
  // Find the dd-item by visible name text
  const handle = await page.evaluateHandle((label) => {
    const items = Array.from(document.querySelectorAll('.dd-item:not(.disabled)'));
    return items.find(el => {
      const nameEl = el.querySelector('.dd-name');
      return nameEl && nameEl.textContent.trim().toLowerCase() === label.toLowerCase();
    });
  }, label);
  const el = handle.asElement();
  if (!el) throw new Error(`Edit menu item "${label}" not found`);
  await el.click();
  await page.waitForTimeout(150);
}

test.describe('[EM] Edit menu click-through — Copy/Cut/Paste/Undo/Redo/SelectAll', () => {

  test('Select All — selects all text in the CM6 editor', async ({ page }) => {
    await setupWithText(page, 'hello world\nsecond line');
    await cmSelect(page, 0, 0);
    await clickEditMenuItem(page, 'Select All');
    const sel = await page.evaluate(() => {
      const cm = window.getActiveCmAdapter();
      return { ...cm.getSelection(), len: cm.getValue().length };
    });
    expect(sel.start).toBe(0);
    expect(sel.end).toBe(sel.len);
  });

  test('Copy — writes selected text to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupWithText(page, 'copy me text');
    await cmSelect(page, 0, 7); // "copy me"
    await clickEditMenuItem(page, 'Copy');
    const cb = await page.evaluate(() => navigator.clipboard.readText());
    expect(cb).toBe('copy me');
  });

  test('Cut — removes selection from the editor and copies to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupWithText(page, 'cut THIS text');
    await cmSelect(page, 4, 8); // "THIS"
    await clickEditMenuItem(page, 'Cut');
    expect(await cmValue(page)).toBe('cut  text');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('THIS');
  });

  test('Paste — inserts clipboard text at cursor', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupWithText(page, 'before|after');
    await page.evaluate(() => navigator.clipboard.writeText('MIDDLE'));
    const i = (await cmValue(page)).indexOf('|');
    await cmSelect(page, i, i + 1);
    await clickEditMenuItem(page, 'Paste');
    await page.waitForTimeout(200);
    expect(await cmValue(page)).toBe('beforeMIDDLEafter');
  });

  test('Undo — reverts last input (after a deliberate edit)', async ({ page }) => {
    await setupWithText(page, 'initial');
    await page.locator('.cm-mount .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' more');
    const beforeUndo = await cmValue(page);
    expect(beforeUndo).toBe('initial more');
    await clickEditMenuItem(page, 'Undo');
    await page.waitForTimeout(150);
    const afterUndo = await cmValue(page);
    expect(afterUndo).not.toBe('initial more');
  });

  test('Redo — re-applies an undone edit', async ({ page }) => {
    await setupWithText(page, 'base');
    await page.locator('.cm-mount .cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' X');
    await clickEditMenuItem(page, 'Undo');
    await page.waitForTimeout(150);
    const afterUndo = await cmValue(page);
    await clickEditMenuItem(page, 'Redo');
    await page.waitForTimeout(150);
    const afterRedo = await cmValue(page);
    expect(afterRedo).not.toBe(afterUndo);
  });
});
