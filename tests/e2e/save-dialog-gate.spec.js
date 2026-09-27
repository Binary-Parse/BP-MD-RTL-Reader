// @ts-check
/**
 * save-dialog-gate.spec.js — DATA-03 (2026-09-26 audit):
 *   1. A superseded Save dialog must not clear the autosave gate the incoming dialog
 *      just armed (double Alt+F4 / re-requested close used to leave autosave free to
 *      write behind a pending Don't-Save).
 *   2. An Escape-dismissed Save dialog leaves no stale settler that a later supersede
 *      could re-fire into a live dialog.
 *   3. A second close request while a close flow is pending is a no-op — it must not
 *      supersede the visible dialog or kill the close failsafe the flow maintains.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('[DATA-03] save-dialog autosave gate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('a superseded save dialog keeps the gate armed until the last dialog settles', async ({ page }) => {
    await page.evaluate(() => { window.__p1 = window._askSaveChanges({ name: 'one.md' }); });
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    expect(await page.evaluate(() => window._saveDialogOpen)).toBe(true);

    // The second dialog supersedes the first synchronously; the abandoned settle must
    // release only its own interest, so the gate stays armed for the visible dialog.
    await page.evaluate(() => { window.__p2 = window._askSaveChanges({ name: 'two.md' }); });
    expect(await page.evaluate(() => window._saveDialogOpen)).toBe(true);

    await page.locator('#dlgDontSaveBtn').click();
    await page.waitForFunction(() => window._saveDialogOpen === false);
    expect(await page.evaluate(() => Promise.all([window.__p1, window.__p2])))
      .toEqual(['cancel', 'discard']);
  });

  test('an Escape-dismissed dialog cannot re-fire into a later dialog (stale settler)', async ({ page }) => {
    await page.evaluate(() => { window.__a = window._askSaveChanges({ name: 'a.md' }); });
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window._saveDialogOpen === false);

    await page.evaluate(() => { window.__b = window._askSaveChanges({ name: 'b.md' }); });
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    // The third dialog supersedes the second; the Escape-settled first dialog must
    // stay dead — its re-fired settle would decrement a counter it never incremented.
    await page.evaluate(() => { window.__c = window._askSaveChanges({ name: 'c.md' }); });
    expect(await page.evaluate(() => window._saveDialogOpen)).toBe(true);
    await page.locator('#dlgDontSaveBtn').click();
    await page.waitForFunction(() => window._saveDialogOpen === false);
    expect(await page.evaluate(() => Promise.all([window.__a, window.__b, window.__c])))
      .toEqual(['cancel', 'cancel', 'discard']);
  });

  test('a second close request while the close flow waits on a dialog is a no-op', async ({ page }) => {
    await page.addInitScript(() => {
      window.__closeCalls = { closeWindow: 0 };
      window.electronAPI = {
        onCloseRequested: (cb) => { window.__closeCb = cb; },
        closeWindow: () => { window.__closeCalls.closeWindow += 1; },
      };
    });
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.waitForFunction(() => typeof window.__closeCb === 'function');
    await page.evaluate(() => {
      window._appState.files.push({ name: 'x.md', path: 'x.md', content: 'draft', dirty: true, revision: 0 });
    });

    await page.evaluate(() => window.__closeCb());
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    expect(await page.evaluate(() => window._closeFlowActive)).toBe(true);
    expect(await page.evaluate(() => window._saveDialogOpen)).toBe(true);

    // Second Alt+F4-equivalent: must not supersede the visible dialog (which would
    // clobber the gate and abort the failsafe via the first flow's cancel path).
    await page.evaluate(() => window.__closeCb());
    expect(await page.evaluate(() => window._saveDialogOpen)).toBe(true);

    await page.locator('#dlgDontSaveBtn').click();
    await page.waitForFunction(() => window._closeFlowActive === false);
    await page.waitForFunction(() => window.__closeCalls.closeWindow >= 1);
    expect(await page.evaluate(() => window._saveDialogOpen)).toBe(false);
  });
});
