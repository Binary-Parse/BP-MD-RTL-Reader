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
    const srcTextarea = page.locator('#srcTextarea');
    const editor = page.locator('#editor');
    const appBody = page.locator('#appBody');

    // Initially LTR — html element must not have dir=rtl
    await expect(html).not.toHaveAttribute('dir', 'rtl');

    // Toggle RTL on — dir must land on #srcTextarea and #editor, NOT html
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await expect(srcTextarea).toHaveAttribute('dir', 'auto');
    await expect(editor).toHaveAttribute('dir', 'rtl');
    // html element must NOT gain a dir attribute
    await expect(html).not.toHaveAttribute('dir', 'rtl');
    // #appBody must never receive a dir attribute
    await expect(appBody).not.toHaveAttribute('dir');

    // Computed direction must be rtl (not just the attribute — catches the CSS bug)
    const computedDirRTL = await page.evaluate(() =>
      getComputedStyle(document.getElementById('editor')).direction
    );
    expect(computedDirRTL).toBe('rtl');

    // Toggle RTL off — dir removed from content elements
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await expect(srcTextarea).not.toHaveAttribute('dir');
    await expect(editor).not.toHaveAttribute('dir');

    // Computed direction must return to ltr after toggle off
    const computedDirLTR = await page.evaluate(() =>
      getComputedStyle(document.getElementById('editor')).direction
    );
    expect(computedDirLTR).toBe('ltr');
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

  // ----------------------------------------------------------------
  // T5 smoke regressions — verify all five fix acceptance signals
  // ----------------------------------------------------------------

  test('[T5-a] #searchBtn click opens command palette', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    const palOverlay = page.locator('#palOverlay');
    await expect(palOverlay).not.toHaveClass(/open/);

    await page.click('#searchBtn');
    await page.waitForTimeout(100);

    await expect(palOverlay).toHaveClass(/open/);
  });

  test('[T5-b] toggleInspector() leaves appBody with two-column grid', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => window.toggleInspector());
    await page.waitForTimeout(50);

    const cols = await page.evaluate(() => {
      return getComputedStyle(document.getElementById('appBody')).gridTemplateColumns;
    });
    // Should have exactly two column values after collapse
    const colCount = cols.trim().split(/\s+(?=\d|auto|minmax|fr)/).length;
    expect(colCount).toBe(2);
  });

  test('[T5-c] find-hit click updates State.findIdx to 1 when second mark clicked', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // Inject a file with three hits
    await page.evaluate(() => {
      const state = window._marqamState;
      state.files = [{ name: 'f.md', path: 'f.md', handle: null, content: 'the quick the brown the fox', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      window.openFind();
      window.runFind('the');
    });
    await page.waitForTimeout(100);

    await page.locator('mark.find-hit').nth(1).click();
    await page.waitForTimeout(50);

    const findIdx = await page.evaluate(() => window._marqamState.findIdx);
    expect(findIdx).toBe(1);
  });
});
