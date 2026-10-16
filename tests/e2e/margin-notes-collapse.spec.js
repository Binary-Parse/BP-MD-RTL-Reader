// @ts-check
/**
 * margin-notes-collapse.spec.js: the margin-notes column folds to gutter markers.
 * Toggle flips aria-expanded; the choice is saved with the other UI prefs and survives a reload;
 * markers sit level with their highlighted passage; a gutter too narrow for cards shows markers
 * instead of nothing; RTL mirrors it all.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');
const DOC = '# Autonomy\n\nWork fully autonomously, except for important decisions below.\n\n## Second\n\nA second paragraph of plain reading prose.\n';
const HIGHLIGHT = { id: 'h-important', text: 'important', note: 'Hello', at: 1, anchor: { headingSlug: 'autonomy', ordinal: 0 } };
const SHOT_DIR = process.env.MARGIN_SHOT_DIR;

/** Open the renderer with a fake bridge whose settings live in sessionStorage (so reload keeps them). */
async function boot(page, { width, height, theme = 'paper', sidebar = false, rtl = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(({ theme, sidebar }) => {
    const KEY = 'mn-test-settings';
    const base = { theme, zoomFactor: 1, viewMode: 'reading', recents: [], lastSession: null, sidebarVisible: sidebar, inspectorVisible: false };
    window.electronAPI = {
      getSettings: async () => ({ ...base, ...JSON.parse(sessionStorage.getItem(KEY) || '{}') }),
      setSettings: async (s) => { sessionStorage.setItem(KEY, JSON.stringify(s)); return { ok: true }; },
      onOpenFile: () => {}, onVaultChanged: () => {},
    };
  }, { theme, sidebar });
  await page.goto(INDEX_URL);
  await load(page, rtl);
}

async function load(page, rtl = false) {
  await page.waitForFunction(() => !!window._appState, null, { timeout: 8000 });
  await page.waitForFunction(() => document.getElementById('editorArea')?.classList.contains('cm-single'), null, { timeout: 8000 });
  await page.evaluate((highlights) => {
    window.electronAPI.annotationsGet = async () => ({ highlights });
    window.electronAPI.annotationsPut = async () => ({ ok: true, count: 0 });
  }, [HIGHLIGHT]);
  await page.evaluate((md) => {
    window._appState.files = [{ name: 'r.md', path: 'r.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
  }, DOC);
  await expect(page.locator('#noteContent mark.user-hl')).toHaveCount(1);
  if (rtl) {
    await page.evaluate(() => window.toggleRTL());
    await expect(page.locator('#noteContent')).toHaveCSS('direction', 'rtl');
  }
}

async function geometry(page) {
  return page.evaluate(() => {
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const col = r(document.getElementById('noteContent'));
    const host = document.getElementById('marginNotes');
    const toggle = document.querySelector('#marginNotes .mn-toggle');
    const dot = document.querySelector('#marginNotes .mn-dot');
    const mark = r(document.querySelector('#noteContent mark.user-hl'));
    const hostRect = r(host);
    const shown = !!hostRect && hostRect.width > 0 && getComputedStyle(host).display !== 'none' && !host.hidden;
    const pane = document.querySelector('.preview-pane');
    const pr = r(pane);
    return {
      shown,
      colLeft: col.left, colRight: col.right, colCenter: (col.left + col.right) / 2,
      paneCenter: pr.left + pane.clientLeft + pane.clientWidth / 2,
      cards: document.querySelectorAll('#marginNotes .mn').length,
      dots: document.querySelectorAll('#marginNotes .mn-dot').length,
      toggleExpanded: toggle ? toggle.getAttribute('aria-expanded') : null,
      toggleLabel: toggle ? toggle.getAttribute('aria-label') : null,
      hostWidth: shown ? hostRect.width : 0,
      hostLeft: shown ? hostRect.left : null,
      hostRight: shown ? hostRect.right : null,
      dotTop: dot ? dot.getBoundingClientRect().top : null,
      dotLeft: dot ? dot.getBoundingClientRect().left : null,
      dotRight: dot ? dot.getBoundingClientRect().right : null,
      markTop: mark ? mark.top : null,
      viewportW: window.innerWidth,
    };
  });
}

const shot = async (page, name) => { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name) }); };

