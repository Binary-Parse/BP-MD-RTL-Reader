// @ts-check
/**
 * undo-history.spec.js — audit B1 against the REAL main process: the on-disk consequence.
 *
 * The CodeMirror undo history used to be shared between files, and loading a file was itself
 * undoable. Ctrl+Z after a tab switch put a.md's text into b.md; the autosave tick then wrote
 * it to b.md on disk. The editor-level rules are proven in tests/e2e/undo-history-per-file.spec.js;
 * this proves nothing reaches the disk.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const { closeApp } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('undo history never leaks across files to disk @electron', () => {
  let electronApp;
  let page;
  let tempRoot;

  test.beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-undo-history-'));
  });

  test.afterEach(async () => {
    await closeApp(electronApp, page);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('Ctrl+Z after a tab switch leaves b.md on disk as BBB after the autosave tick', async () => {
    const folder = path.join(tempRoot, 'Vault');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'a.md'), 'AAA', 'utf8');
    fs.writeFileSync(path.join(folder, 'b.md'), 'BBB', 'utf8');
    electronApp = await electron.launch({
      args: ['--user-data-dir=' + path.join(tempRoot, 'profile'), ROOT],
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
      () => Array.from(document.querySelectorAll('.tree-root .tree-name')).some((el) => el.textContent === 'Vault'),
    );
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }

    // open a.md, type " more" at the end
    await page.locator('.tree-file', { hasText: 'a.md' }).first().click();
    await expect(page.locator('.tab', { hasText: 'a.md' })).toHaveCount(1);
    await page.waitForFunction(() => window.getActiveCmAdapter() && window.getActiveCmAdapter().getValue() === 'AAA');
    await page.evaluate(() => {
      window.setViewMode('edit');
      const ad = window.getActiveCmAdapter();
      ad.focus();
      ad.setSelection({ start: 3, end: 3 });
    });
    await page.keyboard.type(' more');
    expect(await page.evaluate(() => window.getActiveCmAdapter().getValue())).toBe('AAA more');

    // switch to b.md and press Ctrl+Z once with nothing typed there
    await page.locator('.tree-file', { hasText: 'b.md' }).first().click();
    await page.waitForFunction(() => window.getActiveCmAdapter().getValue() === 'BBB');
    await page.evaluate(() => window.getActiveCmAdapter().focus());
    await page.keyboard.press('Control+z');
    expect(await page.evaluate(() => window.getActiveCmAdapter().getValue())).toBe('BBB');

    // Fast-forward the idle clock instead of waiting out the 15 s autosave delay: every file
    // looks idle, then the real autosave tick runs against the real main process.
    await page.evaluate(async () => {
      for (const f of window._appState.files) f._editedAt = 0;
      await window._autosaveTick();
    });

    // a.md's own edit is autosaved (proves the tick really wrote); b.md must be untouched.
    await expect.poll(() => fs.readFileSync(path.join(folder, 'a.md'), 'utf8')).toBe('AAA more');
    expect(fs.readFileSync(path.join(folder, 'b.md'), 'utf8')).toBe('BBB');
    expect(await page.evaluate(() => window._appState.files.find((f) => f.name === 'b.md').dirty)).toBeFalsy();
  });
});
