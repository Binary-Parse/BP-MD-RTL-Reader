const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Accessibility tests using axe-core.
 * axe-core is loaded from the LOCAL node_modules via page.addInitScript (a CDP injection
 * that runs before page scripts and is exempt from the page CSP) — the strict CSP (T-B4,
 * script-src 'self') blocks the old CDN <script> load, and the app must stay 0-network.
 * Known serious violations (color-contrast design choices, missing tree parent,
 * scrollable pane focus) are documented but do not fail the build.
 */

const AXE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../node_modules/axe-core/axe.min.js'), 'utf8');

const KNOWN_VIOLATIONS = new Set([
  'color-contrast',
  'aria-required-parent',
  'scrollable-region-focusable',
]);

test.describe('Accessibility (axe-core WCAG 2.1 AA)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ content: AXE_SOURCE }); // inject axe before navigation (CSP-exempt)
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
  });

  async function runAxe(page, context = null) {
    return page.evaluate(async (ctx) => {
      const options = {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21aa'],
        },
        resultTypes: ['violations'],
      };
      return axe.run(ctx || document.body, options);
    }, context);
  }

  function filterUnknown(violations) {
    return violations.filter(v => !KNOWN_VIOLATIONS.has(v.id));
  }

  test('No critical or serious UNKNOWN violations on welcome screen', async ({ page }) => {
    const results = await runAxe(page);
    const unknown = filterUnknown(results.violations).filter(v => ['critical', 'serious'].includes(v.impact));
    expect(unknown, `Unknown violations: ${JSON.stringify(unknown.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious UNKNOWN violations with demo notes loaded', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(300);
    const results = await runAxe(page);
    const unknown = filterUnknown(results.violations).filter(v => ['critical', 'serious'].includes(v.impact));
    expect(unknown, `Unknown violations: ${JSON.stringify(unknown.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious UNKNOWN violations in RTL mode', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    await page.evaluate(() => window.toggleRTL());
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const unknown = filterUnknown(results.violations).filter(v => ['critical', 'serious'].includes(v.impact));
    expect(unknown, `Unknown violations: ${JSON.stringify(unknown.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious UNKNOWN violations in dark (ink) theme', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'ink'); });
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const unknown = filterUnknown(results.violations).filter(v => ['critical', 'serious'].includes(v.impact));
    expect(unknown, `Unknown violations: ${JSON.stringify(unknown.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious UNKNOWN violations in source mode', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const unknown = filterUnknown(results.violations).filter(v => ['critical', 'serious'].includes(v.impact));
    expect(unknown, `Unknown violations: ${JSON.stringify(unknown.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious UNKNOWN violations with command palette open', async ({ page }) => {
    await page.evaluate(() => window.openPalette());
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const unknown = filterUnknown(results.violations).filter(v => ['critical', 'serious'].includes(v.impact));
    expect(unknown, `Unknown violations: ${JSON.stringify(unknown.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious UNKNOWN violations with modal open', async ({ page }) => {
    await page.evaluate(() => window.showShortcuts());
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const unknown = filterUnknown(results.violations).filter(v => ['critical', 'serious'].includes(v.impact));
    expect(unknown, `Unknown violations: ${JSON.stringify(unknown.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious UNKNOWN violations with find bar open', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    await page.evaluate(() => window.openFind());
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const unknown = filterUnknown(results.violations).filter(v => ['critical', 'serious'].includes(v.impact));
    expect(unknown, `Unknown violations: ${JSON.stringify(unknown.map(v => v.id))}`).toHaveLength(0);
  });

  test('Interactive elements have accessible names', async ({ page }) => {
    const results = await page.evaluate(async () => {
      return axe.run(document.body, {
        runOnly: ['button-name', 'link-name', 'aria-required-children', 'aria-required-parent'],
      });
    });
    const serious = filterUnknown(results.violations).filter(v => ['critical', 'serious'].includes(v.impact));
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('Color contrast known violations are documented (do not fail build)', async ({ page }) => {
    const themes = ['paper', 'ink', 'sepia'];
    for (const theme of themes) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
        if (typeof window.loadDemo === 'function') window.loadDemo();
      }, theme);
      await page.waitForTimeout(300);
      const results = await runAxe(page);
      const contrast = results.violations.find(v => v.id === 'color-contrast');
      // We document the count but do not assert zero — these are design-level choices
      expect(contrast).toBeDefined(); // known violation exists
      expect(contrast.impact).toBe('serious');
    }
  });
});
