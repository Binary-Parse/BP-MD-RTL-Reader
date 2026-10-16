// @ts-check
/**
 * edit-selection-visible.spec.js — selected text in Edit mode must show a highlight in every
 * theme. drawSelection() paints the selection on a layer BEHIND .cm-content, and the opaque
 * paper sheet (.cm-content::before) used to cover it, so a selection was drawn but invisible.
 * Measured on real pixels: the same strip of text before and after selecting it must differ.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

const THEMES = ['paper', 'ink', 'sepia', 'oasis'];
const DOC = 'Plain line of English text for selecting\n\nسطر عربي طويل نسبيا لاختبار التحديد في المحرر\n';

// Mean RGB of a PNG screenshot, decoded in a blank page (no image library in the stack, and
// the app's CSP blocks data: fetches).
async function meanRgb(decoder, png) {
  return decoder.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return [r / n, g / n, b / n];
  }, png.toString('base64'));
}

for (const theme of THEMES) {
  for (const lineIndex of [0, 2]) {
    test(`selection is visible in Edit mode — ${theme}, ${lineIndex === 0 ? 'LTR' : 'RTL'} line`, async ({ page }) => {
      await page.goto(INDEX_URL);
      await page.waitForSelector('#app');
      await page.evaluate(({ t, doc }) => {
        if (t === 'paper') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', t);
        window._appState.files = [{ name: 'sel.md', path: 'sel.md', content: doc, dirty: false }];
        window.renderFile(0);
        window.setViewMode('edit');
      }, { t: theme, doc: DOC });
      const line = page.locator('.cm-mount .cm-line').nth(lineIndex);
      await expect(line).toBeVisible({ timeout: 8000 });

      // Caret on the line, nothing selected: the active-line tint is the same in both shots.
      await line.click();
      await page.keyboard.press('End');
      const box = await line.boundingBox();
      if (!box) throw new Error('line has no box');
      // The middle third of the line: away from the caret at either end.
      const clip = { x: box.x + box.width / 3, y: box.y + 4, width: box.width / 3, height: Math.max(4, box.height - 8) };
      const shotBefore = await page.screenshot({ clip });

      await page.keyboard.press('Shift+Home');
      await expect(page.locator('.cm-mount .cm-selectionBackground')).not.toHaveCount(0);
      const shotAfter = await page.screenshot({ clip });

      const decoder = await page.context().newPage();
      const before = await meanRgb(decoder, shotBefore);
      const after = await meanRgb(decoder, shotAfter);
      await decoder.close();

      const diff = Math.max(...before.map((v, i) => Math.abs(v - after[i])));
      expect(diff, `mean colour change in ${theme}`).toBeGreaterThan(6);
    });
  }
}

// QA H6: CodeMirror's own caret was black and a find match had light text on yellow in the
// dark themes — both invisible. Contrast measured on the computed colours.
const contrast = (a, b) => {
  const lum = (rgb) => {
    const [r, g, b2] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const rgbOf = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

for (const theme of THEMES) {
  test(`caret and find matches are readable in Edit mode — ${theme}`, async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(({ t, doc }) => {
      if (t === 'paper') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', t);
      window._appState.files = [{ name: 'sel.md', path: 'sel.md', content: doc, dirty: false }];
      window.renderFile(0);
      window.setViewMode('edit');
    }, { t: theme, doc: DOC });
    const line = page.locator('.cm-mount .cm-line').first();
    await expect(line).toBeVisible({ timeout: 8000 });
    await line.click();
    await expect(page.locator('.cm-mount .cm-cursor').first()).toBeAttached();
    await page.keyboard.press('Control+f');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'findInput');
    await page.keyboard.type('text');
    await expect(page.locator('.cm-mount .cm-searchMatch').first()).toBeVisible();
    const c = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const probe = document.createElement('div');
      probe.style.color = css.getPropertyValue('--paper');
      document.body.appendChild(probe);
      const paper = getComputedStyle(probe).color;
      probe.remove();
      const m = getComputedStyle(document.querySelector('.cm-mount .cm-searchMatch'));
      return { paper, caret: getComputedStyle(document.querySelector('.cm-mount .cm-cursor')).borderLeftColor, fg: m.color, bg: m.backgroundColor };
    });
    expect(contrast(rgbOf(c.caret), rgbOf(c.paper)), `caret on paper in ${theme}`).toBeGreaterThan(3);
    expect(contrast(rgbOf(c.fg), rgbOf(c.bg)), `find match text in ${theme}`).toBeGreaterThan(4.5);
  });
}
