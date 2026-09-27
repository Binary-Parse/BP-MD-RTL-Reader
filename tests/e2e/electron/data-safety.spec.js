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
