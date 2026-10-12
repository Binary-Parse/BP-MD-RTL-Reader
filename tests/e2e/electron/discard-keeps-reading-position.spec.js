// @ts-check
/**
 * discard-keeps-reading-position.spec.js — B2 follow-up, against the REAL main process.
 *
 * Choosing "Close without Saving" at window close discards the dirty notes' edits, but it must not
 * disturb anything else the quit persists. In particular the reading position of the note that is
 * open in Reading mode: the position saved on quit is the same whether or not dirty notes were
 * discarded. (The bug: the discard re-rendered the active note, which reset its scroll to the top,
 * and the quit then recorded ratio 0 over the real position.)
 *
 * No fixed sleeps: every wait is on an observable state of the app or of the profile on disk.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const LONG = `# Long\n\n${Array.from({ length: 150 }, (_, i) => `Paragraph ${i} of the long note.`).join('\n\n')}\n`;

test.describe('"Close without Saving" keeps the reading position @electron', () => {
  let electronApp;
  let page;
  let tempRoot;

  test.beforeEach(() => {
    test.setTimeout(90000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-discard-pos-'));
  });

  test.afterEach(async () => {
    if (electronApp) {
      if (page && !page.isClosed()) await page.evaluate(() => window.electronAPI.closeWindow()).catch(() => {});
      await electronApp.close().catch(() => {});
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const profile = () => path.join(tempRoot, 'profile');

  async function launchAndOpenFolder(folder) {
    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile(), ROOT],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.openVault === 'function');
    await electronApp.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, folder);
    await page.evaluate(() => window.openVault());
    await page.waitForFunction(
      (name) => Array.from(document.querySelectorAll('.tree-root .tree-name')).some((el) => el.textContent === name),
      path.basename(folder),
    );
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }
  }

  const paneRatio = () => page.evaluate(() => {
    const el = document.querySelector('.preview-pane');
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? el.scrollTop / max : null;
  });

  // The position of long.md in the profile's settings.json (shelf entry), or null.
  const persistedRatio = () => {
    try {
      const settings = JSON.parse(fs.readFileSync(path.join(profile(), 'settings.json'), 'utf8'));
      const entry = (settings.readingProgress || []).find((e) => e && e.path === 'long.md');
      return entry ? entry.ratio : null;
    } catch { return null; }
  };

  // Open long.md in Reading mode, scroll it to about 90 %, dirty b.md, then do the real window
  // close and answer the dialog with `buttonId`. Returns the in-page ratio just before the close.
  async function scrollLongAndCloseWindow(buttonId) {
    await page.locator('.tree-file', { hasText: 'b.md' }).first().click();
    await page.waitForFunction(() => window.getActiveCmAdapter() && window._appState.files[window._appState.activeFile].name === 'b.md');
    await page.evaluate(() => {
      const cm = window.getActiveCmAdapter();
      const end = cm.getValue().length;
      cm.setSelection({ start: end, end });
      cm.replaceSelection(' dirty');
    });
    await page.waitForFunction(() => window._appState.files.find((f) => f.name === 'b.md').dirty === true);

    await page.locator('.tree-file', { hasText: 'long.md' }).first().click();
    await page.waitForFunction(() => window._appState.files[window._appState.activeFile].name === 'long.md');
    await page.evaluate(() => window.setViewMode('reading'));
    await page.waitForFunction(() => {
      const el = document.querySelector('.preview-pane');
      return el && el.scrollHeight - el.clientHeight > 1000;
    });
    await page.evaluate(() => {
      const el = document.querySelector('.preview-pane');
      el.scrollTop = Math.round(0.9 * (el.scrollHeight - el.clientHeight));
    });
    await expect.poll(paneRatio).toBeGreaterThan(0.85);
    const before = await paneRatio();

    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await expect(page.locator(buttonId)).toBeVisible({ timeout: 10000 });
    await page.locator(buttonId).click();
    return before;
  }

  test('the reading position saved on quit is the scrolled one, with dirty notes discarded', async () => {
    const folder = path.join(tempRoot, 'Vault');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'long.md'), LONG, 'utf8');
    fs.writeFileSync(path.join(folder, 'b.md'), 'B', 'utf8');
    await launchAndOpenFolder(folder);

    const before = await scrollLongAndCloseWindow('#dlgDontSaveBtn');
    // the answer closes the window and the app quits: wait for the process, then read the profile
    const proc = electronApp.process();
    if (proc.exitCode === null) await new Promise((resolve) => proc.once('exit', resolve));
    expect(persistedRatio()).not.toBeNull();
    // the window closed on its own after the answer: nothing else is written to the notes
    expect(fs.readFileSync(path.join(folder, 'b.md'), 'utf8')).toBe('B');
    expect(Math.abs(persistedRatio() - before)).toBeLessThan(0.02);
    expect(persistedRatio()).toBeGreaterThan(0.85);
  });
});
