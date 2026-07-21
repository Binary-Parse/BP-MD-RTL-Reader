const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

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
      // process close directly would otherwise hit main.js's native-close
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
    // The production contextBridge global is direct evidence that preload.js
    // executed; Electron 42 no longer returns its path from this runtime API.
    expect(await page.evaluate(() => typeof window.electronAPI?.getSettings)).toBe('function');
  });

  test('opens a startup Markdown file through real main/preload IPC and persists only in the temp profile', async () => {
    await expect.poll(() => page.evaluate(() => window._appState.files[0]?.name)).toBe('runtime-boundary.md');
    await expect(page.locator('.cm-content')).toContainText('real preload and IPC');

    const updated = await page.evaluate(async () => {
      await window.electronAPI.setSettings({ theme: 'ink' });
      return window.electronAPI.getSettings();
    });
    expect(updated.theme).toBe('ink');
    expect(fs.existsSync(path.join(profile, 'settings.json'))).toBe(true);
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


  test('reaches a visible composed desktop window within the startup budget', () => {
    expect(launchElapsed, 'Electron startup to visible #app').toBeLessThan(8_000);
  });
});
