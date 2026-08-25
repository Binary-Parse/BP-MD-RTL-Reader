// @ts-check
/**
 * fullscreen.spec.js — v10 redesign (2026-08-25): the title bar fullscreen toggle.
 *
 * Browser-lane only: this exercises the standard Fullscreen API against a bare
 * Chromium page loaded over file://, which has its own (non-Electron) permission
 * model, so it proves the button's DOM wiring (icon swap, aria-pressed, data-tip)
 * but not that Electron's session permission handlers let requestFullscreen()
 * through — a browser-lane test cannot prove Electron window behaviour. That half
 * is proven in tests/e2e/electron/fullscreen.spec.js.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('[v10] fullscreen toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
  });

  test('clicking #fullscreenBtn requests fullscreen, swaps the icon, and sets aria-pressed', async ({ page }) => {
    await expect(page.locator('#fullscreenBtn use')).toHaveAttribute('href', '#ic-expand');
    await expect(page.locator('#fullscreenBtn')).toHaveAttribute('aria-pressed', 'false');

    await page.locator('#fullscreenBtn').click();
    await expect(page.locator('#fullscreenBtn use')).toHaveAttribute('href', '#ic-shrink');
    await expect(page.locator('#fullscreenBtn')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);

    await page.locator('#fullscreenBtn').click();
    await expect(page.locator('#fullscreenBtn use')).toHaveAttribute('href', '#ic-expand');
    await expect(page.locator('#fullscreenBtn')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  });

  test('#app strips card radius and size caps while fullscreen', async ({ page }) => {
    await page.locator('#fullscreenBtn').click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    const radius = await page.locator('#app').evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).toBe('0px');
  });
});
