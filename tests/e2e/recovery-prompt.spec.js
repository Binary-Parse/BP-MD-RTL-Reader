// @ts-check
/**
 * recovery-prompt.spec.js — audit QA-06 (latent shape bug).
 *
 * main's `recovery:pop` handler resolves `{ok, files}`; the renderer used to test
 * `Array.isArray(snaps)` on that whole object, so the recovery dialog could NEVER appear.
 * This boots the renderer with a mocked bridge and proves the dialog appears, that
 * Restore reopens the snapshot as a dirty tab, and that an unreadable snapshot is
 * reported instead of silently dropped.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = `file:///${path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/')}`;

const DEFAULTS = {
  theme: 'paper', zoomFactor: 1, editorMode: 'live',
  sidebarVisible: true, inspectorVisible: true,
  uiDirection: 'ltr', uiLocale: 'en',
  calendar: 'gregorian', arabicKashida: false, italicRecolor: true,
  recents: [], window: { w: 1280, h: 820, maximized: false }, lastSession: null,
};

async function bootWithRecovery(page, popResult) {
  await page.addInitScript(({ settings, pop }) => {
    const noop = () => {};
    window.electronAPI = {
      closeWindow: noop, minimizeWindow: noop, maximizeWindow: noop,
      openFolder: async () => ({ canceled: true }),
      readVault: async () => ({ error: 'unauthorized-capability' }),
      writeFile: async () => ({ ok: true }),
      recoveryPop: async () => pop,
      recoverySnapshot: async () => ({ ok: true }),
      recoveryClear: async () => { window.__recoveryClearCalls = (window.__recoveryClearCalls || 0) + 1; return { ok: true }; },
      getSettings: async () => settings,
      setSettings: async () => ({ ok: true }),
      exportPDF: async () => ({ ok: true }),
      editCommand: noop, onOpenFile: noop, onVaultChanged: noop,
      checkForUpdate: async () => ({}), logError: noop,
    };
  }, { settings: DEFAULTS, pop: popResult });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app', { state: 'visible' });
}

test.describe('[QA-06] recovery prompt', () => {
  test('a snapshot in the {ok, files} shape actually opens the dialog and restores a dirty tab', async ({ page }) => {
    await bootWithRecovery(page, { ok: true, files: [{ name: 'recovered.md', content: '# Recovered' }] });

    // The prompt is offered automatically at boot — this is the regression guard.
    await page.waitForSelector('#recoveryRestoreBtn', { state: 'visible' });
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);

    await page.locator('#recoveryRestoreBtn').click();
    await page.waitForFunction(() => window._appState.files.some((f) => f.name === 'recovered.md' && f.dirty));
    const restored = await page.evaluate(() => {
      const f = window._appState.files.find((file) => file.name === 'recovered.md');
      return { content: f.content, dirty: f.dirty };
    });
    expect(restored).toEqual({ content: '# Recovered', dirty: true });
    // An explicit Restore consumes the snapshot.
    await page.waitForFunction(() => (window.__recoveryClearCalls || 0) === 1);
  });

  test('an Escape-dismiss never clears the snapshot; an explicit Discard does', async ({ page }) => {
    await bootWithRecovery(page, { ok: true, files: [{ name: 'recovered.md', content: '# Recovered' }] });
    await page.waitForSelector('#recoveryRestoreBtn', { state: 'visible' });
    await page.keyboard.press('Escape');
    expect(await page.locator('#modalOverlay')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => window.__recoveryClearCalls || 0)).toBe(0);

    // Undecided snapshot re-offers; the user now discards explicitly.
    await page.evaluate(() => { void window._offerRecovery(); });
    await page.waitForSelector('#recoveryDiscardBtn', { state: 'visible' });
    await page.locator('#recoveryDiscardBtn').click();
    await page.waitForFunction(() => (window.__recoveryClearCalls || 0) === 1);
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
  });

  test('an unreadable snapshot is announced and opens no dialog', async ({ page }) => {
    await bootWithRecovery(page, { ok: true, files: [], unreadable: 1 });
    await expect(page.locator('#toast')).toContainText('could not be read');
    expect(await page.locator('#recoveryRestoreBtn').count()).toBe(0);
  });

  test('an empty snapshot opens no dialog (normal launch)', async ({ page }) => {
    await bootWithRecovery(page, { ok: true, files: [] });
    expect(await page.locator('#recoveryRestoreBtn').count()).toBe(0);
    expect(await page.evaluate(() => window._appState.files.length)).toBe(0);
  });
});
