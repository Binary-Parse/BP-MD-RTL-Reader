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
  theme: 'paper', zoomFactor: 1,
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
      writeFile: async () => {
        window.__writes = (window.__writes || 0) + 1;
        return window.__writeResult || { error: 'write-failed' };
      },
      readFile: async () => ({ content: '# On disk', meta: { bom: false, eol: '\n', finalNewline: true, hash: 'disk' } }),
      getSettings: async () => { window.__settingsReads = (window.__settingsReads || 0) + 1; return settings; },
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
    await page.waitForFunction(() => window.__settingsReads >= 2); // theme-boot and the settings restore
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

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

  // MAIN-10: main refuses to overwrite a disk copy it cannot read to check for changes.
  test('a save main refuses as read-failed names the reason', async ({ page }) => {
    await bootWithBridge(page);
    await page.waitForFunction(() => window.__settingsReads >= 2);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => {
      window.__writeResult = { error: 'read-failed' };
      window._appState.files.push({
        name: 'busy.md', path: 'busy.md', handle: null, content: '# Busy',
        dirty: true, documentId: 'cap-busy', vaultId: null,
        meta: { bom: false, eol: '\n', finalNewline: true, hash: 'h' },
        revision: 1, inventory: false, open: true, _editedAt: 0,
      });
      window.renderFile(window._appState.files.length - 1);
    });
    await page.evaluate(() => window.saveCurrent());
    await expect(page.locator('#toast')).toContainText(
      'Could not save busy.md: the copy on disk could not be read to check for changes');
  });

  test('M10: a note with an open conflict banner is not tried again on every tick', async ({ page }) => {
    await bootWithBridge(page);
    await page.waitForFunction(() => window.__settingsReads >= 2);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    await page.evaluate(() => {
      window.__writeResult = { error: 'conflict' };
      window._appState.autosave = true;
      window._appState.files.push({
        name: 'clash.md', path: 'clash.md', handle: null, content: '# Mine',
        dirty: true, documentId: 'cap-clash', vaultId: null,
        meta: { bom: false, eol: '\n', finalNewline: true, hash: 'h' },
        revision: 1, inventory: false, open: true, _editedAt: 0,
      });
      window.renderFile(window._appState.files.length - 1);
    });

    // The first tick finds the conflict and shows the banner.
    await page.evaluate(() => window._autosaveTick());
    expect(await page.evaluate(() => window.__writes)).toBe(1);
    expect(await page.evaluate(() => window._appState.files.at(-1).conflict)).toBe(true);

    // Later ticks leave the note alone: no write, and the rendered note is not rebuilt.
    await page.evaluate(() => { document.querySelector('#noteContent').firstElementChild.dataset.m10 = 'kept'; });
    await page.evaluate(async () => { await window._autosaveTick(); await window._autosaveTick(); });
    expect(await page.evaluate(() => window.__writes)).toBe(1);
    const rendered = await page.evaluate(() => document.querySelector('#noteContent').firstElementChild.dataset.m10);
    expect(rendered).toBe('kept');
  });
});

// APP-24: with no settings bridge, the restore success handler read the theme mirror
// unguarded. A throw there skipped the editor mount and every data-safety loop, which the
// rejection handler (DATA-04) exists to prevent.
test('blocked theme storage with no settings bridge still mounts the editor', async ({ page }) => {
  await page.addInitScript(() => {
    const proto = Object.getPrototypeOf(window.localStorage);
    const get = proto.getItem;
    proto.getItem = function (key) {
      if (key === 'bpmdrtlreader-theme') throw new DOMException('blocked', 'SecurityError');
      return get.call(this, key);
    };
  });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!(window.getActiveCmAdapter && window.getActiveCmAdapter()), null, { timeout: 8000 });
});
