// @ts-check
/**
 * typography-zoom.spec.js — T-T4 (rem sizing + app-wide zoom via the :root rem base,
 * staying within the viewport) and T-T5 (no chrome label below 11px), including the
 * transient overlays (menus / palette / modal) where the smallest labels live.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

// Smallest rendered font-size (and a sample) among visible text elements matching `sel`,
// excluding the rendered note/editor panes (prose has its own scale).
const scanChrome = (page, sel) => page.evaluate((selector) => {
  const inContent = (el) => el.closest('#noteContent, #editor, #srcTextarea, .preview-pane, .modal-body');
  const out = [];
  document.querySelectorAll(selector).forEach((el) => {
    if (inContent(el)) return;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    out.push({ fs: parseFloat(getComputedStyle(el).fontSize), cls: String(el.className), tag: el.tagName });
  });
  return out;
}, sel);

test.describe('[T-T4] app-wide zoom (rem base)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('zoom scales CHROME label text ~1.5x (the File menu button + a status-bar label)', async ({ page }) => {
    // Measure rendered font-size: a button's box height is partly fixed-px (padding/row),
    // so the visible scaling is in the TEXT (rem resolves against the scaled root base).
    const fs = (sel) => page.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize), sel);
    const beforeMenu = await fs('.tb-menu-item[data-menu="file"]');
    const beforeStat = await fs('#sbVault');
    await page.evaluate(() => window.setZoom(1.5));
    await page.waitForTimeout(50);
    expect(await fs('.tb-menu-item[data-menu="file"]')).toBeCloseTo(beforeMenu * 1.5, 0); // chrome text scaled
    expect(await fs('#sbVault')).toBeCloseTo(beforeStat * 1.5, 0);                          // status bar too
  });

  test('zoom drives the :root rem base; #editorArea zoom is cleared (no double-scale)', async ({ page }) => {
    await page.evaluate(() => window.setZoom(1.4));
    const z = await page.evaluate(() => ({
      rootFs: parseFloat(document.documentElement.style.fontSize),
      editor: document.getElementById('editorArea').style.zoom,
    }));
    expect(z.rootFs).toBeCloseTo(22.4, 1); // 16 * 1.4
    expect(z.editor).toBe('');
  });

  test('zoom is clamped to the 0.6–2.0 range', async ({ page }) => {
    const lo = await page.evaluate(() => { window.setZoom(0.1); return window._appState.zoomFactor; });
    const hi = await page.evaluate(() => { window.setZoom(9); return window._appState.zoomFactor; });
    expect(lo).toBeGreaterThanOrEqual(0.6);
    expect(hi).toBeLessThanOrEqual(2.0);
  });

  // The headline failure mode of app-wide scaling is pushing fixed chrome off-screen.
  // Root-font scaling must keep the .app frame viewport-sized at every zoom level.
  for (const z of [0.6, 1.5, 2.0]) {
    test(`at zoom ${z} the chrome stays within the viewport (statusbar + titlebar reachable)`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate((zoom) => window.setZoom(zoom), z);
      await page.waitForTimeout(60);
      const m = await page.evaluate(() => {
        const sb = document.querySelector('.statusbar').getBoundingClientRect();
        const tb = document.querySelector('.titlebar').getBoundingClientRect();
        return { sbBottom: sb.bottom, tbTop: tb.top, ih: window.innerHeight };
      });
      expect(m.tbTop).toBeGreaterThanOrEqual(-1);          // titlebar not clipped off the top
      expect(m.sbBottom).toBeLessThanOrEqual(m.ih + 1);    // statusbar bottom within the viewport
    });
  }

  test('an open menu scrolls internally instead of clipping past the viewport at 2x', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.setZoom(2.0));
    await page.locator('.tb-menu-item[data-menu="file"]').click();
    await expect(page.locator('#dropdown')).toHaveClass(/open/);
    const m = await page.evaluate(() => {
      const d = document.getElementById('dropdown');
      return { bottom: d.getBoundingClientRect().bottom, ih: window.innerHeight, scrollable: d.scrollHeight > d.clientHeight + 1, overflowY: getComputedStyle(d).overflowY };
    });
    // Either it fits, or it is internally scrollable (overflow-y:auto + bounded max-height).
    expect(m.bottom <= m.ih + 1 || (m.scrollable && m.overflowY === 'auto')).toBe(true);
  });
});

test.describe('[T-T5] minimum label size', () => {
  test('no visible chrome label renders below 11px — including menus, palette, and modal', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);

    const measured = [];
    // Always-visible chrome (correct live selectors: .toolbar-strip, .tabs — not .toolbar/.tab-strip).
    measured.push(...await scanChrome(page, '.titlebar *, .toolbar-strip *, .statusbar *, .sidebar *, .tabs *'));
    // Open each transient surface and scan the labels that live only there.
    await page.locator('.tb-menu-item[data-menu="file"]').click();
    await expect(page.locator('#dropdown')).toHaveClass(/open/);
    const menu = await scanChrome(page, '#dropdown *');
    measured.push(...menu);
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.openPalette());
    await page.waitForTimeout(100);
    const palette = await scanChrome(page, '.palette *');
    measured.push(...palette);
    await page.keyboard.press('Escape');

    await page.evaluate(() => window.showShortcuts());
    await page.waitForTimeout(100);
    const modal = await scanChrome(page, '.modal-header *, .modal-title');
    measured.push(...modal);

    // Guard against a vacuous green: we must have actually measured the overlay chrome.
    expect(menu.length, 'menu labels measured').toBeGreaterThan(0);
    expect(palette.length, 'palette labels measured').toBeGreaterThan(0);
    expect(measured.length).toBeGreaterThan(20);

    measured.sort((a, b) => a.fs - b.fs);
    const worst = measured[0];
    expect(worst.fs, `smallest chrome label: ${worst.fs}px on ${worst.tag}.${worst.cls}`).toBeGreaterThanOrEqual(10.99);
  });
});
test.describe('[Task 2] reader text scale', () => {
  test('scales rendered headings and document metadata without changing image geometry', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(() => {
      window._appState.files = [{
        name: 'scale.md', path: 'scale.md', dirty: false,
        content: '# Heading\n\n## Subheading\n\nBody text.',
      }];
      window.renderFile(0);
      window.setViewMode('reading');
      const image = document.createElement('img');
      image.style.width = '200px';
      image.style.height = '80px';
      document.getElementById('noteContent').appendChild(image);
    });

    const measure = (scale) => page.evaluate((value) => {
      document.documentElement.style.setProperty('--reader-text-scale', value);
      const size = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      return {
        h1: size('#noteContent h1'),
        h2: size('#noteContent h2'),
        meta: size('#noteContent .doc-meta'),
        imageWidth: document.querySelector('#noteContent img').getBoundingClientRect().width,
      };
    }, String(scale));

    const base = await measure(1);
    const scaled = await measure(1.25);
    expect(scaled.h1).toBeCloseTo(base.h1 * 1.25, 1);
    expect(scaled.h2).toBeCloseTo(base.h2 * 1.25, 1);
    expect(scaled.meta).toBeCloseTo(base.meta * 1.25, 1);
    expect(scaled.imageWidth).toBeCloseTo(base.imageWidth, 1);
  });
  test('scales mixed RTL reader text without changing image or Mermaid geometry', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(() => {
      window._appState.files = [{
        name: 'mixed-scale.md', path: 'mixed-scale.md', dirty: false,
        content: '# English heading\n\n## \u0639\u0646\u0648\u0627\u0646 \u0639\u0631\u0628\u064a\n\n> [!NOTE] \u0645\u0644\u0627\u062d\u0638\u0629 \u0645\u0647\u0645\u0629\n> \u0646\u0635 \u0639\u0631\u0628\u064a \u0645\u0639 `inline code`.\n\n\u0641\u0642\u0631\u0629 English \u0648\u0639\u0631\u0628\u064a\u0629.',
      }];
      window.renderFile(0);
      window.setViewMode('reading');
      const note = document.getElementById('noteContent');
      const image = document.createElement('img');
      image.style.cssText = 'width: 200px; height: 80px';
      const mermaid = document.createElement('div');
      mermaid.className = 'mermaid';
      mermaid.innerHTML = '<svg width="220" height="90" viewBox="0 0 220 90"><rect width="220" height="90"></rect></svg>';
      note.append(image, mermaid);
    });
    await expect(page.locator('#noteContent h2[dir="rtl"]')).toBeVisible();
    await expect(page.locator('#noteContent .callout-title')).toBeVisible();
    await expect(page.locator('#noteContent .callout-body code')).toBeVisible();

    const measure = (scale) => page.evaluate((value) => {
      document.documentElement.style.setProperty('--reader-text-scale', value);
      const size = (selector) => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      const image = document.querySelector('#noteContent img').getBoundingClientRect();
      const mermaid = document.querySelector('#noteContent .mermaid svg').getBoundingClientRect();
      return {
        rtlHeading: size('#noteContent h2[dir="rtl"]'),
        calloutTitle: size('#noteContent .callout-title'),
        calloutCode: size('#noteContent .callout-body code'),
        imageWidth: image.width,
        mermaidWidth: mermaid.width,
        mermaidHeight: mermaid.height,
      };
    }, String(scale));

    const base = await measure(1);
    const scaled = await measure(1.25);
    expect(scaled.rtlHeading).toBeCloseTo(base.rtlHeading * 1.25, 1);
    expect(scaled.calloutTitle).toBeCloseTo(base.calloutTitle * 1.25, 1);
    expect(scaled.calloutCode).toBeCloseTo(base.calloutCode * 1.25, 1);
    expect(scaled.imageWidth).toBeCloseTo(base.imageWidth, 1);
    expect(scaled.mermaidWidth).toBeCloseTo(base.mermaidWidth, 1);
    expect(scaled.mermaidHeight).toBeCloseTo(base.mermaidHeight, 1);
  });
});
