// @ts-check
/**
 * panels-default.spec.js — the packaged app opens to a CLEAN editor-first view: both side
 * panels (sidebar + inspector) start CLOSED, the reveal strips are the user's option to open
 * them, and a user's choice is remembered. Drives the renderer with a mocked Electron settings
 * bridge (the browser/dev surface keeps panels open; the packaged default is closed via
 * src/main/settings.js — modelled here by getSettings()).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');

// Inject a minimal electronAPI whose getSettings returns `settings` (no DOM yet — runs pre-load).
async function withSettings(page, settings) {
  await page.addInitScript((s) => {
    window.electronAPI = {
      getSettings: async () => s,
      setSettings: async () => {},
      onOpenFile: () => {}, onVaultChanged: () => {},
    };
  }, settings);
}
const base = { theme: 'paper', zoomFactor: 1, editorMode: 'live', recents: [], lastSession: null };

test('packaged default: both panels start CLOSED with reveal strips (no panels shown)', async ({ page }) => {
  await withSettings(page, { ...base, sidebarVisible: false, inspectorVisible: false });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  await expect(page.locator('#appBody')).toHaveClass(/no-sidebar/);
  await expect(page.locator('#appBody')).toHaveClass(/no-inspector/);
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.inspector')).toBeHidden();
  // the user's option to open
  await expect(page.locator('.reveal-sidebar')).toBeVisible();
  await expect(page.locator('.reveal-inspector')).toBeVisible();
});

test('user can open a panel via its reveal strip', async ({ page }) => {
  await withSettings(page, { ...base, sidebarVisible: false, inspectorVisible: false });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  await page.click('.reveal-sidebar');
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('#appBody')).not.toHaveClass(/no-sidebar/);
});

test('a remembered open panel is restored (persistence)', async ({ page }) => {
  await withSettings(page, { ...base, sidebarVisible: true, inspectorVisible: false });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  // saved sidebar=open → restored open; inspector stays closed
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('#appBody')).toHaveClass(/no-inspector/);
  expect(await page.evaluate(() => window._appState.sidebarVisible)).toBe(true);
  expect(await page.evaluate(() => window._appState.inspectorVisible)).toBe(false);
});
