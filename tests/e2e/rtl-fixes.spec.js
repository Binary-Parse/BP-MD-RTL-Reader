// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

/** Read computed direction of #editor via page.evaluate */
async function getEditorComputedDirection(page) {
  return page.evaluate(() =>
    getComputedStyle(document.getElementById('editor')).direction
  );
}

/** Inject markdown content and call renderFile(0) */
async function injectMarkdown(page, content) {
  return page.evaluate((md) => {
    window._appState.files = [{
      name: 'fixture.md', path: 'fixture.md',
      handle: null, content: md, dirty: false
    }];
    if (typeof window.renderFile === 'function') window.renderFile(0);
    // T-F13: reveal the rendered preview (export render path) hidden behind `cm-single`.
    const ea = document.getElementById('editorArea');
    if (ea) ea.classList.remove('cm-single', 'welcome');
  }, content);
}

const ARABIC_CONTENT = fs.readFileSync(
  path.resolve(__dirname, '../fixtures/arabic-sample.md'),
  'utf8'
);

const ENGLISH_CONTENT = '# Hello World\n\nThis is an English document with no Arabic text.';

test.describe('RTL and theme bug fixes', () => {

  // ----------------------------------------------------------------
  // T1 RTL scope tests
  // ----------------------------------------------------------------

  test('[RTL-scope] after #rtlBtn click, #srcTextarea gets dir=auto', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#srcTextarea')).toHaveAttribute('dir', 'auto');
  });

  test('[RTL-scope] after #rtlBtn click, #editor gets dir=rtl', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#editor')).toHaveAttribute('dir', 'rtl');
  });

  test('[RTL-scope] after #rtlBtn click, html element does NOT get dir attribute', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('html')).not.toHaveAttribute('dir', 'rtl');
  });

  test('[RTL-scope] after #rtlBtn click, #appBody does NOT get dir attribute', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#appBody')).not.toHaveAttribute('dir');
  });

  test('[RTL-grid] .app-body computed direction is always ltr', async ({ page }) => {
    await page.goto(INDEX_URL);
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
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Toggle on
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const rtlState = await page.evaluate(() => window._appState.direction);
    expect(rtlState).toBe('rtl');

    // Toggle off
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const ltrState = await page.evaluate(() => window._appState.direction);
    expect(ltrState).toBe('ltr');
  });

  test('[RTL-toggle-clean] toggle on then off removes dir from #srcTextarea', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#srcTextarea')).not.toHaveAttribute('dir');
  });

  test('[RTL-toggle-clean] toggle on then off removes dir from #editor', async ({ page }) => {
    await page.goto(INDEX_URL);
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
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#themeBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
  });

  test('[Theme-html] #app element does NOT receive data-theme attribute', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#themeBtn');
    await page.waitForTimeout(100);

    await expect(page.locator('#app')).not.toHaveAttribute('data-theme');
  });

  test('[Theme-html] three theme button clicks cycle paper→ink→sepia→paper on html', async ({ page }) => {
    await page.goto(INDEX_URL);
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
    await page.goto(INDEX_URL);
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
    await page.goto(INDEX_URL);
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

  test('[Visual] LTR + paper theme at 1440x900 @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('ltr-paper-1440x900.png', {
      maxDiffPixels: 5000,
      threshold: 0.2
    });
  });

  test('[Visual] LTR + ink theme at 1440x900 @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#themeBtn');
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('ltr-ink-1440x900.png', {
      maxDiffPixels: 5000,
      threshold: 0.2
    });
  });

  test('[Visual] RTL + paper theme at 1440x900 @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#rtlBtn');
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('rtl-paper-1440x900.png', {
      maxDiffPixels: 5000,
      threshold: 0.2
    });
  });

  test('[Visual] RTL + ink theme at 1440x900 @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await page.click('#themeBtn');
    await page.waitForTimeout(200);
    await page.click('#rtlBtn');
    await page.waitForTimeout(300);

    await expect(page).toHaveScreenshot('rtl-ink-1440x900.png', {
      maxDiffPixels: 5000,
      threshold: 0.2
    });
  });

  // ----------------------------------------------------------------
  // AC1 — Manual RTL with Arabic content applies visible direction
  // ----------------------------------------------------------------

  test('[AC1] computed direction=rtl on #editor after toggle with Arabic content', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Per-note direction: load Arabic content first, then force RTL on that note.
    await injectMarkdown(page, ARABIC_CONTENT);
    await page.waitForTimeout(200);

    // Toggle RTL — attaches to the now-active note (sets _manualRTL=true, dir=rtl on #editor).
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

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
    await page.goto(INDEX_URL);
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

  test('[AC3] visual RTL+Arabic+paper baseline at 1440x900 @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Per-note direction: load Arabic content first, then force RTL on that note.
    await injectMarkdown(page, ARABIC_CONTENT);
    await page.waitForTimeout(300);

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    // Geometric assertion: paragraph text must be right-aligned in RTL mode
    const paraTextAlign = await page.evaluate(() => {
      const p = document.querySelector('#noteContent p');
      if (!p) return null;
      return getComputedStyle(p).textAlign;
    });
    // In RTL, text-align may resolve to 'right', 'end', or 'start' depending
    // on the engine. 'start' in an RTL container is semantically right-aligned.
    expect(paraTextAlign).not.toBeNull();

    // Also verify the editor's computed direction
    const computedDir = await getEditorComputedDirection(page);
    expect(computedDir).toBe('rtl');

    // Accept 'start' only when direction is confirmed RTL; otherwise require 'right'/'end'
    if (computedDir === 'rtl' && paraTextAlign === 'start') {
      // Chromium may report 'start' for text-align:right inside RTL — acceptable
    } else {
      expect(['right', 'end']).toContain(paraTextAlign);
    }

    await expect(page).toHaveScreenshot('rtl-arabic-paper-1440x900.png', {
      maxDiffPixels: 5000,
      threshold: 0.2
    });
  });

  // ----------------------------------------------------------------
  // AC4 — per-note direction: restored on return to its tab, isolated from other tabs
  // ----------------------------------------------------------------

  test('[AC4] per-note RTL is restored on return to its tab and does not leak to other tabs', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    // Two open tabs — A (Arabic) and B (English) — both starting in AUTO.
    await page.evaluate(({ ar, en }) => {
      window._appState.files = [
        { name: 'a.md', path: 'a.md', handle: null, content: ar, dirty: false },
        { name: 'b.md', path: 'b.md', handle: null, content: en, dirty: false },
      ];
      window.renderFile(0);
      document.getElementById('editorArea').classList.remove('cm-single', 'welcome');
    }, { ar: ARABIC_CONTENT, en: ENGLISH_CONTENT });

    // Force RTL on tab A — the choice attaches to that note.
    await page.click('#rtlBtn');
    await page.waitForTimeout(100);
    await expect(page.locator('#editor')).toHaveAttribute('dir', 'rtl');
    expect(await getEditorComputedDirection(page)).toBe('rtl');

    // Switch to tab B — it keeps its own AUTO direction, NOT tab A's forced RTL.
    await page.evaluate(() => window.renderFile(1));
    await page.waitForTimeout(100);
    await expect(page.locator('#editor')).not.toHaveAttribute('dir', 'rtl');
    expect(await getEditorComputedDirection(page)).toBe('ltr');

    // Return to tab A — its forced RTL is restored.
    await page.evaluate(() => window.renderFile(0));
    await page.waitForTimeout(100);
    await expect(page.locator('#editor')).toHaveAttribute('dir', 'rtl');
    expect(await getEditorComputedDirection(page)).toBe('rtl');
  });

  // ----------------------------------------------------------------
  // AC6/AC7/AC8 shared fixture: Arabic markdown with h1, h2, h3
  // ----------------------------------------------------------------

  const RTL_HEADINGS_MD = [
    '# عنوان رئيسي',
    '',
    'نص عربي.',
    '',
    '## عنوان ثانوي',
    '',
    'نص عربي.',
    '',
    '### عنوان ثالثي',
    '',
    'نص عربي.'
  ].join('\n');

  // ----------------------------------------------------------------
  // AC6 — h1 text-align resolves to right/end in RTL mode
  // ----------------------------------------------------------------

  test('[AC6] h1 textAlign is right or end when #editor[dir=rtl]', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const textAlign = await page.evaluate(() => {
      const h1 = document.querySelector('#noteContent h1');
      if (!h1) return null;
      return getComputedStyle(h1).textAlign;
    });

    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
  });

  // ----------------------------------------------------------------
  // AC7 — h2 text-align resolves to right/end in RTL mode
  // ----------------------------------------------------------------

  test('[AC7] h2 textAlign is right or end when #editor[dir=rtl]', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const textAlign = await page.evaluate(() => {
      const h2 = document.querySelector('#noteContent h2');
      if (!h2) return null;
      return getComputedStyle(h2).textAlign;
    });

    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
  });

  // ----------------------------------------------------------------
  // AC8 — h3 text-align resolves to right/end in RTL mode
  // ----------------------------------------------------------------

  test('[AC8] h3 textAlign is right or end when #editor[dir=rtl]', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');

    await injectMarkdown(page, RTL_HEADINGS_MD);
    await page.waitForTimeout(200);

    await page.click('#rtlBtn');
    await page.waitForTimeout(100);

    const textAlign = await page.evaluate(() => {
      const h3 = document.querySelector('#noteContent h3');
      if (!h3) return null;
      return getComputedStyle(h3).textAlign;
    });

    expect(textAlign).not.toBeNull();
    expect(['right', 'end']).toContain(textAlign);
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
          text.toLowerCase().includes('bp md rtl reader')
        ) {
          rtlErrors.push(text);
        }
      }
    });

    page.on('pageerror', err => {
      rtlErrors.push(err.message);
    });

    await page.goto(INDEX_URL);
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
