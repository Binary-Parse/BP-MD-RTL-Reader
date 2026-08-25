// @ts-check
/**
 * tooltips.spec.js — v10 redesign (2026-08-25): designed tooltips replacing native title=.
 *
 * Two mechanisms exist:
 *  - `[data-tip]::after` (CSS-only, base.css/responsive.css) for chrome controls that are
 *    not clipped by an ancestor's overflow.
 *  - `#floatingTip`, positioned by positionFloatingTip() in app.js, for `.tab` and
 *    `#tabAddBtn`, which sit inside `.tabs` (overflow-y: hidden) and would clip a
 *    below-anchored `::after` tooltip (see index.html's comment above #floatingTip).
 *
 * responsive.css:20-27 already collapses `transition-duration` under
 * prefers-reduced-motion, which kills the CSS tooltip's 350ms hover delay — the tooltip
 * then appears instantly. That is correct, deliberate behaviour; these tests pin it so a
 * future change cannot silently reintroduce the delay for reduced-motion users.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function goto(page) {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });
}

async function injectFile(page, name, content) {
  await page.evaluate(({ name, content }) => {
    const S = window._appState;
    S.files = [{ name, path: name, handle: null, content, dirty: false }];
    window.renderFile(0);
  }, { name, content });
  await page.waitForTimeout(200);
}

test.describe('[v10] designed tooltips', () => {
  test('a chrome [data-tip]::after tooltip is instant, not delayed, under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goto(page);

    const themeBtn = page.locator('#themeBtn');
    await expect(themeBtn).toHaveAttribute('data-tip', /.+/);

    const transitionDelay = await themeBtn.evaluate(el => {
      const after = window.getComputedStyle(el, '::after');
      return after.transitionDuration;
    });
    // responsive.css's reduced-motion block collapses every transition-duration to 0.01ms
    // (computed as "1e-05s"), not the full-motion 350ms delay.
    const seconds = transitionDelay.split(',').map(parseFloat);
    expect(seconds.every(s => s < 0.001)).toBe(true);
  });

  test('.tab tooltips do not use the clipped [data-tip]::after mechanism', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'suppressed-after.md', '# Doc\n\nBody.');

    const afterContent = await page.locator('.tab').first().evaluate(el => {
      return window.getComputedStyle(el, '::after').content;
    });
    expect(afterContent).toBe('none');
  });

  test('hovering a tab shows the shared #floatingTip with the full filename, positioned below it', async ({ page }) => {
    await goto(page);
    const longName = 'a-rather-long-filename-that-would-be-clipped-in-the-tab.md';
    await injectFile(page, longName, '# Doc\n\nBody.');

    const tab = page.locator('.tab').first();
    await expect(tab).toHaveAttribute('data-tip', longName);

    const floatingTip = page.locator('#floatingTip');
    await expect(floatingTip).toBeHidden();

    await tab.hover();
    await expect(floatingTip).toBeVisible({ timeout: 1000 });
    expect(await floatingTip.textContent()).toBe(longName);

    const tabBox = await tab.boundingBox();
    const tipBox = await floatingTip.boundingBox();
    expect(tipBox.y).toBeGreaterThanOrEqual(tabBox.y + tabBox.height);

    await page.mouse.move(0, 0);
    await expect(floatingTip).toBeHidden();
  });

  test('#floatingTip appears instantly (no 350ms wait) under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goto(page);
    await injectFile(page, 'reduced-motion.md', '# Doc\n\nBody.');

    const tab = page.locator('.tab').first();
    await tab.hover();
    // A generous margin under the 350ms full-motion delay proves the reduced-motion
    // carve-out fired, without being a flaky exact-timing assertion.
    await expect(page.locator('#floatingTip')).toBeVisible({ timeout: 150 });
  });
});
