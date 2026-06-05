// @ts-check
/**
 * callouts-outline.spec.js — T-F14 callouts + T-F7 document outline, rendered
 * through the real index.html pipeline (callout transform → bidi → outline).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;
const DOC = fs.readFileSync(path.resolve(__dirname, 'fixtures/callouts-outline.md'), 'utf8');

async function inject(page, content) {
  return page.evaluate((md) => {
    window._appState.files = [{ name: 'doc.md', path: 'doc.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
    // T-F13: reveal the rendered preview (export render path) hidden behind `cm-single`.
    document.getElementById('editorArea').classList.remove('cm-single', 'welcome');
  }, content);
}

test.describe('[T-F14] callouts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await inject(page, DOC);
    await page.waitForTimeout(200);
  });

  test('all five GFM callout types (+info) render as styled callouts; no raw blockquotes left', async ({ page }) => {
    for (const t of ['note', 'tip', 'important', 'warning', 'caution', 'info']) {
      const c = page.locator(`#noteContent .callout.callout-${t}`);
      await expect(c).toHaveCount(1);
      await expect(c.locator('.callout-title-text')).toHaveCount(1);
      await expect(c.locator('.callout-body')).toHaveCount(1);
      await expect(c).toHaveAttribute('data-callout', t);
    }
    // every callout blockquote was rewritten — none remain as <blockquote>
    await expect(page.locator('#noteContent blockquote')).toHaveCount(0);
  });

  test('callout titles: explicit title kept; missing title falls back to the type', async ({ page }) => {
    // Scope to #noteContent (the render pipeline): CM6 ALSO renders callouts inline, so an
    // unscoped selector would match both surfaces (T-F13).
    await expect(page.locator('#noteContent .callout-note .callout-title-text')).toHaveText('A useful note');
    await expect(page.locator('#noteContent .callout-important .callout-title-text')).toHaveText('Important');
  });

  test('callout marker line is stripped from the body', async ({ page }) => {
    const noteBody = await page.locator('#noteContent .callout-note .callout-body').textContent();
    expect(noteBody).toContain('number 42');
    expect(noteBody).not.toContain('[!NOTE]');
  });

  test('Arabic callout body composes with R1/R2 (RTL + isolated number)', async ({ page }) => {
    const info = page.locator('#noteContent .callout-info');
    // wrapper resolves RTL from its Arabic content
    const dir = await info.evaluate((el) => getComputedStyle(el).direction);
    expect(dir).toBe('rtl');
    // body paragraph carries per-block dir=rtl, and the number 7 is isolated
    await expect(info.locator('.callout-body p[dir="rtl"]')).toHaveCount(1);
    const bdis = await info.locator('.callout-body bdi').allTextContents();
    expect(bdis).toContain('7');
  });
});

test.describe('[T-F7] document outline', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await inject(page, DOC);
    await page.waitForTimeout(200);
  });

  test('outline lists all h1–h6 with depth classes', async ({ page }) => {
    await expect(page.locator('#tocList .toc-item')).toHaveCount(6);
    for (const lvl of [1, 2, 3, 4, 5, 6]) {
      await expect(page.locator(`#tocList .toc-item.h${lvl}`)).toHaveCount(1);
    }
  });

  test('rendered headings carry matching slug ids (Arabic-aware, EC-C5)', async ({ page }) => {
    await expect(page.locator('#noteContent h1')).toHaveAttribute('id', 'document-title');
    await expect(page.locator('#noteContent h3')).toHaveAttribute('id', 'subsection-2-1');
    await expect(page.locator('#noteContent h6')).toHaveAttribute('id', 'في-فعل-القراءة');
  });

  test('a heading nested in a blockquote does not desync outline ids (regression)', async ({ page }) => {
    // marked.lexer reports only top-level headings, but the DOM has all of them.
    // The outline is DOM-derived, so each heading keeps its own correct id.
    await inject(page, '# Alpha\n\n> ## Quoted Heading\n\n## Beta\n');
    await page.waitForTimeout(200);
    await expect(page.locator('#noteContent h1')).toHaveAttribute('id', 'alpha');
    await expect(page.locator('#noteContent #beta')).toHaveCount(1);          // top-level Beta keeps its id
    await expect(page.locator('#noteContent blockquote #quoted-heading')).toHaveCount(1);
    await expect(page.locator('#tocList .toc-item')).toHaveCount(3);
  });

  test('outline label uses clean rendered text (no raw markdown punctuation)', async ({ page }) => {
    await inject(page, '# Use `code` and **bold** here\n');
    await page.waitForTimeout(200);
    await expect(page.locator('#tocList .toc-item').first()).toHaveText('Use code and bold here');
  });

  test('clicking an outline item scrolls the editor to its heading', async ({ page }) => {
    // T-F13: CM6 is the sole surface, so the outline now scrolls the EDITOR (the preview pane is
    // hidden) and places the caret on the heading line. Restore cm-single (the beforeEach inject
    // strips it — a leftover workaround for the old preview-pane outline) and rebuild the outline.
    await page.evaluate(() => { document.getElementById('editorArea').classList.add('cm-single'); window.buildTOC && window.buildTOC(); });
    await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
    const before = await page.evaluate(() => window.getActiveCmAdapter()._view.scrollDOM.scrollTop);
    await page.locator('#tocList .toc-item.h5').click(); // "Deeper heading five" — Latin, far down
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const a = window.getActiveCmAdapter();
      return { scroll: a._view.scrollDOM.scrollTop, caretLine: a._view.state.doc.lineAt(a.getSelection().start).text };
    });
    expect(after.scroll).toBeGreaterThan(before);
    expect(after.caretLine).toContain('Deeper heading five');
  });

  test('scroll-sync highlights the active heading as the editor scrolls', async ({ page }) => {
    await page.evaluate(() => { document.getElementById('editorArea').classList.add('cm-single'); window.buildTOC && window.buildTOC(); });
    await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
    // at the top, the first heading is active
    const firstActive = await page.evaluate(() =>
      [...document.querySelectorAll('#tocList .toc-item')].findIndex((i) => i.classList.contains('active')));
    expect(firstActive).toBe(0);

    // Put the h3 heading ("### Subsection 2.1", a mid-doc heading that can reach the viewport
    // top) at the top of the CM6 scroller → it becomes the active outline item (index 2).
    await page.evaluate(() => {
      const v = window.getActiveCmAdapter()._view;
      const idx = v.state.doc.toString().search(/^### /m);
      v.scrollDOM.scrollTop = v.lineBlockAt(idx).top;
      v.scrollDOM.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(150);
    const active = await page.evaluate(() =>
      [...document.querySelectorAll('#tocList .toc-item')].findIndex((i) => i.classList.contains('active')));
    expect(active).toBe(2); // h3 is the third of the six headings
  });

  test('[Visual] callouts + outline render at 1440x900 @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('callouts-outline-1440x900.png', {
      maxDiffPixels: 5000,
      threshold: 0.2,
    });
  });
});
