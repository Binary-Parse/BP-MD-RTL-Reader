// @ts-check
/**
 * writing-tools.spec.js — the toolbar writing tools must TOGGLE / REPLACE, not STACK.
 *
 * Regression for "new writing tools not functioning well": clicking a format/heading/
 * list/quote repeatedly used to pile up markers (`### ## x`, `****x****`, `> > x`,
 * `- - x`). They now toggle off / replace cleanly while a single application is unchanged.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/');

async function open(page, content) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.getActiveCmAdapter, null, { timeout: 8000 });
  await page.evaluate((c) => { window._appState.files = [{ name: 't.md', path: 't.md', content: c, dirty: false }]; window.renderFile(0); window.setViewMode('edit'); }, content); // T-F17: these test the editor → edit mode
  await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
}
const val = (page) => page.evaluate(() => window.getActiveCmAdapter().getValue());
const caret = (page, p) => page.evaluate((p) => window.getActiveCmAdapter().setSelection({ start: p, end: p }), p);
const range = (page, s, e) => page.evaluate(([s, e]) => window.getActiveCmAdapter().setSelection({ start: s, end: e }), [s, e]);
const heading = async (page, level) => { await page.click('#tbHeading'); await page.click(`#headingMenu .td-item[data-level="${level}"]`); };

test.describe('writing tools toggle/replace (no stacking)', () => {
  test('Bold toggles off on a second click', async ({ page }) => {
    await open(page, 'world\n');
    await range(page, 0, 5);
    await page.click('#tbBold');
    expect(await val(page)).toBe('**world**\n');
    await page.click('#tbBold');
    expect(await val(page)).toBe('world\n');
  });

  test('Heading replaces the level instead of stacking, and toggles off at the same level', async ({ page }) => {
    await open(page, 'second line\n');
    await caret(page, 3);
    await heading(page, 2);
    expect(await val(page)).toBe('## second line\n');
    await caret(page, 3);
    await heading(page, 3); // replace, not stack
    expect(await val(page)).toBe('### second line\n');
    await caret(page, 3);
    await heading(page, 3); // same level → toggle back to paragraph
    expect(await val(page)).toBe('second line\n');
  });

  test('Heading menu opens above the editor and remains clickable', async ({ page }) => {
    await open(page, 'section\n');
    await caret(page, 3);
    await page.click('#tbHeading');

    await expect(page.locator('#tbHeading')).toHaveAttribute('aria-expanded', 'true');
    const menuIsHitTarget = await page.locator('#headingMenu .td-item[data-level="2"]').evaluate((item) => {
      const rect = item.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return item === hit || item.contains(hit);
    });
    expect(menuIsHitTarget).toBe(true);

    await page.click('#headingMenu .td-item[data-level="2"]');
    expect(await val(page)).toBe('## section\n');
  });

  test('Quote toggles off on a second click', async ({ page }) => {
    await open(page, 'para\n');
    await caret(page, 2);
    await page.click('#tbQuote');
    expect(await val(page)).toBe('> para\n');
    await caret(page, 4);
    await page.click('#tbQuote');
    expect(await val(page)).toBe('para\n');
  });

  test('Bulleted ↔ numbered switches the marker instead of stacking', async ({ page }) => {
    await open(page, 'item\n');
    await caret(page, 2);
    await page.click('#tbList');
    expect(await val(page)).toBe('- item\n');
    await caret(page, 2);
    await page.click('#tbListOrdered'); // replace bullet with number
    expect(await val(page)).toBe('1. item\n');
    await caret(page, 2);
    await page.click('#tbListOrdered'); // same kind → toggle off
    expect(await val(page)).toBe('item\n');
  });

  test('a multi-line selection gets numbered 1., 2., 3.', async ({ page }) => {
    await open(page, 'one\ntwo\nthree\n');
    await range(page, 0, 11); // spans all three lines
    await page.click('#tbListOrdered');
    expect(await val(page)).toBe('1. one\n2. two\n3. three\n');
  });

  test('single application is unchanged (sanity)', async ({ page }) => {
    await open(page, 'alpha beta\n');
    await range(page, 6, 10);
    await page.click('#tbItalic');
    expect(await val(page)).toBe('alpha *beta*\n');
  });
});
