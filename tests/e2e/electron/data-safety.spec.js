// @ts-check
/**
 * data-safety.spec.js — QA-01 (2026-09-26 audit): the save/conflict/recovery/capability
 * flows the chromium lane can never prove, exercised against the REAL main process:
 *   1. an in-place save writes the editor's bytes to disk,
 *   2. an external disk change surfaces the conflict banner instead of overwriting,
 *   3. a legacy Windows-1256 note round-trips in its own encoding,
 *   4. a persisted recovery snapshot is offered back after a relaunch,
 *   5. closing the folder kills save authority and the failure SURFACES (DATA-02).
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CP1256_BODY = Buffer.concat([
  Buffer.from('# ملاحظة\n\n', 'binary'),
  Buffer.from([0xE5, 0xE1, 0xEA, 0xC8, 0xC9]), // Arabic letters in Windows-1256 bytes
]);

async function launchApp(profile) {
  const electronApp = await electron.launch({
    args: ['--user-data-dir=' + profile, ROOT],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' },
  });
  const page = await electronApp.firstWindow();
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.waitForFunction(() => typeof window.openVault === 'function');
  return { electronApp, page };
}

test.describe('data-safety flows against real Electron @electron', () => {
  let electronApp;
  let page;
  let tempRoot;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-data-safety-'));
  });

  test.afterEach(async () => {
    if (electronApp) {
      if (page && !page.isClosed()) {
        await page.evaluate(() => window.electronAPI.closeWindow()).catch(() => {});
      }
      await electronApp.close().catch(() => {});
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function openFolder(folderPath) {
    await electronApp.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, folderPath);
    await page.evaluate(() => window.openVault());
    await page.waitForFunction(
      (name) => Array.from(document.querySelectorAll('.tree-root .tree-name')).some((el) => el.textContent === name),
      path.basename(folderPath),
    );
  }

  async function openFirstNote() {
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }
    await page.locator('.tree-file', { hasText: 'note.md' }).first().click();
    await expect(page.locator('.tab', { hasText: 'note.md' })).toHaveCount(1);
    await page.waitForFunction(() => window.getActiveCmAdapter() != null);
  }

  async function typeAndSave(text) {
    await page.evaluate((t) => window.getActiveCmAdapter().replaceSelection(t), text);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window._appState.files.every((f) => !f.dirty));
  }

  test('an in-place save writes the editor bytes to disk; an external change conflicts', async () => {
    const folder = path.join(tempRoot, 'Vault');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'note.md'), '# original\n', 'utf8');
    ({ electronApp, page } = await launchApp(path.join(tempRoot, 'profile')));
    await openFolder(folder);
    await openFirstNote();
    await typeAndSave('edited line');
    const saved = fs.readFileSync(path.join(folder, 'note.md'), 'utf8');
    expect(saved).toContain('edited line');

    // An external writer changes the disk copy; the next save must CONFLICT (banner),
    // never silently overwrite what happened on disk.
    fs.writeFileSync(path.join(folder, 'note.md'), '# changed externally\n', 'utf8');
    await page.evaluate(() => window.getActiveCmAdapter().replaceSelection('more edits'));
    await page.keyboard.press('Control+s');
    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: 10000 });
    expect(fs.readFileSync(path.join(folder, 'note.md'), 'utf8')).toContain('changed externally');
  });

  test('a legacy Windows-1256 note round-trips in its own encoding', async () => {
    const folder = path.join(tempRoot, 'Vault1256');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'note.md'), CP1256_BODY);
    ({ electronApp, page } = await launchApp(path.join(tempRoot, 'profile')));
    await openFolder(folder);
    await openFirstNote();
    await page.waitForFunction(() => (window._appState.files[0] || {}).meta != null);
    const encoding = await page.evaluate(() => window._appState.files[0].meta.encoding);
    expect(encoding).toBe('windows-1256');
    await typeAndSave(' ');
    const bytes = fs.readFileSync(path.join(folder, 'note.md'));
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF]))).toBe(false);
    expect(bytes.includes(Buffer.from([0xE5, 0xE1, 0xEA, 0xC8, 0xC9]))).toBe(true);
  });

  test('M5: a note with mixed line endings keeps the ending of every line that was not edited', async () => {
    const folder = path.join(tempRoot, 'VaultMixed');
    fs.mkdirSync(folder);
    const file = path.join(folder, 'note.md');
    fs.writeFileSync(file, 'one\r\ntwo\r\nthree\nfour\r\nfive\r\n', 'utf8'); // 4 CRLF + 1 LF
    ({ electronApp, page } = await launchApp(path.join(tempRoot, 'profile')));
    await openFolder(folder);
    await openFirstNote();
    await expect(page.locator('#encodingStat')).toContainText('Mixed');
    await typeAndSave('X');
    expect(fs.readFileSync(file, 'utf8')).toBe('Xone\r\ntwo\r\nthree\nfour\r\nfive\r\n');
    // A second save in the same session starts from what the first one wrote.
    await typeAndSave('Y');
    expect(fs.readFileSync(file, 'utf8')).toBe('XYone\r\ntwo\r\nthree\nfour\r\nfive\r\n');
  });

  test('M6: a UTF-16 note without a BOM that holds an em dash is read and saved as UTF-16', async () => {
    const folder = path.join(tempRoot, 'VaultUtf16');
    fs.mkdirSync(folder);
    const file = path.join(folder, 'note.md');
    fs.writeFileSync(file, Buffer.from('Title — عنوان\nbody\n', 'utf16le'));
    ({ electronApp, page } = await launchApp(path.join(tempRoot, 'profile')));
    await openFolder(folder);
    await openFirstNote();
    expect(await page.evaluate(() => window._appState.files[0].meta.encoding)).toBe('utf16le');
    expect(await page.evaluate(() => window._appState.files[0].content)).toBe('Title — عنوان\nbody\n');
    await typeAndSave('X');
    expect(fs.readFileSync(file).equals(Buffer.from('XTitle — عنوان\nbody\n', 'utf16le'))).toBe(true);
  });

  test('M7: a note with a guessed encoding asks first; no save happens before the answer', async () => {
    const folder = path.join(tempRoot, 'VaultGuess');
    fs.mkdirSync(folder);
    const file = path.join(folder, 'note.md');
    // UTF-8 Arabic with one stray byte: this used to open, whole, as Windows-1256 mojibake.
    const damaged = Buffer.concat([
      Buffer.from('# عنوان الملاحظة\n\nفقرة عربية طويلة فيها كلمات كثيرة.\n', 'utf8'),
      Buffer.from([0xE3, 0x0A]),
    ]);
    fs.writeFileSync(file, damaged);
    ({ electronApp, page } = await launchApp(path.join(tempRoot, 'profile')));
    await openFolder(folder);
    await openFirstNote();

    const banner = page.locator('.encoding-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('1 of its bytes');
    expect(await page.evaluate(() => window._appState.files[0].content)).toContain('عنوان الملاحظة');

    // Save is refused and says why; the file on disk is untouched.
    await page.evaluate(() => window.getActiveCmAdapter().replaceSelection('X'));
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toast', { hasText: 'Confirm the encoding' })).toBeVisible({ timeout: 10000 });
    expect(fs.readFileSync(file).equals(damaged)).toBe(true);
    expect(await page.evaluate(() => window._appState.files[0].dirty)).toBe(true);

    // Reopen as Windows-1256 (discarding the edit): every byte is read, the question is gone.
    await banner.locator('.enc-reopen[data-encoding="windows-1256"]').click();
    await page.locator('#reopenConfirmBtn').click();
    await expect(page.locator('.encoding-banner')).toHaveCount(0);
    expect(await page.evaluate(() => window._appState.files[0].meta.encoding)).toBe('windows-1256');

    // A save in the confirmed encoding changes only what was typed.
    await typeAndSave('X');
    expect(fs.readFileSync(file).equals(Buffer.concat([Buffer.from('X'), damaged]))).toBe(true);
  });

  test('M7: keeping a damaged UTF-8 guess lifts the hold and the save goes through', async () => {
    const folder = path.join(tempRoot, 'VaultKeep');
    fs.mkdirSync(folder);
    const file = path.join(folder, 'note.md');
    const text = '# عنوان الملاحظة\n\nفقرة عربية طويلة فيها كلمات كثيرة.\n';
    fs.writeFileSync(file, Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([0xE3, 0x0A])]));
    ({ electronApp, page } = await launchApp(path.join(tempRoot, 'profile')));
    await openFolder(folder);
    await openFirstNote();
    await page.locator('.encoding-banner .enc-keep').click();
    await expect(page.locator('.encoding-banner')).toHaveCount(0);
    await typeAndSave('X');
    expect(fs.readFileSync(file, 'utf8')).toBe('X' + text + '�\n');
    await expect(page.locator('.encoding-banner')).toHaveCount(0); // the saved file is valid UTF-8
  });

  test('a save failure surfaces instead of passing silently', async () => {
    const folder = path.join(tempRoot, 'VaultRO');
    fs.mkdirSync(folder);
    const file = path.join(folder, 'note.md');
    fs.writeFileSync(file, '# locked\n', 'utf8');
    ({ electronApp, page } = await launchApp(path.join(tempRoot, 'profile')));
    await openFolder(folder);
    await openFirstNote();
    fs.chmodSync(file, 0o444);
    await page.evaluate(() => window.getActiveCmAdapter().replaceSelection('cannot write'));
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toast', { hasText: 'Could not save' })).toBeVisible({ timeout: 10000 });
    fs.chmodSync(file, 0o666);
  });

  test('a persisted recovery snapshot is offered back after relaunch', async () => {
    const profile = path.join(tempRoot, 'profile');
    fs.mkdirSync(profile);
    ({ electronApp, page } = await launchApp(profile));
    await page.evaluate(async () => {
      await window.electronAPI.recoverySnapshot([{ name: 'crashed.md', content: 'unsaved work' }]);
      // A sanctioned close clears snapshots ONLY when no recovery decision is
      // outstanding; a dismissed prompt deliberately re-offers next launch. Mark the
      // decision outstanding (the documented crash-away path) and close gracefully.
      window._recoveryDismissed = true;
    });
    await page.evaluate(() => window.electronAPI.closeWindow());
    await electronApp.close();
    electronApp = null;

    ({ electronApp, page } = await launchApp(profile));
    await expect(page.locator('#recoveryRestoreBtn')).toBeVisible({ timeout: 15000 });
    await page.locator('#recoveryRestoreBtn').click();
    await expect(page.locator('.tab', { hasText: 'crashed.md' })).toHaveCount(1, { timeout: 10000 });
    expect(await page.evaluate(() => window._appState.files[0].content)).toBe('unsaved work');
  });

  test('M11: a crashed page reloads by itself and offers the unsaved note back', async () => {
    test.setTimeout(90000);
    ({ electronApp, page } = await launchApp(path.join(tempRoot, 'profile')));
    await page.evaluate(() => window.newNote());
    await page.waitForFunction(() => window.getActiveCmAdapter() != null);
    await page.evaluate(() => window.getActiveCmAdapter().replaceSelection('typed before the crash'));
    // the 10 s mirror puts the unsaved note on disk
    const snapshot = path.join(tempRoot, 'profile', 'recovery', 'snapshot.json');
    await expect.poll(() => (fs.existsSync(snapshot) ? fs.readFileSync(snapshot, 'utf8') : ''), { timeout: 20000 })
      .toContain('typed before the crash');

    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());

    // Asked from main, so the check does not depend on how the test driver treats a crashed page.
    const inPage = (source) => electronApp.evaluate(async ({ BrowserWindow }, js) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      if (contents.isCrashed() || contents.isLoading()) return null;
      // A call that lands while the page is going away never settles: give each try one second.
      const late = new Promise((resolve) => setTimeout(() => resolve(null), 1000));
      try { return await Promise.race([contents.executeJavaScript(js), late]); } catch (_) { return null; }
    }, source);
    await expect.poll(() => inPage('!!document.getElementById("recoveryRestoreBtn")'), { timeout: 30000 }).toBe(true);
    await inPage('document.getElementById("recoveryRestoreBtn").click()');
    await expect.poll(() => inPage('window._appState.files.map((f) => f.content).join("|")'), { timeout: 10000 })
      .toContain('typed before the crash');
    page = null; // the page object of the dead renderer is not used again
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].destroy());
  });

  test('closing the folder kills save authority and the failure surfaces (DATA-02)', async () => {
    const folder = path.join(tempRoot, 'VaultExpiry');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'note.md'), '# expiring\n', 'utf8');
    ({ electronApp, page } = await launchApp(path.join(tempRoot, 'profile')));
    await openFolder(folder);
    await openFirstNote();
    const vaultId = await page.evaluate(() => window._appState.files[0].vaultId);
    await page.evaluate((id) => window.electronAPI.closeVault(id), vaultId);
    await page.evaluate(() => window.getActiveCmAdapter().replaceSelection('after close'));
    await page.keyboard.press('Control+s');
    await expect(page.locator('.toast', { hasText: 'Could not save' })).toBeVisible({ timeout: 10000 });
  });
});
