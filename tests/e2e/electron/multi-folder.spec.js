// @ts-check
/**
 * multi-folder.spec.js — B4 (multi-folder workspaces): the required end-to-end proof
 * that two real folders coexist through the REAL Electron main process, not a mocked
 * bridge. Drives dialog.showOpenDialog via electronApp.evaluate() (the only way to pick
 * a folder without a real native dialog) and reads/writes real temp directories on disk.
 *
 * Proves, against the real IPC + protocol stack:
 *   - both folders render as named roots, each with its own note
 *   - opening folder B never discards folder A's tab, and no confirm() ever fires
 *   - folder A's image resolves to folder A's own bytes (bpmd://vault/<idA>/pic.png),
 *     even though folder B was read AFTER it
 *   - a crafted vaultId-A + ../folder-B relative path still 404s (containment holds
 *     across two real, simultaneously-open vault roots, not just one)
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('two real folders coexist @electron', () => {
  let electronApp;
  let page;
  let tempRoot;
  let folderA;
  let folderB;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-multi-folder-'));
    const profile = path.join(tempRoot, 'profile');
    fs.mkdirSync(profile);

    folderA = path.join(tempRoot, 'FolderA');
    folderB = path.join(tempRoot, 'FolderB');
    fs.mkdirSync(folderA);
    fs.mkdirSync(folderB);
    fs.writeFileSync(path.join(folderA, 'note.md'), '# Note A\n\n![](pic.png)\n', 'utf8');
    fs.writeFileSync(path.join(folderB, 'note.md'), '# Note B\n\n![](pic.png)\n', 'utf8');
    // The protocol layer serves raw bytes by extension-mapped MIME; it never parses PNG
    // structure, so a plain distinguishable byte marker is sufficient (and avoids the
    // complexity of hand-rolling a real, CRC-valid PNG for a bytes-match assertion).
    fs.writeFileSync(path.join(folderA, 'pic.png'), Buffer.from('PNG-BYTES-FROM-FOLDER-A'));
    fs.writeFileSync(path.join(folderB, 'pic.png'), Buffer.from('PNG-BYTES-FROM-FOLDER-B'));

    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile, ROOT],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
    // app.js is a type="module" script and loads asynchronously — wait for it to finish
    // executing before driving window.openVault().
    await page.waitForFunction(() => typeof window.openVault === 'function');
    // The packaged default starts with both panels closed — the tree exists in the DOM
    // either way (toHaveCount/allTextContents don't need visibility), but a real click
    // (the close-folder button) does.
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }
    // Any native confirm() would otherwise block the whole test on a modal Playwright
    // cannot see; asserting it never fires is the point, so make a stray call loud
    // instead of silently hanging.
    await page.evaluate(() => {
      window.__confirmCalls = [];
      window.confirm = (msg) => { window.__confirmCalls.push(msg); return true; };
    });
  });

  test.afterEach(async () => {
    if (electronApp) {
      if (page && !page.isClosed()) {
        await page.evaluate(() => window.electronAPI.closeWindow());
      }
      await electronApp.close();
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

  test('both folders render as named roots; opening B keeps A\'s tab and never discards', async () => {
    await openFolder(folderA);
    await expect(page.locator('.tab', { hasText: 'note.md' })).toHaveCount(1);
    const rootNamesAfterA = await page.locator('.tree-root .tree-name').allTextContents();
    expect(rootNamesAfterA).toEqual(['FolderA']);

    await openFolder(folderB);

    const rootNames = await page.locator('.tree-root .tree-name').allTextContents();
    expect(rootNames.sort()).toEqual(['FolderA', 'FolderB']);
    // A's tab (the only one opened so far) survives — opening B never closed it. B's own
    // note.md is now in the tree (2 file rows total) but has no tab of its own yet, same
    // as any file in a freshly-opened folder before the user clicks into it.
    await expect(page.locator('.tab', { hasText: 'note.md' })).toHaveCount(1);
    await expect(page.locator('.tree-file', { hasText: 'note.md' })).toHaveCount(2);
    expect(await page.evaluate(() => window.__confirmCalls)).toEqual([]);

    // Opening B's note (as the user would by clicking it in the tree) makes it a second
    // tab, and A's is still there alongside it.
    await page.evaluate(() => {
      const idx = window._appState.files.findIndex((f) => f.content.includes('Note B'));
      window.renderFile(idx);
    });
    await expect(page.locator('.tab', { hasText: 'note.md' })).toHaveCount(2);
  });

  test('folder A\'s image resolves to folder A\'s own bytes while folder B was read last, and cross-vault traversal 404s', async () => {
    await openFolder(folderA);
    await openFolder(folderB);

    // Render A's note (its image src is only rewritten to bpmd:// on render) and read it.
    const idA = await page.evaluate(() => {
      const idx = window._appState.files.findIndex((f) => f.name === 'note.md' && f.vaultId && f.content.includes('Note A'));
      window.renderFile(idx);
      return window._appState.files[idx].vaultId;
    });
    const srcA = await page.locator('#noteContent img').getAttribute('src');
    expect(srcA).toBe(`bpmd://vault/${idA}/pic.png`);

    // fetch() runs in the MAIN process (electronApp.evaluate), not the renderer — the
    // renderer's CSP connect-src is 'self' and would block a bpmd:// fetch outright;
    // img-src is the directive that admits bpmd: there, which is what the real <img> tag
    // above already exercised. This is a read of the SAME protocol.handle either way.
    const bytesA = await electronApp.evaluate(async ({ net }, url) => {
      const res = await net.fetch(url);
      return { status: res.status, text: await res.text() };
    }, srcA);
    expect(bytesA.status).toBe(200);
    expect(bytesA.text).toBe('PNG-BYTES-FROM-FOLDER-A');

    // A's own vaultId cannot reach into B via a crafted relative path.
    const escapeAttempt = await electronApp.evaluate(async ({ net }, id) => {
      const res = await net.fetch(`bpmd://vault/${id}/../FolderB/pic.png`);
      return res.status;
    }, idA);
    expect(escapeAttempt).toBe(404);

    // And B's own id still resolves to B's own bytes, unaffected by A's activity.
    const idB = await page.evaluate(() => {
      const idx = window._appState.files.findIndex((f) => f.name === 'note.md' && f.vaultId && f.content.includes('Note B'));
      window.renderFile(idx);
      return window._appState.files[idx].vaultId;
    });
    const srcB = await page.locator('#noteContent img').getAttribute('src');
    expect(srcB).toBe(`bpmd://vault/${idB}/pic.png`);
    const bytesB = await electronApp.evaluate(async ({ net }, url) => (await net.fetch(url)).text(), srcB);
    expect(bytesB).toBe('PNG-BYTES-FROM-FOLDER-B');
  });

  test('closing folder A leaves folder B fully intact', async () => {
    await openFolder(folderA);
    await openFolder(folderB);

    const closeBtn = page.locator('.tree-root', { hasText: 'FolderA' }).locator('.tree-root-close');
    await closeBtn.click();

    await expect(page.locator('.tree-root .tree-name')).toHaveText(['FolderB']);
    await expect(page.locator('.tab', { hasText: 'note.md' })).toHaveCount(1);
    expect(await page.evaluate(() => window._appState.files.some((f) => f.content.includes('Note B')))).toBe(true);
    expect(await page.evaluate(() => window._appState.files.some((f) => f.content.includes('Note A')))).toBe(false);
  });
});
