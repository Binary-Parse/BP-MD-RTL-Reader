// @ts-check
/**
 * export-epub.spec.js — T6.1c "Export EPUB…": the renderer builds the whole archive
 * (markdown → bidi-aware XHTML → stored ZIP, dependency-free) and hands main opaque bytes.
 *
 * This spec covers the renderer half: the menu/palette entries, the exact bridge payload
 * (a real ZIP that starts with PK and is well over 1 KB), and every outcome branch. The real
 * file-on-disk half lives in tests/e2e/electron/export-epub.spec.js, which stubs the native
 * save dialog and reads the archive back.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

/**
 * Load the demo note with an exportEpub bridge of the given flavour. The handler lives inside
 * the page (no eval/Function — the app's CSP forbids both), so the payload is recorded there.
 */
async function bootWithDemo(page, kind = 'capture') {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app', { state: 'visible' });
  await page.evaluate((which) => {
    window.__epub = null;
    window.__epubBytes = null;
    const handlers = {
      capture: (payload) => {
        window.__epub = {
          defaultName: payload.defaultName,
          size: payload.bytes.length,
          head: Array.from(payload.bytes.slice(0, 4)),
          isUint8: payload.bytes instanceof Uint8Array,
        };
        return Promise.resolve({ ok: true });
      },
      bytes: (payload) => {
        window.__epubBytes = Array.from(payload.bytes);
        return Promise.resolve({ ok: true });
      },
      cancel: () => Promise.resolve({ canceled: true }),
      error: () => Promise.resolve({ error: 'write-failed' }),
      reject: () => Promise.reject(new Error('ipc boom')),
    };
    window.electronAPI = { exportEpub: handlers[which] };
    window.loadDemo();
  }, kind);
  await page.evaluate(() => window.renderFile(0));
}

/** Parse the recorded ZIP bytes inside the page: return [{name, text}] in central-dir order. */
const READ_ENTRIES = () => {
  const bytes = Uint8Array.from(window.__epubBytes);
  const view = new DataView(bytes.buffer);
  const count = view.getUint16(bytes.length - 12, true); // EOCD +10
  const decoder = new TextDecoder();
  const out = [];
  let p = view.getUint32(bytes.length - 6, true); // EOCD +16 → central directory offset
  for (let i = 0; i < count; i += 1) {
    const nameLen = view.getUint16(p + 28, true);
    const size = view.getUint32(p + 24, true);
    const local = view.getUint32(p + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out.push({
      name: decoder.decode(bytes.slice(p + 46, p + 46 + nameLen)),
      text: decoder.decode(bytes.slice(start, start + size)),
    });
    p += 46 + nameLen;
  }
  return out;
};

test.describe('[T6.1c] Export EPUB action', () => {
  test('File menu and command palette both offer "Export EPUB…"', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.locator('.tb-menu-item[data-menu="file"]').click();
    await expect(page.locator('#dropdown')).toContainText('Export EPUB');
    await page.keyboard.press('Escape');
    const entry = await page.evaluate(() => window.PALETTE_COMMANDS.find((c) => c.name === 'Export EPUB…'));
    expect(entry, 'the palette offers the EPUB export').toBeTruthy();
    expect(entry.meta).toBe('command');
    expect(entry.sec).toBe('Files');
  });

  test('exportEpub hands the bridge a real ZIP (PK…) with bytes and an .epub name', async ({ page }) => {
    await bootWithDemo(page, 'capture');

    await page.evaluate(() => window.exportEpub());
    const payload = await page.evaluate(() => window.__epub);
    expect(payload).not.toBeNull();
    expect(payload.isUint8).toBe(true);
    expect(payload.defaultName).toMatch(/\.epub$/);
    expect(payload.head).toEqual([0x50, 0x4B, 0x03, 0x04]); // PK\x03\x04 local file header
    expect(payload.size).toBeGreaterThan(1024);
    await expect(page.locator('#toast')).toContainText('.epub');
  });

  test('the archive is a valid OCF container holding the rendered note', async ({ page }) => {
    await bootWithDemo(page, 'bytes');
    await page.evaluate(() => window.exportEpub());
    const entries = await page.evaluate(READ_ENTRIES);
    expect(entries[0].name).toBe('mimetype');
    expect(entries[0].text).toBe('application/epub+zip');
    const names = entries.map((e) => e.name);
    expect(names).toContain('META-INF/container.xml');
    expect(names).toContain('OEBPS/content.opf');
    expect(names).toContain('OEBPS/nav.xhtml');
    const chapter = entries.find((e) => e.name === 'OEBPS/chapter-1.xhtml');
    expect(chapter.text).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(chapter.text).toContain('dir=');
    // The rendered note's structure travelled: a heading, a paragraph, and a nav entry whose
    // label is that heading (the demo note opens with an h1 — same assumption as export-pdf).
    const chapterText = entries
      .filter((e) => e.name.startsWith('OEBPS/chapter-'))
      .map((e) => e.text)
      .join('\n');
    expect(chapterText).toContain('<h1');
    expect(chapterText).toContain('<p');
    const heading = /<h1[^>]*>([^<]+)<\/h1>/.exec(chapterText)[1];
    expect(entries.find((e) => e.name === 'OEBPS/nav.xhtml').text).toContain(heading);
  });

  test('a canceled save shows NO failure toast', async ({ page }) => {
    await bootWithDemo(page, 'cancel');
    await page.evaluate(() => window.exportEpub());
    await expect(page.locator('#toast')).not.toContainText('failed');
  });

  test('a returned error, and a rejecting bridge, both toast "EPUB export failed"', async ({ page }) => {
    await bootWithDemo(page, 'error');
    await page.evaluate(() => window.exportEpub());
    await expect(page.locator('#toast')).toContainText('EPUB export failed');

    await bootWithDemo(page, 'reject');
    await page.evaluate(() => window.exportEpub());
    await expect(page.locator('#toast')).toContainText('EPUB export failed');
  });

  test('with no active file → "No file to export" and the bridge is NOT called', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(() => {
      window.__called = false;
      window.electronAPI = { exportEpub: () => { window.__called = true; return Promise.resolve({ ok: true }); } };
    });
    await page.evaluate(() => window.exportEpub()); // welcome screen: activeFile === null
    expect(await page.evaluate(() => window.__called)).toBe(false);
    await expect(page.locator('#toast')).toContainText('No file to export');
  });

  test('without the desktop bridge → "needs the desktop app"', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(() => { delete window.electronAPI; window.loadDemo(); });
    await page.evaluate(() => { window.renderFile(0); return window.exportEpub(); });
    await expect(page.locator('#toast')).toContainText('needs the desktop app');
  });
});
