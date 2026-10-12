// @ts-check
/**
 * export-html.spec.js — audit L3: "Exported" is said only after the file is written.
 *
 * In the desktop app the HTML export goes through the bridge (main asks for the path and
 * writes the file). This spec covers the renderer half with a stubbed bridge; the file on
 * disk is covered by tests/e2e/electron/export-html.spec.js.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

async function bootWithDemo(page, kind) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app', { state: 'visible' });
  await page.evaluate((which) => {
    window.__html = null;
    window.__anchorClicks = 0;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download')) { window.__anchorClicks += 1; return; }
      click.call(this);
    };
    const handlers = {
      ok: (payload) => { window.__html = payload; return Promise.resolve({ ok: true }); },
      cancel: () => Promise.resolve({ canceled: true }),
      error: () => Promise.resolve({ error: 'write-failed' }),
      reject: () => Promise.reject(new Error('ipc boom')),
    };
    if (which !== 'none') window.electronAPI = { exportHtml: handlers[which] };
    window.loadDemo();
  }, kind);
  await page.evaluate(() => window.renderFile(0));
}

test.describe('HTML export through the bridge (audit L3)', () => {
  test('the bridge gets the finished document and an .html name; the toast comes after ok', async ({ page }) => {
    await bootWithDemo(page, 'ok');
    const returned = await page.evaluate(() => window.exportHTML());
    const sent = await page.evaluate(() => window.__html);
    expect(sent.html).toBe(returned);
    expect(sent.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(sent.defaultName).toMatch(/\.html$/);
    await expect(page.locator('#toast')).toContainText('Exported ' + sent.defaultName);
    // No download is started in the page when main writes the file.
    expect(await page.evaluate(() => window.__anchorClicks)).toBe(0);
  });

  test('a cancelled save dialog says nothing', async ({ page }) => {
    await bootWithDemo(page, 'cancel');
    const returned = await page.evaluate(() => window.exportHTML());
    expect(typeof returned).toBe('string');
    await expect(page.locator('#toast')).not.toContainText('Exported');
    await expect(page.locator('#toast')).not.toContainText('failed');
    expect(await page.evaluate(() => window.__anchorClicks)).toBe(0);
  });

  for (const kind of ['error', 'reject']) {
    test(`a failed write (${kind}) says "HTML export failed", never "Exported"`, async ({ page }) => {
      await bootWithDemo(page, kind);
      await page.evaluate(() => window.exportHTML());
      await expect(page.locator('#toast')).toContainText('HTML export failed');
      expect(await page.evaluate(() => window.__anchorClicks)).toBe(0);
    });
  }

  test('the failure toast is Arabic in the Arabic interface', async ({ page }) => {
    await bootWithDemo(page, 'error');
    await page.evaluate(() => window.setArabicUI(true));
    await page.evaluate(() => window.exportHTML());
    await expect(page.locator('#toast')).toContainText('فشل تصدير HTML');
  });

  test('without the bridge the page still downloads the file itself', async ({ page }) => {
    await bootWithDemo(page, 'none');
    await page.evaluate(() => window.exportHTML());
    expect(await page.evaluate(() => window.__anchorClicks)).toBe(1);
    await expect(page.locator('#toast')).toContainText('Exported');
  });
});
