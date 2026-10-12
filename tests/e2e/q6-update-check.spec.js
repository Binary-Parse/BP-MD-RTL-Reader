// @ts-check
/**
 * q6-update-check.spec.js — T-Q6 renderer side: the opt-in "Check for Updates…" action.
 * Only triggered by the user; reports via a toast; degrades without the desktop bridge.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
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
      window.electronAPI = { checkForUpdate: () => Promise.resolve({ current: '1.0.0', latest: '9.9.9-e2e', updateAvailable: true, url: 'x' }) };
    });
    await page.evaluate(() => window.checkForUpdate());
    await expect(page.locator('#toast')).toContainText('Update available: 9.9.9-e2e');
  });

  test('up-to-date reports cleanly (no false "update")', async ({ page }) => {
    await page.evaluate(() => {
      window.electronAPI = { checkForUpdate: () => Promise.resolve({ current: '1.0.0', latest: '1.0.0', updateAvailable: false }) };
    });
    await page.evaluate(() => window.checkForUpdate());
    await expect(page.locator('#toast')).toContainText("up to date");
  });

  // audit M37: a failed check is no dead end. The card names the reason and offers the one
  // thing that still works, the fixed releases page that main opens.
  for (const [error, text] of [
    ['untrusted', 'The update check was not made: GitHub’s certificate is not one this version knows.'],
    ['network', 'Could not check for updates. You can look at the releases page yourself.'],
    ['http', 'Could not check for updates. You can look at the releases page yourself.'],
  ]) {
    test(`a failed check (${error}) shows the card with "Open releases page"`, async ({ page }) => {
      await page.evaluate((error) => {
        window.__releasePageCalls = 0;
        window.electronAPI = {
          checkForUpdate: () => Promise.resolve({ error, current: '1.0.0' }),
          openReleasePage: async () => { window.__releasePageCalls += 1; return { ok: true }; },
        };
      }, error);
      await page.evaluate(() => window.checkForUpdate());
      const bar = page.locator('#updateBar');
      await expect(bar).toBeVisible();
      await expect(bar).toContainText(text);
      await expect(page.locator('#updateViewBtn')).toHaveText('Open releases page');
      await page.click('#updateViewBtn');
      expect(await page.evaluate(() => window.__releasePageCalls)).toBe(1);
      await expect(bar).toBeHidden();
    });
  }

  test('the failure card is Arabic in the Arabic interface, and Dismiss opens nothing', async ({ page }) => {
    await page.evaluate(() => {
      window.__releasePageCalls = 0;
      window.electronAPI = {
        checkForUpdate: () => Promise.resolve({ error: 'untrusted', current: '1.0.0' }),
        openReleasePage: async () => { window.__releasePageCalls += 1; return { ok: true }; },
      };
      window.setArabicUI(true);
    });
    await page.evaluate(() => window.checkForUpdate());
    await expect(page.locator('#updateBar')).toContainText('لم يُجرَ فحص التحديث');
    await expect(page.locator('#updateViewBtn')).toHaveText('افتح صفحة الإصدارات');
    await page.click('#updateDismissBtn');
    await expect(page.locator('#updateBar')).toBeHidden();
    expect(await page.evaluate(() => window.__releasePageCalls)).toBe(0);
  });

  test('without the desktop bridge → graceful message (no crash)', async ({ page }) => {
    await page.evaluate(() => { delete window.electronAPI; });
    await page.evaluate(() => window.checkForUpdate());
    await expect(page.locator('#toast')).toContainText('needs the desktop app');
  });
});
