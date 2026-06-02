// @ts-check
/**
 * f13-single-mode.spec.js — T-F13: under ?cm=1 the editor collapses to the SINGLE CM6
 * live-preview surface (the source pane is shown, the redundant markdown preview pane and
 * the 3 mode buttons are hidden) and Find searches that surface. Default (no flag) keeps
 * the full 3-mode textarea UI — opt-in and reversible.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('[T-F13] single live-preview mode (behind ?cm=1)', () => {
  test('A — the single CM6 surface is VISIBLE in default live mode (no mode switching)', async ({ page }) => {
    await page.goto(INDEX_URL + '?cm=1');
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    expect(await page.evaluate(() => window._appState.editorMode)).toBe('live'); // still live — not switched to 'source'
    const size = await page.evaluate(() => {
      const r = document.querySelector('.cm-mount .cm-editor').getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    expect(size).toBe(true); // RED today: .source-pane is display:none in live mode → zero size
  });

  test('B — the 3 mode buttons are hidden under the flag', async ({ page }) => {
    await page.goto(INDEX_URL + '?cm=1');
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    for (const id of ['modeLive', 'modeSplit', 'modeSource']) {
      expect(await page.evaluate((i) => getComputedStyle(document.getElementById(i)).display, id)).toBe('none');
    }
  });

  test('C — Find searches the CM6 source surface, not the hidden preview', async ({ page }) => {
    await page.goto(INDEX_URL + '?cm=1');
    await page.waitForSelector('#app');
    // A markdown MARKER ('**') exists in the source but NOT in the rendered preview — so it
    // differentiates: the old preview-walker finds 0, the source/cmAdapter path finds 2.
    await page.evaluate(() => {
      window._appState.files = [{ name: 'x.md', path: 'x.md', content: '**needle** here', dirty: false }];
      window.renderFile(0);
    });
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    expect(await page.evaluate(() => window._appState.editorMode)).toBe('live');
    await page.evaluate(() => { window.openFind(); window.runFind('**'); });
    expect(await page.evaluate(() => document.getElementById('findInfo').textContent)).toBe('1/2'); // RED today: '0/0' (preview has no '**')
  });

  test('D — default (no flag) keeps the full 3-mode textarea UI intact (reversible)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('modeSplit')).display)).not.toBe('none');
    expect(await page.evaluate(() => document.querySelector('.editor-area.cm-single') === null)).toBe(true);
    await page.evaluate(() => window.setEditorMode('split'));
    expect(await page.evaluate(() => document.getElementById('editorArea').className)).toContain('split');
    expect(await page.evaluate(() => document.getElementById('srcTextarea').style.display)).not.toBe('none');
  });
});
