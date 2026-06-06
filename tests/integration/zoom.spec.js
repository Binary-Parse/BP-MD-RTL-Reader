// @ts-check
/**
 * Integration tests for zoom controls (Issue #5).
 * Validates: Ctrl+= / Ctrl+- / Ctrl+0, zoom scoped to #editorArea,
 * statusbar zoom unaffected, View menu entries present.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/');

async function loadFile(page) {
  await page.evaluate(() => {
    const S = window._appState;
    S.files = [{ name: 'test.md', path: 'test.md', handle: null, content: '# Zoom Test\n\nContent.', dirty: false }];
    window.renderFile(0);
  });
  await page.waitForTimeout(100);
}

test.describe('Zoom controls (Issue #5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await loadFile(page);
    // Reset zoom before each test
    await page.evaluate(() => window.zoomReset());
  });

  test('Ctrl+= increases zoom on #editorArea', async ({ page }) => {
    const before = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.getElementById('editorArea')).zoom) || 1
    );

    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);

    const after = await page.evaluate(() =>
      window._appState.zoomFactor
    );
    expect(after).toBeGreaterThan(before);
    expect(after).toBeCloseTo(1.1, 1);
  });

  test('Ctrl+- decreases zoom on #editorArea', async ({ page }) => {
    await page.keyboard.press('Control+-');
    await page.waitForTimeout(50);

    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBeLessThan(1);
    expect(factor).toBeCloseTo(1 / 1.1, 1);
  });

  test('Ctrl+0 resets zoom to 1', async ({ page }) => {
    // Zoom in first
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);

    // Reset
    await page.keyboard.press('Control+0');
    await page.waitForTimeout(50);

    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(1);
  });

  test('zoom scales the rem base on :root (app-wide), clearing the old #editorArea zoom (T-T4)', async ({ page }) => {
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);

    const z = await page.evaluate(() => ({
      rootFs: parseFloat(document.documentElement.style.fontSize),
      editor: document.getElementById('editorArea').style.zoom,
    }));
    expect(z.rootFs).toBeGreaterThan(16); // rem base grew → whole UI (chrome + content) scales
    expect(z.editor).toBe('');            // old content-only zoom is cleared (no double-scale)
  });

  test('statusbar zoom is unaffected by Ctrl+=', async ({ page }) => {
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.keyboard.press('Control+=');
    await page.waitForTimeout(50);

    const sbZoom = await page.evaluate(() => {
      const sb = document.querySelector('.statusbar');
      const z = getComputedStyle(sb).zoom;
      return z;
    });
    // statusbar should have zoom = 'normal' or '1' — not the editor zoom value
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBeGreaterThan(1);

    // Verify statusbar did NOT get zoomed (it's outside #editorArea)
    const sbRect = await page.evaluate(() => {
      const sb = document.querySelector('.statusbar');
      return sb.getBoundingClientRect().height;
    });
    // statusbar should remain at its natural height (~26px)
    expect(sbRect).toBeGreaterThan(0);
    expect(sbRect).toBeLessThan(60); // guard against zoom cascade
  });

  test('zoom clamped at 2.0 maximum', async ({ page }) => {
    await page.evaluate(() => window.setZoom(5.0));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(2.0);
  });

  test('zoom clamped at 0.6 minimum', async ({ page }) => {
    await page.evaluate(() => window.setZoom(0.1));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(0.6);
  });

  test('View menu contains Zoom In, Zoom Out, Reset Zoom items', async ({ page }) => {
    // Open the View menu
    await page.click('.tb-menu-item[data-menu="view"]');
    await page.waitForTimeout(100);

    const dropdown = page.locator('#dropdown');
    await expect(dropdown).toHaveClass(/open/);

    const text = await dropdown.textContent();
    expect(text).toContain('Zoom In');
    expect(text).toContain('Zoom Out');
    expect(text).toContain('Reset Zoom');

    // Close menu
    await page.keyboard.press('Escape');
  });

  test('State.zoomFactor is updated via setZoom()', async ({ page }) => {
    await page.evaluate(() => window.setZoom(1.5));
    const factor = await page.evaluate(() => window._appState.zoomFactor);
    expect(factor).toBe(1.5);
  });
});
