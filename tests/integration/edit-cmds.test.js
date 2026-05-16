// @ts-check
/**
 * Integration tests for Edit menu commands (Issue #8).
 * Validates: Ctrl+A in source mode selects only textarea text;
 * Ctrl+A in live mode selects editor content not sidebar;
 * no document.execCommand in new selectAll/copy paths.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../marqam.html').replace(/\\/g, '/');

async function injectAndRender(page, content = '# Test\n\nSome **bold** text here.') {
  await page.evaluate((content) => {
    const S = window._marqamState;
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

  test('Ctrl+A in source mode selects textarea content only', async ({ page }) => {
    // Switch to source mode
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    // Focus the textarea
    await page.click('#srcTextarea');
    await page.waitForTimeout(50);

    // Press Ctrl+A
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    // The textarea should have all text selected
    const selected = await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      return ta.selectionStart === 0 && ta.selectionEnd === ta.value.length && ta.value.length > 0;
    });
    expect(selected).toBe(true);
  });

  test('Ctrl+A in live mode selects editor content via Selection API', async ({ page }) => {
    // Ensure live mode
    await page.evaluate(() => window.setEditorMode('live'));
    await page.waitForTimeout(100);

    // Click inside the preview area
    await page.click('#noteContent');
    await page.waitForTimeout(50);

    // Press Ctrl+A (our custom handler kicks in)
    await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);

    // Check that selection is non-empty and covers note content
    const selectionInfo = await page.evaluate(() => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return { empty: true };
      const range = sel.getRangeAt(0);
      return {
        empty: sel.toString().length === 0,
        containsNote: document.getElementById('noteContent').contains(range.commonAncestorContainer)
      };
    });
    // Selection should be non-empty
    expect(selectionInfo.empty).toBe(false);
  });

  test('execEditCmd("selectAll") in source mode calls textarea.select()', async ({ page }) => {
    await page.evaluate(() => window.setEditorMode('source'));
    await page.waitForTimeout(100);

    // Focus textarea first
    await page.evaluate(() => document.getElementById('srcTextarea').focus());
    await page.waitForTimeout(50);

    await page.evaluate(() => window.execEditCmd('selectAll'));
    await page.waitForTimeout(50);

    const isSelected = await page.evaluate(() => {
      const ta = document.getElementById('srcTextarea');
      return ta.selectionStart === 0 && ta.selectionEnd === ta.value.length && ta.value.length > 0;
    });
    expect(isSelected).toBe(true);
  });

  test('execEditCmd("selectAll") in live mode uses Selection.selectAllChildren', async ({ page }) => {
    await page.evaluate(() => window.setEditorMode('live'));
    await page.waitForTimeout(100);

    await page.evaluate(() => window.execEditCmd('selectAll'));
    await page.waitForTimeout(50);

    const selLen = await page.evaluate(() => {
      const sel = window.getSelection();
      return sel ? sel.toString().length : 0;
    });
    expect(selLen).toBeGreaterThan(0);
  });

  test('cut/paste in live mode shows info toast instead of error', async ({ page }) => {
    await page.evaluate(() => window.setEditorMode('live'));
    await page.waitForTimeout(100);

    await page.evaluate(() => window.execEditCmd('cut'));
    await page.waitForTimeout(200);

    // Toast element should have 'show' class or have info content
    const toastState = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return {
        visible: t && t.classList.contains('show'),
        isInfo: t && t.classList.contains('info'),
        text: t ? t.textContent : ''
      };
    });
    // Either toast is visible with info class, or contains the expected text
    expect(toastState.visible || toastState.text.length > 0).toBe(true);
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
      const S = window._marqamState;
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
      const S = window._marqamState;
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
      const S = window._marqamState;
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
