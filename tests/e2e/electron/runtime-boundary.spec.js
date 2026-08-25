const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('real Electron runtime boundary @electron', () => {
  let electronApp;
  let page;
  let tempRoot;
  let profile;
  let notePath;
  let launchElapsed;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-electron-test-'));
    profile = path.join(tempRoot, 'profile');
    notePath = path.join(tempRoot, 'runtime-boundary.md');
    fs.mkdirSync(profile);
    fs.writeFileSync(notePath, '# Runtime boundary\n\nreal preload and IPC', 'utf8');

    const started = Date.now();
    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile, ROOT, notePath],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        ELECTRON_ENABLE_LOGGING: '0',
      },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
    launchElapsed = Date.now() - started;
  });

  test.afterEach(async () => {
    if (electronApp) {
      // Approve the production close handshake first; calling the harness'
      // process close directly would otherwise hit src/main/index.js's native-close
      // interception and wait for the renderer response.
      if (page && !page.isClosed()) {
        await page.evaluate(() => window.electronAPI.closeWindow());
      }
      await electronApp.close();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('creates the production BrowserWindow with an isolated sandboxed preload', async () => {
    const evidence = await electronApp.evaluate(({ app, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const preferences = win.webContents.getLastWebPreferences();
      return {
        userData: app.getPath('userData'),
        contextIsolation: preferences.contextIsolation,
        nodeIntegration: preferences.nodeIntegration,
        sandbox: preferences.sandbox,
      };
    });
    expect(path.resolve(evidence.userData)).toBe(path.resolve(profile));
    expect(evidence).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(await page.evaluate(() => typeof window.process)).toBe('undefined');
    // The production contextBridge global is direct evidence that src/preload/index.js
    // executed; Electron 42 no longer returns its path from this runtime API.
    expect(await page.evaluate(() => typeof window.electronAPI?.getSettings)).toBe('function');
  });

  test('opens a startup Markdown file through real main/preload IPC and persists only in the temp profile', async () => {
    // Optional-chain _appState too, not just .files[0]. The poll runs as soon as the
    // window exists, which can be before app.js has finished evaluating; reading
    // .files off undefined THROWS out of the poll instead of returning a retryable
    // value, which made this test flake on roughly one run in three (reproduced on
    // main, so it predates T-F19 — but this test is extended below, so fix it here).
    await expect.poll(() => page.evaluate(() => window._appState?.files?.[0]?.name)).toBe('runtime-boundary.md');
    await expect(page.locator('.cm-content')).toContainText('real preload and IPC');

    const updated = await page.evaluate(async () => {
      await window.electronAPI.setSettings({ theme: 'ink' });
      return window.electronAPI.getSettings();
    });
    expect(updated.theme).toBe('ink');
    expect(fs.existsSync(path.join(profile, 'settings.json'))).toBe(true);

    // T-F19: the three chrome settings must survive the REAL main-process migrate() and
    // land on disk. migrate() is the only validation layer, so a key it does not know is
    // silently dropped end to end — a unit test on the renderer alone would not see that.
    const chrome = await page.evaluate(async () => {
      await window.electronAPI.setSettings({
        windowTitleMode: 'app', autoHideTitlebar: true, hideStatusBar: true,
      });
      return window.electronAPI.getSettings();
    });
    expect(chrome.windowTitleMode).toBe('app');
    expect(chrome.autoHideTitlebar).toBe(true);
    expect(chrome.hideStatusBar).toBe(true);
    expect(chrome.version).toBe(4);
    const onDisk = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8'));
    expect(onDisk).toMatchObject({
      windowTitleMode: 'app', autoHideTitlebar: true, hideStatusBar: true, version: 4,
    });

    // and a malformed value is rejected rather than stored
    const rejected = await page.evaluate(async () => {
      await window.electronAPI.setSettings({ windowTitleMode: 'bogus', autoHideTitlebar: 'yes' });
      return window.electronAPI.getSettings();
    });
    expect(rejected.windowTitleMode).toBe('file');
    expect(rejected.autoHideTitlebar).toBe(false);
  });
  test('uses the real preload webFrame zoom bridge and leaves renderer fallback scaling cleared', async () => {
    expect(await page.evaluate(() => typeof window.electronAPI?.setAppZoom)).toBe('function');
    const viewportBefore = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    await page.evaluate(() => window.setZoom(1.25));
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(viewportBefore.innerWidth);
    const renderer = await page.evaluate(() => ({
      stateZoom: window._appState.zoomFactor,
      rootFontSize: document.documentElement.style.fontSize,
      editorZoom: document.getElementById('editorArea').style.zoom,
    }));
    const viewportAfter = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    const nativeZoom = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());

    expect(renderer).toEqual({ stateZoom: 1.25, rootFontSize: '', editorZoom: '' });
    expect(viewportAfter.innerWidth).toBeLessThan(viewportBefore.innerWidth);
    expect(viewportAfter.clientWidth).toBeLessThan(viewportBefore.clientWidth);
    expect(viewportAfter.innerWidth / viewportBefore.innerWidth).toBeCloseTo(1 / 1.25, 1);
    expect(nativeZoom).toBeCloseTo(1.25, 3);
  });

  test('production main process flags a symlink that escapes a vault root', async () => {
    const vault = path.join(tempRoot, 'vault');
    const outside = path.join(tempRoot, 'secret.md');
    fs.mkdirSync(vault);
    fs.writeFileSync(outside, 'secret');
    const link = path.join(vault, 'escape.md');
    fs.symlinkSync(outside, link);
    const escaped = await electronApp.evaluate(async ({}, payload) => {
      // Playwright evaluates this function in the main process GLOBAL scope, where
      // CommonJS's module-local `require` binding does not exist (`typeof require` is
      // 'undefined' there). process.mainModule.require does — and it must stay in-process,
      // because the point of this @electron spec is that the PRODUCTION main process
      // exposes the guard. (Node DEP0138 is documentation-only, never scheduled removal.)
      const req = process.mainModule.require;
      const nodePath = req('path');
      const fsSync = req('fs');
      const { isSymlinkEscape } = req(nodePath.join(payload.root, 'src/main/main-logic.js'));
      return isSymlinkEscape(fsSync.realpathSync(payload.link), payload.vault, nodePath);
    }, { root: ROOT, link, vault });
    expect(escaped).toBe(true);
  });

  test('dialog IPC uses the sender-owned window rather than a second focused window', async () => {
    const evidence = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const owned = BrowserWindow.getAllWindows()[0];
      const decoy = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
      const fromSender = BrowserWindow.fromWebContents(owned.webContents);
      const focused = BrowserWindow.getFocusedWindow();
      decoy.destroy();
      return {
        ownedId: owned.id,
        fromSenderId: fromSender && fromSender.id,
        focusedId: focused && focused.id,
      };
    });
    expect(evidence.fromSenderId).toBe(evidence.ownedId);
  });
});
