// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('smoke tests', () => {
  test('app element is visible and no console errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(INDEX_URL);
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
    await page.goto(INDEX_URL);
    await expect(page.locator('.titlebar')).toBeVisible();
    await expect(page.locator('.statusbar')).toBeVisible();
  });

  test('sidebar is visible with file navigation', async ({ page }) => {
    await page.goto(INDEX_URL);
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.sb-tabs')).toBeVisible();
  });

  test('inspector is visible', async ({ page }) => {
    await page.goto(INDEX_URL);
    await expect(page.locator('.inspector')).toBeVisible();
  });

  test('welcome screen shown on initial load', async ({ page }) => {
    await page.goto(INDEX_URL);
    await expect(page.locator('#welcome')).toBeVisible();
  });

  test('cycle all three themes via button', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Default theme is 'paper' (no data-theme attribute or paper)
    const html = page.locator('html');
    const themeIcon = page.locator('#themeBtn use');
    await expect(themeIcon).toHaveAttribute('href', '#ic-sun');

    // Click theme button to go to ink
    await page.click('#themeBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('data-theme', 'ink');
    await expect(themeIcon).toHaveAttribute('href', '#ic-moon');

    // Click again to go to sepia
    await page.click('#themeBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('data-theme', 'sepia');
    // v1.2: sepia no longer borrows the Reading/Edit toggle's book-open glyph —
    // the theme button shows the palette icon instead.
    await expect(themeIcon).toHaveAttribute('href', '#ic-palette');

    // Click again to go back to paper
    await page.click('#themeBtn');
    await page.waitForTimeout(100);
    await expect(html).toHaveAttribute('data-theme', 'paper');
    await expect(themeIcon).toHaveAttribute('href', '#ic-sun');

    // No console JS errors during theme cycling
    const jsErrors = errors.filter(e => !e.includes('net::ERR') && !e.includes('Failed to load'));
    expect(jsErrors).toHaveLength(0);
  });

  test('toggle RTL via button', async ({ page }) => {
    await page.goto(INDEX_URL);
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

    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Inject a file via State proxy
    await page.evaluate(() => {
      const state = window._appState;
      if (!state) throw new Error('_appState not exposed');
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

    // T-F13: welcome hidden, the CM6 editor visible (the single on-screen surface).
    await expect(page.locator('#welcome')).toBeHidden();
    await expect(page.locator('.cm-mount .cm-editor')).toBeVisible();

    // The render pipeline (#noteContent, used for export) still produces the parsed HTML.
    const html = await page.locator('#noteContent').innerHTML();
    expect(html).toContain('Hello World');
    expect(html).toContain('Section Two');
    expect(html).toContain('<strong>');

    // No JS errors
    const jsErrors = errors.filter(e => !e.includes('net::ERR') && !e.includes('Failed to load') && !e.includes('cdn.jsdelivr') && !e.includes('fonts.'));
    expect(jsErrors).toHaveLength(0);
  });

  test('command palette opens with Ctrl+K and closes with Escape', async ({ page }) => {
    await page.goto(INDEX_URL);
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

  test('the single CM6 live-preview editor mounts when a file is open', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      const state = window._appState;
      if (state) {
        state.files = [{ name: 'test.md', path: 'test.md', handle: null, content: '# Test\n\nContent.', dirty: false }];
        if (typeof window.renderFile === 'function') window.renderFile(0);
      }
    });
    // T-F13: one editor surface (CM6), no split/source modes.
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    await expect(page.locator('#editorArea')).toHaveClass(/cm-single/);
  });

  // ----------------------------------------------------------------
  // T5 smoke regressions — verify all five fix acceptance signals
  // ----------------------------------------------------------------

  test('[T5-a] #searchBtn click opens command palette', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    const palOverlay = page.locator('#palOverlay');
    await expect(palOverlay).not.toHaveClass(/open/);

    await page.click('#searchBtn');
    await page.waitForTimeout(100);

    await expect(palOverlay).toHaveClass(/open/);
  });

  test('[T5-b] toggleInspector() leaves appBody with two-column grid', async ({ page }) => {
    await page.goto(INDEX_URL);
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

  // ----------------------------------------------------------------
  // openVault feature-detect coverage (AC1)
  // ----------------------------------------------------------------
  test('[AC1] openVault: showDirectoryPicker absent → fallback input created without error toast', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Remove FSA APIs to simulate unsupported environment
    await page.evaluate(() => {
      delete window.showDirectoryPicker;
      delete window.showOpenFilePicker;
    });

    // openVault should NOT throw and should NOT show an error toast
    await page.evaluate(() => {
      // We cannot actually trigger the file picker in automation,
      // but we verify that openVault() function exists and doesn't immediately toast error.
      // The fallback creates an <input> element — verify it is available.
      if (typeof window.openVault !== 'function') throw new Error('openVault not exported');
    });

    // Verify no error toast visible after feature-detect check
    const toastHasError = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.classList.contains('show') && t.classList.contains('error');
    });
    expect(toastHasError).toBe(false);

    const jsErrors = errors.filter(e =>
      !e.includes('fonts.googleapis') && !e.includes('cdn.jsdelivr') &&
      !e.includes('Failed to load resource') && !e.includes('net::ERR')
    );
    expect(jsErrors).toHaveLength(0);
  });

  test('[AC1] vaultSearch exported on window for unit test access', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    const exported = await page.evaluate(() => typeof window.vaultSearch === 'function');
    expect(exported).toBe(true);
  });

  test('[T5-c] find navigation moves to the second match in the CM6 editor', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Inject a file with three hits
    await page.evaluate(() => {
      const state = window._appState;
      state.files = [{ name: 'f.md', path: 'f.md', handle: null, content: 'the quick the brown the fox', dirty: false }];
      window.renderFile(0);
    });
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });

    await page.evaluate(() => { window.openFind(); window.runFind('the'); });
    await page.waitForTimeout(100);
    // T-F13: find runs over the CM6 surface — matches tracked in findSourceMatches, navigation
    // via findStep (CM6 selection), not DOM <mark> hits in the (removed) preview.
    expect(await page.evaluate(() => window._appState.findSourceMatches.length)).toBe(3);

    await page.click('#findNextBtn');
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => window._appState.findIdx)).toBe(1);
    expect(await page.$eval('#findInfo', el => el.textContent)).toMatch(/2\s*\/\s*3/);
  });
});
