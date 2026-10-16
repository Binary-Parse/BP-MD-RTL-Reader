// @ts-check
/**
 * block-direction.spec.js — design-mock feature 1: pin ONE block right-to-left or left-to-right.
 * A badge in the reading column's start margin flips the block under the pointer; the pin is a
 * `<!-- dir: … -->` line above the block in the note, so it survives a reload and an export.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');
const NOTE = '# Title\n\nمرحبا بالعالم، هذه فقرة عربية.\n\nAn English paragraph.\n\n```\nconst x = 1;\n```\n';

async function boot(page, { viewMode = 'reading', uiLocale } = {}) {
  const settings = { theme: 'paper', zoomFactor: 1, viewMode, recents: [], lastSession: null, ...(uiLocale ? { uiLocale } : {}) };
  await page.addInitScript((s) => {
    window.electronAPI = { getSettings: async () => s, setSettings: async () => {}, onOpenFile: () => {}, onVaultChanged: () => {} };
  }, settings);
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => document.getElementById('editorArea')?.classList.contains('cm-single'), null, { timeout: 8000 });
}

async function openNote(page, content = NOTE) {
  await page.evaluate((md) => {
    window._appState.files = [{ name: 'b.md', path: 'b.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
  }, content);
}

const noteText = (page) => page.evaluate(() => window._appState.files[0].content);
const arabicPara = (page) => page.locator('#noteContent p', { hasText: 'مرحبا' });

test.describe('per-block direction', () => {
  test('the badge menu pins one block, writes the pin into the note, and Auto removes it', async ({ page }) => {
    await boot(page);
    await openNote(page);
    await expect(arabicPara(page)).toHaveAttribute('dir', 'rtl');

    await arabicPara(page).hover();
    const badge = page.locator('#dirBadge');
    const menu = page.locator('#dirMenu');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('ع');
    await expect(badge).toHaveAttribute('data-tip', /Auto/);
    await badge.click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio')).toHaveText(['عRight to left', 'ALeft to right', '⇆Auto']);
    await expect(menu.getByRole('menuitemradio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitemradio', { name: 'Left to right' }).click();
    await expect(menu).toBeHidden();

    await expect(arabicPara(page)).toHaveAttribute('dir', 'ltr');
    await expect(arabicPara(page)).toHaveAttribute('data-pinned', 'ltr');
    expect(await noteText(page)).toContain('<!-- dir: ltr -->\nمرحبا بالعالم');
    expect(await page.evaluate(() => window._appState.files[0].dirty)).toBe(true);
    await expect(badge).toHaveClass(/pinned/);
    // The other blocks keep their own direction.
    await expect(page.locator('#noteContent p', { hasText: 'English' })).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('#noteContent .bpmd-dir, #noteContent .bpmd-src')).toHaveCount(0);

    await expect(badge).toHaveAttribute('data-tip', /pinned left to right/);
    await badge.click();
    await expect(menu.getByRole('menuitemradio', { name: 'Left to right' })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitemradio', { name: 'Auto' }).click();
    await expect(arabicPara(page)).toHaveAttribute('dir', 'rtl');
    await expect(arabicPara(page)).not.toHaveAttribute('data-pinned', /.*/);
    expect(await noteText(page)).toBe(NOTE);
  });

  test('the menu offers all three states: pin the same direction, switch the pin, keyboard and Escape', async ({ page }) => {
    await boot(page);
    await openNote(page);
    await arabicPara(page).hover();
    const badge = page.locator('#dirBadge');
    const menu = page.locator('#dirMenu');
    // Pin RTL on a block that is already right to left by its text: it stays RTL under a forced LTR note.
    await badge.click();
    await menu.getByRole('menuitemradio', { name: 'Right to left' }).click();
    expect(await noteText(page)).toContain('<!-- dir: rtl -->\nمرحبا بالعالم');
    await expect(badge).toHaveClass(/pinned/);

    // Switching the pin replaces the line instead of adding a second one.
    await badge.click();
    await menu.getByRole('menuitemradio', { name: 'Left to right' }).click();
    const text = await noteText(page);
    expect(text).toContain('<!-- dir: ltr -->\nمرحبا بالعالم');
    expect(text).not.toContain('dir: rtl');

    // Keyboard: Enter opens the menu on the checked item, Escape closes it and returns focus.
    await badge.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'Left to right' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Auto' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(badge).toBeFocused();
    expect(await noteText(page)).toBe(text);
  });

  test('a pin in the note is applied on open, wins over the forced direction, and reaches the HTML export', async ({ page }) => {
    await boot(page);
    await openNote(page, '<!-- dir: rtl -->\nPlain English, pinned right to left.\n\nUnpinned English.\n');
    const pinned = page.locator('#noteContent p', { hasText: 'Plain English' });
    await expect(pinned).toHaveAttribute('dir', 'rtl');
    await page.click('#rtlBtn'); // auto → forced RTL
    await page.click('#rtlBtn'); // forced RTL → forced LTR
    await expect(page.locator('#noteContent p', { hasText: 'Unpinned' })).toHaveAttribute('dir', 'ltr');
    await expect(pinned).toHaveAttribute('dir', 'rtl');
    const doc = await page.evaluate(async () => (await window.buildExportDoc(window._appState.files[0])).fullHtml);
    expect(doc).toMatch(/<p[^>]*dir="rtl"[^>]*>Plain English, pinned right to left\./);
    expect(doc).not.toMatch(/bpmd-src|bpmd-dir|dir: rtl/);
  });

  test('code blocks are never pinned: the badge is disabled on them', async ({ page }) => {
    await boot(page);
    await openNote(page);
    await page.locator('#noteContent pre').hover();
    const badge = page.locator('#dirBadge');
    await expect(badge).toBeVisible();
    await expect(badge).toBeDisabled();
    await expect(badge).toHaveText('{}');
  });

  test('Ctrl+D in Edit mode pins the block under the caret; Reset removes every pin in one undo step', async ({ page }) => {
    await boot(page, { viewMode: 'edit' });
    await openNote(page, 'First block.\n\nSecond block.\n');
    await page.locator('.cm-content').click();
    await page.evaluate(() => window.cmAdapter?.setSelection?.({ start: 16 }) ?? null);
    await page.locator('.cm-line', { hasText: 'Second block.' }).click();
    await page.keyboard.press('Control+d');
    expect(await noteText(page)).toBe('First block.\n\n<!-- dir: rtl -->\nSecond block.\n');
    await expect(page.locator('.cm-line', { hasText: 'Second block.' })).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('.cm-line.cm-dir-pin')).toHaveAttribute('dir', 'ltr');

    await page.locator('.cm-line', { hasText: 'First block.' }).click();
    await page.keyboard.press('Control+d');
    expect(await noteText(page)).toContain('<!-- dir: rtl -->\nFirst block.');

    await page.evaluate(() => window.resetBlockDirections());
    expect(await noteText(page)).toBe('First block.\n\nSecond block.\n');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+z');
    expect(await noteText(page)).toBe('<!-- dir: rtl -->\nFirst block.\n\n<!-- dir: rtl -->\nSecond block.\n');
  });

  test('in the Arabic interface the badge sits on the right, the start side', async ({ page }) => {
    await boot(page, { uiLocale: 'ar' });
    await openNote(page);
    await page.locator('#noteContent p', { hasText: 'English' }).hover();
    const badge = page.locator('#dirBadge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('A');
    const [b, col] = await Promise.all([badge.boundingBox(), page.locator('#noteContent').boundingBox()]);
    expect(b && col && b.x).toBeGreaterThanOrEqual((col?.x ?? 0) + (col?.width ?? 0));
  });
});
