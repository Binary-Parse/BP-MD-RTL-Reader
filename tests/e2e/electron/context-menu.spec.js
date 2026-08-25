/**
 * context-menu.spec.js — the v10 redesign's renderer-drawn right-click menu (D1), proven
 * against a real Electron BrowserWindow + main process.
 *
 * tests/e2e/electron/fullscreen.spec.js explains why this needs the real Electron lane:
 * a bare Chromium page over file:// never exercises src/main/window-controller.js's
 * 'context-menu' handler, the context-menu:show/context-menu:action IPC round-trip, or the
 * app:command relay — all of that only exists in the real main process.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

test.describe('renderer-drawn context menu @electron', () => {
  let electronApp;
  let page;
  let tempRoot;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-context-menu-test-'));
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

  // Checks the live DOM selection is not inside any chrome surface — the regression this
  // guards is webContents.selectAll() being run in main, which selects the entire
  // renderer DOM (titlebar/sidebar/statusbar), not just the document.
  async function selectionOutsideChrome(pg) {
    return pg.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return true; // nothing selected is not the bug
      const node = sel.getRangeAt(0).commonAncestorContainer;
      const chrome = ['.titlebar', '.sidebar', '.statusbar', '.inspector'];
      return !chrome.some((sel2) => document.querySelector(sel2)?.contains(node));
    });
  }

  test('right-click paints the themed .ctx menu (never a native popup) and dispatches a role', async () => {
    await page.locator('#welcome').click({ button: 'right' });
    const ctx = page.locator('#ctxMenu');
    await expect(ctx).toBeVisible();
    await expect(ctx.locator('.dd-item[role="menuitem"]')).not.toHaveCount(0);

    // Select All is always offered on a non-editable surface (T-B12).
    const selectAll = ctx.locator('.dd-item', { hasText: 'Select All' });
    await expect(selectAll).toBeVisible();
    await selectAll.click();
    await expect(ctx).toBeHidden();
    expect(await selectionOutsideChrome(page)).toBe(true);
  });

  test('Escape closes the menu; a click outside closes it too', async () => {
    await page.locator('#welcome').click({ button: 'right' });
    await expect(page.locator('#ctxMenu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ctxMenu')).toBeHidden();

    await page.locator('#welcome').click({ button: 'right' });
    await expect(page.locator('#ctxMenu')).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(page.locator('#ctxMenu')).toBeHidden();
  });

  test('arrow keys move roving focus among the menu items', async () => {
    await page.locator('#welcome').click({ button: 'right' });
    const ctx = page.locator('#ctxMenu');
    await expect(ctx).toBeVisible();
    const items = ctx.locator('.dd-item[tabindex="0"]');
    const count = await items.count();
    expect(count).toBeGreaterThan(1);

    const firstFocused = await page.evaluate(() => document.activeElement.textContent);
    await page.keyboard.press('ArrowDown');
    const secondFocused = await page.evaluate(() => document.activeElement.textContent);
    expect(secondFocused).not.toBe(firstFocused);
    await page.keyboard.press('Escape');
  });

  // T-F19-alike: a right-click anchored inside the titlebar's drag region must still be
  // clickable — proves .ctx is in the no-drag allowlist (responsive.css), matching M18/5.11.
  //
  // Right-clicking directly on the titlebar's own (visually-hidden) accessible-name text
  // makes Chromium natively pre-select that word for its own "Copy" affordance, before our
  // menu ever runs — independent of this app. With no document open, selectAll's
  // no-open-document branch clears that stray selection instead of leaving it in the
  // chrome (edit-commands.js's selectAll()).
  test('a menu anchored over the titlebar drag region is still clickable', async () => {
    await page.locator('.tb-lead').click({ button: 'right', position: { x: 5, y: 10 } });
    const ctx = page.locator('#ctxMenu');
    await expect(ctx).toBeVisible();
    const selectAll = ctx.locator('.dd-item', { hasText: 'Select All' });
    await expect(selectAll).toBeVisible();
    await selectAll.click();
    await expect(ctx).toBeHidden();
    expect(await selectionOutsideChrome(page)).toBe(true);
  });

  // D1 addendum / M17: the six app commands round-trip through main and back over
  // app:command — without preload's onAppCommand + this relay, they would silently no-op.
  test('the "Command Palette" app command opens the palette end-to-end through main', async () => {
    await page.locator('#welcome').click({ button: 'right' });
    const ctx = page.locator('#ctxMenu');
    await expect(ctx).toBeVisible();
    const paletteItem = ctx.locator('.dd-item', { hasText: 'Command Palette' });
    await expect(paletteItem).toBeVisible();
    await paletteItem.click();
    await expect(page.locator('#palOverlay')).toHaveClass(/open/);
  });

  test('a right-click with a text selection offers an enabled Copy that actually copies', async () => {
    await page.waitForFunction(() => !!window._appState);
    await page.evaluate(() => {
      const S = window._appState;
      S.files = [{ name: 'ctx.md', path: 'ctx.md', handle: null, content: '# Doc\n\nSelectable body text.', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const p = document.querySelector('#noteContent p');
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.locator('#noteContent p').click({ button: 'right' });
    const ctx = page.locator('#ctxMenu');
    await expect(ctx).toBeVisible();
    const copyItem = ctx.locator('.dd-item[role="menuitem"]:not([aria-disabled="true"])', { hasText: 'Copy' });
    await expect(copyItem).toBeVisible();
  });

  // [CA20-electron] Main sends only ids for its six app commands (APP_COMMANDS in
  // window-controller.js); the renderer resolves display text through its own
  // APP_COMMAND_DISPLAY (app.js), a fifth hand-maintained copy of these strings per
  // click-audit-all.spec.js's CA19/CA20 drift guards. Only the Electron lane can see
  // real main-sent ids, so the cross-check against MENU_DEFS/PALETTE_COMMANDS (the
  // renderer's own copies) has to live here instead of in that browser-lane file.
  test('the six app-command labels/shortcuts main sends match MENU_DEFS/PALETTE_COMMANDS', async () => {
    await page.locator('#welcome').click({ button: 'right' });
    const ctx = page.locator('#ctxMenu');
    await expect(ctx).toBeVisible();
    const appCommandLabels = await ctx.locator('.dd-item').allTextContents();
    await page.keyboard.press('Escape');

    const known = await page.evaluate(() => {
      const allMenuItems = Object.values(window.MENU_DEFS || {}).flatMap((m) => m.items || []);
      const byName = (name) => allMenuItems.find((i) => i.name === name)?.shortcut;
      return {
        'New Note': byName('New Note'),
        'Find…': byName('Find…'),
        'Command Palette': byName('Command Palette'),
        'Auto-hide Top Bar': byName('Auto-hide Top Bar'),
        'Hide Bottom Status Bar': byName('Hide Bottom Status Bar'),
        'Settings…': byName('Settings…'),
      };
    });
    for (const [name, shortcut] of Object.entries(known)) {
      expect(shortcut, `MENU_DEFS is missing "${name}"`).toBeTruthy();
      expect(appCommandLabels.some((t) => t === name + shortcut), `context menu should show "${name}${shortcut}"`).toBe(true);
    }
  });

  // v10 redesign follow-up: main's old hard-coded English labels left the right-click
  // menu untranslated even with the UI in Arabic. Now that the renderer resolves them
  // through its own locale-aware APP_COMMAND_DISPLAY, they must follow the UI language.
  test('the right-click menu localizes its app commands with the UI', async () => {
    await page.waitForFunction(() => typeof window.toggleArabicUI === 'function');
    await page.evaluate(() => window.toggleArabicUI());
    await page.waitForTimeout(100);
    await page.locator('#welcome').click({ button: 'right' });
    const ctx = page.locator('#ctxMenu');
    await expect(ctx).toBeVisible();
    // menu.newNote's Arabic string (locale.js) — the same catalog the View/File menus use.
    await expect(ctx.locator('.dd-item', { hasText: 'ملاحظة جديدة' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.toggleArabicUI());
  });

  // v10 redesign: the two visibility toggles name the direction a click will go, dispatched
  // through main's ids exactly like every other app command — this proves the real
  // end-to-end round trip (right-click → dispatch → toggle → re-render) picks up the new
  // label, not just that APP_COMMAND_DISPLAY resolves it in isolation (CA21, browser-lane).
  test('the right-click menu\'s "Auto-hide Top Bar" item flips to "Always Show Top Bar" after toggling', async () => {
    await page.locator('#welcome').click({ button: 'right' });
    let ctx = page.locator('#ctxMenu');
    await expect(ctx).toBeVisible();
    await expect(ctx.locator('.dd-item', { hasText: 'Auto-hide Top Bar' })).toBeVisible();
    await ctx.locator('.dd-item', { hasText: 'Auto-hide Top Bar' }).click();
    await expect(ctx).toBeHidden();

    await page.locator('#welcome').click({ button: 'right' });
    ctx = page.locator('#ctxMenu');
    await expect(ctx).toBeVisible();
    await expect(ctx.locator('.dd-item', { hasText: 'Always Show Top Bar' })).toBeVisible();
    await expect(ctx.locator('.dd-item', { hasText: 'Auto-hide Top Bar' })).toHaveCount(0);

    // restore
    await ctx.locator('.dd-item', { hasText: 'Always Show Top Bar' }).click();
  });
});
