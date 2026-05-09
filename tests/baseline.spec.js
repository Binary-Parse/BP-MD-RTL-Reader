// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const REFERENCE_PATH = path.resolve(__dirname, '../marqam-app.html');
const REFERENCE_URL = `file:///${REFERENCE_PATH.replace(/\\/g, '/')}`;

test.describe('reference baseline', () => {
  test('capture marqam-app-baseline at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(REFERENCE_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('marqam-app-baseline.png', {
      maxDiffPixels: 100,
      threshold: 0.2
    });
  });

  test('capture marqam-app-baseline ink theme', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(REFERENCE_URL);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'ink');
    });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('marqam-app-baseline-ink.png', {
      maxDiffPixels: 100,
      threshold: 0.2
    });
  });
});
