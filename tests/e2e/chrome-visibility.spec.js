// @ts-check
/**
 * chrome-visibility.spec.js — T-F19 auto-hiding title bar and hideable status bar.
 *
 * Split from chrome-geometry.spec.js because these assert BEHAVIOUR (grid track counts
 * across states, the reveal strip, retract, focus reveal, stacking) rather than the
 * static compact scale.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

/** Rendered gap between the visible toast and the bottom edge of .app. */
async function toastGap(page) {
  await page.evaluate(() => window.showToast('measure', 'info'));
  await page.waitForTimeout(350);
  const gap = await page.evaluate(() => {
    const t = document.querySelector('.toast').getBoundingClientRect();
    const app = document.querySelector('.app').getBoundingClientRect();
    return app.bottom - t.bottom;
  });
  return gap;
}

test.describe('[T-F19] chrome visibility states', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
  });

  /** Apply a chrome state the way the renderer does, and read back the geometry. */
  async function chrome(page, flags) {
    await page.evaluate((flags) => {
      const S = window._appState;
      S.autoHideTitlebar = flags.includes('autohide');
      S.hideStatusBar = flags.includes('nostatus');
      window.applyChromeLayout();
    }, flags);
    await page.waitForTimeout(120);
    return page.evaluate(() => {
      const app = document.querySelector('.app');
      const rows = getComputedStyle(app).gridTemplateRows.trim();
      return {
        rows,
        trackCount: rows === 'none' ? 0 : rows.split(/\s+/).length,
        appH: app.getBoundingClientRect().height,
        bodyH: document.querySelector('.app-body').getBoundingClientRect().height,
        statusH: document.querySelector('.statusbar').getBoundingClientRect().height,
      };
    });
  }

  // The trap: `position:absolute` removes .titlebar as a grid ITEM (CSS Grid §6 — only
  // in-flow children become grid items), so the track COUNT must drop. Zeroing the first
  // track instead drops .app-body into a 0px row and the whole window paints empty.
  test('each hidden bar removes a grid track and gives its space to the body', async ({ page }) => {
    const base = await chrome(page, []);
    expect(base.trackCount, 'default: titlebar + body + statusbar').toBe(3);

    const noStatus = await chrome(page, ['nostatus']);
    expect(noStatus.trackCount).toBe(2);
    expect(noStatus.statusH).toBe(0);
    expect(noStatus.bodyH).toBeCloseTo(base.bodyH + base.statusH, 0);

    const autoHide = await chrome(page, ['autohide']);
    expect(autoHide.trackCount).toBe(2);
    expect(autoHide.bodyH).toBeGreaterThan(base.bodyH);

    const both = await chrome(page, ['autohide', 'nostatus']);
    expect(both.trackCount).toBe(1);
    expect(both.bodyH).toBeCloseTo(both.appH, 0);
  });

  test('the toast keeps its 24px clearance when the status bar is gone', async ({ page }) => {
    const withBar = await chrome(page, []);
    const gapWithBar = await toastGap(page);
    await chrome(page, ['nostatus']);
    const gapWithout = await toastGap(page);
    // The clearance tracks the bar: remove the bar, recover exactly its height.
    expect(gapWithout, 'no status bar left to clear').toBeCloseTo(24, 0);
    expect(gapWithBar - gapWithout).toBeCloseTo(withBar.statusH, 0);
  });

  // The reveal is a pointer-position threshold, not an element, so assert the threshold.
  // Rows 0-4 belong to the Windows resize border and never reach the DOM; the band that
  // does is what this pins.
  test('a pointer inside the top band reveals the bar; below it, nothing happens', async ({ page }) => {
    await chrome(page, ['autohide']);
    const peeked = () => page.evaluate(() =>
      document.documentElement.hasAttribute('data-chrome-peek'));
    const move = (y) => page.evaluate((clientY) => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientY, bubbles: true }));
    }, y);

    await move(10);
    expect(await peeked(), 'clientY 10 is inside the reveal band').toBe(true);

    await move(200);
    expect(await peeked(), 'moving into the body retracts').toBe(false);

    await move(60);
    expect(await peeked(), 'clientY 60 is below the band and must not reveal').toBe(false);
  });

  // Windows owns the top ~4 rows of a restored frameless window as a resize border and
  // sends the DOM nothing there. Move fast enough and the last mousemove the renderer
  // sees is far below the band -- measured 2026-08-23 on a live window, a two-jump flick
  // delivered one sample at clientY 272 and then silence, and the bar stayed hidden.
  // mouseleave still fires, carrying clientY 1, so that is what closes the gap.
  test('a pointer that leaves over the top edge reveals the bar', async ({ page }) => {
    await chrome(page, ['autohide']);
    const peeked = () => page.evaluate(() =>
      document.documentElement.hasAttribute('data-chrome-peek'));
    const leave = (y) => page.evaluate((clientY) => {
      document.dispatchEvent(new MouseEvent('mouseleave', { clientY, bubbles: false }));
    }, y);

    await leave(1);
    expect(await peeked(), 'leaving over the top edge means the pointer went up').toBe(true);

    await page.evaluate(() => document.documentElement.removeAttribute('data-chrome-peek'));
    await leave(400);
    expect(await peeked(), 'leaving sideways or downward must not reveal').toBe(false);
  });

  // Electron builds its Win32 drag rectangles from an element's LAYOUT box. The hidden bar
  // is still laid out across rows 0-35 (position:absolute; top:0; height:35px) and is only
  // MOVED by transform: translateY(-100%), so it kept that whole band as a drag region and
  // swallowed every pointer event aimed at the reveal. Measured on a live window
  // 2026-08-23: rows 0-4 answered HTTOP and rows 5-10 HTCAPTION, so a real cursor never
  // reached the DOM — while Playwright's injected mouse did, which is why this suite stayed
  // green while the feature was unusable.
  test('the hidden bar releases the window drag region, and takes it back when revealed', async ({ page }) => {
    // The app-region rules are scoped to html.electron, which only the preload sets.
    await page.evaluate(() => document.documentElement.classList.add('electron'));
    const region = () => page.evaluate(() =>
      getComputedStyle(document.querySelector('.titlebar')).getPropertyValue('-webkit-app-region'));

    await chrome(page, ['autohide']);
    expect(await region(), 'a hidden bar must not hold a drag region').toBe('no-drag');

    await page.evaluate(() => document.documentElement.setAttribute('data-chrome-peek', ''));
    expect(await region(), 'a revealed bar still drags the window').toBe('drag');

    await page.evaluate(() => document.documentElement.removeAttribute('data-chrome-peek'));
    await chrome(page, []);
    expect(await region(), 'with auto-hide off the bar always drags').toBe('drag');
  });

  test('hovering the top edge reveals the bar, and leaving it retracts', async ({ page }) => {
    await chrome(page, ['autohide']);
    const appTop = await page.evaluate(() =>
      Math.round(document.querySelector('.app').getBoundingClientRect().top));

    const barTop = () => page.evaluate(() =>
      Math.round(document.querySelector('.titlebar').getBoundingClientRect().top));

    expect(await barTop(), 'starts lifted out of view').toBeLessThan(appTop);

    await page.mouse.move(700, appTop + 2);
    await page.waitForTimeout(350);
    expect(await barTop(), 'hot edge reveals it').toBe(appTop);

    await page.mouse.move(700, appTop + 400);
    await page.waitForTimeout(400);
    expect(await barTop(), 'moving into the body retracts it').toBeLessThan(appTop);
  });

  test('keyboard focus reveals the bar, so no control is stranded off-screen', async ({ page }) => {
    await chrome(page, ['autohide']);
    const appTop = await page.evaluate(() =>
      Math.round(document.querySelector('.app').getBoundingClientRect().top));
    await page.focus('#sidebarToggleBtn');
    await page.waitForTimeout(300);
    const top = await page.evaluate(() =>
      Math.round(document.querySelector('.titlebar').getBoundingClientRect().top));
    expect(top, ':focus-within must reveal the bar').toBe(appTop);
  });

  // The hidden bar must sit UNDER the palette (z-index 100) and the modal (110), or it
  // paints over a dialog that is supposed to own the screen.
  test('the hidden bar stacks below the modal and palette', async ({ page }) => {
    await chrome(page, ['autohide']);
    const z = await page.evaluate(() => {
      const zi = (sel) => parseInt(getComputedStyle(document.querySelector(sel)).zIndex, 10);
      return {
        titlebar: zi('.titlebar'),
        palette: zi('.palette-overlay'),
        modal: zi('.modal-overlay'),
      };
    });
    expect(z.titlebar).toBeLessThan(z.palette);
    expect(z.titlebar).toBeLessThan(z.modal);
  });

  test('an open dialog is never covered by the revealed bar', async ({ page }) => {
    await chrome(page, ['autohide']);
    await page.evaluate(() => window.showShortcuts());
    await page.waitForTimeout(200);
    const appTop = await page.evaluate(() =>
      Math.round(document.querySelector('.app').getBoundingClientRect().top));
    await page.mouse.move(700, appTop + 2);
    await page.waitForTimeout(350);
    const covered = await page.evaluate(() => {
      const bar = document.querySelector('.titlebar').getBoundingClientRect();
      const dlg = document.querySelector('#modalOverlay .modal').getBoundingClientRect();
      const overlap = !(bar.bottom <= dlg.top || bar.top >= dlg.bottom);
      const barZ = parseInt(getComputedStyle(document.querySelector('.titlebar')).zIndex, 10);
      const dlgZ = parseInt(getComputedStyle(document.querySelector('#modalOverlay')).zIndex, 10);
      return overlap && barZ > dlgZ;
    });
    expect(covered, 'the bar must not paint over an open dialog').toBe(false);
  });
});

