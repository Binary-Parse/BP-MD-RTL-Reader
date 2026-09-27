// @ts-check
/**
 * export-epub.spec.js (Electron lane) — T6.1c end to end: the renderer builds the archive,
 * the sandboxed preload forwards it, real main asks for a path and writes the bytes.
 *
 * The native save dialog is stubbed in the MAIN process (the only way to choose a path without
 * a real dialog — same seam multi-folder.spec.js uses for showOpenDialog), so everything except
 * the human click is the production path.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const ARABIC_NOTE = [
  '# الفصل الأول',
  '',
  'هذا نص عربي طويل بما يكفي ليحدد اتجاه المستند تلقائيًا عند التصدير.',
  '',
  '## الفصل الثاني',
  '',
  'فقرة ثانية بنص مختلط mixed with English and more prose to fill the file.',
  '',
].join('\n');

test.describe('EPUB export @electron', () => {
  let electronApp;
  let page;
  let tempRoot;
  let profile;
  let notePath;
  let epubPath;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-epub-test-'));
    profile = path.join(tempRoot, 'profile');
    notePath = path.join(tempRoot, 'book.md');
    epubPath = path.join(tempRoot, 'book.epub');
    fs.mkdirSync(profile);
    fs.writeFileSync(notePath, ARABIC_NOTE, 'utf8');

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
    await page.waitForFunction(() => window._appState && window._appState.files.length > 0, null, { timeout: 10000 });
  });

  test.afterEach(async () => {
    if (electronApp) {
      if (page && !page.isClosed()) await page.evaluate(() => window.electronAPI.closeWindow());
      await electronApp.close();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('exporting a note writes a real .epub to disk that starts with PK and is a valid ZIP', async () => {
    // The renderer must reach the real bridge installed by the production preload.
    expect(await page.evaluate(() => typeof window.electronAPI.exportEpub)).toBe('function');

    await electronApp.evaluate(async ({ dialog }, target) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
    }, epubPath);

    const res = await page.evaluate(() => window.exportEpub());
    expect(res).toMatchObject({ ok: true });

    expect(fs.existsSync(epubPath)).toBe(true);
    const bytes = fs.readFileSync(epubPath);
    expect(bytes.length).toBeGreaterThan(1024);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04'); // local file header
    expect(bytes.subarray(30, 38).toString('latin1')).toBe('mimetype'); // first entry, at offset 30
    expect(bytes.subarray(bytes.length - 22, bytes.length - 18).toString('latin1')).toBe('PK\x05\x06'); // EOCD

    // The archive carries the note's own chapters, and the Arabic note resolved to RTL.
    const text = bytes.toString('utf8');
    expect(text).toContain('application/epub+zip');
    expect(text).toContain('OEBPS/chapter-2.xhtml');
    expect(text).toContain('page-progression-direction="rtl"');
    expect(text).toContain('الفصل الأول');

    // No stray temp file is left next to the export (atomic write cleans up after itself).
    expect(fs.readdirSync(tempRoot).filter((n) => n.startsWith('book.epub.tmp'))).toEqual([]);
  });

  test('a canceled dialog writes nothing and reports canceled', async () => {
    await electronApp.evaluate(async ({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
    });
    const res = await page.evaluate(() => window.exportEpub());
    expect(res).toMatchObject({ canceled: true });
    expect(fs.existsSync(epubPath)).toBe(false);
    expect(fs.readdirSync(tempRoot).filter((n) => n.endsWith('.epub'))).toEqual([]);
  });
});
