// @ts-check
/**
 * recents-open.spec.js — clicking a recent file on the welcome screen must OPEN it.
 *
 * Regression for the reported bug: "app shows recent files but clicking does nothing".
 * Root cause was twofold — the click handler only navigated to ALREADY-loaded files,
 * and single-file recents never stored enough info (absolute path) to be reopened.
 * These boot the renderer with a mocked electronAPI (the new openFile/readFile bridges
 * included) and click the real .recent-item element.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = `file:///${path.resolve(__dirname, '../index.html').replace(/\\/g, '/')}`;

const DEFAULTS = {
  theme: 'paper', zoomFactor: 1, editorMode: 'live',
  sidebarVisible: true, inspectorVisible: true,
  uiDirection: 'ltr', uiLocale: 'en', numerals: 'western',
  calendar: 'gregorian', arabicKashida: false, italicRecolor: true,
  recents: [], window: { w: 1280, h: 820, maximized: false }, lastSession: null,
};

async function bootWithBridge(page, { settings = DEFAULTS, vaults = {}, files = {} } = {}) {
  await page.addInitScript(({ settings, vaults, files }) => {
    window.__vaults = vaults;        // vaultRoot -> readVault entries
    window.__files = files;          // abs path  -> readFile result
    window.__readVaultCalls = 0;
    window.__readFileCalls = 0;
    const noop = () => {};
    window.electronAPI = {
      closeWindow: noop, minimizeWindow: noop, maximizeWindow: noop,
      openFolder: async () => ({ canceled: true }),
      readVault: async (p) => { window.__readVaultCalls++; return window.__vaults[p] || []; },
      openFile: async () => ({ canceled: true }),
      readFile: async (p) => { window.__readFileCalls++; return window.__files[p] || { error: 'unauthorized-path' }; },
      writeFile: async () => ({ ok: true }),
      getSettings: async () => settings,
      setSettings: async () => ({ ok: true }),
      exportPDF: async () => ({ ok: true }),
      editCommand: noop, onOpenFile: noop, onVaultChanged: noop,
      checkForUpdate: async () => ({}), logError: noop,
    };
  }, { settings, vaults, files });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app', { state: 'visible' });
  // recents render during restoreSettings; wait for the list to paint. Use 'attached'
  // (not 'visible') because a restored session opens a file and hides the welcome screen.
  await page.waitForSelector('.recent-item', { state: 'attached' });
}

test.describe('clicking a recent file opens it', () => {
  test('single-file recent (abs) → reads the file by absolute path and opens it', async ({ page }) => {
    // The exact shape of the reported bug: a recent opened as a single file (no vault).
    await bootWithBridge(page, {
      settings: { ...DEFAULTS, recents: [
        { name: 'note.md', path: 'C:/docs/note.md', vaultRoot: null, abs: 'C:/docs/note.md' },
      ] },
      files: { 'C:/docs/note.md': { name: 'note.md', path: 'C:/docs/note.md', content: '# Note body\n\nhi' } },
    });
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0); // nothing loaded yet
    await page.click('.recent-item');
    await page.waitForFunction(() => window._appState.files.length === 1);
    const r = await page.evaluate(() => ({
      active: window._appState.activeFile,
      activePath: window._appState.files[window._appState.activeFile]?.path,
      readFileCalls: window.__readFileCalls,
      welcomeHidden: document.getElementById('welcome').style.display === 'none',
      editorAreaWelcome: document.querySelector('.editor-area').classList.contains('welcome'),
    }));
    expect(r.readFileCalls).toBe(1);          // reopened via fs:readFile
    expect(r.activePath).toBe('C:/docs/note.md');
    expect(r.active).toBe(0);
    expect(r.welcomeHidden).toBe(true);       // welcome screen dismissed → file is visible
    expect(r.editorAreaWelcome).toBe(false);
  });

  test('vault recent (vaultRoot) → re-opens the vault from disk and selects the note', async ({ page }) => {
    await bootWithBridge(page, {
      settings: { ...DEFAULTS, recents: [
        { name: 'b.md', path: 'b.md', vaultRoot: '/V', abs: null },
      ] },
      vaults: { '/V': [
        { name: 'a.md', relPath: 'a.md', content: '# A' },
        { name: 'b.md', relPath: 'b.md', content: '# B' },
      ] },
    });
    await page.click('.recent-item');
    await page.waitForFunction(() => window._appState.files.length === 2);
    const r = await page.evaluate(() => ({
      activePath: window._appState.files[window._appState.activeFile]?.path,
      vaultName: window._appState.vaultName,
      readVaultCalls: window.__readVaultCalls,
    }));
    expect(r.readVaultCalls).toBe(1);
    expect(r.activePath).toBe('b.md');        // selected the clicked note, not just index 0
    expect(r.vaultName).toBe('V');
  });

  test('already-loaded recent → fast path navigates without re-reading disk', async ({ page }) => {
    // When a session is restored the file is already open and the welcome screen (with the
    // recents list) is hidden, so this branch is driven via openRecent() directly rather
    // than a click. It guards that an in-memory recent navigates without touching disk.
    await bootWithBridge(page, {
      settings: { ...DEFAULTS,
        lastSession: { vaultPath: '/V', openPaths: ['a.md', 'b.md'], activePath: 'a.md' },
        recents: [{ name: 'b.md', path: 'b.md', vaultRoot: '/V', abs: null }],
      },
      vaults: { '/V': [
        { name: 'a.md', relPath: 'a.md', content: '# A' },
        { name: 'b.md', relPath: 'b.md', content: '# B' },
      ] },
    });
    await page.waitForFunction(() => window._appState.files.length === 2); // restored
    const before = await page.evaluate(() => window.__readVaultCalls);
    // restore renders the active note (a.md), so pushRecent prepended it — target b.md by path.
    await page.evaluate(() => window.openRecent(window._appState.recents.find(r => r.path === 'b.md')));
    await page.waitForFunction(() => window._appState.files[window._appState.activeFile]?.path === 'b.md');
    const after = await page.evaluate(() => window.__readVaultCalls);
    expect(after).toBe(before);               // no extra readVault — navigated in place
  });

  test('legacy recent (no abs/vaultRoot) → cannot reopen, shows an instructive toast', async ({ page }) => {
    await bootWithBridge(page, {
      settings: { ...DEFAULTS, recents: [{ name: 'old.md', path: 'old.md' }] },
    });
    await page.click('.recent-item');
    await page.waitForFunction(() => document.getElementById('toast').classList.contains('show'));
    const r = await page.evaluate(() => ({
      filesLen: window._appState.files.length,
      toast: document.getElementById('toast').textContent,
      isInfo: document.getElementById('toast').classList.contains('info'),
    }));
    expect(r.filesLen).toBe(0);               // nothing opened (no data to reopen from)
    expect(r.isInfo).toBe(true);
    expect(r.toast).toContain('older version');
  });
});
