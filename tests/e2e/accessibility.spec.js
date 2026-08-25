const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Accessibility tests using axe-core.
 * axe-core is loaded from the LOCAL node_modules via page.addInitScript (a CDP injection
 * that runs before page scripts and is exempt from the page CSP) — the strict CSP (T-B4,
 * script-src 'self') blocks the old CDN <script> load, and the app must stay 0-network.
 * Every critical/serious WCAG violation fails the build; there is no global
 * suppression list.
 */

const AXE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../node_modules/axe-core/axe.min.js'), 'utf8');

test.describe('Accessibility (axe-core WCAG 2.1 AA)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({ content: AXE_SOURCE }); // inject axe before navigation (CSP-exempt)
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/src/renderer/index.html');
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

  function seriousViolations(violations) {
    return violations.filter(v => ['critical', 'serious'].includes(v.impact));
  }

  test('No critical or serious violations on welcome screen', async ({ page }) => {
    const results = await runAxe(page);
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious violations with demo notes loaded', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(300);
    const results = await runAxe(page);
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious violations in RTL mode', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    await page.evaluate(() => window.toggleRTL());
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious violations in dark (ink) theme', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'ink'); });
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious violations in the CM6 editor', async ({ page }) => {
    // T-F13: there is no source mode — the CM6 live-preview editor is the only surface.
    await page.evaluate(() => window.loadDemo());
    await page.locator('.cm-mount .cm-editor').first().waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious violations with command palette open', async ({ page }) => {
    await page.evaluate(() => window.openPalette());
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious violations with modal open', async ({ page }) => {
    await page.evaluate(() => window.showShortcuts());
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  // T-F19: the Settings dialog reuses the same #modalOverlay, but its switches and
  // segmented control are new ARIA surface that axe should see.
  test('No critical or serious violations with the Settings dialog open', async ({ page }) => {
    await page.evaluate(() => window.showSettings());
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('No critical or serious violations with find bar open', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    await page.evaluate(() => window.openFind());
    await page.waitForTimeout(200);
    const results = await runAxe(page);
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('Interactive elements have accessible names', async ({ page }) => {
    const results = await page.evaluate(async () => {
      return axe.run(document.body, {
        runOnly: ['button-name', 'link-name', 'aria-required-children', 'aria-required-parent'],
      });
    });
    const serious = seriousViolations(results.violations);
    expect(serious, `Violations: ${JSON.stringify(serious.map(v => v.id))}`).toHaveLength(0);
  });

  test('Callouts have no WCAG AA color-contrast violation in any shipped theme', async ({ page }) => {
    const themes = ['paper', 'ink', 'sepia'];
    for (const theme of themes) {
      await page.evaluate((t) => {
        document.documentElement.setAttribute('data-theme', t);
        const host = document.getElementById('noteContent');
        host.style.display = 'block';
        host.innerHTML = '<aside class="callout callout-note" role="note" aria-label="Note: Heads up"><div class="callout-title"><span class="callout-icon" aria-hidden="true">ⓘ</span><span>Heads up</span></div><div class="callout-body">Readable callout body.</div></aside>';
      }, theme);
      await page.waitForTimeout(300);
      const callout = page.locator('.callout').first();
      await expect(callout).toBeVisible();
      const results = await runAxe(page, '.callout');
      const contrast = results.violations.filter(v => v.id === 'color-contrast');
      expect(contrast, `${theme} callout contrast violations`).toHaveLength(0);
    }
  });
});
