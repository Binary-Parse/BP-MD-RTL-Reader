// @ts-check
/**
 * window-title.spec.js — T-F19: the OS window title follows the active file.
 *
 * Electron propagates document.title to the native window unless a page-title-updated
 * handler calls preventDefault(); this app registers none, so setting document.title in
 * the renderer is what reaches the Windows taskbar and Alt+Tab. These tests assert the
 * renderer half — the native half is a manual check against a packaged build.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

const PRODUCT = 'BP MD RTL Reader';
const FSI = '⁨'; // FIRST STRONG ISOLATE
const PDI = '⁩'; // POP DIRECTIONAL ISOLATE
/** The exact title the renderer should produce for a file. */
const titled = (name, dirty = false) => `${dirty ? '• ' : ''}${FSI}${name}${PDI}`;

async function openFiles(page, files, active = 0) {
  await page.evaluate(({ files, active }) => {
    const S = window._appState;
    S.files = files.map((f) => ({
      name: f.name, path: f.name, handle: null, content: f.content || '# x\n', dirty: !!f.dirty,
    }));
    window.renderFile(active);
  }, { files, active });
  await page.waitForTimeout(120);
}

async function setMode(page, mode) {
  await page.evaluate((mode) => {
    window._appState.windowTitleMode = mode;
    window.syncWindowTitle();
  }, mode);
  await page.waitForTimeout(60);
}

test.describe('[T-F19] OS window title', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
  });

  test('falls back to the product name when no file is open', async ({ page }) => {
    expect(await page.title()).toBe(PRODUCT);
  });

  test('follows the active file name', async ({ page }) => {
    await openFiles(page, [{ name: 'notes.md' }]);
    expect(await page.title()).toBe(titled('notes.md'));
  });

  test('marks unsaved changes with a leading dot, and clears it on save', async ({ page }) => {
    await openFiles(page, [{ name: 'notes.md' }]);
    expect(await page.title()).toBe(titled('notes.md'));

    // renderFile() is the chokepoint every save, edit and conflict path funnels through
    await page.evaluate(() => { window._appState.files[0].dirty = true; window.renderFile(0); });
    await page.waitForTimeout(120);
    expect(await page.title()).toBe(titled('notes.md', true));

    await page.evaluate(() => { window._appState.files[0].dirty = false; window.renderFile(0); });
    await page.waitForTimeout(120);
    expect(await page.title()).toBe(titled('notes.md'));
  });

  test('follows a tab switch', async ({ page }) => {
    await openFiles(page, [{ name: 'first.md' }, { name: 'second.md' }], 0);
    expect(await page.title()).toBe(titled('first.md'));
    await page.evaluate(() => window.renderFile(1));
    await page.waitForTimeout(120);
    expect(await page.title()).toBe(titled('second.md'));
  });

  test('returns to the product name when the last tab closes', async ({ page }) => {
    await openFiles(page, [{ name: 'notes.md' }]);
    // drive the real control rather than an internal
    await page.click('.tab .close');
    await page.waitForTimeout(250);
    expect(await page.title()).toBe(PRODUCT);
  });

  test('"App name" mode pins the product name regardless of the open file', async ({ page }) => {
    await openFiles(page, [{ name: 'notes.md', dirty: true }]);
    await setMode(page, 'app');
    expect(await page.title()).toBe(PRODUCT);
    await setMode(page, 'file');
    expect(await page.title()).toBe(titled('notes.md', true));
  });

  // ── bidi ────────────────────────────────────────────────────────────────
  // A neutral "• " directly against a strong-RTL filename is resolved by the bidi
  // algorithm from surrounding context, which is undefined for a bare taskbar string.
  // The title has no <bdi> available, so the filename is wrapped in FSI…PDI instead.
  test('an RTL filename is bidi-isolated so the dirty marker cannot be reordered', async ({ page }) => {
    await openFiles(page, [{ name: 'مقالة-القراءة.md', dirty: true }]);
    const t = await page.title();
    expect(t).toBe(titled('مقالة-القراءة.md', true));
    expect(t.startsWith('• '), 'the marker must stay at the logical start').toBe(true);
    expect(t.indexOf(FSI), 'the filename must be isolated').toBeGreaterThan(-1);
    expect(t.endsWith(PDI)).toBe(true);
  });

  test('a filename containing the marker glyph stays distinguishable from a dirty file', async ({ page }) => {
    await openFiles(page, [{ name: '• notes.md' }]);
    const clean = await page.title();
    await page.evaluate(() => { window._appState.files[0].dirty = true; window.renderFile(0); });
    await page.waitForTimeout(120);
    const dirty = await page.title();
    expect(clean).not.toBe(dirty);
    expect(clean).toBe(titled('• notes.md'));
    expect(dirty).toBe(titled('• notes.md', true));
  });
});
