// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const MARQAM_PATH = path.resolve(__dirname, '../marqam.html');
const MARQAM_URL = `file:///${MARQAM_PATH.replace(/\\/g, '/')}`;

test.describe('RTL and theme bug fixes', () => {

  // ----------------------------------------------------------------
  // T1 RTL scope tests
  // ----------------------------------------------------------------

  test('[RTL-scope] after #rtlBtn click, #srcTextarea gets dir=auto', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#srcTextarea')).toHaveAttribute('dir', 'auto');
  });

  test('[RTL-scope] after #rtlBtn click, #editor gets dir=rtl', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#editor')).toHaveAttribute('dir', 'rtl');
  });

  test('[RTL-scope] after #rtlBtn click, html element does NOT get dir attribute', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('html')).not.toHaveAttribute('dir', 'rtl');
  });

  test('[RTL-scope] after #rtlBtn click, #appBody does NOT get dir attribute', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#appBody')).not.toHaveAttribute('dir');
  });

  test('[RTL-grid] .app-body computed direction is always ltr', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // LTR state
    const ltrDir = await page.evaluate(() => {
      return getComputedStyle(document.getElementById('appBody')).direction;
    });
    expect(ltrDir).toBe('ltr');

    // RTL state — grid container must still be ltr
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const rtlDir = await page.evaluate(() => {
      return getComputedStyle(document.getElementById('appBody')).direction;
    });
    expect(rtlDir).toBe('ltr');
  });

  test('[RTL-toggle-clean] toggle on then off leaves State.direction as ltr', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // Toggle on
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const rtlState = await page.evaluate(() => window._marqamState.direction);
    expect(rtlState).toBe('rtl');

    // Toggle off
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const ltrState = await page.evaluate(() => window._marqamState.direction);
    expect(ltrState).toBe('ltr');
  });

  test('[RTL-toggle-clean] toggle on then off removes dir from #srcTextarea', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#srcTextarea')).not.toHaveAttribute('dir');
  });

  test('[RTL-toggle-clean] toggle on then off removes dir from #editor', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#editor')).not.toHaveAttribute('dir');
  });

  // ----------------------------------------------------------------
  // T2 Theme data-theme target tests
  // ----------------------------------------------------------------

  test('[Theme-html] data-theme is set on html element after #themeBtn click', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#themeBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
  });

  test('[Theme-html] #app element does NOT receive data-theme attribute', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#themeBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#app')).not.toHaveAttribute('data-theme');
  });

  test('[Theme-html] three theme button clicks cycle paper→ink→sepia→paper on html', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    const html = page.locator('html');

    await page.click('#themeBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('data-theme', 'ink');

    await page.click('#themeBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('data-theme', 'sepia');

    await page.click('#themeBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('data-theme', 'paper');
  });

  // ----------------------------------------------------------------
  // T3 Statusbar dark theme tests
  // ----------------------------------------------------------------

  test('[Statusbar-ink] statusbar has dark background in ink theme', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // Cycle to ink theme
    await page.click('#themeBtn');
    await page.waitForTimeout(200);

    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.querySelector('.statusbar')).backgroundColor;
    });

    // In ink theme, --paper-deep is #1E2126 = rgb(30, 33, 38)
    // The light ink value (#E8E2D5 = rgb(232, 226, 213)) must NOT be the background
    // We expect a dark color (r+g+b sum well below 300)
    const match = bgColor.match(/\d+/g);
    if (!match) throw new Error(`Unexpected backgroundColor format: ${bgColor}`);
    const [r, g, b] = match.map(Number);
    const brightness = r + g + b;
    // Dark background: sum < 200 (e.g. rgb(30,33,38) = 101)
    // Light background: sum > 500 (e.g. rgb(232,226,213) = 671)
    expect(brightness).toBeLessThan(200);
  });

  test('[Statusbar-paper] statusbar has dark background in paper (default) theme', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    const bgColor = await page.evaluate(() => {
      return getComputedStyle(document.querySelector('.statusbar')).backgroundColor;
    });

    const match = bgColor.match(/\d+/g);
    if (!match) throw new Error(`Unexpected backgroundColor format: ${bgColor}`);
    const [r, g, b] = match.map(Number);
    const brightness = r + g + b;
    // Paper default --ink is #1F1B16 = rgb(31, 27, 22) sum = 80
    expect(brightness).toBeLessThan(200);
  });

  // ----------------------------------------------------------------
  // Visual screenshot tests
  // ----------------------------------------------------------------

  test('[Visual] LTR + paper theme at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('ltr-paper-1440x900.png', {
      maxDiffPixels: 200,
      threshold: 0.2
    });
  });

  test('[Visual] LTR + ink theme at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#themeBtn');
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('ltr-ink-1440x900.png', {
      maxDiffPixels: 200,
      threshold: 0.2
    });
  });

  test('[Visual] RTL + paper theme at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('rtl-paper-1440x900.png', {
      maxDiffPixels: 200,
      threshold: 0.2
    });
  });

  test('[Visual] RTL + ink theme at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#themeBtn');
    await page.waitForTimeout(200);
    await page.click('#rtlBtn');
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('rtl-ink-1440x900.png', {
      maxDiffPixels: 200,
      threshold: 0.2
    });
  });

});