// A separate describe: these reload the page with a seeded chrome state, so they cannot
// share the suite-wide beforeEach that lands on a clean document.
test.describe('[T-F19] launching with chrome already hidden', () => {
  /** Seed the pre-paint mirror the way a previous session would have left it, then boot. */
  async function bootWith(page, chromeValue) {
    await page.goto(INDEX_URL);
    await page.evaluate((v) => localStorage.setItem('bpmdrtlreader-chrome', v), chromeValue);
    await page.reload();
    await page.waitForSelector('.app', { state: 'visible' });
  }

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('bpmdrtlreader-chrome')).catch(() => {});
  });

  // restoreSettings() sets the flags straight from disk and calls applyChromeLayout(); it
  // never goes through setAutoHideTitlebar(), where the recovery toast lives. So opening
  // the app with the bar hidden used to explain nothing at all.
  test('says how to get the top bar back', async ({ page }) => {
    await bootWith(page, 'autohide');
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('Ctrl+Shift+T');
    await expect(toast).toContainText('top edge');
  });

  test('says how to get the status bar back', async ({ page }) => {
    await bootWith(page, 'nostatus');
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText('Ctrl+Shift+B');
  });

  test('stays quiet when nothing is hidden', async ({ page }) => {
    await bootWith(page, '');
    await page.waitForTimeout(600);
    // #toast is always in the DOM; `.show` is what makes it a visible toast.
    await expect(page.locator('#toast')).not.toHaveClass(/\bshow\b/);
  });
});
