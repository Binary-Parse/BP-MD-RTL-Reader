// @ts-check
/**
 * f11-t6.spec.js — T-F11 (italic-recolour opt-out; chevrons mirror in RTL UI) and
 * T-T6 (Fraunces optical sizing enabled).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('[T-F11] italic recolour opt-out', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(() => {
      window.setItalicRecolor(true); // start from the default (recolour on)
      window._appState.files = [{ name: 'e.md', path: 'e.md', content: 'Some *emphasised* prose with a normal run.\n', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(80);
  });

  const colors = (page) => page.evaluate(() => {
    const em = document.querySelector('#noteContent p em');
    const p = document.querySelector('#noteContent p');
    return { em: getComputedStyle(em).color, p: getComputedStyle(p).color };
  });

  test('ON by default: <em> is recoloured (differs from body ink)', async ({ page }) => {
    const c = await colors(page);
    expect(c.em).not.toBe(c.p);
  });

  test('opt-OUT: <em> keeps the body ink colour (only the slant remains)', async ({ page }) => {
    await page.evaluate(() => window.setItalicRecolor(false));
    const c = await colors(page);
    expect(c.em).toBe(c.p);
    // …and the slant is preserved (the recolour opt-out only drops colour, not italics).
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('#noteContent p em')).fontStyle)).toBe('italic');
    // re-enable → recoloured again
    await page.evaluate(() => window.setItalicRecolor(true));
    const c2 = await colors(page);
    expect(c2.em).not.toBe(c2.p);
  });
});

test.describe('[T-F11] chevrons mirror in RTL UI', () => {
  test('directional chevrons flip (scaleX(-1)) when the UI is RTL', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const ltr = await page.evaluate(() => getComputedStyle(document.getElementById('sidebarToggleBtn')).transform);
    expect(ltr === 'none' || ltr === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true); // not mirrored in LTR

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl')); // R7 will set this
    await page.waitForTimeout(150); // let any transform transition settle before reading computed style
    // The panel toggles are visible by default → mirrored.
    const rtl = await page.evaluate(() => ({
      side: getComputedStyle(document.getElementById('sidebarToggleBtn')).transform,
      insp: getComputedStyle(document.getElementById('inspectorToggleBtn')).transform,
    }));
    expect(rtl.side).toMatch(/^matrix\(-1,/); // mirrored
    expect(rtl.insp).toMatch(/^matrix\(-1,/);
    // The reveal strips (display:none until a panel is hidden) use the same mirror rule,
    // combined with their translateY centering: html[dir="rtl"] .reveal-strip → translateY(-50%) scaleX(-1).
    const stripRuleMirrors = await page.evaluate(() => {
      const el = document.getElementById('showSidebarStrip');
      el.style.display = 'flex'; // force-render so computed transform is reliable
      const t = getComputedStyle(el).transform;
      el.style.display = '';
      return t;
    });
    expect(stripRuleMirrors).toMatch(/^matrix\(-1,/);
  });
});

test.describe('[T-T6] Fraunces optical sizing', () => {
  test('optical sizing is enabled (auto) on Fraunces text', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    // The welcome heading is Fraunces (--serif). Optical sizing must be active.
    const os = await page.evaluate(() => {
      const h = document.querySelector('.welcome-card h1') || document.querySelector('h1');
      return getComputedStyle(h).fontOpticalSizing;
    });
    expect(os).toBe('auto');
  });
});

test.describe('[T-F10] status-bar stats are not falsely clickable', () => {
  test('.sb-stat spans use the default cursor, not pointer', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    // None of the status-bar stats (utf-8 / markdown / word count / cursor pos …)
    // have a click handler, so the pointer cursor was a false affordance.
    const cursors = await page.$$eval('.sb-stat', (els) => els.map((e) => getComputedStyle(e).cursor));
    expect(cursors.length).toBeGreaterThan(0);
    expect(cursors.every((c) => c !== 'pointer')).toBe(true);
  });
});
