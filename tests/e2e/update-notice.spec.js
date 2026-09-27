// @ts-check
/**
 * update-notice.spec.js — T7.1: the OPT-IN update check's renderer half — the notice card
 * (message + View release + Dismiss) and the Settings switch that turns the check on.
 *
 * The network side lives in main (see tests/unit/main-auto-update.test.js); here the bridge is
 * mocked so the notice, the switch and the persistence can be driven deterministically.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = `file:///${path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/')}`;

const DEFAULTS = {
  theme: 'paper', zoomFactor: 1, editorMode: 'live', viewMode: 'reading',
  sidebarVisible: true, inspectorVisible: true,
  uiDirection: 'ltr', uiLocale: 'en',
  calendar: 'gregorian', arabicKashida: false, italicRecolor: true,
  updateCheck: 'manual',
  window: { w: 1280, h: 820, maximized: false }, lastSession: null,
};

async function boot(page, { settings = DEFAULTS, autoCheckResult = null } = {}) {
  await page.addInitScript(({ settings, autoCheckResult }) => {
    window.__setSettingsCalls = [];
    window.__autoCheckCalls = 0;
    window.__releasePageCalls = 0;
    window.__updateListener = null;
    window.electronAPI = {
      getSettings: async () => settings,
      setSettings: async (patch) => { window.__setSettingsCalls.push(patch); return { ok: true }; },
      onOpenFile: () => {}, onVaultChanged: () => {},
      onUpdateAvailable: (cb) => { window.__updateListener = cb; },
      autoUpdateCheck: async () => {
        window.__autoCheckCalls += 1;
        return autoCheckResult || { checked: true, current: '1.3.0', latest: '1.3.0', updateAvailable: false };
      },
      openReleasePage: async () => { window.__releasePageCalls += 1; return { ok: true }; },
    };
  }, { settings, autoCheckResult });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
}

test.describe('[T7.1] opt-in update notice', () => {
  test('the update check is OFF by default and nothing is requested at boot', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window._appState.updateCheck)).toBe('manual');
    expect(await page.evaluate(() => window.__autoCheckCalls)).toBe(0);
    await expect(page.locator('#updateBar')).toHaveCount(0); // never even created
  });

  test('main reporting a newer release shows the notice with a version and both actions', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__updateListener({ latest: '1.4.0', current: '1.3.0' }));
    const bar = page.locator('#updateBar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Version 1.4.0 is available.');
    await expect(page.locator('#updateViewBtn')).toHaveText('View release');
    await expect(page.locator('#updateDismissBtn')).toHaveText('Dismiss');
    await expect(bar).toHaveAttribute('role', 'status');
  });

  test('"View release" asks main to open the release page and closes the notice', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__updateListener({ latest: '2.0.0' }));
    await page.click('#updateViewBtn');
    expect(await page.evaluate(() => window.__releasePageCalls)).toBe(1);
    await expect(page.locator('#updateBar')).toBeHidden();
  });

  test('"Dismiss" closes the notice without opening anything', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__updateListener({ latest: '2.0.0' }));
    await page.click('#updateDismissBtn');
    await expect(page.locator('#updateBar')).toBeHidden();
    expect(await page.evaluate(() => window.__releasePageCalls)).toBe(0);
  });

  test('an empty or missing version never renders a notice', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window.showUpdateNotice({ latest: '' }); window.showUpdateNotice({}); });
    await expect(page.locator('#updateBar')).toHaveCount(0);
  });

  test('the Settings switch is off by default, turns the check on, and persists it', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.showSettings());
    const toggle = page.locator('#setUpdateAuto');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('#modalOverlay')).toContainText('Check for updates automatically');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => window._appState.updateCheck)).toBe('auto');
    // Turning it ON checks immediately, so the switch has a visible effect.
    await expect.poll(() => page.evaluate(() => window.__autoCheckCalls)).toBe(1);
    // …and the choice is persisted through the settings bridge.
    await expect.poll(
      () => page.evaluate(() => (window.__setSettingsCalls || []).some((c) => c.updateCheck === 'auto')),
      { timeout: 3000 }
    ).toBe(true);
  });

  test('enabling the switch and finding an update shows the notice — and stays quiet when up to date', async ({ page }) => {
    await boot(page, { autoCheckResult: { checked: true, current: '1.3.0', latest: '1.9.0', updateAvailable: true } });
    await page.evaluate(() => window.showSettings());
    await page.click('#setUpdateAuto');
    await expect(page.locator('#updateBar')).toContainText('Version 1.9.0 is available.');

    await boot(page, { autoCheckResult: { checked: true, current: '1.3.0', latest: '1.3.0', updateAvailable: false } });
    await page.evaluate(() => window.showSettings());
    await page.click('#setUpdateAuto');
    await expect(page.locator('#updateBar')).toHaveCount(0);
  });

  test('a persisted "auto" restores the switch as ON', async ({ page }) => {
    await boot(page, { settings: { ...DEFAULTS, updateCheck: 'auto' } });
    expect(await page.evaluate(() => window._appState.updateCheck)).toBe('auto');
    await page.evaluate(() => window.showSettings());
    await expect(page.locator('#setUpdateAuto')).toHaveAttribute('aria-checked', 'true');
  });

  test('turning the switch back OFF returns to manual', async ({ page }) => {
    await boot(page, { settings: { ...DEFAULTS, updateCheck: 'auto' } });
    await page.evaluate(() => window.showSettings());
    await page.click('#setUpdateAuto');
    expect(await page.evaluate(() => window._appState.updateCheck)).toBe('manual');
    await expect(page.locator('#setUpdateAuto')).toHaveAttribute('aria-checked', 'false');
    // No further check is requested from the renderer when the setting goes back to manual.
    await expect.poll(() => page.evaluate(() => window.__autoCheckCalls)).toBe(0);
  });

  test('the notice is localized (Arabic) with the same two actions', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.setArabicUI(true));
    await page.evaluate(() => window.__updateListener({ latest: '1.4.0' }));
    await expect(page.locator('#updateBar')).toContainText('يتوفر الإصدار 1.4.0.');
    await expect(page.locator('#updateViewBtn')).toHaveText('عرض الإصدار');
    await expect(page.locator('#updateDismissBtn')).toHaveText('تجاهل');
  });
});
