// @ts-check
/**
 * discard-folder-note.spec.js — defect B2, against the REAL main process and real files.
 *
 * Requirement: choosing "Don't Save" for a note opened from a FOLDER throws its edit away for good.
 * The tab goes, and the note that stays in the folder's file list holds exactly its last saved
 * text and is clean. (The bug: the tab closed but the file object stayed dirty with the discarded
 * text, and ~24 s later the auto-save wrote it to disk: `ORIGINAL` became
 * `ORIGINAL\nDISCARDED-EDIT\n` after the user had refused to save.)
 *
 *   R1  after Don't Save the note is clean at its saved text: no dirty tab, no dirty file, the
 *       dirty count reported to the main process is 0;
 *   R2  nothing is written afterwards: the file is byte-identical after the autosave tick and
 *       after the real autosave timer fired;
 *   R3  reopening the note shows the saved text, and Ctrl+Z does not bring the edit back;
 *   R4  the crash-recovery snapshot no longer contains the discarded text;
 *   R5  Save still writes and closes, Cancel / Esc keep the tab open with the edit intact;
 *   R6  closing the window with several dirty notes and choosing "Close without Saving" leaves
 *       them all clean and writes none of them;
 *   R7  a never-saved Untitled note that is discarded leaves no ghost file in the list.
 *
 * No fixed sleeps: every wait is on an observable state of the app, the disk or the main process.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const { closeApp } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ORIGINAL = 'ORIGINAL';
const EDIT = '\nDISCARDED-EDIT\n';
const CONTROL_ORIGINAL = 'CONTROL';
const POLL = { timeout: 20000 };

test.describe('"Don\'t Save" on a folder note really discards it @electron', () => {
  let electronApp;
  let page;
  let tempRoot;
  let folder;
  let profile;
  let notePath;
  let controlPath;

  test.beforeEach(async () => {
    test.setTimeout(120000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-discard-'));
    folder = path.join(tempRoot, 'Vault');
    profile = path.join(tempRoot, 'profile');
    fs.mkdirSync(folder);
    notePath = path.join(folder, 'note.md');
    controlPath = path.join(folder, 'zz-control.md');
    fs.writeFileSync(notePath, ORIGINAL, 'utf8');
    fs.writeFileSync(controlPath, CONTROL_ORIGINAL, 'utf8');

    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile, ROOT],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.openVault === 'function');
    // Record every dirty count the renderer reports to the main process.
    await electronApp.evaluate(({ ipcMain }) => {
      globalThis.__dirtyReports = [];
      ipcMain.on('doc:dirty-state', (_event, count) => { globalThis.__dirtyReports.push(count); });
    });
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
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && globalThis.__veto) win.removeListener('close', globalThis.__veto);
      }).catch(() => {});
    }
    await closeApp(electronApp, page);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const readBytes = (p) => fs.readFileSync(p);
  const fileState = (name) => page.evaluate((n) => {
    const f = window._appState.files.find((x) => x.name === n);
    return f ? { content: f.content, savedContent: f.savedContent, dirty: !!f.dirty, open: f.open !== false } : null;
  }, name);
  const dirtyReports = () => electronApp.evaluate(() => globalThis.__dirtyReports.slice());

  async function openNote(name) {
    await page.locator('.tree-file', { hasText: name }).first().click();
    await expect(page.locator('.tab', { hasText: name })).toHaveCount(1);
    await page.waitForFunction((n) => {
      const f = window._appState.files[window._appState.activeFile];
      return f && f.name === n && window.getActiveCmAdapter() && window.getActiveCmAdapter().getValue() === f.content;
    }, name);
  }
  // Type `text` at the end of the open note through the real editor and wait for the dirty flag.
  async function typeAtEnd(name, text) {
    await page.evaluate((t) => {
      const cm = window.getActiveCmAdapter();
      const end = cm.getValue().length;
      cm.setSelection({ start: end, end });
      cm.replaceSelection(t);
    }, text);
    await page.waitForFunction((n) => window._appState.files.find((f) => f.name === n).dirty === true, name);
  }
  const closeTabOf = (name) => page.locator('.tab', { hasText: name }).locator('.close').click();
  async function chooseInDialog(buttonId) {
    await expect(page.locator(buttonId)).toBeVisible({ timeout: 10000 });
    await page.locator(buttonId).click();
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
  }
  // Every file is old enough for the autosave, then the real tick runs.
  const ageAndTick = () => page.evaluate(async () => {
    for (const f of window._appState.files) f._editedAt = 0;
    await window._autosaveTick();
  });

  // The reproduction: open, edit, close the tab, Don't Save.
  async function discardNoteEdit() {
    await openNote('note.md');
    await typeAtEnd('note.md', EDIT);
    await closeTabOf('note.md');
    await chooseInDialog('#dlgDontSaveBtn');
    await expect(page.locator('.tab', { hasText: 'note.md' })).toHaveCount(0);
  }

  test('R1 + R2: the discarded note is clean at its saved text and the disk stays byte-identical', async () => {
    const before = readBytes(notePath);
    await discardNoteEdit();

    expect(await fileState('note.md')).toEqual({ content: ORIGINAL, savedContent: ORIGINAL, dirty: false, open: false });
    await expect(page.locator('.tab.dirty')).toHaveCount(0);
    await expect(page.locator('.tab .close', { hasText: '●' })).toHaveCount(0);
    expect(await page.evaluate(() => window._appState.files.filter((f) => f.dirty).length)).toBe(0);
    expect(await page.title()).not.toContain('•');
    await expect.poll(async () => (await dirtyReports()).at(-1)).toBe(0);

    await ageAndTick();
    expect(readBytes(notePath).equals(before)).toBe(true);
    expect(readBytes(notePath).toString('utf8')).toBe(ORIGINAL);
  });

  test('R2: the REAL autosave timer never writes the discarded edit (a due control note proves it ran)', async () => {
    const before = readBytes(notePath);
    await openNote('zz-control.md');
    await typeAtEnd('zz-control.md', ' control-edit');
    await discardNoteEdit();
    // The control sorts after note.md, so one autosave pass writes note.md first if it is going to.
    const order = await page.evaluate(() => window._appState.files.map((f) => f.name));
    expect(order.indexOf('note.md')).toBeLessThan(order.indexOf('zz-control.md'));
    // Age every file so the next timer tick (<= 5 s) finds them due; no direct tick call here.
    await page.evaluate(() => { for (const f of window._appState.files) f._editedAt = 0; });
    await expect.poll(() => fs.readFileSync(controlPath, 'utf8'), POLL).toBe(CONTROL_ORIGINAL + ' control-edit');
    expect(readBytes(notePath).equals(before)).toBe(true);
  });

  test('R3: reopening shows the saved text and Ctrl+Z cannot bring the edit back', async () => {
    const before = readBytes(notePath);
    await discardNoteEdit();

    await openNote('note.md');
    expect(await page.evaluate(() => window.getActiveCmAdapter().getValue())).toBe(ORIGINAL);
    expect(await fileState('note.md')).toMatchObject({ content: ORIGINAL, dirty: false });

    await page.evaluate(() => { window.setViewMode('edit'); window.getActiveCmAdapter().focus(); });
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');
    expect(await page.evaluate(() => window.getActiveCmAdapter().getValue())).toBe(ORIGINAL);
    expect(await fileState('note.md')).toMatchObject({ content: ORIGINAL, dirty: false });
    await ageAndTick();
    expect(readBytes(notePath).equals(before)).toBe(true);
  });

  test('R4: the crash-recovery snapshot stops carrying the discarded text', async () => {
    const snapshot = path.join(profile, 'recovery', 'snapshot.json');
    const snapshotText = () => { try { return fs.readFileSync(snapshot, 'utf8'); } catch { return ''; } };
    // Autosave off: it would write the stale edit and make the note clean by itself, hiding
    // whether the discard alone clears the snapshot.
    await page.evaluate(() => { window._appState.autosave = false; });
    await openNote('note.md');
    await typeAtEnd('note.md', EDIT);
    // positive control: the real recovery loop (10 s) mirrors the dirty note
    await expect.poll(snapshotText, { timeout: 30000 }).toContain('DISCARDED-EDIT');
    await closeTabOf('note.md');
    await chooseInDialog('#dlgDontSaveBtn');
    await expect.poll(snapshotText, { timeout: 30000 }).not.toContain('DISCARDED-EDIT');
  });

  test('R5: Save writes the edit and closes the tab', async () => {
    await openNote('note.md');
    await typeAtEnd('note.md', EDIT);
    await closeTabOf('note.md');
    await chooseInDialog('#dlgSaveBtn');
    await expect(page.locator('.tab', { hasText: 'note.md' })).toHaveCount(0);
    expect(fs.readFileSync(notePath, 'utf8')).toBe(ORIGINAL + EDIT);
    expect(await fileState('note.md')).toMatchObject({ content: ORIGINAL + EDIT, savedContent: ORIGINAL + EDIT, dirty: false });
  });

  test('R5: Cancel and Esc keep the tab open, dirty, with the edit intact', async () => {
    const before = readBytes(notePath);
    await openNote('note.md');
    await typeAtEnd('note.md', EDIT);

    await closeTabOf('note.md');
    await chooseInDialog('#dlgCancelBtn');
    await expect(page.locator('.tab.dirty', { hasText: 'note.md' })).toHaveCount(1);
    expect(await fileState('note.md')).toMatchObject({ content: ORIGINAL + EDIT, savedContent: ORIGINAL, dirty: true });

    await closeTabOf('note.md');
    await expect(page.locator('#dlgCancelBtn')).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
    await expect(page.locator('.tab.dirty', { hasText: 'note.md' })).toHaveCount(1);
    expect(await page.evaluate(() => window.getActiveCmAdapter().getValue())).toBe(ORIGINAL + EDIT);
    expect(await fileState('note.md')).toMatchObject({ content: ORIGINAL + EDIT, dirty: true });
    expect(readBytes(notePath).equals(before)).toBe(true);
  });

  test('R6: closing the window with dirty folder notes and "Close without Saving" writes none of them', async () => {
    const beforeNote = readBytes(notePath);
    const beforeControl = readBytes(controlPath);
    await openNote('note.md');
    await typeAtEnd('note.md', EDIT);
    await openNote('zz-control.md');
    await typeAtEnd('zz-control.md', ' control-edit');

    // Keep the window alive after the sanctioned close so the state after the choice can be read.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      globalThis.__veto = (event) => event.preventDefault();
      win.on('close', globalThis.__veto);
      win.close(); // the real close request main sends for the window's X
    });
    await chooseInDialog('#dlgDontSaveBtn');
    await page.waitForFunction(() => window._appState.files.every((f) => !f.dirty));

    expect(await fileState('note.md')).toMatchObject({ content: ORIGINAL, savedContent: ORIGINAL, dirty: false });
    expect(await fileState('zz-control.md')).toMatchObject({ content: CONTROL_ORIGINAL, dirty: false });
    await ageAndTick();
    expect(readBytes(notePath).equals(beforeNote)).toBe(true);
    expect(readBytes(controlPath).equals(beforeControl)).toBe(true);

    // R3 for the window-close discard, in a session that stays open: a note that was in the
    // background and the note that was active both come back with their saved text, and neither
    // Ctrl+Z nor Ctrl+Shift+Z brings an edit back.
    for (const [name, saved] of [['note.md', ORIGINAL], ['zz-control.md', CONTROL_ORIGINAL], ['note.md', ORIGINAL]]) {
      await page.locator('.tab', { hasText: name }).click();
      await page.waitForFunction(
        (n) => window._appState.files[window._appState.activeFile].name === n,
        name,
      );
      await page.evaluate(() => { window.setViewMode('edit'); window.getActiveCmAdapter().focus(); });
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Control+Shift+z');
      expect(await page.evaluate(() => window.getActiveCmAdapter().getValue())).toBe(saved);
      expect(await fileState(name)).toMatchObject({ content: saved, dirty: false });
    }
    await ageAndTick();
    expect(readBytes(notePath).equals(beforeNote)).toBe(true);
    expect(readBytes(controlPath).equals(beforeControl)).toBe(true);
  });

  test('a pending disk conflict: Don\'t Save leaves the note clean on the other program\'s text, conflict cleared', async () => {
    await openNote('note.md');
    await typeAtEnd('note.md', EDIT);
    fs.writeFileSync(notePath, 'EXTERNAL', 'utf8'); // another program changes the file
    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: 15000 });
    expect(await page.evaluate(() => window._appState.files.find((f) => f.name === 'note.md').conflict)).toBe(true);

    await closeTabOf('note.md');
    await chooseInDialog('#dlgDontSaveBtn');
    await expect(page.locator('.tab', { hasText: 'note.md' })).toHaveCount(0);
    expect(await page.evaluate(() => {
      const f = window._appState.files.find((x) => x.name === 'note.md');
      return { content: f.content, savedContent: f.savedContent, dirty: !!f.dirty, conflict: !!f.conflict, diskContent: f.diskContent };
    })).toEqual({ content: 'EXTERNAL', savedContent: 'EXTERNAL', dirty: false, conflict: false, diskContent: null });
    await expect(page.locator('.tab.conflict')).toHaveCount(0);

    await ageAndTick();
    expect(fs.readFileSync(notePath, 'utf8')).toBe('EXTERNAL');
    await openNote('note.md');
    expect(await page.evaluate(() => window.getActiveCmAdapter().getValue())).toBe('EXTERNAL');
    await expect(page.locator('.conflict-banner')).toHaveCount(0);
    expect(fs.readFileSync(notePath, 'utf8')).toBe('EXTERNAL');
  });

  test('R7: a never-saved Untitled note that is discarded leaves no ghost file', async () => {
    await page.evaluate(() => window.newNote());
    await page.waitForFunction(() => window._appState.files.some((f) => /^Untitled/.test(f.name)));
    const name = await page.evaluate(() => window._appState.files.find((f) => /^Untitled/.test(f.name)).name);
    await page.evaluate(() => window.getActiveCmAdapter().replaceSelection('never saved'));
    await page.waitForFunction((n) => window._appState.files.find((f) => f.name === n).dirty === true, name);
    await closeTabOf(name);
    await chooseInDialog('#dlgDontSaveBtn');
    await expect(page.locator('.tab', { hasText: name })).toHaveCount(0);
    expect(await fileState(name)).toBeNull();
    await expect(page.locator('.tree-file', { hasText: name })).toHaveCount(0);
  });

  test('closing the folder with "Close without Saving" removes its notes and writes nothing', async () => {
    const before = readBytes(notePath);
    await openNote('note.md');
    await typeAtEnd('note.md', EDIT);
    const vaultId = await page.evaluate(() => window._appState.files.find((f) => f.name === 'note.md').vaultId);
    await page.locator('.tree-root-close').first().click();
    await chooseInDialog('#dlgDontSaveBtn');
    await page.waitForFunction(() => !window._appState.files.some((f) => f.vaultId));
    expect(vaultId).toBeTruthy();
    await ageAndTick();
    expect(readBytes(notePath).equals(before)).toBe(true);

    // reopening the folder reads the saved text
    await page.evaluate(() => window.openVault());
    await page.waitForFunction(() => window._appState.files.some((f) => f.name === 'note.md'));
    expect(await fileState('note.md')).toMatchObject({ content: ORIGINAL, dirty: false });
  });
});
