const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '..', '..', 'index.html').replace(/\\/g, '/');

test.describe('audit remediation UI contracts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
  });

  test('file tree has one roving tab stop and ArrowDown moves it', async ({ page }) => {
    await expect(page.locator('#tree')).toHaveAttribute('role', 'tree');
    const items = page.locator('#tree [role="treeitem"]');
    expect(await items.count()).toBeGreaterThan(1);
    await expect(items.filter({ has: page.locator('[tabindex="0"]') })).toHaveCount(0);
    expect(await page.locator('#tree [role="treeitem"][tabindex="0"]').count()).toBe(1);
    await page.locator('#tree [role="treeitem"][tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement === document.querySelectorAll('#tree [role="treeitem"]')[1])).toBe(true);
  });

  test('typing updates the active tab in place instead of rebuilding all tabs', async ({ page }) => {
    await page.locator('.cm-mount .cm-editor').waitFor({ state: 'visible', timeout: 8000 });
    await page.evaluate(() => { window.__auditTabNode = document.querySelector('.tab[aria-selected="true"]'); });
    await page.locator('.cm-content').click();
    await page.keyboard.type('x');
    expect(await page.evaluate(() => window.__auditTabNode === document.querySelector('.tab[aria-selected="true"]'))).toBe(true);
    await expect(page.locator('.tab[aria-selected="true"]')).toHaveClass(/dirty/);
  });

  test('command palette exposes listbox selection through active-descendant', async ({ page }) => {
    await page.evaluate(() => window.openPalette());
    const input = page.locator('#palInput');
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-activedescendant', 'pal-option-0');
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'pal-option-1');
    await expect(page.locator('#pal-option-1')).toHaveAttribute('aria-selected', 'true');
  });

  test('narrow layout uses bounded chrome and an overflowable editor toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 700 });
    const styles = await page.evaluate(() => ({
      brand: getComputedStyle(document.querySelector('.tb-brand')).display,
      toolbarOverflow: getComputedStyle(document.querySelector('.toolbar-strip')).overflowX,
      bodyWidth: document.getElementById('appBody').getBoundingClientRect().width,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(styles.brand).toBe('none');
    expect(styles.toolbarOverflow).toBe('auto');
    expect(styles.bodyWidth).toBeLessThanOrEqual(styles.viewportWidth);
  });

  test('reduced-motion preference suppresses shipped transitions', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const duration = await page.locator('#toast').evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
    expect(duration).toBeLessThanOrEqual(0.00001);
  });
});
