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
  await page.waitForTimeout(150);
}

/** px number from a computed style string like "22px". */
const px = (v) => parseFloat(v);

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
    // v10 redesign (2026-08-25): titlebar 35->38px, statusbar 22->24px, statusFont
    // 12->11.5px (still above the 11px legibility floor). See chrome-tokens.test.js.
    expect(m.titlebar).toBeCloseTo(38, 0);
    expect(m.statusbar).toBeCloseTo(24, 0);
    expect(m.winControls).toBeCloseTo(38, 0);
    expect(m.menuFont).toBe('13px');
    expect(m.statusFont).toBe('11.5px');
    expect(m.iconW).toBe('16px');
    expect(m.iconH).toBe('16px');
    // the dropdown hangs off the bar, so it must track the same token
    expect(px(m.dropdownTop)).toBeCloseTo(38, 0);
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

  // v10 redesign (2026-08-25): acceptance item 1 — the tab strip starts exactly at
  // the sidebar's right edge, so the titlebar zoning visually continues the sidebar
  // column beneath it. .tb-menubar's min-inline-size is derived from this app's own
  // measured .tb-lead width (35px = 8px lead padding + the 27px .tb-btn) via the
  // --sidebar-w/--tb-lead-w tokens (tests/unit/chrome-zoning.test.js), not copied
  // from the reference, whose assumed .tb-lead width differs.
  //
  // The trailing edge — the action cluster's first icon landing on the inspector's
  // left edge — previously could not be met at all: the reference's ±5px target
  // assumed 38px window-control buttons (3x38=114, trailing content 287px against a
  // 280px inspector); this app's .win-btn is 46px (pinned by chrome-tokens.test.js),
  // making the trailing content 285px, 19px past a 280px inspector with NO padding
  // left to absorb it. Fixed by widening the inspector to 300px instead (D1) — the
  // only option that keeps every pinned dimension (46px window buttons, 27px icons,
  // 3px gaps) and lands the alignment exactly, not approximately.
  test('[v10] the title-bar zones align with the panel columns', async ({ page }) => {
    // A fresh profile opens both panels by default; only toggle a panel that is
    // actually collapsed, rather than assuming either starting state.
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }
    if ((await page.getAttribute('#inspectorToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#inspectorToggleBtn');
    }
    await page.waitForSelector('#sidebarPanel', { state: 'visible' });
    await page.waitForSelector('#inspectorPanel', { state: 'visible' });
    await injectFile(page, 'zoning.md', '# Zoning\n');
    const m = await page.evaluate(() => ({
      sidebarRight: document.getElementById('sidebarPanel').getBoundingClientRect().right,
      firstTabLeft: document.querySelector('.tab-list .tab')?.getBoundingClientRect().left,
      inspectorLeft: document.getElementById('inspectorPanel').getBoundingClientRect().left,
      firstActionLeft: document.getElementById('viewModeBtn')?.getBoundingClientRect().left,
    }));
    expect(m.firstTabLeft, 'expected a rendered tab').not.toBeUndefined();
    expect(m.firstActionLeft, 'expected #viewModeBtn').not.toBeUndefined();
    expect(m.firstTabLeft).toBeCloseTo(m.sidebarRight, 0);
    expect(m.firstActionLeft).toBeCloseTo(m.inspectorLeft, 0);
  });

  // The alignment above is a zoning device: the action cluster reads as the header of
  // the inspector column. With the inspector collapsed there is no column to head, so
  // re-aligning would mean crowding the window-control buttons and making the icons
  // jump on every toggle — the leading edge already behaves this way (.tb-menubar's
  // min-inline-size is a fixed floor; the tab strip does not slide left when the
  // sidebar collapses). This pins that the icons deliberately stay put.
  test('[v10] the action cluster does not move when the inspector collapses', async ({ page }) => {
    await injectFile(page, 'zoning2.md', '# Zoning\n');
    const before = await page.evaluate(() => document.getElementById('viewModeBtn').getBoundingClientRect().left);
    await page.click('#inspectorToggleBtn');
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.getElementById('viewModeBtn').getBoundingClientRect().left);
    expect(after).toBeCloseTo(before, 0);
  });

  // v10 redesign: at <=1100px the sidebar narrows (responsive.css), and the title bar
  // must track it — one --sidebar-w override now drives both the body grid and the
  // .tb-menubar floor, instead of the two silently disagreeing.
  test('[v10] the tab strip tracks the narrowed sidebar at <=1100px', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }
    await page.waitForSelector('#sidebarPanel', { state: 'visible' });
    await injectFile(page, 'zoning3.md', '# Zoning\n');
    const m = await page.evaluate(() => ({
      sidebarRight: document.getElementById('sidebarPanel').getBoundingClientRect().right,
      firstTabLeft: document.querySelector('.tab-list .tab')?.getBoundingClientRect().left,
    }));
    expect(m.firstTabLeft, 'expected a rendered tab').not.toBeUndefined();
    expect(m.firstTabLeft).toBeCloseTo(m.sidebarRight, 0);
  });
});
