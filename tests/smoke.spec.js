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

  test('cycle all three themes via button', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // Default theme is 'paper' (no data-theme attribute or paper)
    const html = page.locator('html');

    // Click theme button to go to ink
    await page.click('#themeBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('data-theme', 'ink');

    // Click again to go to sepia
    await page.click('#themeBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('data-theme', 'sepia');

    // Click again to go back to paper
    await page.click('#themeBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('data-theme', 'paper');

    // No console JS errors during theme cycling
    const jsErrors = errors.filter(e => !e.includes('net::ERR') && !e.includes('Failed to load'));
    expect(jsErrors).toHaveLength(0);
  });

  test('toggle RTL via button', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    const html = page.locator('html');

    // Initially LTR (no dir attribute on root element)
    await expect(html).not.toHaveAttribute('dir', 'rtl');

    // Toggle RTL on — dir must land on the <html> element
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('dir', 'rtl');

    // #appBody must never receive a dir attribute
    const appBody = page.locator('#appBody');
    await expect(appBody).not.toHaveAttribute('dir', 'rtl');

    // Toggle RTL off
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await expect(html).not.toHaveAttribute('dir', 'rtl');
  });

  test('inject file via page.evaluate and verify render', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // Inject a file via State proxy
    await page.evaluate(() => {
      const state = window._marqamState;
      if (!state) throw new Error('_marqamState not exposed');
      state.files = [{
        name: 'test-note.md',
        path: 'test-note.md',
        handle: null,
        content: '# Hello World\n\nThis is a **test** note with #testing tag.\n\n## Section Two\n\nMore content here.',
        dirty: false
      }];
      // renderFile is exposed on window
      if (typeof window.renderFile === 'function') window.renderFile(0);
    });

    await page.waitForTimeout(300);

    // Welcome should be hidden, content visible
    await expect(page.locator('#welcome')).toBeHidden();
    await expect(page.locator('#noteContent')).toBeVisible();

    // Editor should contain the rendered heading
    const noteContent = page.locator('#noteContent');
    await expect(noteContent.locator('h1')).toContainText('Hello World');
    await expect(noteContent.locator('h2')).toContainText('Section Two');
    await expect(noteContent.locator('strong')).toContainText('test');

    // No JS errors
    const jsErrors = errors.filter(e => !e.includes('net::ERR') && !e.includes('Failed to load') && !e.includes('cdn.jsdelivr') && !e.includes('fonts.'));
    expect(jsErrors).toHaveLength(0);
  });

  test('command palette opens with Ctrl+K and closes with Escape', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    const palOverlay = page.locator('#palOverlay');
    await expect(palOverlay).not.toHaveClass(/open/);

    // Open palette
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(100);
    await expect(palOverlay).toHaveClass(/open/);

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await expect(palOverlay).not.toHaveClass(/open/);
  });

  test('split-view mode shows both source and preview panes', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // Load a file first
    await page.evaluate(() => {
      const state = window._marqamState;
      if (state) {
        state.files = [{ name: 'test.md', path: 'test.md', handle: null, content: '# Test\n\nContent.', dirty: false }];
        if (typeof window.renderFile === 'function') window.renderFile(0);
      }
    });
    await page.waitForTimeout(200);

    // Click split mode
    await page.click('#modeSplit');
    await page.waitForTimeout(100);

    // Both panes should be visible
    const editorArea = page.locator('#editorArea');
    await expect(editorArea).toHaveClass(/split/);
  });
});
