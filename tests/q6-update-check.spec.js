// @ts-check
/**
 * q6-update-check.spec.js — T-Q6 renderer side: the opt-in "Check for Updates…" action.
 * Only triggered by the user; reports via a toast; degrades without the desktop bridge.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('[T-Q6] opt-in update check', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('the Help menu offers "Check for Updates…"', async ({ page }) => {
    await page.locator('.tb-menu-item[data-menu="help"]').click();
    await expect(page.locator('#dropdown')).toContainText('Check for Updates');
  });

  test('an available update is surfaced via a toast', async ({ page }) => {
    await page.evaluate(() => {
      window.electronAPI = { checkForUpdate: () => Promise.resolve({ current: '1.0.0', latest: '1.2.0', updateAvailable: true, url: 'x' }) };
    });
    await page.evaluate(() => window.checkForUpdate());
    await expect(page.locator('#toast')).toContainText('Update available: 1.2.0');
  });

  test('up-to-date reports cleanly (no false "update")', async ({ page }) => {
    await page.evaluate(() => {
      window.electronAPI = { checkForUpdate: () => Promise.resolve({ current: '1.0.0', latest: '1.0.0', updateAvailable: false }) };
    });
    await page.evaluate(() => window.checkForUpdate());
    await expect(page.locator('#toast')).toContainText("up to date");
  });

  test('without the desktop bridge → graceful message (no crash)', async ({ page }) => {
    await page.evaluate(() => { delete window.electronAPI; });
    await page.evaluate(() => window.checkForUpdate());
    await expect(page.locator('#toast')).toContainText('needs the desktop app');
  });
});
