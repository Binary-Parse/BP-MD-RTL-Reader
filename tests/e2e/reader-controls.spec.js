// @ts-check
/**
 * Reader controls — document-only text scale and content measure. The controls
 * deliberately use the existing global-settings bridge, while app zoom keeps
 * its separate whole-window behaviour.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function boot(page, settings = {}) {
  const saved = {
    theme: 'paper', zoomFactor: 1, editorMode: 'live', viewMode: 'reading',
    sidebarVisible: false, inspectorVisible: false, recents: [], lastSession: null,
    readerTextScale: 1.2, readerWidthCh: 84,
    ...settings,
  };
  await page.addInitScript((initialSettings) => {
    window.__readerSettingsWrites = [];
    window.electronAPI = {
      getSettings: async () => initialSettings,
      setSettings: async (payload) => { window.__readerSettingsWrites.push(payload); return { ok: true }; },
      onOpenFile: () => {}, onVaultChanged: () => {},
    };
  }, saved);
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
}

async function injectNote(page) {
  await page.evaluate(() => {
    window._appState.files = [{
      name: 'reader-controls.md', path: 'reader-controls.md', dirty: false,
      content: '# Reader controls\n\nThis note has enough prose to exercise the shared controls.',
    }];
    window.renderFile(0);
  });
}

test.describe('Reader controls', () => {
  test('stay hidden on welcome, then appear in both Reading and Edit within the shared content pane', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#readerControlsButton')).toBeHidden();
    await injectNote(page);
    await expect(page.locator('#readerControlsButton')).toBeVisible();
    await expect(page.locator('#editorArea')).toHaveClass(/reading/);

    await page.evaluate(() => window.setViewMode('edit'));
    await expect(page.locator('#editorArea')).not.toHaveClass(/reading/);
    await expect(page.locator('#readerControlsButton')).toBeVisible();
  });

  test('does not apply reader width or text scale to the welcome editor shell at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page, { readerTextScale: 1.3, readerWidthCh: 48 });
    await expect(page.locator('#welcome')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({
      scale: document.documentElement.style.getPropertyValue('--reader-text-scale'),
      width: document.documentElement.style.getPropertyValue('--reader-width'),
    }))).toEqual({ scale: '1.3', width: '48ch' });

    const shell = await page.evaluate(() => {
      const editor = document.getElementById('editor');
      return {
        maxWidth: getComputedStyle(editor).maxWidth,
        fontSize: parseFloat(getComputedStyle(editor).fontSize),
      };
    });

    expect(shell.maxWidth).toBe('800px');
    // v10 redesign (2026-08-25): .editor base font-size 1.0625->1.125rem (17->18px).
    expect(shell.fontSize).toBeCloseTo(18, 1);

    await injectNote(page);
    const documentSurface = await page.evaluate(() => {
      const note = document.getElementById('noteContent');
      return {
        maxWidth: getComputedStyle(note).maxWidth,
        fontSize: parseFloat(getComputedStyle(note).fontSize),
      };
    });

    expect(documentSurface.maxWidth).not.toBe('none');
    // v10: #noteContent base 1.0625->1.125rem; scaled by readerTextScale 1.3 -> 23.4px.
    expect(documentSurface.fontSize).toBeCloseTo(23.4, 1);
  });


  test('restores reader preferences, applies them immediately, and persists user adjustments', async ({ page }) => {
    await boot(page, { readerTextScale: 1.2, readerWidthCh: 84 });
    await expect.poll(() => page.evaluate(() => ({
      scale: window._appState.readerTextScale,
      width: window._appState.readerWidthCh,
      cssScale: document.documentElement.style.getPropertyValue('--reader-text-scale'),
      cssWidth: document.documentElement.style.getPropertyValue('--reader-width'),
    }))).toEqual({ scale: 1.2, width: 84, cssScale: '1.2', cssWidth: '84ch' });

    await injectNote(page);
    await page.locator('#readerControlsButton').click();
    await expect(page.locator('#readerControlsPopover')).toBeVisible();
    await page.locator('#readerTextScaleIncrease').click();
    await expect(page.locator('#readerTextScaleReset')).toHaveText('130%');
    await page.locator('#readerWidthSlider').evaluate((input) => {
      input.value = '94';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(() => page.evaluate(() => ({
      scale: window._appState.readerTextScale,
      width: window._appState.readerWidthCh,
      cssScale: document.documentElement.style.getPropertyValue('--reader-text-scale'),
      cssWidth: document.documentElement.style.getPropertyValue('--reader-width'),
    }))).toEqual({ scale: 1.3, width: 94, cssScale: '1.3', cssWidth: '94ch' });
    await page.waitForFunction(() => window.__readerSettingsWrites.some((write) =>
      write.readerTextScale === 1.3 && write.readerWidthCh === 94), null, { timeout: 3000 });

    await page.locator('#readerTextScaleReset').click();
    await expect.poll(() => page.evaluate(() => window._appState.readerTextScale)).toBe(1);
  });

  test('uses Aa controls to clamp text scale and content width at their advertised boundaries', async ({ page }) => {
    await boot(page, { readerTextScale: 1, readerWidthCh: 72 });
    await injectNote(page);
    await page.locator('#readerControlsButton').click();

    const decrease = page.locator('#readerTextScaleDecrease');
    const increase = page.locator('#readerTextScaleIncrease');
    const reset = page.locator('#readerTextScaleReset');
    const width = page.locator('#readerWidthSlider');

    await decrease.click();
    await decrease.click();
    await expect(reset).toHaveText('80%');
    await expect.poll(() => page.evaluate(() => window._appState.readerTextScale)).toBe(0.8);
    await decrease.click();
    await expect(reset).toHaveText('80%');
    await expect.poll(() => page.evaluate(() => window._appState.readerTextScale)).toBe(0.8);

    for (let i = 0; i < 12; i += 1) await increase.click();
    await expect(reset).toHaveText('200%');
    await expect.poll(() => page.evaluate(() => window._appState.readerTextScale)).toBe(2);
    await increase.click();
    await expect(reset).toHaveText('200%');
    await expect.poll(() => page.evaluate(() => window._appState.readerTextScale)).toBe(2);

    await width.focus();
    await page.keyboard.press('Home');
    await expect(width).toHaveValue('48');
    await expect(page.locator('#readerWidthValue')).toHaveText('48ch');
    await expect.poll(() => page.evaluate(() => window._appState.readerWidthCh)).toBe(48);
    await page.keyboard.press('ArrowRight');
    await expect(width).toHaveValue('50');
    await page.keyboard.press('ArrowLeft');
    await expect(width).toHaveValue('48');

    await page.keyboard.press('End');
    await expect(width).toHaveValue('120');
    await expect(page.locator('#readerWidthValue')).toHaveText('120ch');
    await expect.poll(() => page.evaluate(() => window._appState.readerWidthCh)).toBe(120);
    await page.keyboard.press('ArrowRight');
    await expect(width).toHaveValue('120');
    await expect.poll(() => page.evaluate(() => window._appState.readerWidthCh)).toBe(120);
  });

  test('widens the reading surface as content width increases past the document shell (regression)', async ({ page }) => {
    // The document shell (.editor) used to keep a legacy max-width:800px that re-capped the
    // reader measure to ~640px, so "increase content width" did nothing past ~75ch while
    // "decrease" worked. At a wide viewport, 80ch and 120ch both clear that old cap — so with
    // the bug their rendered widths were equal, and only the fix makes 120ch measurably wider.
    await page.setViewportSize({ width: 1600, height: 900 });
    await boot(page, { viewMode: 'reading', readerWidthCh: 72 });
    await injectNote(page);
    await expect(page.locator('#editorArea')).toHaveClass(/reading/);

    const noteWidthAt = (ch) => page.evaluate((value) => {
      const slider = document.getElementById('readerWidthSlider');
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById('noteContent').clientWidth;
    }, ch);

    const w80 = await noteWidthAt(80);
    const w120 = await noteWidthAt(120);
    expect(w120).toBeGreaterThan(w80 + 100);
  });

  // A7 (v10 redesign follow-up): the test above only exercises the widest possible
  // configuration (1600x900, both panels closed). Change any one input and the slider goes
  // back to being a no-op — the dominant term at realistic sizes is .editor's own FIXED
  // padding (56px 80px 120px), not the 800px cap the test above targets. At the packaged
  // default window (1280x820, main/settings.js) with both panels open, the pane is only
  // 1280 - 240 (sidebar) - 300 (inspector) = 740px, minus 2x80px padding = 580px available —
  // less than even the 72ch default, so every further increase renders identically.
  //
  // 580px is a genuine ceiling here even after the fix (740px pane minus a responsive but
  // still-nonzero padding still clips both 72ch and 120ch, which is why the "widens..." test
  // above can compare two ch values directly and this one can't) — so this asserts the fixed
  // 160px tax is gone, not that 120ch ends up wider than 72ch at this specific width.
  test('the content-width slider is not capped at 580px at the packaged default window with both panels open', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await boot(page, { viewMode: 'reading', sidebarVisible: true, inspectorVisible: true, readerWidthCh: 72 });
    await injectNote(page);
    await expect(page.locator('#editorArea')).toHaveClass(/reading/);

    const noteWidthAt = (ch) => page.evaluate((value) => {
      const slider = document.getElementById('readerWidthSlider');
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById('noteContent').clientWidth;
    }, ch);

    const w120 = await noteWidthAt(120);
    expect(w120).toBeGreaterThan(580);
  });

  // The 800px shell cap's `.editor-area.reading:not(.welcome)` carve-out excludes every other
  // mode. When CM6 fails to load, cm-single is never added, so the editor-area falls back to
  // the plain two-pane live view (viewMode 'edit', no reading/split/source/cm-single class) —
  // the preview pane's #editor keeps the un-carved-out 800px cap (640px content box after its
  // own 160px padding), a HARD ceiling independent of how wide the window is.
  test('the content-width slider is not capped at 640px when CM6 fails to load (plain two-pane fallback)', async ({ page }) => {
    await page.route('**/codemirror.min.js', (route) => route.abort());
    await page.setViewportSize({ width: 1440, height: 900 });
    await boot(page, { viewMode: 'edit', readerWidthCh: 120 });
    await injectNote(page);
    await expect(page.locator('#editorArea')).not.toHaveClass(/cm-single/);

    const width = await page.evaluate(() => document.getElementById('noteContent').clientWidth);
    expect(width).toBeGreaterThan(640);
  });

  // The v10 pass moved .editor / #noteContent to 1.125rem but left .cm-mount .cm-scroller at
  // the pre-redesign 1.0625rem — same --reader-width, but `ch` resolves against each element's
  // OWN font, so Reading and Edit measure the same setting differently.
  test('Reading and Edit render the same content width setting within 2% of each other', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await boot(page, { viewMode: 'reading', readerWidthCh: 72 });
    await injectNote(page);
    await page.waitForSelector('.cm-mount .cm-content', { state: 'attached' });
    const readingWidth = await page.evaluate(() => document.getElementById('noteContent').clientWidth);

    await page.evaluate(() => window.setViewMode('edit'));
    await expect(page.locator('#editorArea')).toHaveClass(/cm-single/);
    await expect(page.locator('#editorArea')).not.toHaveClass(/reading/);
    const editWidth = await page.evaluate(() =>
      document.querySelector('.cm-mount .cm-content').clientWidth);

    expect(editWidth).toBeGreaterThan(0);
    expect(Math.abs(readingWidth - editWidth) / readingWidth).toBeLessThan(0.02);
  });

  test('is a non-modal popover that closes on Escape or outside press and returns focus to Aa', async ({ page }) => {
    await boot(page);
    await injectNote(page);
    const trigger = page.locator('#readerControlsButton');
    await trigger.click();
    await expect(page.locator('#readerControlsPopover')).toHaveAttribute('aria-modal', 'false');
    await page.locator('#readerWidthSlider').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#readerControlsPopover')).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.locator('#noteContent').click();
    await expect(page.locator('#readerControlsPopover')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('gives Find precedence over the Aa popover across stacked Escape presses', async ({ page }) => {
    await boot(page);
    await injectNote(page);
    const trigger = page.locator('#readerControlsButton');

    await trigger.click();
    await expect(page.locator('#readerControlsPopover')).toBeVisible();
    await page.keyboard.press('Control+f');
    await expect(page.locator('#findBar')).toHaveClass(/open/);
    await expect(page.locator('#readerControlsPopover')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#findBar')).not.toHaveClass(/open/);
    await expect(page.locator('#readerControlsPopover')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#readerControlsPopover')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('localizes reader-control labels and accessible names with the Arabic interface', async ({ page }) => {
    await boot(page);
    await injectNote(page);
    await page.evaluate(() => window.setArabicUI(true));
    await page.locator('#readerControlsButton').click();
    await expect(page.locator('#readerControlsTitle')).toHaveText('إعدادات القراءة');
    await expect(page.locator('#readerControlsButton')).toHaveAttribute('aria-label', 'إعدادات القراءة');
    await expect(page.locator('#readerTextScaleIncrease')).toHaveAttribute('aria-label', 'زيادة حجم النص');
    await expect(page.locator('#readerWidthLabel')).toHaveText('عرض المحتوى');
  });

  test('keeps the root-font zoom fallback when the native bridge is unavailable', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
    await page.evaluate(() => window.setZoom(1.4));
    await expect.poll(() => page.evaluate(() => ({
      zoom: window._appState.zoomFactor,
      root: document.documentElement.style.fontSize,
      editor: document.getElementById('editorArea').style.zoom,
    }))).toEqual({ zoom: 1.4, root: '22.4px', editor: '' });
  });
});
