const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// H13 / H14 in the REAL Electron runtime on this machine (win32). The macOS and Linux
// halves cannot run here; they are covered by unit tests and labelled UNVERIFIED.
test.describe('platform launch behaviour @electron', () => {
  let electronApp;
  let page;
  let tempRoot;

  async function launch(extraArgs) {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-platform-'));
    const profile = path.join(tempRoot, 'profile');
    fs.mkdirSync(profile);
    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile, ROOT, ...extraArgs(tempRoot)],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
  }

  test.afterEach(async () => {
    if (electronApp) {
      if (page && !page.isClosed()) await page.evaluate(() => window.electronAPI.closeWindow());
      await electronApp.close();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('H14: a file:// URL argument (what a Linux "Open with" passes) opens that note', async () => {
    await launch((root) => {
      const note = path.join(root, 'with space.md');
      fs.writeFileSync(note, '# From a URL\n\nopened by file URL', 'utf8');
      return [pathToFileURL(note).href];
    });
    await expect.poll(() => page.evaluate(() => window._appState?.files?.[0]?.name)).toBe('with space.md');
    await expect(page.locator('.cm-content')).toContainText('opened by file URL');
  });

  test('H14: a file:// URL with a remote host is not opened', async () => {
    await launch(() => ['file://server/share/remote.md']);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window._appState?.files || []).map((f) => f.name))).not.toContain('remote.md');
  });

  test('H13: the preload marks the document with the host platform and win32 keeps its own window buttons', async () => {
    await launch(() => []);
    await expect.poll(() => page.evaluate((p) => document.documentElement.classList.contains('platform-' + p), process.platform)).toBe(true);
    if (process.platform === 'win32') {
      await expect(page.locator('.win-controls')).toBeVisible();
      const frame = await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        return { frameless: win.getBounds().width === win.getContentBounds().width };
      });
      expect(frame.frameless).toBe(true);
    }
  });
});
