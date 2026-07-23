// @ts-check
/**
 * Help menu trimming + About attribution.
 *  - Help menu offers ONLY Keyboard Shortcuts + About BP MD RTL Reader
 *    (the placeholder "Documentation" / "Report an Issue" items were removed).
 *  - The About dialog credits publisher "Binary Parse" and the "MIT License".
 *
 * These assertions go RED against the pre-change index.html (which had the two
 * extra Help items and an About without attribution) — verified during authoring.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function openHelpMenu(page) {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });
  await page.click('.tb-menu-item[data-menu="help"]');
  await page.waitForTimeout(80);
}
async function helpItemNames(page) {
  return page.$$eval('#dropdown .dd-item .dd-name', els => els.map(e => e.textContent.trim()));
}

test.describe('[HELP] Help menu + About attribution', () => {
  test('Help menu offers Keyboard Shortcuts, Check for Updates, and About', async ({ page }) => {
    await openHelpMenu(page);
    expect(await helpItemNames(page)).toEqual(['Keyboard Shortcuts', 'Check for Updates…', 'About BP MD RTL Reader']);
  });

  test('Help menu no longer offers Documentation or Report an Issue', async ({ page }) => {
    await openHelpMenu(page);
    const names = await helpItemNames(page);
    expect(names).not.toContain('Documentation');
    expect(names).not.toContain('Report an Issue');
  });

  test('About dialog shows publisher "Binary Parse" and "MIT License"', async ({ page }) => {
    await openHelpMenu(page);
    const about = await page.evaluateHandle(() =>
      Array.from(document.querySelectorAll('#dropdown .dd-item'))
        .find(el => el.querySelector('.dd-name') &&
          el.querySelector('.dd-name').textContent.trim() === 'About BP MD RTL Reader'));
    const el = about.asElement();
    if (!el) throw new Error('About BP MD RTL Reader item not found');
    await el.click();
    await page.waitForSelector('#modalOverlay.open', { state: 'visible' });
    const body = (await page.textContent('#modalBody')) || '';
    expect(body).toContain('Binary Parse');
    expect(body).toContain('MIT License');
    // Rebrand: About shows the new product name, and the old Arabic name is gone.
    expect(body).toContain('BP MD RTL Reader');
    expect(body).not.toContain('مَرْقَم');
    // Release polish: the About dialog states the real release version, not a prototype label.
    expect(body).toContain('1.0.0');
    expect(body).not.toContain('prototype');
  });

  test('window title and titlebar brand read "BP MD RTL Reader"', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    expect(await page.title()).toBe('BP MD RTL Reader');
    expect(((await page.textContent('.tb-brand-name')) || '').trim()).toBe('BP MD RTL Reader');
  });
});
