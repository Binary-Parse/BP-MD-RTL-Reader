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

  test('D — the cmEditor SETTING governs the mode: default off = 3-mode textarea; toggling switches live (reversible)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(120);

    // default: the setting is OFF → classic textarea + 3-mode UI, no cm-single, no CM6 mounted
    expect(await page.evaluate(() => window._appState.cmEditor)).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('modeSplit')).display)).not.toBe('none');
    expect(await page.evaluate(() => document.querySelector('.editor-area.cm-single') === null)).toBe(true);
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(0);
    // setEditorMode still works in the classic UI
    await page.evaluate(() => window.setEditorMode('split'));
    expect(await page.evaluate(() => document.getElementById('editorArea').className)).toContain('split');

    // turn the SETTING on → CM6 mounts as the single live-preview surface; the 3 mode buttons hide
    await page.evaluate(() => window.setCmEditor(true));
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    expect(await page.evaluate(() => window._appState.cmEditor)).toBe(true);
    expect(await page.evaluate(() => document.querySelector('.editor-area.cm-single') !== null)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('modeSplit')).display)).toBe('none');

    // turn it OFF again → live teardown back to the textarea, 3-mode UI restored (reversible)
    await page.evaluate(() => window.setCmEditor(false));
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(0, { timeout: 8000 });
    expect(await page.evaluate(() => window._appState.cmEditor)).toBe(false);
    expect(await page.evaluate(() => document.querySelector('.editor-area.cm-single') === null)).toBe(true);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('modeSplit')).display)).not.toBe('none');
    expect(await page.evaluate(() => document.getElementById('srcTextarea').style.display)).not.toBe('none');
  });

  test('E — the cmEditor setting persists + restores: a saved cmEditor=true mounts CM6 on launch', async ({ page }) => {
    // inject a bridge whose getSettings reports cmEditor:true BEFORE the app boots
    await page.addInitScript(() => {
      const noop = () => {};
      window.electronAPI = {
        closeWindow: noop, minimizeWindow: noop, maximizeWindow: noop,
        openFolder: async () => ({ canceled: true }), readVault: async () => [],
        writeFile: async () => ({ ok: true }),
        getSettings: async () => ({ theme: 'paper', zoomFactor: 1, editorMode: 'live', sidebarVisible: true, inspectorVisible: true, uiDirection: 'ltr', uiLocale: 'en', calendar: 'gregorian', arabicKashida: false, italicRecolor: true, cmEditor: true, recents: [], lastSession: null }),
        setSettings: async () => ({ ok: true }),
        exportPDF: async () => ({ ok: true }), editCommand: noop, onOpenFile: noop, onVaultChanged: noop,
        checkForUpdate: async () => ({}), logError: noop,
      };
    });
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    // restore set cmEditor=true → the startup initCM6Editor() mounts CM6 (no ?cm flag in the URL)
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    expect(await page.evaluate(() => window._appState.cmEditor)).toBe(true);
  });

  test('F — the CM6 editor renders Arabic tables inline with MIRRORED (RTL) columns — R9 in the editor', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window.setCmEditor(true);
      // heading first so the default cursor (pos 0) is OFF the table → the table renders
      window._appState.files = [{ name: 't.md', path: 't.md',
        content: '# عنوان عربي\n\n| المفتاح | Value |\n| --- | --- |\n| واحد | 1 |\n', dirty: false }];
      window.renderFile(0);
    });
    const table = page.locator('.cm-mount .cm-lp-block table');
    await expect(table).toHaveCount(1, { timeout: 8000 });        // rendered inline, not raw pipes
    expect(await table.first().getAttribute('dir')).toBe('rtl');   // Arabic-first → columns mirror (R9)
    // the raw pipe syntax is hidden while the table is rendered
    expect(await page.evaluate(() => document.querySelector('.cm-mount .cm-content').textContent.includes('| المفتاح |'))).toBe(false);
  });

  test('G — the CM6 editor renders mermaid diagrams inline (async SVG) off the active line', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window.setCmEditor(true);
      window._appState.files = [{ name: 'd.md', path: 'd.md',
        content: '# diagram\n\n```mermaid\ngraph TD; A-->B;\n```\n', dirty: false }];
      window.renderFile(0);
    });
    // the ```mermaid block renders to an <svg> inside the live-preview block widget (vs raw fences)
    await expect(page.locator('.cm-mount .cm-lp-block svg')).toHaveCount(1, { timeout: 12000 });
  });
});
