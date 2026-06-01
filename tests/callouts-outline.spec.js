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
    await expect(page.locator('.callout-note .callout-title-text')).toHaveText('A useful note');
    await expect(page.locator('.callout-important .callout-title-text')).toHaveText('Important');
  });

  test('callout marker line is stripped from the body', async ({ page }) => {
    const noteBody = await page.locator('.callout-note .callout-body').textContent();
    expect(noteBody).toContain('number 42');
    expect(noteBody).not.toContain('[!NOTE]');
  });

  test('Arabic callout body composes with R1/R2 (RTL + isolated number)', async ({ page }) => {
    const info = page.locator('.callout-info');
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

  test('clicking an outline item scrolls its heading into view', async ({ page }) => {
    const before = await page.evaluate(() => document.querySelector('.preview-pane').scrollTop);
    await page.locator('#tocList .toc-item.h6').click();
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.querySelector('.preview-pane').scrollTop);
    expect(after).toBeGreaterThan(before);
    // the h6 heading is now within the visible pane
    const visible = await page.evaluate(() => {
      const h6 = document.querySelector('#noteContent h6');
      const wrap = document.querySelector('.preview-pane');
      const hr = h6.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      return hr.top >= wr.top - 4 && hr.top <= wr.bottom;
    });
    expect(visible).toBe(true);
  });

  test('scroll-sync highlights the active heading as the pane scrolls', async ({ page }) => {
    // at the top, the first heading is active
    const firstActive = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#tocList .toc-item')];
      return items.findIndex((i) => i.classList.contains('active'));
    });
    expect(firstActive).toBe(0);

    // scroll to the last heading's position; it becomes the active outline item
    await page.evaluate(() => {
      const wrap = document.querySelector('.preview-pane');
      const h6 = document.querySelector('#noteContent h6');
      const top = h6.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
      wrap.scrollTop = top + 5;
      wrap.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(150);
    const active = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#tocList .toc-item')];
      return items.findIndex((i) => i.classList.contains('active'));
    });
    expect(active).toBe(5); // h6 is the last of the six headings
  });

  test('[Visual] callouts + outline render at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('callouts-outline-1440x900.png', {
      maxDiffPixels: 5000,
      threshold: 0.2,
    });
  });
});
