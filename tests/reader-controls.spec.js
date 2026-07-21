// @ts-check
/**
 * Reader controls — document-only text scale and content measure. The controls
 * deliberately use the existing global-settings bridge, while app zoom keeps
 * its separate whole-window behaviour.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');

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
