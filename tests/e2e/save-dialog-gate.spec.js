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

// B2: "Don't Save" throws the edit away for good. The Electron lane proves the disk; this lane
// proves the in-memory outcome on each surface that offers the choice.
test.describe('[B2] Don\'t Save discards the edit', () => {
  const FOLDER_NOTE = { name: 'a.md', path: 'a.md', vaultId: 'v1', inventory: true, open: true, content: 'SAVED\nEDIT', savedContent: 'SAVED', dirty: true, revision: 1 };

  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('closing a folder note\'s tab: the note stays in the list at its saved text, clean', async ({ page }) => {
    await page.evaluate((note) => {
      window._appState.files.push({ ...note }, { name: 'b.md', path: 'b.md', vaultId: 'v1', inventory: true, open: true, content: 'B', savedContent: 'B', dirty: false, revision: 0 });
      window.renderFile(0);
    }, FOLDER_NOTE);
    await page.evaluate(() => { window.__closing = window.closeTab(0); });
    await page.locator('#dlgDontSaveBtn').click();
    await page.evaluate(() => window.__closing);
    const state = await page.evaluate(() => {
      const f = window._appState.files.find((x) => x.name === 'a.md');
      return { content: f.content, dirty: f.dirty, open: f.open, count: window._appState.files.length };
    });
    expect(state).toEqual({ content: 'SAVED', dirty: false, open: false, count: 2 });
    await expect(page.locator('.tab.dirty')).toHaveCount(0);
  });

  test('closing a loose file\'s tab removes it, as before', async ({ page }) => {
    await page.evaluate(() => {
      window._appState.files.push({ name: 'loose.md', path: 'loose.md', content: 'SAVED\nEDIT', savedContent: 'SAVED', dirty: true, revision: 1 });
      window.renderFile(0);
    });
    await page.evaluate(() => { window.__closing = window.closeTab(0); });
    await page.locator('#dlgDontSaveBtn').click();
    await page.evaluate(() => window.__closing);
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
  });

  test('closing a folder note\'s tab with Cancel keeps the edit and the tab', async ({ page }) => {
    await page.evaluate((note) => { window._appState.files.push({ ...note }); window.renderFile(0); }, FOLDER_NOTE);
    await page.evaluate(() => { window.__closing = window.closeTab(0); });
    await page.locator('#dlgCancelBtn').click();
    await page.evaluate(() => window.__closing);
    const state = await page.evaluate(() => {
      const f = window._appState.files[0];
      return { content: f.content, dirty: f.dirty, open: f.open };
    });
    expect(state).toEqual({ content: 'SAVED\nEDIT', dirty: true, open: true });
  });

  test('"Close without Saving" at window close leaves every dirty note clean at its saved text', async ({ page }) => {
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
    await page.evaluate((note) => {
      window._appState.files.push({ ...note }, { ...note, name: 'c.md', path: 'c.md', content: 'C-EDIT', savedContent: 'C' });
      window.renderFile(0);
    }, FOLDER_NOTE);
    await page.evaluate(() => window.__closeCb());
    await page.locator('#dlgDontSaveBtn').click();
    await page.waitForFunction(() => window.__closeCalls.closeWindow >= 1);
    const state = await page.evaluate(() => window._appState.files.map((f) => [f.name, f.content, f.dirty]));
    expect(state).toEqual([['a.md', 'SAVED', false], ['c.md', 'C', false]]);
  });
});
