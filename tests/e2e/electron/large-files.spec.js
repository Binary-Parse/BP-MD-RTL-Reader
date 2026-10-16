const { test, expect, _electron: electron } = require('@playwright/test');
const { closeApp } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MIB = 1024 * 1024;

// Large notes through the real main process: "Open with" (launch argument, which used to drop
// big notes without a word), the picker's confirm step, and the 100 MB refusal.
test.describe('large notes in the real app @electron', () => {
  let electronApp;
  let page;
  let tempRoot;

  function writeNote(name, bytes) {
    const file = path.join(tempRoot, name);
    const line = `${'word '.repeat(19)}abcd\n`;
    const fd = fs.openSync(file, 'w');
    const chunk = Buffer.from(line.repeat(10000));
    let written = 0;
    while (written + chunk.length <= bytes) { fs.writeSync(fd, chunk); written += chunk.length; }
    if (bytes > written) fs.writeSync(fd, Buffer.alloc(bytes - written, 0x61));
    fs.closeSync(fd);
    return file;
  }

  async function launch(args) {
    const profile = path.join(tempRoot, 'profile');
    fs.mkdirSync(profile);
    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile, ROOT, ...args],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
  }

  test.beforeEach(() => { tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-large-')); });
  test.afterEach(async () => {
    await closeApp(electronApp, page);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('the renderer is given the limits by main', async () => {
    await launch([]);
    const limits = await page.evaluate(() => window.electronAPI.getLimits());
    expect(limits).toMatchObject({ largeNoteBytes: 5 * MIB, confirmNoteBytes: 20 * MIB, maxFileBytes: 100 * MIB });
  });

  test('"Open with" a 21 MB note asks first, then opens it in large-file mode', async () => {
    const note = writeNote('twentyone.md', 21 * MIB);
    await launch([note]);
    await expect(page.locator('#largeOpenConfirmBtn')).toBeVisible({ timeout: 30000 });
    await page.locator('#largeOpenConfirmBtn').click();
    await expect.poll(() => page.evaluate(() => window._appState.files[0]?.largeTier), { timeout: 60000 }).toBe(2);
    await expect(page.locator('#renderAnywayBtn')).toBeVisible();
  });

  test('"Open with" a 21 MB note and answering Cancel opens nothing', async () => {
    const note = writeNote('twentyone.md', 21 * MIB);
    await launch([note]);
    await expect(page.locator('#largeOpenConfirmBtn')).toBeVisible({ timeout: 30000 });
    await page.locator('#largeOpenCancelBtn').click();
    await page.waitForTimeout(500); // deliberate: the note would have opened by now
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
  });

  // CodeMirror cannot lay out a wrapped line of about 15 million characters (it threw while the
  // note stayed open and the editor stayed empty); the note is shown unwrapped. 16 M characters is
  // a LARGE note (under 20 MiB): no question first.
  test('"Open with" a note that is one 16-million-character line shows it in the editor, again and again', async () => {
    const note = path.join(tempRoot, 'oneline.md');
    fs.writeFileSync(note, `# Big

${'word '.repeat(3_200_000)}`);
    await launch([note]);
    await expect.poll(() => page.evaluate(() => window._appState?.files[0]?.largeTier), { timeout: 60000 }).toBe(1);
    // The editor is built after the note is listed: until then it reads -1, and the poll waits.
    const lengths = () => page.evaluate(() => ({ editor: window.getActiveCmAdapter()?._view?.state.doc.length ?? -1, note: window._appState.files[0].content.length }));
    await expect.poll(async () => { const l = await lengths(); return l.note > 16_000_000 && l.editor === l.note; }, { timeout: 30000 }).toBe(true);
    const again = await page.evaluate(() => { try { window.renderFile(0); window.renderFile(0); return 'ok'; } catch (e) { return e.message; } });
    expect(again).toBe('ok');
    const after = await lengths();
    expect(after.editor).toBe(after.note);
  });

  test('"Open with" a note over 100 MB says so instead of doing nothing', async () => {
    const note = writeNote('huge.md', 100 * MIB + 1);
    await launch([note]);
    await expect(page.locator('#toast')).toContainText('100', { timeout: 30000 });
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
  });
});
