// @ts-check
/**
 * export-pdf.spec.js — T-F6 "Export PDF" renderer action: builds the same standalone,
 * bidi-aware note document as HTML export and hands it to the electronAPI bridge.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('[T-F6] Export PDF action', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('File menu and command palette both offer "Export PDF"', async ({ page }) => {
    await page.locator('.tb-menu-item[data-menu="file"]').click();
    await expect(page.locator('#dropdown')).toContainText('Export PDF');
    await page.keyboard.press('Escape');
    const inPalette = await page.evaluate(() => window.PALETTE_COMMANDS.some((c) => c.name === 'Export PDF'));
    expect(inPalette).toBe(true);
  });

  test('exportPDF builds the standalone doc and invokes the bridge with html + .pdf name', async ({ page }) => {
    await page.evaluate(() => {
      window.__pdf = null;
      window.electronAPI = { exportPDF: (payload) => { window.__pdf = payload; return Promise.resolve({ ok: true, path: 'C:/tmp/on-reading.pdf' }); } };
      window.loadDemo();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => window.renderFile(0));
    await page.waitForTimeout(100);

    await page.evaluate(() => window.exportPDF());
    const payload = await page.evaluate(() => window.__pdf);
    expect(payload).not.toBeNull();
    expect(payload.defaultName).toMatch(/\.pdf$/);
    expect(payload.html).toContain('<!DOCTYPE html>');
    expect(payload.html).toContain('<h1');                 // the rendered note heading is in the doc
    expect(payload.html).not.toContain('<script');         // exported doc carries no script
    // SC2: the PDF document embeds a strict CSP so the offscreen render can't pull remote resources.
    expect(payload.html).toContain('Content-Security-Policy');
    expect(payload.html).toMatch(/default-src 'none'/);
    expect(payload.html).toMatch(/img-src data:/);
    // Success toast reflects the returned path's filename.
    await expect(page.locator('#toast')).toContainText('on-reading.pdf');
  });

  test('a success toast uses the note basename, not an absolute save path', async ({ page }) => {
    await page.evaluate(() => {
      window.electronAPI = { exportPDF: () => Promise.resolve({ ok: true }) };
      window.loadDemo();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.renderFile(0); return window.exportPDF(); });
    await expect(page.locator('#toast')).toContainText('.pdf');
    await expect(page.locator('#toast')).not.toContainText('C:\\Users');
  });

  test('user-canceled export shows NO failure toast', async ({ page }) => {
    await page.evaluate(() => {
      window.electronAPI = { exportPDF: () => Promise.resolve({ canceled: true }) };
      window.loadDemo();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.renderFile(0); return window.exportPDF(); });
    await page.waitForTimeout(100);
    await expect(page.locator('#toast')).not.toContainText('failed');
  });

  test('a returned error → "PDF export failed"', async ({ page }) => {
    await page.evaluate(() => {
      window.electronAPI = { exportPDF: () => Promise.resolve({ error: 'export-failed' }) };
      window.loadDemo();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.renderFile(0); return window.exportPDF(); });
    await expect(page.locator('#toast')).toContainText('PDF export failed');
  });

  test('a rejecting bridge is caught → "PDF export failed" (no unhandled rejection)', async ({ page }) => {
    await page.evaluate(() => {
      window.electronAPI = { exportPDF: () => Promise.reject(new Error('ipc boom')) };
      window.loadDemo();
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.renderFile(0); return window.exportPDF(); });
    await expect(page.locator('#toast')).toContainText('PDF export failed');
  });

  test('with no active file → "No file to export" and the bridge is NOT called', async ({ page }) => {
    const called = await page.evaluate(async () => {
      let invoked = false;
      window.electronAPI = { exportPDF: () => { invoked = true; return Promise.resolve({ ok: true }); } };
      await window.exportPDF(); // welcome screen: activeFile === null
      return invoked;
    });
    expect(called).toBe(false);
    await expect(page.locator('#toast')).toContainText('No file to export');
  });

  test('without the desktop bridge → "needs the desktop app" (graceful in a plain browser)', async ({ page }) => {
    await page.evaluate(() => { delete window.electronAPI; window.loadDemo(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { window.renderFile(0); return window.exportPDF(); });
    await expect(page.locator('#toast')).toContainText('needs the desktop app');
  });
});
