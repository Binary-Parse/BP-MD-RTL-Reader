// @ts-check
/**
 * r7-rtl-ui.spec.js — T-R7 full RTL/Arabic UI: the chrome mirrors (sidebar → right) and
 * localizes (en/ar) when the Arabic interface is on, via uiDirection/uiLocale; toggling
 * back restores the English chrome (incl. the accelerator <u> underlines).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

const xOf = (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().x, sel);

test.describe('[T-R7] full RTL/Arabic UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('default UI is LTR + English (sidebar on the left; menus say File/Edit/View/Help)', async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).not.toBe('rtl');
    expect(await xOf(page, '.sidebar')).toBeLessThan(await xOf(page, '.inspector')); // sidebar left of inspector
    expect(await page.locator('.tb-menu-item[data-menu="file"]').textContent()).toContain('File');
  });

  test('Arabic UI mirrors the layout (sidebar → right) and localizes the chrome', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl');
    expect(await xOf(page, '.sidebar')).toBeGreaterThan(await xOf(page, '.inspector')); // mirrored
    expect(await page.locator('.tb-menu-item[data-menu="file"]').textContent()).toBe('ملف');
    expect(await page.locator('.tb-menu-item[data-menu="view"]').textContent()).toBe('عرض');
    expect(await page.locator('.sb-tab[data-pane="files"]').textContent()).toBe('الملفات');
    expect(await page.evaluate(() => window._appState.uiLocale)).toBe('ar');
  });

  test('toggling back to English restores the chrome incl. the accelerator underline', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    await page.evaluate(() => window.setArabicUI(false));
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('ltr');
    expect(await xOf(page, '.sidebar')).toBeLessThan(await xOf(page, '.inspector'));
    // The <u>F</u>ile accelerator markup is restored (not flattened to plain text).
    expect(await page.locator('.tb-menu-item[data-menu="file"]').innerHTML()).toContain('<u>F</u>');
    expect(await page.locator('.sb-tab[data-pane="files"]').textContent()).toBe('Files');
  });

  test('English note CONTENT stays LTR even when the UI is Arabic/RTL (no leak)', async ({ page }) => {
    await page.evaluate(() => {
      window.setArabicUI(true); // chrome → rtl
      window._appState.files = [{ name: 'e.md', path: 'e.md', content: '# English heading\n\nA plain English paragraph that must read left-to-right.\n', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(80);
    const dir = await page.evaluate(() => ({
      editor: getComputedStyle(document.getElementById('editor')).direction,
      para: getComputedStyle(document.querySelector('#noteContent p')).direction,
    }));
    expect(dir.editor).toBe('ltr'); // content anchored LTR, independent of the RTL chrome
    expect(dir.para).toBe('ltr');
  });

  test('[Visual] Arabic (RTL) chrome at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { window.loadDemo(); window.setArabicUI(true); });
    await page.waitForTimeout(250);
    await expect(page).toHaveScreenshot('rtl-ui-chrome-1440x900.png', { maxDiffPixels: 8000, threshold: 0.2 });
  });
});
