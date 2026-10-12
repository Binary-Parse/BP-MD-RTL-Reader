// @ts-check
/**
 * external-change-baseline.spec.js — defect B6, against the REAL main process and real files.
 *
 * Requirement: a CLEAN open note that another program changes on disk is reloaded silently,
 * and the reloaded text becomes the note's saved baseline. So editing it to anything that
 * differs from the new disk text — including exactly the OLD text — is a real, unsaved edit:
 * Ctrl+S writes it, the auto-save writes it, and closing the window asks first.
 * (The bug: the baseline stayed on the old text, typing the old text back looked clean, nothing
 * was saved, the window closed without a question and the disk kept the other program's text.)
 *
 * No fixed sleeps: every wait is on an observable state of the app or of the disk.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WATCH_TIMEOUT = 15000; // main debounces watcher events (300 ms trailing, 2 s max wait)

test.describe('an external change to a clean note moves its saved baseline @electron', () => {
  let electronApp;
  let page;
  let tempRoot;
  let folder;
  let notePath;

  test.beforeEach(async () => {
    test.setTimeout(90000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-ext-baseline-'));
    folder = path.join(tempRoot, 'Vault');
    fs.mkdirSync(folder);
    notePath = path.join(folder, 'note.md');
    fs.writeFileSync(notePath, 'one', 'utf8');

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
      (name) => Array.from(document.querySelectorAll('.tree-root .tree-name')).some((el) => el.textContent === name),
      path.basename(folder),
    );
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }
    await page.locator('.tree-file', { hasText: 'note.md' }).first().click();
    await expect(page.locator('.tab', { hasText: 'note.md' })).toHaveCount(1);
    await page.waitForFunction(() => window.getActiveCmAdapter() && window.getActiveCmAdapter().getValue() === 'one');
  });

  test.afterEach(async () => {
    if (electronApp) {
      if (page && !page.isClosed()) await page.evaluate(() => window.electronAPI.closeWindow()).catch(() => {});
      await electronApp.close().catch(() => {});
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const state = () => page.evaluate(() => {
    const f = window._appState.files.find((x) => x.path === 'note.md');
    return { content: f.content, savedContent: f.savedContent, dirty: !!f.dirty, conflict: !!f.conflict };
  });
  const setEditorText = (text) => page.evaluate((t) => {
    const cm = window.getActiveCmAdapter();
    cm.setSelection({ start: 0, end: cm.getValue().length });
    cm.replaceSelection(t);
  }, text);
  const disk = () => fs.readFileSync(notePath, 'utf8');

  // Another program writes `two`; wait until the app has silently reloaded it.
  async function externalWriteAndReload(text) {
    fs.writeFileSync(notePath, text, 'utf8');
    await page.waitForFunction(
      (t) => window._appState.files.some((f) => f.path === 'note.md' && f.content === t && !f.conflict)
        && window.getActiveCmAdapter().getValue() === t,
      text,
      { timeout: WATCH_TIMEOUT },
    );
  }

  test('R1 + R2: reload, type the OLD text back, Ctrl+S writes it to disk', async () => {
    await externalWriteAndReload('two');
    expect(await state()).toEqual({ content: 'two', savedContent: 'two', dirty: false, conflict: false });

    await setEditorText('one');
    await page.waitForFunction(() => window._appState.files.find((f) => f.path === 'note.md').dirty === true);
    expect(await state()).toMatchObject({ content: 'one', savedContent: 'two', dirty: true });
    await expect(page.locator('.tab.dirty', { hasText: 'note.md' })).toHaveCount(1);

    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window._appState.files.every((f) => !f.dirty));
    expect(disk()).toBe('one');
    expect(await state()).toMatchObject({ content: 'one', savedContent: 'one', dirty: false });
  });

  test('R2: the real auto-save tick writes the old text back too', async () => {
    await externalWriteAndReload('two');
    await setEditorText('one');
    await page.waitForFunction(() => window._appState.files.find((f) => f.path === 'note.md').dirty === true);
    await page.evaluate(async () => {
      for (const f of window._appState.files) f._editedAt = 0; // idle long enough: no 15 s wait
      await window._autosaveTick();
    });
    await expect.poll(disk).toBe('one');
    await page.waitForFunction(() => window._appState.files.every((f) => !f.dirty));
  });

  test('R2: closing the window asks to save instead of closing silently', async () => {
    await externalWriteAndReload('two');
    await setEditorText('one');
    await page.waitForFunction(() => window._appState.files.find((f) => f.path === 'note.md').dirty === true);

    // The real close request main sends when the window's X is pressed.
    await electronApp.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    await expect(page.locator('#dlgSaveBtn')).toBeVisible({ timeout: 10000 });
    expect(disk()).toBe('two'); // nothing was written behind the prompt
    await page.locator('#dlgCancelBtn').click();
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
    expect(disk()).toBe('two');
    expect(await state()).toMatchObject({ content: 'one', dirty: true }); // the window stayed open with the edit
  });

  test('R3: returning to exactly the new disk text is clean again', async () => {
    await externalWriteAndReload('two');
    await setEditorText('one');
    await page.waitForFunction(() => window._appState.files.find((f) => f.path === 'note.md').dirty === true);
    await setEditorText('two');
    await page.waitForFunction(() => window._appState.files.find((f) => f.path === 'note.md').dirty === false);
    expect(await state()).toEqual({ content: 'two', savedContent: 'two', dirty: false, conflict: false });
    expect(disk()).toBe('two');
  });

  test('R4: a DIRTY note whose file changes on disk keeps the user text, shows the conflict, and a save does not overwrite', async () => {
    await setEditorText('mine');
    await page.waitForFunction(() => window._appState.files.find((f) => f.path === 'note.md').dirty === true);
    fs.writeFileSync(notePath, 'two', 'utf8');
    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: WATCH_TIMEOUT });
    expect(await state()).toEqual({ content: 'mine', savedContent: 'one', dirty: true, conflict: true });
    expect(await page.evaluate(() => window.getActiveCmAdapter().getValue())).toBe('mine');
    expect(disk()).toBe('two');

    await page.keyboard.press('Control+s'); // main still sees the OLD baseHash -> refuses
    await expect(page.locator('.toast', { hasText: 'Could not save' })).toBeVisible({ timeout: 10000 });
    expect(disk()).toBe('two');
    expect(await state()).toMatchObject({ content: 'mine', dirty: true, conflict: true });
  });

  test('R5: "Reload from disk" on a conflict sets content and baseline to the disk text', async () => {
    await setEditorText('mine');
    await page.waitForFunction(() => window._appState.files.find((f) => f.path === 'note.md').dirty === true);
    fs.writeFileSync(notePath, 'two', 'utf8');
    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: WATCH_TIMEOUT });
    await page.locator('#conflictBar .cf-reload').click();
    await page.waitForFunction(() => window.getActiveCmAdapter().getValue() === 'two');
    expect(await state()).toEqual({ content: 'two', savedContent: 'two', dirty: false, conflict: false });

    await setEditorText('one'); // and the B6 consequence: the old text is a real edit now
    await page.waitForFunction(() => window._appState.files.find((f) => f.path === 'note.md').dirty === true);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window._appState.files.every((f) => !f.dirty));
    expect(disk()).toBe('one');
  });
});
