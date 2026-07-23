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
    expect(shell.fontSize).toBeCloseTo(17, 1);

    await injectNote(page);
    const documentSurface = await page.evaluate(() => {
      const note = document.getElementById('noteContent');
      return {
        maxWidth: getComputedStyle(note).maxWidth,
        fontSize: parseFloat(getComputedStyle(note).fontSize),
      };
    });

    expect(documentSurface.maxWidth).not.toBe('none');
    expect(documentSurface.fontSize).toBeCloseTo(22.1, 1);
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
