// @ts-check
/**
 * m6-session-restore.spec.js — T-B5/M6 session-restore WIRING (not just the pure helpers).
 * Boots the renderer with a mocked electronAPI bridge so restoreLastSession + the
 * persistSettings(lastSession) round-trip are actually exercised, and guards the
 * vault-capability staleness regression: loadDemo must NOT persist a vault ID paired with
 * demo files.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = `file:///${path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/')}`;

const DEFAULTS = {
  theme: 'paper', zoomFactor: 1, editorMode: 'live',
  sidebarVisible: true, inspectorVisible: true,
  uiDirection: 'ltr', uiLocale: 'en', numerals: 'western',
  calendar: 'gregorian', arabicKashida: false, italicRecolor: true,
  recents: [], window: { w: 1280, h: 820, maximized: false }, lastSession: null,
};

async function bootWithBridge(page, { settings = DEFAULTS, vaults = {} } = {}) {
  await page.addInitScript(({ settings, vaults }) => {
    window.__writes = [];
    window.__vaults = vaults;
    window.__nextFolder = { canceled: true };
    const noop = () => {};
    window.electronAPI = {
      closeWindow: noop, minimizeWindow: noop, maximizeWindow: noop,
      openFolder: async () => window.__nextFolder,
      readVault: async (id) => window.__vaults[id] || { error: 'unauthorized-capability' },
      writeFile: async () => ({ ok: true }),
      getSettings: async () => settings,
      setSettings: async (patch) => { window.__writes.push(patch); return { ok: true }; },
      exportPDF: async () => ({ ok: true }),
      editCommand: noop, onOpenFile: noop, onVaultChanged: noop,
      checkForUpdate: async () => ({}), logError: noop,
    };
  }, { settings, vaults });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app', { state: 'visible' });
}

test.describe('[M6] session restore wiring', () => {
  test('restoreLastSession re-reads the saved vault and re-opens the active note on launch', async ({ page }) => {
    await bootWithBridge(page, {
      settings: { ...DEFAULTS, lastSession: { vaultId: 'cap-v', openPaths: ['a.md', 'sub/b.md'], activePath: 'sub/b.md' } },
      vaults: { 'cap-v': { vault: { id: 'cap-v', name: 'V', generation: 1 }, entries: [
        { name: 'a.md', relPath: 'a.md', documentId: 'cap-a', content: '# A' },
        { name: 'b.md', relPath: 'sub/b.md', documentId: 'cap-b', content: '# B heading' },
      ] } },
    });
    // restore is async (readVault) — wait for State.files to populate
    await page.waitForFunction(() => window._appState?.files?.length === 2);
    const r = await page.evaluate(() => ({
      count: window._appState.files.length,
      active: window._appState.activeFile,
      activePath: window._appState.files[window._appState.activeFile]?.path,
      vaultName: window._appState.vaultName,
    }));
    expect(r.count).toBe(2);
    expect(r.activePath).toBe('sub/b.md');   // pickActiveIndex found the saved active note
    expect(r.active).toBe(1);
  });

  test('no lastSession → nothing is restored (stays on welcome)', async ({ page }) => {
    await bootWithBridge(page, { settings: { ...DEFAULTS, lastSession: null } });
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
  });

  test('loadDemo clears the vault session — no conflated {realVault + demoPaths} is persisted (regression)', async ({ page }) => {
    await bootWithBridge(page, {
      vaults: { 'cap-real': { vault: { id: 'cap-real', name: 'RealVault', generation: 1 }, entries: [
        { name: 'note.md', relPath: 'note.md', documentId: 'cap-note', content: '# real note' },
      ] } },
    });
    const r = await page.evaluate(async () => {
      // 1) open a real Electron vault → its session should persist
      window.__nextFolder = { canceled: false, vault: { id: 'cap-real', name: 'RealVault', generation: 1 } };
      await window.openVault();
      await new Promise((res) => setTimeout(res, 260)); // flush the debounced persist
      const w1 = window.__writes.length;
      const afterVault = window.__writes[w1 - 1]?.lastSession;
      // 2) load the ephemeral demo notes → the stale vault path must NOT be paired with demo files
      window.loadDemo();
      await new Promise((res) => setTimeout(res, 260));
      const w2 = window.__writes.length;
      const afterDemo = window.__writes[w2 - 1]?.lastSession;
      return { w1, w2, afterVault, afterDemo };
    });
    expect(r.w1).toBeGreaterThan(0);                      // the vault open did persist
    // B2: lastSession moved to { vaults: [{vaultId,...}], activeVaultId } — no top-level vaultId.
    expect(r.afterVault?.activeVaultId).toBe('cap-real');  // …with the opaque vault session
    expect(r.afterVault?.vaults).toEqual([{ vaultId: 'cap-real', openPaths: ['note.md'] }]);
    expect(r.w2).toBeGreaterThan(r.w1);                   // loadDemo triggered a fresh persist
    expect(r.afterDemo).toBe(null);                       // …that CLEARED the session (no '/RealVault' + demo paths)
  });
});
