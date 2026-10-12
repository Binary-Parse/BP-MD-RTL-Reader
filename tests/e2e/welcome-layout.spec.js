// @ts-check
/**
 * welcome-layout.spec.js: the welcome (home) screen must fit inside its page.
 *
 * Regression for the 2000x1250 screenshot: the welcome was capped at the 800px reading
 * column, so its two cramped columns squeezed the hero title and the action rows, and long
 * file names ran past the page edge. These boot the renderer with a mocked electronAPI
 * (same bridge as recents-open.spec.js) and seed recents + reading progress with long names.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = `file:///${path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/')}`;

const LONG_LTR = 'Binary_Parse_Legal_Agent_Prompt.md';
const LONG_RTL = 'خلطة-فيديو-الذكاء-الاصطناعي.md';
const VERY_LONG_LTR = 'Binary_Parse_Legal_Agent_Prompt_v2_FINAL_with_all_the_reviewer_comments_2026.md';
const VERY_LONG_RTL = 'خلطة-فيديو-الذكاء-الاصطناعي-النسخة-النهائية-بعد-المراجعة-الكاملة-2026.md';
const CAP = (n) => `cap-${n}`;

const SETTINGS = {
  theme: 'paper', zoomFactor: 1, editorMode: 'live',
  sidebarVisible: true, inspectorVisible: true,
  uiDirection: 'ltr', uiLocale: 'en',
  calendar: 'gregorian', arabicKashida: false, italicRecolor: true,
  recents: [
    { name: LONG_LTR, path: `C:/Vault/${LONG_LTR}`, vaultId: null, documentId: CAP('a1') },
    { name: LONG_RTL, path: `C:/Vault/${LONG_RTL}`, vaultId: null, documentId: CAP('a2') },
    { name: 'AGENTS.md', path: 'C:/Vault/AGENTS.md', vaultId: null, documentId: CAP('a3') },
    { name: VERY_LONG_LTR, path: 'C:/Vault/' + VERY_LONG_LTR, vaultId: null, documentId: CAP('a4') },
    { name: VERY_LONG_RTL, path: 'C:/Vault/' + VERY_LONG_RTL, vaultId: null, documentId: CAP('a5') },
  ],
  readingProgress: [
    { key: 'k1', name: LONG_LTR, path: `C:/Vault/${LONG_LTR}`, vaultId: null, documentId: CAP('a1'), ratio: 0.56, at: Date.now() - 46800000 },
    { key: 'k2', name: LONG_RTL, path: `C:/Vault/${LONG_RTL}`, vaultId: null, documentId: CAP('a2'), ratio: 0.79, at: Date.now() - 3600000 },
  ],
  window: { w: 1280, h: 820, maximized: false }, lastSession: null,
};

async function boot(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.addInitScript((settings) => {
    const noop = () => {};
    window.electronAPI = {
      closeWindow: noop, minimizeWindow: noop, maximizeWindow: noop,
      openFolder: async () => ({ canceled: true }),
      readVault: async () => ({ error: 'unauthorized-capability' }),
      openFile: async () => ({ canceled: true }),
      readFile: async () => ({ error: 'unauthorized-path' }),
      writeFile: async () => ({ ok: true }),
      getSettings: async () => settings,
      setSettings: async () => ({ ok: true }),
      exportPDF: async () => ({ ok: true }),
      editCommand: noop, onOpenFile: noop, onVaultChanged: noop,
      checkForUpdate: async () => ({}), logError: noop,
    };
  }, SETTINGS);
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app', { state: 'visible' });
  await page.waitForSelector('.recent-item', { state: 'attached' });
  await page.waitForSelector('.continue-item', { state: 'attached' });
}

/** Descendants of the welcome card whose box falls outside the card (the page). */
function outsideCard(page) {
  return page.evaluate(() => {
    const card = document.querySelector('#welcome .welcome-card').getBoundingClientRect();
    const tol = 1;
    const bad = [];
    document.querySelectorAll('#welcome .welcome-card *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // hidden or display: contents
      if (r.left < card.left - tol || r.right > card.right + tol || r.top < card.top - tol || r.bottom > card.bottom + tol) {
        bad.push(el.tagName.toLowerCase() + '.' + (el.getAttribute('class') || ''));
      }
    });
    return bad;
  });
}

const SIZES = [[2000, 1250], [1440, 900], [1024, 768]];

