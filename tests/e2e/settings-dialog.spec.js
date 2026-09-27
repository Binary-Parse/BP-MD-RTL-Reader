// @ts-check
/**
 * settings-dialog.spec.js — T-F19 Settings dialog.
 *
 * The dialog reuses the app's single #modalOverlay, so it inherits the existing focus
 * stack, Escape priority chain and Tab trap; these tests assert that inheritance holds
 * rather than re-testing the modal machinery itself. Controls follow the WAI-ARIA switch
 * pattern (role=switch + aria-checked) and the toggle-button pattern (aria-pressed) for
 * the segmented control.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

const open = (page) => page.evaluate(() => window.showSettings());

test.describe('[T-F19] Settings dialog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
  });

  test('opens from Ctrl+, and closes on Escape', async ({ page }) => {
    await page.keyboard.press('Control+,');
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    expect(await page.textContent('#modalTitle')).toBe('Settings');

    await page.keyboard.press('Escape');
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
  });

  test('global shortcuts are inert while the dialog is open (no second dialog over a pending one)', async ({ page }) => {
    await open(page);
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);

    await page.keyboard.press('Control+s');
    await page.keyboard.press('Control+k');

    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    expect(await page.textContent('#modalTitle')).toBe('Settings');
    await expect(page.locator('#toast')).toHaveText('');

    await page.keyboard.press('Escape');
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
  });

  test('opens from the View menu', async ({ page }) => {
    await page.click('.tb-menu-item[data-menu="view"]');
    const item = page.locator('#dropdown .dd-item', { hasText: 'Settings' }).first();
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
  });

  test('is reachable from the command palette', async ({ page }) => {
    const found = await page.evaluate(() =>
      (window.PALETTE_COMMANDS || []).some((c) => /settings/i.test(c.name || '')));
    expect(found, 'a Settings entry should exist in PALETTE_COMMANDS').toBe(true);
  });

  test('exposes switch and toggle-button semantics', async ({ page }) => {
    await open(page);
    const roles = await page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      return {
        autoHideRole: g('setAutoHide').getAttribute('role'),
        autoHideChecked: g('setAutoHide').getAttribute('aria-checked'),
        autoHideName: g('setAutoHide').getAttribute('aria-label'),
        statusRole: g('setHideStatus').getAttribute('role'),
        statusChecked: g('setHideStatus').getAttribute('aria-checked'),
        statusName: g('setHideStatus').getAttribute('aria-label'),
        modeFile: g('setTitleModeFile').getAttribute('aria-pressed'),
        modeApp: g('setTitleModeApp').getAttribute('aria-pressed'),
      };
    });
    expect(roles.autoHideRole).toBe('switch');
    expect(roles.statusRole).toBe('switch');
    expect(roles.autoHideChecked).toBe('false');
    expect(roles.statusChecked).toBe('false');
    expect(roles.autoHideName, 'a switch needs an accessible name').toBeTruthy();
    expect(roles.statusName).toBeTruthy();
    expect(roles.modeFile).toBe('true');   // 'file' is the default
    expect(roles.modeApp).toBe('false');
  });

  test('the switches drive the live chrome state', async ({ page }) => {
    await open(page);

    await page.click('#setAutoHide');
    expect(await page.getAttribute('#setAutoHide', 'aria-checked')).toBe('true');
    expect(await page.evaluate(() => document.documentElement.dataset.chrome)).toContain('autohide');

    await page.click('#setHideStatus');
    expect(await page.getAttribute('#setHideStatus', 'aria-checked')).toBe('true');
    expect(await page.evaluate(() => document.documentElement.dataset.chrome)).toContain('nostatus');

    await page.click('#setAutoHide');
    expect(await page.evaluate(() => document.documentElement.dataset.chrome)).not.toContain('autohide');
  });

  test('the segmented control drives the window title', async ({ page }) => {
    await page.evaluate(() => {
      const S = window._appState;
      S.files = [{ name: 'notes.md', path: 'notes.md', handle: null, content: '# x\n', dirty: false }];
      window.renderFile(0);
    });
    await open(page);

    await page.click('#setTitleModeApp');
    expect(await page.title()).toBe('BP MD RTL Reader');
    expect(await page.getAttribute('#setTitleModeApp', 'aria-pressed')).toBe('true');
    expect(await page.getAttribute('#setTitleModeFile', 'aria-pressed')).toBe('false');

    await page.click('#setTitleModeFile');
    expect(await page.title()).toContain('notes.md');
  });

  test('a chrome choice survives a reload via the pre-paint cache', async ({ page }) => {
    await open(page);
    await page.click('#setHideStatus');

    await page.reload();
    await page.waitForSelector('.app', { state: 'visible' });
    expect(await page.evaluate(() => document.documentElement.dataset.chrome)).toContain('nostatus');
  });

  test('Tab is trapped inside the dialog and focus returns to the opener on close', async ({ page }) => {
    await page.focus('#themeBtn');
    await open(page);

    const inside = await page.evaluate(() => {
      const overlay = document.getElementById('modalOverlay');
      return overlay.contains(document.activeElement);
    });
    expect(inside, 'focus should move into the dialog').toBe(true);

    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('modalOverlay').contains(document.activeElement)))
      .toBe(true);

    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('themeBtn');
  });

  // v10 redesign: "WINDOW"/"APPEARANCE" rendered in the mono face at the wrong tracking —
  // the "one chrome voice" pass (design §12) had only reached two of its fourteen
  // selectors. This is the one dialog in this file's own scope; the sidebar/inspector/
  // palette/about half of the same fix is covered by tests/unit/v10-chrome-voice.test.js.
  test('the section labels render in the chrome voice (Inter, not mono)', async ({ page }) => {
    await open(page);
    const style = await page.evaluate(() => {
      const label = document.querySelector('.set-group-label');
      const cs = getComputedStyle(label);
      return { fontFamily: cs.fontFamily, letterSpacing: cs.letterSpacing, fontSize: cs.fontSize };
    });
    expect(style.fontFamily).toMatch(/Inter/);
    expect(style.fontFamily).not.toMatch(/JetBrains/);
    // 0.09em at the computed font-size, converted to px (jsdom/Chromium report letter-spacing in px).
    const expectedPx = parseFloat(style.fontSize) * 0.09;
    expect(parseFloat(style.letterSpacing)).toBeCloseTo(expectedPx, 1);
  });

  test('the modal close button uses the medium radius token (9px; the v10 literal was 8px)', async ({ page }) => {
    await open(page);
    const closeRadius = await page.evaluate(() => getComputedStyle(document.getElementById('modalCloseBtn')).borderRadius);
    expect(closeRadius).toBe('9px');
  });

  // audit UX-08: the Arabic options (locale/direction, calendar, kashida, italic recolor)
  // were View-menu-only; the dialog now carries them as a fourth group driven by the same
  // State toggles.
  test('the Arabic group exposes all five controls with the live state', async ({ page }) => {
    await open(page);
    const state = await page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      const ids = ['setArabicUI', 'setCalGreg', 'setCalHijri', 'setKashida', 'setItalic'];
      return {
        missing: ids.filter((id) => !g(id)),
        groupCount: document.querySelectorAll('.set-group').length,
        arabicUI: g('setArabicUI').getAttribute('aria-checked'),
        arabicUIName: g('setArabicUI').getAttribute('aria-label'),
        calGreg: g('setCalGreg').getAttribute('aria-pressed'),
        calHijri: g('setCalHijri').getAttribute('aria-pressed'),
        kashida: g('setKashida').getAttribute('aria-checked'),
        italic: g('setItalic').getAttribute('aria-checked'),
      };
    });
    expect(state.missing).toEqual([]);
    expect(state.groupCount).toBe(6);           // Window, Appearance, Files, Reading (T8.1), Updates (T7.1), Arabic
    expect(state.arabicUI).toBe('false');       // LTR out of the box
    expect(state.arabicUIName, 'a switch needs an accessible name').toBeTruthy();
    expect(state.calGreg).toBe('true');         // Gregorian by default
    expect(state.calHijri).toBe('false');
    expect(state.kashida).toBe('false');        // ragged by default
    expect(state.italic).toBe('true');          // recolor on by default
  });

  test('the Arabic group drives the same state the View menu does', async ({ page }) => {
    await open(page);

    await page.click('#setCalHijri');
    expect(await page.getAttribute('#setCalHijri', 'aria-pressed')).toBe('true');
    expect(await page.getAttribute('#setCalGreg', 'aria-pressed')).toBe('false');
    expect(await page.evaluate(() => window._appState.calendar)).toBe('hijri');

    await page.click('#setKashida');
    expect(await page.getAttribute('#setKashida', 'aria-checked')).toBe('true');
    expect(await page.evaluate(() => window._appState.arabicKashida)).toBe(true);
    expect(await page.evaluate(() => document.getElementById('appBody').classList.contains('kashida'))).toBe(true);

    await page.click('#setItalic');
    expect(await page.getAttribute('#setItalic', 'aria-checked')).toBe('false');
    expect(await page.evaluate(() => window._appState.italicRecolor)).toBe(false);

    await page.click('#setArabicUI');
    expect(await page.getAttribute('#setArabicUI', 'aria-checked')).toBe('true');
    expect(await page.evaluate(() => window._appState.uiDirection)).toBe('rtl');
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl');

    // Restore the interface so the remaining specs start from the default document.
    await page.click('#setArabicUI');
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('ltr');
  });
});
