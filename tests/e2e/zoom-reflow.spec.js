// @ts-check
/**
 * zoom-reflow.spec.js — audit H12. At 200 % zoom the 800 px minimum window is 400 CSS px wide;
 * the title bar was wider than that and pushed the window buttons off-screen (WCAG 1.4.4 resize
 * to 200 %, 1.4.10 reflow down to 320 CSS px). The minimise / maximise / close buttons must stay
 * fully inside the viewport and the page must not scroll horizontally, in the browser lane and
 * with the Electron class (which switches the app to a full-viewport frameless layout).
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');
const AXE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../node_modules/axe-core/axe.min.js'), 'utf8');

const WIDTHS = [1280, 800, 640, 400, 320];

async function boot(page, { electron, lang, withFile }) {
  await page.addInitScript({ content: AXE_SOURCE });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app', { state: 'visible' });
  await page.waitForFunction(() => !!window._appState && !!window.setArabicUI);
  await page.evaluate(({ electron, lang, withFile }) => {
    if (electron) document.documentElement.classList.add('electron');
    if (lang === 'ar') window.setArabicUI(true); // real Arabic labels and an RTL title bar
    if (withFile) {
      window._appState.files = [{ name: 'a-rather-long-document-name.md', path: 'a-rather-long-document-name.md', handle: null, content: '# Title\n\nBody', dirty: false }];
      window.renderFile(0);
    }
  }, { electron, lang, withFile });
}

async function measure(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
    return {
      vw,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      appRight: document.querySelector('.app').getBoundingClientRect().right,
      min: box('winMinBtn'), max: box('winMaxBtn'), close: box('winCloseBtn'),
      titlebarOverflow: (() => { const t = document.querySelector('.titlebar'); return t.scrollWidth - t.clientWidth; })(),
      // every group that is still shown must be fully inside the bar's row: nothing hangs out of it
      rowEnd: document.querySelector('.tb-row').getBoundingClientRect().right,
      groups: [...document.querySelector('.tb-row').children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => ({ cls: c.className, right: c.getBoundingClientRect().right, left: c.getBoundingClientRect().left })),
    };
  });
}

for (const electron of [false, true]) {
  for (const lang of ['en', 'ar']) {
    test.describe(`[H12] title bar reflow (${electron ? 'electron layout' : 'browser'}, ${lang})`, () => {
      for (const width of WIDTHS) {
        test(`window buttons stay inside a ${width}px viewport and the page does not scroll sideways`, async ({ page }) => {
          await page.setViewportSize({ width, height: 800 });
          await boot(page, { electron, lang, withFile: true });
          const m = await measure(page);
          for (const [name, b] of [['minimise', m.min], ['maximise', m.max], ['close', m.close]]) {
            expect(b.width, `${name} width`).toBeGreaterThan(0);
            expect(b.height, `${name} height`).toBeGreaterThan(0);
            expect(b.left, `${name} left edge`).toBeGreaterThanOrEqual(-0.5);
            expect(b.right, `${name} right edge`).toBeLessThanOrEqual(m.vw + 0.5);
            expect(b.right, `${name} inside the app frame`).toBeLessThanOrEqual(m.appRight + 0.5);
          }
          expect(m.scrollWidth, 'document scrollWidth').toBeLessThanOrEqual(m.innerWidth);
          expect(m.titlebarOverflow, 'title bar content wider than the bar').toBeLessThanOrEqual(1);
          for (const g of m.groups) {
            expect(g.right, `group ${g.cls} right edge`).toBeLessThanOrEqual(m.rowEnd + 0.5);
            expect(g.left, `group ${g.cls} left edge`).toBeGreaterThanOrEqual(-0.5);
          }
        });
      }
    });
  }
}

test.describe('[H12] the controls that remain are still usable at 400px', () => {
  test('the window buttons are clickable (not covered by another element)', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await boot(page, { electron: true, lang: 'en', withFile: true });
    for (const id of ['winMinBtn', 'winMaxBtn', 'winCloseBtn']) {
      const hit = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el === top || el.contains(top);
      }, id);
      expect(hit, id).toBe(true);
    }
  });

  test('the sidebar toggle, the menu and the view-mode switch stay reachable', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await boot(page, { electron: false, lang: 'en', withFile: true });
    for (const sel of ['#sidebarToggleBtn', '.tb-menu-item[data-menu="file"]', '.tb-menu-item[data-menu="help"]', '#viewModeBtn']) {
      const b = await page.locator(sel).boundingBox();
      expect(b, sel).not.toBeNull();
      expect(b.x, sel).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(400.5);
    }
  });

  test('axe finds no critical or serious violation at 400px', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await boot(page, { electron: false, lang: 'en', withFile: true });
    // the sidebar is open by default in the browser lane; at 400 px it would leave the editor 96 px
    // (a separate layout question, not the title bar) -- close it so axe judges the title bar and page
    await page.evaluate(() => { if (window._appState.sidebarVisible) document.getElementById('sidebarToggleBtn').click(); });
    const results = await page.evaluate(async () => {
      // @ts-ignore
      return axe.run(document.body, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    });
    const serious = results.violations.filter((v) => ['critical', 'serious'].includes(v.impact));
    expect(serious, JSON.stringify(serious.map((v) => v.id))).toHaveLength(0);
  });
});
