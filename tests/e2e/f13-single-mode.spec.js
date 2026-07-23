// @ts-check
/**
 * f13-single-mode.spec.js — T-F13: CodeMirror 6 is now the ONE and ONLY editor. It mounts on
 * launch as a single live-preview surface (the redundant markdown preview pane and the 3 view-
 * mode buttons are gone), it renders like PROSE (serif headings, real bold/italic, mono only
 * for code) rather than monospace source, and Find searches that surface. No opt-in, no modes.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('[T-F13] CM6 as the single live-preview editor (default, no opt-in)', () => {
  test('A — the single CM6 surface mounts + is VISIBLE by default once a file is open', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    expect(await page.evaluate(() => window._appState.editorMode)).toBe('live');
    const size = await page.evaluate(() => {
      const r = document.querySelector('.cm-mount .cm-editor').getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    expect(size).toBe(true);
  });

  test('B — the 3 view-mode buttons no longer exist in the DOM', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    for (const id of ['modeLive', 'modeSplit', 'modeSource']) {
      expect(await page.evaluate((i) => document.getElementById(i), id)).toBeNull();
    }
  });

  test('C — Find searches the CM6 source surface (sees markdown markers the preview drops)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window._appState.files = [{ name: 'x.md', path: 'x.md', content: '**needle** here', dirty: false }];
      window.renderFile(0);
    });
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    await page.evaluate(() => { window.openFind(); window.runFind('**'); });
    expect(await page.evaluate(() => document.getElementById('findInfo').textContent)).toBe('1/2');
  });

  test('D — the welcome card shows at launch (not the empty CM6 surface); opening a file reveals CM6', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 }); // mounted…
    // …but with no file open the welcome (preview pane) is what's visible, not the CM6 surface
    expect(await page.evaluate(() => {
      const r = document.querySelector('.cm-mount .cm-editor').getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('welcome')).display)).not.toBe('none');
    // open a file → the welcome goes away and the CM6 live-preview surface takes the pane
    await page.evaluate(() => window.loadDemo());
    expect(await page.evaluate(() => {
      const r = document.querySelector('.cm-mount .cm-editor').getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    })).toBe(true);
  });

  test('E — CM6 mounts on launch even when the persisted settings carry no cm flag', async ({ page }) => {
    await page.addInitScript(() => {
      const noop = () => {};
      window.electronAPI = {
        closeWindow: noop, minimizeWindow: noop, maximizeWindow: noop,
        openFolder: async () => ({ canceled: true }), readVault: async () => [],
        writeFile: async () => ({ ok: true }),
        getSettings: async () => ({ theme: 'paper', zoomFactor: 1, editorMode: 'live', sidebarVisible: true, inspectorVisible: true, uiDirection: 'ltr', uiLocale: 'en', calendar: 'gregorian', arabicKashida: false, italicRecolor: true, recents: [], lastSession: null }),
        setSettings: async () => ({ ok: true }),
        exportPDF: async () => ({ ok: true }), editCommand: noop, onOpenFile: noop, onVaultChanged: noop,
        checkForUpdate: async () => ({}), logError: noop,
      };
    });
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
  });

  test('K — headings render as PROSE: serif face, larger than body (not monospace source)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window._appState.files = [{ name: 'h.md', path: 'h.md', content: '# Heading One\n\nbody text here\n', dirty: false }];
      window.renderFile(0);
    });
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    const r = await page.evaluate(() => {
      const content = document.querySelector('.cm-mount .cm-content');
      const base = parseFloat(getComputedStyle(content).fontSize);
      const spans = [...content.querySelectorAll('*')];
      const h = spans.find((s) => /Fraunces/i.test(getComputedStyle(s).fontFamily) && s.textContent.includes('Heading One'));
      return { base, hasSerif: !!h, hSize: h ? parseFloat(getComputedStyle(h).fontSize) : 0 };
    });
    expect(r.hasSerif).toBe(true);           // heading text takes the serif (Fraunces) face
    expect(r.hSize).toBeGreaterThan(r.base); // and is rendered larger than body prose
  });

  test('L — the editor BODY font is the prose sans face, not monospace', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => window.loadDemo());
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    const fam = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-mount .cm-content')).fontFamily);
    expect(/Inter|sans/i.test(fam)).toBe(true);   // prose sans
    expect(/mono/i.test(fam)).toBe(false);        // NOT the monospace source look
  });

  test('F — the CM6 editor renders Arabic tables inline with MIRRORED (RTL) columns — R9 in the editor', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      // heading first so the default cursor (pos 0) is OFF the table → the table renders
      window._appState.files = [{ name: 't.md', path: 't.md',
        content: '# عنوان عربي\n\n| المفتاح | Value |\n| --- | --- |\n| واحد | 1 |\n', dirty: false }];
      window.renderFile(0);
    });
    const table = page.locator('.cm-mount .cm-lp-block table');
    await expect(table).toHaveCount(1, { timeout: 8000 });        // rendered inline, not raw pipes
    expect(await table.first().getAttribute('dir')).toBe('rtl');   // Arabic-first → columns mirror (R9)
    expect(await page.evaluate(() => document.querySelector('.cm-mount .cm-content').textContent.includes('| المفتاح |'))).toBe(false);
  });

  test('G — the CM6 editor renders mermaid diagrams inline (async SVG) off the active line', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window._appState.files = [{ name: 'd.md', path: 'd.md',
        content: '# diagram\n\n```mermaid\ngraph TD; A-->B;\n```\n', dirty: false }];
      window.renderFile(0);
    });
    await expect(page.locator('.cm-mount .cm-lp-block svg')).toHaveCount(1, { timeout: 12000 });
  });

  test('H — the CM6 editor renders > [!NOTE] callouts inline off the active line', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window._appState.files = [{ name: 'c.md', path: 'c.md',
        content: '# notes\n\n> [!NOTE] Heads up\n> body line\n', dirty: false }];
      window.renderFile(0);
    });
    await expect(page.locator('.cm-mount .cm-lp-block .callout')).toHaveCount(1, { timeout: 8000 });
  });

  test('I — the CM6 editor renders inline $…$ math (KaTeX) off the active line', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window._appState.files = [{ name: 'm.md', path: 'm.md',
        content: '# math\n\nPythagoras: $x^2+y^2=z^2$ done\n', dirty: false }];
      window.renderFile(0);
    });
    await expect(page.locator('.cm-mount .math-inline .katex')).toHaveCount(1, { timeout: 8000 });
  });

  test('J — the CM6 editor renders a standalone image inline off the active line', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    await page.evaluate(() => {
      window._appState.files = [{ name: 'p.md', path: 'p.md',
        content: '# pics\n\n![a picture](https://example.com/x.png)\n', dirty: false }];
      window.renderFile(0);
    });
    const img = page.locator('.cm-mount .cm-lp-image img');
    await expect(img).toHaveCount(1, { timeout: 8000 });
    expect(await img.first().getAttribute('src')).toBe('https://example.com/x.png');
  });
});
