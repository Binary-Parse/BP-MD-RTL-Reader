// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const MARQAM_PATH = path.resolve(__dirname, '../marqam.html');
const MARQAM_URL = `file:///${MARQAM_PATH.replace(/\\/g, '/')}`;

test.describe('smoke tests', () => {
  test('app element is visible and no console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    const app = page.locator('.app');
    await expect(app).toBeVisible();

    // Allow font-loading and CDN errors but not JS errors
    const jsErrors = errors.filter(e =>
      !e.includes('fonts.googleapis') &&
      !e.includes('fonts.gstatic') &&
      !e.includes('cdn.jsdelivr') &&
      !e.includes('Failed to load resource') &&
      !e.includes('net::ERR')
    );
    expect(jsErrors).toHaveLength(0);
  });

  test('titlebar and statusbar are visible', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await expect(page.locator('.titlebar')).toBeVisible();
    await expect(page.locator('.statusbar')).toBeVisible();
  });

  test('sidebar is visible with file navigation', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sb-tabs')).toBeVisible();
  });

  test('inspector is visible', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await expect(page.locator('.inspector')).toBeVisible();
  });

  test('welcome screen shown on initial load', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await expect(page.locator('#welcome')).toBeVisible();
  });
});
