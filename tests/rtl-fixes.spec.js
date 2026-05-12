// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const MARQAM_PATH = path.resolve(__dirname, '../marqam.html');
const MARQAM_URL = `file:///${MARQAM_PATH.replace(/\\/g, '/')}`;

/** Read computed direction of #editor via page.evaluate */
async function getEditorComputedDirection(page) {
  return page.evaluate(() =>
    getComputedStyle(document.getElementById('editor')).direction
  );
}

/** Inject markdown content and call renderFile(0) */
async function injectMarkdown(page, content) {
  return page.evaluate((md) => {
    window._marqamState.files = [{
      name: 'fixture.md', path: 'fixture.md',
      handle: null, content: md, dirty: false
    }];
    if (typeof window.renderFile === 'function') window.renderFile(0);
  }, content);
}

const ARABIC_CONTENT = fs.readFileSync(
  path.resolve(__dirname, 'fixtures/arabic-sample.md'),
  'utf8'
);

const ENGLISH_CONTENT = '# Hello World\n\nThis is an English document with no Arabic text.';

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

  // ----------------------------------------------------------------
  // AC1 — Manual RTL with Arabic content applies visible direction
  // ----------------------------------------------------------------

  test('[AC1] computed direction=rtl on #editor after toggle with Arabic content', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // Toggle RTL manually first (sets _manualRTL=true, dir=rtl on #editor)
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    // Inject Arabic content (auto-RTL: State.direction already 'rtl' so no toggle)
    await injectMarkdown(page, ARABIC_CONTENT);
    await page.waitForTimeout(200);

    // Assert dir attribute is set (pre-existing assertion class)
    await expect(page.locator('#editor')).toHaveAttribute('dir', 'rtl');

    // Assert computed direction is actually rtl (catches the CSS bug)
    const computedDir = await getEditorComputedDirection(page);
    expect(computedDir).toBe('rtl');
  });

  // ----------------------------------------------------------------
  // AC2 — Manual RTL with non-Arabic content does not break LTR
  // ----------------------------------------------------------------

  test('[AC2] computed direction returns to ltr after toggle off with English content', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, ENGLISH_CONTENT);
    await page.waitForTimeout(200);

    // Toggle on
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    const rtlDir = await getEditorComputedDirection(page);
    expect(rtlDir).toBe('rtl');

    // Toggle off — must return to ltr
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    const ltrDir = await getEditorComputedDirection(page);
    expect(ltrDir).toBe('ltr');
  });

  // ----------------------------------------------------------------
  // AC3 — Visual RTL+Arabic baseline at 1440x900 (paper theme)
  // ----------------------------------------------------------------

  test('[AC3] visual RTL+Arabic+paper baseline at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // Toggle RTL manually first, then inject Arabic (prevents auto-RTL toggle conflict)
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await injectMarkdown(page, ARABIC_CONTENT);
    await page.waitForTimeout(300);

    // Geometric assertion: paragraph text must be right-aligned in RTL mode
    const paraTextAlign = await page.evaluate(() => {
      const p = document.querySelector('#noteContent p');
      if (!p) return null;
      return getComputedStyle(p).textAlign;
    });
    // In RTL, text-align: end resolves to 'right' (or 'end' in some engines)
    // 'start' is indistinguishable from LTR default — drop it
    expect(paraTextAlign).not.toBeNull();
    expect(['right', 'end']).toContain(paraTextAlign);

    // Also verify the editor's computed direction
    const computedDir = await getEditorComputedDirection(page);
    expect(computedDir).toBe('rtl');

    await expect(page).toHaveScreenshot('rtl-arabic-paper-1440x900.png', {
      maxDiffPixels: 200,
      threshold: 0.2
    });
  });

  // ----------------------------------------------------------------
  // AC4 — RTL state persists across file switch
  // ----------------------------------------------------------------

  test('[AC4] RTL computed direction persists after switching files', async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    // Set RTL manually (_manualRTL = true, persists across file loads)
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    // Load file A (Arabic) — auto-RTL path doesn't conflict since already rtl
    await injectMarkdown(page, ARABIC_CONTENT);
    await page.waitForTimeout(200);

    await expect(page.locator('#editor')).toHaveAttribute('dir', 'rtl');
    const dirAfterA = await getEditorComputedDirection(page);
    expect(dirAfterA).toBe('rtl');

    // Load file B (English) — _manualRTL=true prevents auto-LTR revert
    await injectMarkdown(page, ENGLISH_CONTENT);
    await page.waitForTimeout(200);

    // With _manualRTL set, English content should NOT revert to ltr
    await expect(page.locator('#editor')).toHaveAttribute('dir', 'rtl');
    const dirAfterB = await getEditorComputedDirection(page);
    expect(dirAfterB).toBe('rtl');
  });

  // ----------------------------------------------------------------
  // AC5 — Console clean during RTL flows
  // ----------------------------------------------------------------

  test('[AC5] console clean during RTL toggle and file load', async ({ page }) => {
    const rtlErrors = [];

    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        const text = msg.text();
        // Filter out CDN/font noise; only capture RTL-related errors
        if (
          text.toLowerCase().includes('rtl') ||
          text.toLowerCase().includes('direction') ||
          text.toLowerCase().includes('arabic') ||
          text.toLowerCase().includes('marqam')
        ) {
          rtlErrors.push(text);
        }
      }
    });

    page.on('pageerror', err => {
      rtlErrors.push(err.message);
    });

    await page.goto(MARQAM_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, ARABIC_CONTENT);
    await page.waitForTimeout(200);

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await injectMarkdown(page, ENGLISH_CONTENT);
    await page.waitForTimeout(200);

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    expect(rtlErrors).toHaveLength(0);
  });

});
