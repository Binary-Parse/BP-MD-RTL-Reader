// @ts-check
/**
 * panels-default.spec.js — the packaged app opens to a CLEAN editor-first view: both side
 * panels (sidebar + inspector) start CLOSED, the titlebar toggles are the user's option to
 * open them, and a user's choice is remembered. Drives the renderer with a mocked Electron
 * settings bridge (the browser/dev surface keeps panels open; the packaged default is closed
 * via src/main/settings.js — modelled here by getSettings()).
 *
 * T-F18 replaced the floating reveal strips with always-visible titlebar toggles, so the
 * "how does the user reopen a closed panel" contract is asserted on those buttons now.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

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

test('packaged default: both panels start CLOSED with their titlebar toggles collapsed', async ({ page }) => {
  await withSettings(page, { ...base, sidebarVisible: false, inspectorVisible: false });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  await expect(page.locator('#appBody')).toHaveClass(/no-sidebar/);
  await expect(page.locator('#appBody')).toHaveClass(/no-inspector/);
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.inspector')).toBeHidden();
  // the user's option to open: the titlebar toggles, visible and reporting "collapsed"
  await expect(page.locator('#sidebarToggleBtn')).toBeVisible();
  await expect(page.locator('#inspectorToggleBtn')).toBeVisible();
  await expect(page.locator('#sidebarToggleBtn')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#inspectorToggleBtn')).toHaveAttribute('aria-expanded', 'false');
});

test('user can open either panel via its titlebar toggle', async ({ page }) => {
  await withSettings(page, { ...base, sidebarVisible: false, inspectorVisible: false });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });

  await page.click('#sidebarToggleBtn');
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('#appBody')).not.toHaveClass(/no-sidebar/);
  await expect(page.locator('#sidebarToggleBtn')).toHaveAttribute('aria-expanded', 'true');

  await page.click('#inspectorToggleBtn');
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('#appBody')).not.toHaveClass(/no-inspector/);
  await expect(page.locator('#inspectorToggleBtn')).toHaveAttribute('aria-expanded', 'true');
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

// T2.1: the first-run colour-scheme follow. A profile that never chose a theme
// (themeFollowSystem true, the migrated default for a NEW install) derives the theme from
// the OS scheme; a profile with a saved theme is never overridden.
test('first run on a dark system opens in ink; on a light system in paper', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await withSettings(page, { ...base, themeFollowSystem: true });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ink');
  expect(await page.evaluate(() => window._appState.theme)).toBe('ink');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  // paper is the default: no data-theme attribute is exactly as valid as data-theme="paper"
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'ink');
  expect(await page.evaluate(() => window._appState.theme)).toBe('paper');
});

test('a saved theme survives a dark system (themeFollowSystem false)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await withSettings(page, { ...base, theme: 'sepia', themeFollowSystem: false });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia');
  expect(await page.evaluate(() => window._appState.theme)).toBe('sepia');
});
