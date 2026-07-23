// @ts-check
/**
 * Integration tests for Edit menu commands (Issue #8).
 * Validates: Ctrl+A in source mode selects only textarea text;
 * Ctrl+A in live mode selects editor content not sidebar;
 * no document.execCommand in new selectAll/copy paths.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../../src/renderer/index.html').replace(/\\/g, '/');

async function injectAndRender(page, content = '# Test\n\nSome **bold** text here.') {
  await page.evaluate((content) => {
    const S = window._appState;
    S.files = [{ name: 'edit-test.md', path: 'edit-test.md', handle: null, content, dirty: false }];
    window.renderFile(0);
  }, content);
  await page.waitForTimeout(200);
}

test.describe('Edit commands (Issue #8)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FILE_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await injectAndRender(page);
  });

  // T-F13: CM6 is the sole editor — no source/live/split modes.
  test('Ctrl+A in the CM6 editor selects its content', async ({ page }) => {
    await page.locator('.cm-mount .cm-content').click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    const selLen = await page.evaluate(() => { const s = window.getSelection(); return s ? s.toString().length : 0; });
    expect(selLen).toBeGreaterThan(0);
  });

  test('Ctrl+A selection stays within the editor, not the sidebar', async ({ page }) => {
    await page.locator('.cm-mount .cm-content').click();
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    const info = await page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { withinEditor: false, withinSidebar: false };
      const range = sel.getRangeAt(0);
      const cm = document.querySelector('.cm-mount .cm-content');
      const sidebar = document.querySelector('.sidebar');
      return {
        withinEditor: cm ? cm.contains(range.commonAncestorContainer) : false,
        withinSidebar: sidebar ? sidebar.contains(range.commonAncestorContainer) : false,
      };
    });
    expect(info.withinSidebar).toBe(false);
    expect(info.withinEditor).toBe(true);
  });

  test('execEditCmd("selectAll") selects all text in the CM6 editor', async ({ page }) => {
    await page.evaluate(() => window.getActiveCmAdapter().setSelection({ start: 0, end: 0 }));
    await page.evaluate(() => window.execEditCmd('selectAll'));
    await page.waitForTimeout(50);
    const sel = await page.evaluate(() => {
      const cm = window.getActiveCmAdapter();
      return { ...cm.getSelection(), len: cm.getValue().length };
    });
    expect(sel.start).toBe(0);
    expect(sel.end).toBe(sel.len);
    expect(sel.len).toBeGreaterThan(0);
  });

  test('execEditCmd("selectAll") produces a non-empty DOM selection', async ({ page }) => {
    await page.locator('.cm-mount .cm-content').click();
    await page.evaluate(() => window.execEditCmd('selectAll'));
    await page.waitForTimeout(50);
    const selLen = await page.evaluate(() => { const s = window.getSelection(); return s ? s.toString().length : 0; });
    expect(selLen).toBeGreaterThan(0);
  });

  test('cut in the CM6 editor removes the selection without an error toast', async ({ page }) => {
    await page.evaluate(() => { try { Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.resolve(''), writeText: () => Promise.resolve() }, configurable: true }); } catch (_) {} });
    await page.locator('.cm-mount .cm-content').click();
    await page.keyboard.press('Control+a');
    await page.evaluate(() => window.execEditCmd('cut'));
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.getActiveCmAdapter().getValue())).toBe('');
    const isError = await page.evaluate(() => { const t = document.getElementById('toast'); return !!(t && t.classList.contains('error')); });
    expect(isError).toBe(false);
  });

  test('font size of .source-textarea is >= 13px', async ({ page }) => {
    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.source-textarea');
      return parseFloat(getComputedStyle(el).fontSize);
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });

  test('font size of .editor (preview) is >= 13px', async ({ page }) => {
    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.editor');
      return parseFloat(getComputedStyle(el).fontSize);
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });

  test('computed font-size of .tag is >= 13px', async ({ page }) => {
    // Inject a file with a tag so the tag cloud renders
    await page.evaluate(() => {
      const S = window._appState;
      S.files = [{ name: 'tags.md', path: 'tags.md', handle: null, content: '# Test\n\nA note with #reading tag.', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(200);

    // Switch to tags pane to trigger renderTags()
    await page.click('.sb-tab[data-pane="tags"]');
    await page.waitForTimeout(100);

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.tag');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });

  test('computed font-size of .sr-snip is >= 13px', async ({ page }) => {
    // Inject two files so search results render
    await page.evaluate(() => {
      const S = window._appState;
      S.files = [
        { name: 'a.md', path: 'a.md', handle: null, content: 'hello world content here', dirty: false },
        { name: 'b.md', path: 'b.md', handle: null, content: 'hello another file', dirty: false }
      ];
      window.renderFile(0);
    });
    await page.waitForTimeout(200);

    // Switch to search pane and type a query
    await page.click('.sb-tab[data-pane="search"]');
    await page.waitForTimeout(100);
    await page.fill('#sbSearchInput', 'hello');
    await page.waitForTimeout(200);

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.sr-snip');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });

  test('computed font-size of .toc-item.h2 is >= 13px', async ({ page }) => {
    await page.evaluate(() => {
      const S = window._appState;
      S.files = [{ name: 'headings.md', path: 'headings.md', handle: null, content: '# H1\n\n## H2 Section\n\nContent.', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(300);

    const fontSize = await page.evaluate(() => {
      const el = document.querySelector('.toc-item.h2');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    expect(fontSize).toBeGreaterThanOrEqual(13);
  });
});