test.describe('welcome screen fits its page', () => {
  for (const [w, h] of SIZES) {
    test(`no element leaves the welcome card and nothing scrolls sideways at ${w}x${h}`, async ({ page }) => {
      await boot(page, w, h);
      expect(await outsideCard(page)).toEqual([]);
      const overflow = await page.evaluate(() => {
        const sel = ['#welcome .welcome-card', '#welcome .recent-item', '#welcome .continue-item'];
        return sel.flatMap((s) => [...document.querySelectorAll(s)]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => s + ' ' + (el.textContent || '').trim().slice(0, 40)));
      });
      expect(overflow).toEqual([]);
    });
  }

  test('the welcome is not capped at the 800px reading column on a wide window', async ({ page }) => {
    await boot(page, 2000, 1250);
    const cardWidth = await page.evaluate(() => document.querySelector('#welcome .welcome-card').getBoundingClientRect().width);
    expect(cardWidth).toBeGreaterThan(900);
  });

  test('long file names truncate with an ellipsis on one line and keep the full name in title (LTR UI)', async ({ page }) => {
    await boot(page, 1440, 900);
    const names = await page.evaluate(() => [...document.querySelectorAll('#welcome .recent-item .r-name, #welcome .continue-item .c-name')].map((el) => {
      const cs = getComputedStyle(el);
      return {
        text: el.textContent, title: el.title, ellipsis: cs.textOverflow, nowrap: cs.whiteSpace,
        truncated: el.scrollWidth > el.clientWidth, height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2,
      };
    }));
    const long = names.find((n) => n.text === VERY_LONG_LTR);
    expect(long, 'very long LTR recent name rendered').toBeTruthy();
    expect(long.title).toBe(VERY_LONG_LTR);
    expect(long.truncated).toBe(true);
    expect(long.height).toBeLessThanOrEqual(long.lineHeight * 1.5);
    for (const n of names) {
      expect(n.ellipsis, n.text).toBe('ellipsis');
      expect(n.nowrap, n.text).toBe('nowrap');
    }
  });

  test('long Arabic file names truncate with an ellipsis on one line and keep the full name in title (RTL UI)', async ({ page }) => {
    await boot(page, 1440, 900);
    await page.evaluate(() => window.setArabicUI(true));
    const arabic = await page.evaluate((name) => {
      const el = [...document.querySelectorAll('#welcome .recent-item .r-name')].find((e) => e.textContent === name);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        title: el.title, ellipsis: cs.textOverflow, nowrap: cs.whiteSpace,
        truncated: el.scrollWidth > el.clientWidth, height: el.getBoundingClientRect().height,
        lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2,
      };
    }, VERY_LONG_RTL);
    expect(arabic, 'very long Arabic recent name rendered').toBeTruthy();
    expect(arabic.title).toBe(VERY_LONG_RTL);
    expect(arabic.ellipsis).toBe('ellipsis');
    expect(arabic.nowrap).toBe('nowrap');
    expect(arabic.truncated).toBe(true);
    expect(arabic.height).toBeLessThanOrEqual(arabic.lineHeight * 1.5);
    expect(await outsideCard(page)).toEqual([]);
  });

  test('the hero title wraps to at most 2 lines at 1440x900', async ({ page }) => {
    await boot(page, 1440, 900);
    const lines = await page.evaluate(() => {
      const h1 = document.querySelector('#welcome .welcome-card h1');
      const lh = parseFloat(getComputedStyle(h1).lineHeight);
      return Math.round(h1.getBoundingClientRect().height / lh);
    });
    expect(lines).toBeLessThanOrEqual(2);
  });

  test('action rows: description, title and shortcut do not overlap at 1440x900', async ({ page }) => {
    await boot(page, 1440, 900);
    const overlaps = await page.evaluate(() => {
      const hit = (a, b) => {
        const x = a.getBoundingClientRect(), y = b.getBoundingClientRect();
        return x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom;
      };
      const out = [];
      document.querySelectorAll('#welcome .welcome-btn').forEach((btn) => {
        const title = btn.querySelector('.wb-title > span:nth-child(2)');
        const sub = btn.querySelector('.wb-sub');
        const sc = btn.querySelector('.wb-shortcut');
        if (sc && sub && hit(sc, sub)) out.push(`${btn.id}: shortcut/sub`);
        if (sc && title && hit(sc, title)) out.push(`${btn.id}: shortcut/title`);
        if (title && sub && hit(title, sub)) out.push(`${btn.id}: title/sub`);
      });
      return out;
    });
    expect(overlaps).toEqual([]);
  });
});
