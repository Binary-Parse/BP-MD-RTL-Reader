// @ts-check
/**
 * focus-trap.spec.js — T-F4/F5 keyboard accessibility:
 *   F4  modal & palette trap Tab, move focus inside on open, restore it on close,
 *       and unwind correctly when nested (palette over modal, nested Esc order).
 *   F5  toolbar menus support roving focus (Up/Down/Home/End) and restore focus to
 *       the opener button on Esc.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

const activeInfo = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { id: el?.id || '', cls: el?.className || '', tag: el?.tagName || '', text: (el?.textContent || '').trim().slice(0, 24) };
});

test.describe('[T-F4] overlay focus trap & restore', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('palette: opening moves focus to its input, Esc restores focus to the opener', async ({ page }) => {
    // Give a concrete opener with focus, then open the palette as that element would.
    await page.locator('#searchBtn').focus();
    expect((await activeInfo(page)).id).toBe('searchBtn');
    await page.evaluate(() => window.openPalette()); // pushFocus() captures #searchBtn
    await expect(page.locator('#palOverlay')).toHaveClass(/open/);
    await expect.poll(async () => (await activeInfo(page)).id).toBe('palInput');

    await page.keyboard.press('Escape');
    await expect(page.locator('#palOverlay')).not.toHaveClass(/open/);
    expect((await activeInfo(page)).id).toBe('searchBtn'); // focus came back to the opener
  });

  test('palette: Tab stays inside (single focusable → input keeps focus)', async ({ page }) => {
    await page.evaluate(() => window.openPalette());
    await expect.poll(async () => (await activeInfo(page)).id).toBe('palInput');
    await page.keyboard.press('Tab');
    expect((await activeInfo(page)).id).toBe('palInput');
    await page.keyboard.press('Shift+Tab');
    expect((await activeInfo(page)).id).toBe('palInput');
  });

  test('modal: focus moves into the dialog and Tab is trapped (never escapes to the page body)', async ({ page }) => {
    await page.evaluate(() => window.showShortcuts());
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    // Focus is inside the dialog…
    await expect.poll(async () => page.evaluate(() => document.querySelector('#modalOverlay .modal')?.contains(document.activeElement))).toBe(true);
    // …and stays inside across several Tabs (wrap, no leak to toolbar/body).
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.querySelector('#modalOverlay .modal')?.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.querySelector('#modalOverlay .modal')?.contains(document.activeElement))).toBe(true);
  });

  test('modal: Esc closes the dialog and restores focus to the opener', async ({ page }) => {
    // Focus a concrete opener (the Help menu button), then open the modal as that
    // button's action would. closeModal()→restoreFocus() must return focus to it.
    await page.locator('.tb-menu-item[data-menu="help"]').focus();
    expect(await page.evaluate(() => document.activeElement?.dataset?.menu)).toBe('help');
    await page.evaluate(() => window.showShortcuts());
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => document.querySelector('#modalOverlay .modal')?.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
    expect(await page.evaluate(() => document.activeElement?.dataset?.menu)).toBe('help'); // restored to the exact opener
  });

  test('nested: palette over modal — first Esc closes palette (focus back in modal), second closes modal', async ({ page }) => {
    await page.evaluate(() => window.showShortcuts());
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    await page.evaluate(() => window.openPalette());
    await expect(page.locator('#palOverlay')).toHaveClass(/open/);
    await expect.poll(async () => (await activeInfo(page)).id).toBe('palInput');

    // First Esc: palette closes, modal still open, focus restored INTO the modal.
    await page.keyboard.press('Escape');
    await expect(page.locator('#palOverlay')).not.toHaveClass(/open/);
    await expect(page.locator('#modalOverlay')).toHaveClass(/open/);
    expect(await page.evaluate(() => document.querySelector('#modalOverlay .modal')?.contains(document.activeElement))).toBe(true);

    // Second Esc: modal closes too.
    await page.keyboard.press('Escape');
    await expect(page.locator('#modalOverlay')).not.toHaveClass(/open/);
  });
});

test.describe('[T-F5] toolbar menu roving focus', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('keyboard-opened menu focuses its first item; Arrow/Home/End rove; Esc restores the button', async ({ page }) => {
    const editBtn = page.locator('.tb-menu-item[data-menu="edit"]');
    await editBtn.focus();
    await editBtn.press('Enter'); // keyboard activation (click detail 0)
    await expect(page.locator('#dropdown')).toHaveClass(/open/);

    // First enabled item is focused on open.
    await expect.poll(async () => (await activeInfo(page)).cls).toContain('dd-item');
    const firstText = (await activeInfo(page)).text;

    // ArrowDown moves to a different item; Home returns to the first.
    await page.keyboard.press('ArrowDown');
    expect((await activeInfo(page)).text).not.toBe(firstText);
    // Roving tabindex is applied: exactly the focused item is tabbable (the rest -1),
    // so Tab won't walk through every item — load-bearing because the template hard-
    // codes tabindex="0" on each item.
    const roving = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#dropdown .dd-item:not(.disabled)')];
      return { zeros: items.filter(i => i.getAttribute('tabindex') === '0').length, focusedTi: document.activeElement.getAttribute('tabindex') };
    });
    expect(roving.zeros).toBe(1);
    expect(roving.focusedTi).toBe('0');
    await page.keyboard.press('Home');
    expect((await activeInfo(page)).text).toBe(firstText);

    // End jumps to the last enabled item.
    const lastText = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#dropdown .dd-item:not(.disabled)')];
      return items[items.length - 1].textContent.trim().slice(0, 24);
    });
    await page.keyboard.press('End');
    expect((await activeInfo(page)).text).toBe(lastText);

    // Esc closes the menu and returns focus to the opener button.
    await page.keyboard.press('Escape');
    await expect(page.locator('#dropdown')).not.toHaveClass(/open/);
    expect((await activeInfo(page)).cls).toContain('tb-menu-item');
  });

  test('mouse-opened menu leaves focus on the editor (Copy/Cut still read the live selection)', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.evaluate(() => window.setEditorMode('source'));
    await page.locator('#srcTextarea').waitFor({ state: 'visible' });
    await page.locator('#srcTextarea').focus();
    expect((await activeInfo(page)).id).toBe('srcTextarea');

    await page.locator('.tb-menu-item[data-menu="edit"]').click(); // mouse → detail 1
    await expect(page.locator('#dropdown')).toHaveClass(/open/);
    // Focus must stay precisely on the editor — not jump into the menu, not fall to body.
    expect((await activeInfo(page)).id).toBe('srcTextarea');
  });

  test('mouse-opened menu is still keyboard-navigable: ArrowDown pulls focus into the first item', async ({ page }) => {
    await page.locator('.tb-menu-item[data-menu="edit"]').click(); // mouse open, focus left outside
    await expect(page.locator('#dropdown')).toHaveClass(/open/);
    expect(await page.evaluate(() => document.querySelector('#dropdown')?.contains(document.activeElement))).toBe(false);
    await page.keyboard.press('ArrowDown'); // document-level handler pulls focus in
    expect(await page.evaluate(() => document.querySelector('#dropdown')?.contains(document.activeElement))).toBe(true);
    expect((await activeInfo(page)).cls).toContain('dd-item');
  });

  test('Tab inside an open menu closes it and returns focus to the opener (ARIA menu behavior)', async ({ page }) => {
    const editBtn = page.locator('.tb-menu-item[data-menu="edit"]');
    await editBtn.focus();
    await editBtn.press('Enter');
    await expect(page.locator('#dropdown')).toHaveClass(/open/);
    await expect.poll(async () => (await activeInfo(page)).cls).toContain('dd-item');
    await page.keyboard.press('Tab');
    await expect(page.locator('#dropdown')).not.toHaveClass(/open/); // Tab closed it
    expect((await activeInfo(page)).cls).toContain('tb-menu-item'); // focus did not leak away — back on the opener
  });
});
