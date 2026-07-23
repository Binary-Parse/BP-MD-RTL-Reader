// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('visual regression @visual', () => {
  test('default paper theme at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    // Ensure paper theme (default)
    await page.evaluate(() => {
      document.querySelector('.app').removeAttribute('data-theme');
    });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('app-paper.png', {
      maxDiffPixels: 5000,
      threshold: 0.2
    });
  });

  test('ink (dark) theme at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    // Set ink theme via the theme button
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'ink');
    });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('app-ink.png', {
      maxDiffPixels: 5000,
      threshold: 0.2
    });
  });

  test('sepia theme at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      document.querySelector('.app').setAttribute('data-theme', 'sepia');
    });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('app-sepia.png', {
      maxDiffPixels: 5000,
      threshold: 0.2
    });
  });
});
