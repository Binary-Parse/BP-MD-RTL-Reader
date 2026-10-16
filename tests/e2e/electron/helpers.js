// QA-N4: one way to end an Electron test. Under load the app can take longer than the test's
// own budget to close, so the teardown gets its own 30 s, and a close that still hangs after
// 10 s kills the process instead of failing an otherwise green test.
const { test } = require('@playwright/test');

const CLOSE_GRACE_MS = 10_000;

/**
 * @param {import('@playwright/test').ElectronApplication | undefined} electronApp
 * @param {import('@playwright/test').Page | undefined} page
 * @param {{ exit?: boolean }} [options] exit: leave without the close flow (unsaved work on purpose)
 */
async function closeApp(electronApp, page, { exit = false } = {}) {
  if (!electronApp) return;
  test.info().setTimeout(test.info().timeout + 30_000);
  if (exit) {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
  } else if (page && !page.isClosed()) {
    // Approve the production close handshake first; closing the process directly would hit
    // the native-close interception and wait for the renderer's answer.
    await page.evaluate(() => window.electronAPI.closeWindow()).catch(() => {});
  }
  let timer;
  const closed = await Promise.race([
    electronApp.close().then(() => true, () => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), CLOSE_GRACE_MS); }),
  ]);
  clearTimeout(timer);
  if (!closed) {
    try { electronApp.process().kill(); } catch (_) { /* already gone */ }
  }
}

module.exports = { closeApp };
