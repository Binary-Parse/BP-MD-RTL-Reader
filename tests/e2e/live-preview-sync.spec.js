// @ts-check
/**
 * live-preview-sync.spec.js — two CM6-sole-editor bugs:
 *   1. "Sometimes the content isn't transferred to display." The 150ms render debounce in
 *      applyEditorInput captured the edited file and rendered it into the SHARED #noteContent
 *      (which powers the outline + export). Switching files before it fired clobbered the new
 *      file's display/outline with the previous file's stale content. Fixed with an active-file
 *      guard in the debounce.
 *   2. "Outline is not working." In cm-single mode the rendered preview pane is display:none, so
 *      the outline's click-to-scroll + active-tracking (bound to .preview-pane) did nothing. The
 *      outline now drives the CM6 editor (scroll + caret + active highlight).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function boot(page) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.getActiveCmAdapter, null, { timeout: 8000 });
}
const setFiles = (page, files, active = 0) => page.evaluate(({ files, active }) => {
  window._appState.files = files.map(f => ({ name: f.name, path: f.name, content: f.content, dirty: false }));
  window.renderFile(active);
}, { files, active });
const outline = (page) => page.evaluate(() => [...document.querySelectorAll('.toc-item')].map(i => i.textContent));

test.describe('display/outline stay in sync with the active file (debounce race)', () => {
  test('editing file A then switching to B does NOT leak A into B\'s outline/#noteContent', async ({ page }) => {
    await boot(page);
    await setFiles(page, [
      { name: 'A.md', content: '# A1\n\naaa\n' },
      { name: 'B.md', content: '# B1\n\nbbb\n' },
    ]);
    await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
    // edit A (appends a heading) then immediately switch to B, before the 150ms debounce fires
    await page.evaluate(() => {
      const a = window.getActiveCmAdapter();
      a.setSelection({ start: a.getValue().length });
      a.replaceSelection('\n\n## A2 added');
      window.renderFile(1); // switch to B right away
    });
    await page.waitForTimeout(300); // let the stale debounce (would have) fired
    // B is active: outline + rendered headings must be B's, not A's
    expect(await page.evaluate(() => window._appState.activeFile)).toBe(1);
    expect(await outline(page)).toEqual(['B1']);
    const heads = await page.evaluate(() => [...document.querySelectorAll('#noteContent h1,#noteContent h2')].map(h => h.textContent));
    expect(heads).toEqual(['B1']);
    // and A kept its edit
    expect(await page.evaluate(() => window._appState.files[0].content)).toContain('## A2 added');
  });

  test('a normal edit still updates the outline (no regression)', async ({ page }) => {
    await boot(page);
    await setFiles(page, [{ name: 'k.md', content: '# One\n\nbody\n' }]);
    await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
    expect(await outline(page)).toEqual(['One']);
    await page.evaluate(() => {
      const a = window.getActiveCmAdapter();
      a.setSelection({ start: a.getValue().length });
      a.replaceSelection('\n\n## Two\n\nmore');
    });
    await page.waitForTimeout(300);
    expect(await outline(page)).toEqual(['One', 'Two']);
  });
});

test.describe('outline drives the CM6 editor', () => {
  async function openHeadingsDoc(page) {
    const pad = (n) => Array.from({ length: n }, (_, i) => `text ${i}`).join('\n');
    await setFiles(page, [{ name: 'h.md', content: `# One\n\n${pad(40)}\n\n## Two\n\n${pad(40)}\n\n### Three\n\n${pad(40)}\n` }]);
    await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
  }

  test('clicking an outline entry scrolls the editor + places the caret on that heading', async ({ page }) => {
    await boot(page);
    await openHeadingsDoc(page);
    expect(await outline(page)).toEqual(['One', 'Two', 'Three']);
    const before = await page.evaluate(() => window.getActiveCmAdapter()._view.scrollDOM.scrollTop);
    await page.locator('.toc-item', { hasText: 'Three' }).click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const a = window.getActiveCmAdapter();
      return { scroll: a._view.scrollDOM.scrollTop, caretLine: a._view.state.doc.lineAt(a.getSelection().start).text };
    });
    expect(after.scroll).toBeGreaterThan(before);
    expect(after.caretLine).toContain('Three');
  });

  test('the active outline entry tracks the editor scroll position', async ({ page }) => {
    await boot(page);
    await openHeadingsDoc(page);
    await page.locator('.toc-item', { hasText: 'Three' }).click();
    await page.waitForTimeout(300);
    const activeIdx = await page.evaluate(() => [...document.querySelectorAll('.toc-item')].findIndex(i => i.classList.contains('active')));
    expect(activeIdx).toBe(2);
  });
});

test.describe('outline drives the visible reading surface', () => {
  async function openLongHeadingsDoc(page) {
    const pad = (n) => Array.from({ length: n }, (_, i) => `reading text ${i}`).join('\n');
    await setFiles(page, [{ name: 'reading.md', content: `# One\n\n${pad(70)}\n\n## Two\n\n${pad(70)}\n\n### Three\n\n${pad(70)}\n` }]);
    await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
  }

  test('clicking an outline entry in Reading mode scrolls the visible preview pane', async ({ page }) => {
    await boot(page);
    await openLongHeadingsDoc(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => window.setViewMode('reading'));
    await expect(page.locator('#editorArea')).toHaveClass(/reading/);

    const before = await page.evaluate(() => document.querySelector('.preview-pane').scrollTop);
    await page.locator('.toc-item', { hasText: 'Three' }).click();
    const after = await page.evaluate(() => ({
      previewScrollTop: document.querySelector('.preview-pane').scrollTop,
      previewVisible: getComputedStyle(document.querySelector('.preview-pane')).display !== 'none',
      sourceVisible: getComputedStyle(document.querySelector('.source-pane')).display !== 'none',
    }));

    expect(after.previewVisible).toBe(true);
    expect(after.sourceVisible).toBe(false);
    expect(after.previewScrollTop).toBeGreaterThan(before);
  });

  test('Reading mode tracks the active outline entry from preview scrolling even with CM6 initialized', async ({ page }) => {
    await boot(page);
    await openLongHeadingsDoc(page);
    await page.evaluate(() => window.setViewMode('reading'));

    await page.evaluate(() => {
      const wrap = document.querySelector('.preview-pane');
      const heading = [...document.querySelectorAll('#noteContent h1, #noteContent h2, #noteContent h3')]
        .find(el => el.textContent === 'Three');
      wrap.scrollTop = heading.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop + 1;
      wrap.dispatchEvent(new Event('scroll'));
    });

    await expect.poll(() => page.evaluate(() => document.querySelector('.toc-item.active')?.textContent)).toBe('Three');
  });
});

test.describe('adaptive reading tables', () => {
  test('a wide table remains in a local scroll frame without widening the preview pane', async ({ page }) => {
    await boot(page);
    await setFiles(page, [{
      name: 'wide-table.md',
      content: '# Wide table\n\n| One | Two | Three |\n| --- | --- | --- |\n| A | B | C |',
    }]);
    await page.evaluate(() => window.setViewMode('reading'));

    const frame = page.locator('#noteContent .table-frame');
    await expect(frame).toHaveCount(1);
    await page.evaluate(() => {
      document.querySelector('#noteContent table').style.minWidth = '1800px';
    });
    await expect.poll(() => frame.evaluate(el => el.getAttribute('tabindex'))).toBe('0');

    const geometry = await page.evaluate(() => {
      const pane = document.querySelector('.preview-pane');
      const frame = document.querySelector('#noteContent .table-frame');
      const table = frame.querySelector('table');
      const paneRect = pane.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      return {
        paneClientWidth: pane.clientWidth,
        paneScrollWidth: pane.scrollWidth,
        frameClientWidth: frame.clientWidth,
        frameScrollWidth: frame.scrollWidth,
        tableWidth: table.getBoundingClientRect().width,
        paneLeft: paneRect.left,
        paneRight: paneRect.right,
        frameLeft: frameRect.left,
        frameRight: frameRect.right,
      };
    });

    expect(geometry.frameScrollWidth).toBeGreaterThan(geometry.frameClientWidth);
    expect(geometry.tableWidth).toBeGreaterThan(geometry.frameClientWidth);
    expect(geometry.paneScrollWidth).toBeLessThanOrEqual(geometry.paneClientWidth + 1);
    // The frame must stay within the pane on both edges — a breakout that overhangs would
    // be clipped by the pane's overflow-x:hidden, hiding part of the table.
    expect(geometry.frameLeft).toBeGreaterThanOrEqual(geometry.paneLeft - 1);
    expect(geometry.frameRight).toBeLessThanOrEqual(geometry.paneRight + 1);
  });
});

test.describe('inline code scales with its context', () => {
  test('inline code inside a heading is far larger than inline code in body text', async ({ page }) => {
    await boot(page);
    await setFiles(page, [{
      name: 'code.md',
      content: '# Title `H1CODE`\n\nBody with `BODYCODE` inline.',
    }]);
    await page.evaluate(() => window.setViewMode('reading'));

    const sizes = await page.evaluate(() => {
      const px = (el) => parseFloat(getComputedStyle(el).fontSize);
      return {
        heading: px(document.querySelector('#noteContent h1 code')),
        body: px(document.querySelector('#noteContent p code')),
      };
    });

    // 0.85em of the h1 (2.625rem) must dwarf 0.85em of body text (1.125rem) — a fixed
    // rem size (the previous bug) would make heading code the same tiny size as body code.
    expect(sizes.heading).toBeGreaterThan(sizes.body * 1.5);
  });
});
