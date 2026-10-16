// @ts-check
/**
 * margin-notes-layout.spec.js: the margin-notes column never moves the reading page.
 * The page (#noteContent) keeps the same horizontal centre with and without notes; notes
 * sit in the free gutter beside it, mirrored in RTL, and hide when the gutter is too narrow.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');
const DOC = '# Autonomy\n\nWork fully autonomously, except for important decisions below.\n\n## Second\n\nA second paragraph of plain reading prose.\n';
const HIGHLIGHT = { id: 'h-important', text: 'important', note: 'Hello', at: 1, anchor: { headingSlug: 'autonomy', ordinal: 0 } };

async function boot(page, { width, height, withNote }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    window.electronAPI = {
      getSettings: async () => ({ theme: 'paper', zoomFactor: 1, viewMode: 'reading', recents: [], lastSession: null, sidebarVisible: false, inspectorVisible: false }),
      setSettings: async () => {},
      onOpenFile: () => {}, onVaultChanged: () => {},
    };
  });
  await page.goto(INDEX_URL);
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('editorArea')?.classList.contains('cm-single'), null, { timeout: 8000 });
  await page.evaluate((highlights) => {
    window.electronAPI.annotationsGet = async () => ({ highlights });
    window.electronAPI.annotationsPut = async () => ({ ok: true, count: 0 });
  }, withNote ? [HIGHLIGHT] : []);
  await page.evaluate((md) => {
    window._appState.files = [{ name: 'r.md', path: 'r.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
  }, DOC);
  // Wait for the highlight to re-anchor (the card may still be hidden for lack of gutter).
  if (withNote) await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(1);
}

/** Geometry of the reading column, the notes column and the first card, in CSS pixels. */
async function geometry(page) {
  return page.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const pane = document.querySelector('.preview-pane');
    const col = r(document.getElementById('noteContent'));
    const host = document.getElementById('marginNotes');
    const card = document.querySelector('#marginNotes .mn');
    const mark = document.querySelector('#noteContent mark.user-hl');
    const hostRect = r(host);
    const visible = !!hostRect && hostRect.width > 0 && getComputedStyle(host).display !== 'none' && !host.hidden;
    const paneInnerLeft = r(pane).left + pane.clientLeft;
    return {
      colLeft: col.left, colRight: col.right, colCenter: (col.left + col.right) / 2,
      paneCenter: paneInnerLeft + pane.clientWidth / 2,
      dir: getComputedStyle(document.getElementById('noteContent')).direction,
      notesVisible: visible,
      hostLeft: visible ? hostRect.left : null,
      hostRight: visible ? hostRect.right : null,
      cardCount: document.querySelectorAll('#marginNotes .mn').length,
      cardTop: card ? card.getBoundingClientRect().top : null,
      markTop: mark ? mark.getBoundingClientRect().top : null,
      cardLeft: card ? card.getBoundingClientRect().left : null,
      cardRight: card ? card.getBoundingClientRect().right : null,
    };
  });
}

test.describe('margin notes never move the reading page', () => {
  // Panels closed (the packaged default). At 2000 the free gutter (~514px a side) holds a card;
  // at 1440 it is ~311px, less than card (232) + sheet gap + 24, so the cards fold to markers.
  for (const { viewport, expectVisible, expectCards } of [
    { viewport: { width: 2000, height: 1250 }, expectVisible: true, expectCards: 1 },
    { viewport: { width: 1440, height: 900 }, expectVisible: true, expectCards: 0 },
  ]) {
    test(`page centre is unchanged by a note at ${viewport.width}x${viewport.height}`, async ({ page, browser }) => {
      await boot(page, { ...viewport, withNote: false });
      const bare = await geometry(page);
      const other = await browser.newPage();
      await boot(other, { ...viewport, withNote: true });
      const noted = await geometry(other);
      await other.close();

      expect(Math.abs(noted.colCenter - bare.colCenter)).toBeLessThanOrEqual(2);
      expect(Math.abs(noted.colCenter - bare.paneCenter)).toBeLessThanOrEqual(2);
      expect(noted.notesVisible).toBe(expectVisible);
      expect(noted.cardCount).toBe(expectCards);
      expect(noted.hostLeft).toBeGreaterThanOrEqual(noted.colRight);
      if (expectCards) {
        expect(noted.cardLeft).toBeGreaterThanOrEqual(noted.colRight);
        expect(Math.abs(noted.cardTop - noted.markTop)).toBeLessThanOrEqual(2);
      }
    });
  }

  test('RTL: notes mirror into the left gutter and the page stays centred at 2000x1250', async ({ page, browser }) => {
    const viewport = { width: 2000, height: 1250 };
    await boot(page, { ...viewport, withNote: false });
    await page.evaluate(() => window.toggleRTL());
    await expect(page.locator('#noteContent')).toHaveCSS('direction', 'rtl');
    const bare = await geometry(page);

    const other = await browser.newPage();
    await boot(other, { ...viewport, withNote: true });
    await other.evaluate(() => window.toggleRTL());
    await expect(other.locator('#noteContent')).toHaveCSS('direction', 'rtl');
    const noted = await geometry(other);
    await other.close();

    expect(Math.abs(noted.colCenter - bare.colCenter)).toBeLessThanOrEqual(2);
    expect(noted.notesVisible).toBe(true);
    expect(noted.hostRight).toBeLessThanOrEqual(noted.colLeft);
    expect(noted.cardRight).toBeLessThanOrEqual(noted.colLeft);
  });

  test('a gutter too narrow for a card shows markers, not cards, and keeps the page centred at 1024x768', async ({ page, browser }) => {
    await boot(page, { width: 1024, height: 768, withNote: false });
    const bare = await geometry(page);
    const other = await browser.newPage();
    await boot(other, { width: 1024, height: 768, withNote: true });
    const noted = await geometry(other);
    await other.close();

    expect(Math.abs(noted.colCenter - bare.colCenter)).toBeLessThanOrEqual(2);
    expect(noted.notesVisible).toBe(true);
    expect(noted.cardCount).toBe(0);
    expect(noted.hostLeft).toBeGreaterThanOrEqual(noted.colRight);
  });

  test('screenshots with and without a note at 2000x1250', async ({ page, browser }) => {
    await boot(page, { width: 2000, height: 1250, withNote: false });
    await page.screenshot({ path: process.env.MARGIN_SHOT_DIR ? path.join(process.env.MARGIN_SHOT_DIR, 'margin-2000-without-note.png') : undefined });
    const other = await browser.newPage();
    await boot(other, { width: 2000, height: 1250, withNote: true });
    await other.screenshot({ path: process.env.MARGIN_SHOT_DIR ? path.join(process.env.MARGIN_SHOT_DIR, 'margin-2000-with-note.png') : undefined });
    await other.close();
  });
});
