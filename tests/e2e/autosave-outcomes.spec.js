// @ts-check
/**
 * autosave-outcomes.spec.js — audit QA-01.
 *
 * The autosave loop used to ignore writeThrough()'s outcome, so a persistent save
 * failure was completely invisible. It now notifies once per file. Boots the renderer
 * with a mocked electronAPI bridge (same harness shape as m6-session-restore.spec.js)
 * whose writeFile always fails, drives one tick through the exported window._autosaveTick
 * hook, and asserts the toast.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = `file:///${path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/')}`;

const DEFAULTS = {
  theme: 'paper', zoomFactor: 1, editorMode: 'live',
  sidebarVisible: true, inspectorVisible: true,
  uiDirection: 'ltr', uiLocale: 'en',
  calendar: 'gregorian', arabicKashida: false, italicRecolor: true,
  recents: [], window: { w: 1280, h: 820, maximized: false }, lastSession: null,
};

async function bootWithBridge(page) {
  await page.addInitScript(({ settings }) => {
    const noop = () => {};
    window.electronAPI = {
      closeWindow: noop, minimizeWindow: noop, maximizeWindow: noop,
      openFolder: async () => ({ canceled: true }),
      readVault: async () => ({ error: 'unauthorized-capability' }),
      writeFile: async () => ({ error: 'write-failed' }),
      getSettings: async () => settings,
      setSettings: async () => ({ ok: true }),
      exportPDF: async () => ({ ok: true }),
      editCommand: noop, onOpenFile: noop, onVaultChanged: noop,
      checkForUpdate: async () => ({}), logError: noop,
    };
  }, { settings: DEFAULTS });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app', { state: 'visible' });
}

test.describe('[QA-01] autosave write outcomes', () => {
  test('a persistent write failure surfaces a one-time toast', async ({ page }) => {
    await bootWithBridge(page);
    await page.waitForTimeout(150); // let the settings restore settle

    await page.evaluate(() => {
      window._appState.autosave = true;
      window._appState.files.push({
        name: 'fail.md', path: 'fail.md', handle: null, content: '# Fail',
        dirty: true, documentId: 'cap-fail', vaultId: null,
        meta: { bom: false, eol: '\n', finalNewline: true, hash: 'h' },
        revision: 1, inventory: false, open: true, _editedAt: 0,
      });
      window.renderFile(window._appState.files.length - 1);
    });

    await page.evaluate(() => window._autosaveTick());
    await expect(page.locator('#toast')).toContainText('Auto-save could not write');

    // The failure notice is said once per file, not on every tick.
    await page.evaluate(() => {
      window.document.querySelector('#toast').textContent = '';
      return window._autosaveTick();
    });
    await expect(page.locator('#toast')).not.toContainText('Auto-save could not write');
  });
});
