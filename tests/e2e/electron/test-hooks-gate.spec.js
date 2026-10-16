const { test, expect, _electron: electron } = require('@playwright/test');
const { closeApp } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// QA-L2 / M3: outside a test run the page keeps its functions and state off `window`, and
// the real IPC still works through the sender-frame guard (origin app://ui, top frame).
test.describe('test hooks and IPC guard in a real Electron run @electron', () => {
  let electronApp;
  let page;
  let tempRoot;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-hooks-test-'));
    const profile = path.join(tempRoot, 'profile');
    fs.mkdirSync(profile);
    const notePath = path.join(tempRoot, 'note.md');
    fs.writeFileSync(notePath, '# Hooks\n\nbody', 'utf8');
    const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' };
    delete env.BPMD_TEST;
    electronApp = await electron.launch({ args: ['--user-data-dir=' + profile, ROOT, notePath], env });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
  });

  test.afterEach(async () => {
    await closeApp(electronApp, page);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('no test hooks on window, and the note opened through the guarded IPC', async () => {
    const exposed = await page.evaluate(() => ({
      state: typeof window._appState,
      render: typeof window.renderFile,
      search: location.search,
    }));
    expect(exposed).toEqual({ state: 'undefined', render: 'undefined', search: '' });
    // Opening the note crosses fs IPC handlers; it renders only if the guard let them through.
    await expect(page.locator('#noteContent h1, .cm-content').first()).toContainText('Hooks');
  });

  // APP-12: the gate that pauses autosave while a Save prompt is open is module state. On
  // window, any script in the page could set it and switch autosave off.
  test('an open Save prompt leaves no gate flag on window', async () => {
    const editor = page.locator('.cm-content');
    await expect(page.locator('#noteContent h1, .cm-content').first()).toContainText('Hooks');
    if (!(await editor.isVisible())) await page.keyboard.press('Control+e'); // to Edit mode
    await editor.click();
    await page.keyboard.type('x');
    await page.keyboard.press('Control+w');
    await expect(page.locator('#dlgCancelBtn')).toBeVisible({ timeout: 10000 });
    const gates = await page.evaluate(() => ['_saveDialogOpen', '_closeFlowActive', '_recoveryPromptOpen', '_recoveryDismissed']
      .filter((name) => name in window));
    await page.locator('#dlgCancelBtn').click();
    expect(gates).toEqual([]);
  });
});
