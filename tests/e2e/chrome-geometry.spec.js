// @ts-check
/**
 * chrome-geometry.spec.js — T-F19 compact chrome, measured in a real engine.
 *
 * The static token contract lives in tests/unit/chrome-tokens.test.js; this file
 * asserts what the tokens actually RESOLVE to once the cascade has run: bar heights,
 * type and icon sizes, the tab strip fitting inside its shortened track, and the
 * toast keeping its clearance above the status bar in every chrome state.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

async function injectFile(page, name, content) {
  await page.evaluate(({ name, content }) => {
    const S = window._appState;
    S.files = [{ name, path: name, handle: null, content, dirty: false }];
    window.renderFile(0);
  }, { name, content });
}

/** px number from a computed style string like "22px". */
const px = (v) => parseFloat(v);

/** Rendered gap between the visible toast and the bottom edge of .app. */
async function toastGap(page) {
  await page.evaluate(() => new Promise((resolve) => {
    window.showToast('measure', 'info');
    const t = document.querySelector('.toast');
    const dur = t ? parseFloat(getComputedStyle(t).transitionDuration) : 0;
    if (!dur) return resolve();
    t.addEventListener('transitionend', () => resolve(), { once: true });
    setTimeout(resolve, 1000);
  }));
  const gap = await page.evaluate(() => {
    const t = document.querySelector('.toast').getBoundingClientRect();
    const app = document.querySelector('.app').getBoundingClientRect();
    return app.bottom - t.bottom;
  });
  return gap;
}

