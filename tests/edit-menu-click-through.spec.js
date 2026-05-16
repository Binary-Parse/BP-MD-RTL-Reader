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

const FILE_URL = 'file:///' + path.resolve(__dirname, '../marqam.html').replace(/\\/g, '/');

async function setupWithText(page, text) {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });
  await page.evaluate(() => {
    const S = window._marqamState;
    S.files = [{ name: 'edit.md', path: 'edit.md', handle: null, content: '', dirty: false }];
    window.renderFile(0);
    window.setEditorMode('source');
  });
  await page.waitForTimeout(150);
  await page.evaluate((t) => {
    const ta = document.getElementById('srcTextarea');
    ta.value = t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
  }, text);
  await page.waitForTimeout(100);
}

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

  test('Select All — selects all text in focused textarea', async ({ page }) => {
    await setupWithText(page, 'hello world\nsecond line');
    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.selectionStart = ta.selectionEnd = 0;
    });
    await clickEditMenuItem(page, 'Select All');
    const sel = await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      return { start: ta.selectionStart, end: ta.selectionEnd, len: ta.value.length };
    });
    expect(sel.start).toBe(0);
    expect(sel.end).toBe(sel.len);
  });

  test('Copy — writes selected text to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupWithText(page, 'copy me text');
    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.selectionStart = 0;
      ta.selectionEnd = 7; // "copy me"
    });
    await clickEditMenuItem(page, 'Copy');
    const cb = await page.evaluate(() => navigator.clipboard.readText());
    expect(cb).toBe('copy me');
  });

  test('Cut — removes selection from textarea and copies to clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupWithText(page, 'cut THIS text');
    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      ta.selectionStart = 4;
      ta.selectionEnd = 8; // "THIS"
    });
    await clickEditMenuItem(page, 'Cut');
    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    const cb = await page.evaluate(() => navigator.clipboard.readText());
    expect(val).toBe('cut  text');
    expect(cb).toBe('THIS');
  });

  test('Paste — inserts clipboard text at cursor', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupWithText(page, 'before|after');
    await page.evaluate(() => navigator.clipboard.writeText('MIDDLE'));
    await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      const i = ta.value.indexOf('|');
      ta.selectionStart = i;
      ta.selectionEnd = i + 1;
    });
    await clickEditMenuItem(page, 'Paste');
    await page.waitForTimeout(200);
    const val = await page.evaluate(() => document.getElementById('srcTextarea').value);
    expect(val).toBe('beforeMIDDLEafter');
  });

  test('Undo — reverts last input (after a deliberate edit)', async ({ page }) => {
    await setupWithText(page, 'initial');
    // Simulate a user edit via the textarea (browser must record this in undo history)
    await page.focus('#srcTextarea');
    await page.keyboard.press('End');
    await page.keyboard.type(' more');
    const beforeUndo = await page.evaluate(() => document.getElementById('srcTextarea').value);
    expect(beforeUndo).toBe('initial more');
    await clickEditMenuItem(page, 'Undo');
    await page.waitForTimeout(150);
    const afterUndo = await page.evaluate(() => document.getElementById('srcTextarea').value);
    // Undo should remove the typed text (Chromium textarea undo behavior)
    expect(afterUndo).not.toBe('initial more');
  });

  test('Redo — re-applies an undone edit', async ({ page }) => {
    await setupWithText(page, 'base');
    await page.focus('#srcTextarea');
    await page.keyboard.press('End');
    await page.keyboard.type(' X');
    await clickEditMenuItem(page, 'Undo');
    await page.waitForTimeout(150);
    const afterUndo = await page.evaluate(() => document.getElementById('srcTextarea').value);
    await clickEditMenuItem(page, 'Redo');
    await page.waitForTimeout(150);
    const afterRedo = await page.evaluate(() => document.getElementById('srcTextarea').value);
    expect(afterRedo).not.toBe(afterUndo);
  });
});
