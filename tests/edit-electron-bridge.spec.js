// @ts-check
/**
 * Verifies that when window.electronAPI.editCommand is available (packaged
 * Electron), execEditCmd routes Copy/Cut/Paste/Undo/Redo/SelectAll through
 * the native IPC bridge instead of trying JS-side selection/clipboard tricks.
 *
 * This is the real-world Electron path; the previous focus-tracking fallback
 * (covered by edit-menu-click-through.spec.js) is the file://-loaded
 * Playwright path. Both must work.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');

async function gotoWithElectronMock(page) {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });
  // Install a spy that records every editCommand call
  await page.evaluate(() => {
    window.__editCommandCalls = [];
    window.electronAPI = window.electronAPI || {};
    window.electronAPI.editCommand = (cmd) => {
      window.__editCommandCalls.push(cmd);
    };
  });
}

async function clickEditMenuItem(page, label) {
  await page.click('.tb-menu-item[data-menu="edit"]');
  await page.waitForTimeout(80);
  const handle = await page.evaluateHandle((label) => {
    const items = Array.from(document.querySelectorAll('.dd-item:not(.disabled)'));
    return items.find(el => {
      const nameEl = el.querySelector('.dd-name');
      return nameEl && nameEl.textContent.trim().toLowerCase() === label.toLowerCase();
    });
  }, label);
  const el = handle.asElement();
  if (!el) throw new Error(`Edit menu item "${label}" not found`);
  await el.click();
  await page.waitForTimeout(100);
}

test.describe('[EB] Electron edit-command bridge', () => {

  for (const [label, cmd] of [
    ['Copy', 'copy'],
    ['Cut', 'cut'],
    ['Paste', 'paste'],
    ['Undo', 'undo'],
    ['Redo', 'redo'],
  ]) {
    test(`Edit→${label} dispatches editCommand("${cmd}") via electronAPI`, async ({ page }) => {
      await gotoWithElectronMock(page);
      await clickEditMenuItem(page, label);
      const calls = await page.evaluate(() => window.__editCommandCalls);
      expect(calls).toContain(cmd);
    });
  }

  // Select All is intentionally NEVER routed through the IPC bridge:
  // webContents.selectAll() would select the ENTIRE renderer DOM
  // (titlebar/sidebar/statusbar). It is scoped to the editor in the renderer
  // instead (see edit-commands.js selectAll() + the execEditCmd shim, which
  // passes electronAPI:null for selectAll). So even with electronAPI present,
  // editCommand('selectAll') must NOT be dispatched.
  test('Edit→Select All does NOT use the IPC bridge (renderer-scoped)', async ({ page }) => {
    await gotoWithElectronMock(page);
    await clickEditMenuItem(page, 'Select All');
    const calls = await page.evaluate(() => window.__editCommandCalls);
    expect(calls).not.toContain('selectAll');
  });

  test('editCommand is NOT called when electronAPI is absent (browser fallback)', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    // Set up spy WITHOUT exposing electronAPI.editCommand
    await page.evaluate(() => {
      window.__editCommandCalls = [];
      // Explicitly ensure electronAPI is undefined so fallback path runs
      delete window.electronAPI;
    });
    await clickEditMenuItem(page, 'Select All');
    const calls = await page.evaluate(() => window.__editCommandCalls);
    expect(calls).toEqual([]);
  });
});