test.describe('[T-F19] compact chrome geometry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
  });

  // ── tab strip ────────────────────────────────────────────────────────────
  // .tabs sets overflow-y:hidden, so a .tab taller than the strip's CONTENT box
  // is silently clipped at the bottom. At 36px with padding-block 6px 0 the box is
  // 30px against a 31px tab — already 1px over — and shortening the bar to 35px
  // makes it 2px. Assert the invariant rather than either magic number.
  test('a tab fits inside the tab strip content box', async ({ page }) => {
    await injectFile(page, 'notes.md', '# Notes\n\nBody.\n');
    const m = await page.evaluate(() => {
      const tabs = document.querySelector('.tabs');
      const tab = document.querySelector('.tab');
      const cs = getComputedStyle(tabs);
      return {
        contentBox: tabs.getBoundingClientRect().height
          - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
        tab: tab ? tab.getBoundingClientRect().height : null,
        addBtn: document.querySelector('.tab-add').getBoundingClientRect().height
          + parseFloat(getComputedStyle(document.querySelector('.tab-add')).marginBottom),
      };
    });
    expect(m.tab, 'a tab should exist after injecting a file').not.toBeNull();
    expect(m.tab, 'tab is clipped by .tabs overflow-y:hidden').toBeLessThanOrEqual(m.contentBox);
    expect(m.addBtn, '+ button is clipped by .tabs overflow-y:hidden').toBeLessThanOrEqual(m.contentBox);
  });

  // ── toast clearance ──────────────────────────────────────────────────────
  // #toast is a child of .app, so its `bottom` is measured past the status-bar row.
  // Measure the declared offset, not the rect: the toast is translated off-screen
  // while hidden, which would confound a bounding-box read.
  test('the toast clears the status bar by 24px', async ({ page }) => {
    const statusbar = await page.evaluate(() =>
      document.querySelector('.statusbar').getBoundingClientRect().height);
    // Measure what is painted. Chromium resolves `bottom` on this absolutely positioned child of
    // a grid container from layout, so the computed string is not a reliable stand-in.
    expect(await toastGap(page)).toBeCloseTo(statusbar + 24, 0);
  });

  // What the tokens actually resolve to once the cascade has run.
  test('the bars resolve to the compact scale', async ({ page }) => {
    const m = await page.evaluate(() => {
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      const h = (sel) => document.querySelector(sel).getBoundingClientRect().height;
      return {
        titlebar: h('.titlebar'),
        statusbar: h('.statusbar'),
        winControls: h('.win-controls'),
        menuFont: cs('.tb-menu-item').fontSize,
        statusFont: cs('.statusbar').fontSize,
        iconW: cs('#themeBtn .ic').width,
        iconH: cs('#themeBtn .ic').height,
        dropdownTop: cs('#dropdown').top,
      };
    });
    // Marginalia redesign: a 44px command row over a 34px tab row (78px in all), a 30px
    // folio. See chrome-tokens.test.js.
    expect(m.titlebar).toBeCloseTo(78, 0);
    expect(m.statusbar).toBeCloseTo(30, 0);
    expect(m.winControls).toBeCloseTo(44, 0);
    expect(m.menuFont).toBe('13px');
    expect(m.statusFont).toBe('11.5px');
    expect(m.iconW).toBe('16px');
    expect(m.iconH).toBe('16px');
    // the dropdown hangs off the command row, so it must track the same token
    expect(px(m.dropdownTop)).toBeCloseTo(44, 0);
  });

  test('every interactive title-bar control clears the 24x24 target minimum', async ({ page }) => {
    const small = await page.evaluate(() => {
      const sels = ['#sidebarToggleBtn', '#viewModeBtn', '#rtlBtn', '#themeBtn',
        '#fullscreenBtn', '#inspectorToggleBtn', '#tabAddBtn', '#winMinBtn', '#winMaxBtn', '#winCloseBtn'];
      return sels.map((s) => {
        const el = document.querySelector(s);
        if (!el) return { s, w: null, h: null };
        const r = el.getBoundingClientRect();
        return { s, w: Math.round(r.width), h: Math.round(r.height) };
      }).filter((x) => x.w === null || x.w < 24 || x.h < 24);
    });
    expect(small, `controls under 24x24: ${JSON.stringify(small)}`).toEqual([]);
  });

  // Marginalia redesign: the command row reads start to end as sidebar toggle, mark, menus,
  // a flexible command bar centred in the free space, then the action cluster and the
  // window controls. The command bar is capped at 34rem so it never swallows the row.
  test('[marginalia] the command row reads in order and the command bar is capped', async ({ page }) => {
    const m = await page.evaluate(() => {
      const left = (sel) => document.querySelector(sel).getBoundingClientRect().left;
      const box = document.querySelector('#searchBtn').getBoundingClientRect();
      return {
        toggle: left('#sidebarToggleBtn'),
        mark: left('#markBtn'),
        menus: left('.tb-menubar'),
        search: left('#searchBtn'),
        searchWidth: box.width,
        mode: left('#viewModeBtn'),
        dir: left('#rtlBtn'),
        theme: left('#themeBtn'),
        inspector: left('#inspectorToggleBtn'),
        win: left('#winMinBtn'),
      };
    });
    const order = [m.toggle, m.mark, m.menus, m.search, m.mode, m.dir, m.theme, m.inspector, m.win];
    expect(order, 'command row order').toEqual([...order].sort((a, b) => a - b));
    expect(m.searchWidth).toBeLessThanOrEqual(34 * 16 + 1);
  });

  // The action cluster is anchored to the window controls, so it must not jump when the
  // inspector panel collapses and the pane widths change.
  test('[marginalia] the action cluster does not move when the inspector collapses', async ({ page }) => {
    await injectFile(page, 'zoning2.md', '# Zoning\n');
    const before = await page.evaluate(() => document.getElementById('viewModeBtn').getBoundingClientRect().left);
    await page.click('#inspectorToggleBtn');
    const after = await page.evaluate(() => document.getElementById('viewModeBtn').getBoundingClientRect().left);
    expect(after).toBeCloseTo(before, 0);
  });

  // The sidebar is 19.5rem wide, and 16rem at <=1100px (responsive.css overrides the token).
  test('[marginalia] the sidebar is 312px wide and narrows to 256px at <=1100px', async ({ page }) => {
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }
    await page.waitForSelector('#sidebarPanel', { state: 'visible' });
    const wide = await page.evaluate(() => document.getElementById('sidebarPanel').getBoundingClientRect().width);
    expect(wide).toBeCloseTo(312, 0);
    await page.setViewportSize({ width: 1000, height: 800 });
    const narrow = await page.evaluate(() => document.getElementById('sidebarPanel').getBoundingClientRect().width);
    expect(narrow).toBeCloseTo(256, 0);
  });

  test('[marginalia] the tab row sits directly under the command row', async ({ page }) => {
    await injectFile(page, 'rows.md', '# Rows\n');
    const m = await page.evaluate(() => {
      const bar = document.querySelector('.titlebar').getBoundingClientRect();
      const row = document.querySelector('.tb-row').getBoundingClientRect();
      const tabs = document.querySelector('.tabs').getBoundingClientRect();
      return { barTop: bar.top, rowTop: row.top, rowBottom: row.bottom, tabsTop: tabs.top, tabsBottom: tabs.bottom, barBottom: bar.bottom };
    });
    expect(m.rowTop).toBeCloseTo(m.barTop, 0);
    expect(m.tabsTop).toBeCloseTo(m.rowBottom, 0);
    expect(m.tabsBottom).toBeCloseTo(m.barBottom, 0);
  });
});

test.describe('[Marginalia] status bar folio extras', () => {
  test('the zoom button shows the zoom level and resets it on click', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await expect(page.locator('#zoomBtn')).toHaveText('100%');
    await page.evaluate(() => window.zoomIn());
    await expect(page.locator('#zoomBtn')).toHaveText('110%');
    await page.click('#zoomBtn');
    await expect(page.locator('#zoomBtn')).toHaveText('100%');
    expect(await page.evaluate(() => window._appState.zoomFactor)).toBe(1);
  });

  test('the reading bar follows the open note and hides on the welcome screen', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await expect(page.locator('#sbProgress')).toBeHidden();
    await page.evaluate(() => {
      window._appState.files = [{ name: 'a.md', path: 'a.md', handle: null, content: '# a\n\nbody\n', dirty: false }];
      window.renderFile(0);
    });
    await expect(page.locator('#sbProgress')).toHaveCount(1);
    expect(await page.evaluate(() => document.getElementById('sbProgress').hidden)).toBe(false);
  });
});