test.describe('collapsible margin notes', () => {
  test('toggle folds the cards to a marker level with the passage and unfolds again; the page stays centred', async ({ page }) => {
    await boot(page, { width: 2000, height: 1250 });
    const open = await geometry(page);
    expect(open.shown).toBe(true);
    expect(open.cards).toBe(1);
    expect(open.dots).toBe(0);
    expect(open.toggleExpanded).toBe('true');
    expect(open.toggleLabel).toBe('Collapse margin notes');
    expect(Math.abs(open.colCenter - open.paneCenter)).toBeLessThanOrEqual(2);
    await shot(page, 'collapse-2000-expanded-paper.png');

    await page.locator('#marginNotes .mn-toggle').click();
    await expect(page.locator('#marginNotes .mn-toggle')).toHaveAttribute('aria-expanded', 'false');
    const folded = await geometry(page);
    expect(folded.shown).toBe(true);
    expect(folded.cards).toBe(0);
    expect(folded.dots).toBe(1);
    expect(folded.toggleLabel).toBe('Expand margin notes');
    expect(folded.hostWidth).toBeLessThan(40);
    expect(folded.dotLeft).toBeGreaterThanOrEqual(folded.colRight);
    expect(Math.abs(folded.dotTop - folded.markTop)).toBeLessThanOrEqual(4);
    expect(Math.abs(folded.colCenter - open.colCenter)).toBeLessThanOrEqual(2);
    await shot(page, 'collapse-2000-collapsed-paper.png');

    await page.locator('#marginNotes .mn-toggle').click();
    await expect(page.locator('#marginNotes .mn-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect((await geometry(page)).cards).toBe(1);
  });

  test('the toggle works from the keyboard', async ({ page }) => {
    await boot(page, { width: 2000, height: 1250 });
    await page.locator('#marginNotes .mn-toggle').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#marginNotes .mn-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('#marginNotes .mn-toggle').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('#marginNotes .mn-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('the choice is saved with the settings and survives a reload', async ({ page }) => {
    await boot(page, { width: 2000, height: 1250 });
    await page.locator('#marginNotes .mn-toggle').click();
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('mn-test-settings') || '{}').marginNotesCollapsed === true, null, { timeout: 5000 });
    await page.reload();
    await load(page);
    await expect(page.locator('#marginNotes .mn-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect((await geometry(page)).cards).toBe(0);
    expect((await geometry(page)).dots).toBe(1);

    await page.locator('#marginNotes .mn-toggle').click();
    await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('mn-test-settings') || '{}').marginNotesCollapsed === false, null, { timeout: 5000 });
    await page.reload();
    await load(page);
    await expect(page.locator('#marginNotes .mn-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  test('clicking a marker unfolds the column and marks that note active', async ({ page }) => {
    await boot(page, { width: 2000, height: 1250 });
    await page.locator('#marginNotes .mn-toggle').click();
    await page.locator('#marginNotes .mn-dot').click();
    await expect(page.locator('#marginNotes .mn-toggle')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#marginNotes .mn.on')).toHaveCount(1);
  });

  test('a narrow gutter (1440x900, left sidebar open) shows markers instead of nothing, without a toggle', async ({ page }) => {
    await boot(page, { width: 1440, height: 900, sidebar: true });
    const g = await geometry(page);
    expect(g.shown).toBe(true);
    expect(g.cards).toBe(0);
    expect(g.dots).toBe(1);
    expect(g.toggleExpanded).toBeNull();
    expect(g.dotLeft).toBeGreaterThanOrEqual(g.colRight);
    expect(g.dotRight).toBeLessThanOrEqual(g.viewportW);
    expect(Math.abs(g.dotTop - g.markTop)).toBeLessThanOrEqual(4);
    await shot(page, 'collapse-1440-sidebar-markers-paper.png');
    // The saved choice is untouched by the squeeze.
    expect(await page.evaluate(() => window._appState.marginNotesCollapsed)).toBe(false);
    // With no room to unfold, a marker jumps to its passage instead.
    await page.locator('#marginNotes .mn-dot').click();
    await expect(page.locator('#noteContent mark.user-hl.on')).toHaveCount(1);
  });

  test('collapsed at 1440x900 with panels closed: markers, page centred', async ({ page }) => {
    await boot(page, { width: 1440, height: 900 });
    const g = await geometry(page);
    expect(g.dots).toBe(1);
    expect(Math.abs(g.colCenter - g.paneCenter)).toBeLessThanOrEqual(2);
    await shot(page, 'collapse-1440-collapsed-paper.png');
  });

  test('a viewport too narrow even for markers hides the column', async ({ page }) => {
    await boot(page, { width: 700, height: 800 });
    const g = await geometry(page);
    expect(g.shown).toBe(false);
  });

  test('RTL: the markers and the toggle mirror into the left gutter', async ({ page }) => {
    await boot(page, { width: 2000, height: 1250, rtl: true });
    const open = await geometry(page);
    expect(open.shown).toBe(true);
    expect(open.cards).toBe(1);
    expect(open.hostRight).toBeLessThanOrEqual(open.colLeft);
    await shot(page, 'collapse-2000-expanded-rtl.png');
    await page.locator('#marginNotes .mn-toggle').click();
    const folded = await geometry(page);
    expect(folded.dots).toBe(1);
    expect(folded.dotRight).toBeLessThanOrEqual(folded.colLeft);
    expect(Math.abs(folded.dotTop - folded.markTop)).toBeLessThanOrEqual(4);
    expect(await page.locator('#marginNotes').getAttribute('dir')).toBe('rtl');
    await expect(page.locator('#marginNotes .mn-toggle')).toHaveAttribute('aria-label', /./);
    await shot(page, 'collapse-2000-collapsed-rtl.png');
  });

  test('dark theme (Ink): expanded and collapsed screenshots', async ({ page }) => {
    await boot(page, { width: 2000, height: 1250, theme: 'ink' });
    await shot(page, 'collapse-2000-expanded-ink.png');
    await page.locator('#marginNotes .mn-toggle').click();
    await shot(page, 'collapse-2000-collapsed-ink.png');
    expect((await geometry(page)).dots).toBe(1);
  });
});
