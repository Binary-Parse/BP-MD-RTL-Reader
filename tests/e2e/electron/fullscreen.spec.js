/**
 * fullscreen.spec.js — the v10 redesign's fullscreen toggle, proven against a real
 * BrowserWindow. tests/e2e/fullscreen.spec.js already proves the button's DOM wiring
 * against a bare Chromium page over file://, but that page never goes through
 * Electron's session.setPermissionRequestHandler / setPermissionCheckHandler, which
 * deny every permission by default (src/main/window-controller.js). Only a real
 * Electron window exercises that gate, so only here can requestFullscreen() actually
 * be proven to succeed rather than being silently refused.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('fullscreen toggle @electron', () => {
  let electronApp;
  let page;
  let tempRoot;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-fullscreen-test-'));
    const profile = path.join(tempRoot, 'profile');
    fs.mkdirSync(profile);
    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile, ROOT],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        ELECTRON_ENABLE_LOGGING: '0',
      },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
  });

  test.afterEach(async () => {
    if (electronApp) {
      if (page && !page.isClosed()) {
        await page.evaluate(() => window.electronAPI.closeWindow());
      }
      await electronApp.close();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('clicking #fullscreenBtn actually fullscreens the real BrowserWindow', async () => {
    // v1.2: the toggle moved from the DOM Fullscreen API to the real OS window
    // (win.setFullScreen via 'window-set-fullscreen'). document.fullscreenElement
    // therefore never lights up; the button's own aria-pressed — driven by main's
    // enter/leave-full-screen echo — is the renderer-side state to wait on.
    const before = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen());
    expect(before).toBe(false);

    await page.locator('#fullscreenBtn').click();
    await expect(page.locator('#fullscreenBtn')).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });

    const after = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen());
    expect(after).toBe(true);
    await expect(page.locator('#fullscreenBtn use')).toHaveAttribute('href', '#ic-shrink');

    await page.locator('#fullscreenBtn').click();
    await expect(page.locator('#fullscreenBtn')).toHaveAttribute('aria-pressed', 'false', { timeout: 10000 });

    const restored = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen());
    expect(restored).toBe(false);

    // Windows' exit-fullscreen DWM animation can still be settling after isFullScreen()
    // already reports false; closing the window mid-transition destabilized the very
    // next Electron launch in this worker (a following test's window.setZoom call would
    // intermittently fail with "not a function", as if app.js hadn't finished loading —
    // reproduced consistently across full-suite runs, never in isolation). Give it a
    // beat before the afterEach hook tears the window down.
    await page.waitForTimeout(300);
  });
});
