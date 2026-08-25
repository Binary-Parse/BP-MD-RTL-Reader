// @ts-check
/**
 * rtl-frontmatter-hijri.spec.js — T-R6 front-matter direction + T-R8 Hijri daily
 * notes, exercised through the real index.html pipeline.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

const editorDir = (page) =>
  page.evaluate(() => getComputedStyle(document.getElementById('editor')).direction);

async function inject(page, content) {
  return page.evaluate((md) => {
    window._appState.files = [{ name: 'doc.md', path: 'doc.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
  }, content);
}

test.describe('[T-R6] front-matter direction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
  });

  test('direction: rtl renders the document RTL even with English content', async ({ page }) => {
    await inject(page, '---\ndirection: rtl\n---\n# English Title\n\nAn English body paragraph.\n');
    await page.waitForTimeout(150);
    expect(await editorDir(page)).toBe('rtl');
  });

  test('the front-matter block is not rendered as body text', async ({ page }) => {
    await inject(page, '---\ndirection: rtl\ntitle: Secret\n---\n# Body Heading\n\nBody text.\n');
    await page.waitForTimeout(150);
    const text = await page.locator('#noteContent').textContent();
    expect(text).not.toContain('direction:');
    expect(text).not.toContain('title:');
    expect(text).not.toContain('Secret');
    expect(text).toContain('Body Heading');
    // the --- fence must not survive as an <hr> at the top of the body
    await expect(page.locator('#noteContent h1')).toHaveText('Body Heading');
  });

  test('direction: ltr overrides Arabic content (container LTR)', async ({ page }) => {
    await inject(page, '---\ndirection: ltr\n---\n# عنوان عربي\n\nنص عربي للقراءة.\n');
    await page.waitForTimeout(150);
    expect(await editorDir(page)).toBe('ltr');
  });

  test('the direction indicator + inspector reflect the front-matter direction', async ({ page }) => {
    await inject(page, '---\ndirection: rtl\n---\n# English Title\n\nbody\n');
    await page.waitForTimeout(150);
    expect(await page.locator('#dirIndicator').textContent()).toBe('RTL');
    expect(await page.locator('#propDir').textContent()).toBe('RTL');
    await expect(page.locator('#rtlBtn')).toHaveClass(/active/);
  });

  test('direction: auto falls through to content first-strong (per-block, no container flip)', async ({ page }) => {
    await inject(page, '---\ndirection: auto\n---\n# عنوان عربي\n\nنص عربي.\n');
    await page.waitForTimeout(150);
    expect(await editorDir(page)).toBe('ltr'); // container neutral
    await expect(page.locator('#noteContent h1')).toHaveAttribute('dir', 'rtl'); // block self-resolves
    const text = await page.locator('#noteContent').textContent();
    expect(text).not.toContain('direction:'); // front matter still stripped
  });

  test('manual ⇄ toggle still wins over front matter', async ({ page }) => {
    await inject(page, '---\ndirection: ltr\n---\n# Title\n\nbody\n');
    await page.waitForTimeout(150);
    expect(await editorDir(page)).toBe('ltr');
    await page.click('#rtlBtn'); // manual RTL override
    await page.waitForTimeout(150);
    expect(await editorDir(page)).toBe('rtl');
  });
});

test.describe('[T-R8] Hijri daily notes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
  });

  test('the calendar toggle is in the View menu', async ({ page }) => {
    await page.click('.tb-menu-item[data-menu="view"]');
    await page.waitForTimeout(150);
    const dd = await page.locator('#dropdown').textContent();
    expect(dd).toContain('Gregorian');
    expect(dd).toContain('Hijri');
  });

  test('Gregorian daily note uses the local Gregorian date filename + heading', async ({ page }) => {
    const last = await page.evaluate(() => {
      window.setCalendar('gregorian');
      window.newDailyNote();
      const fs = window._appState.files;
      return fs[fs.length - 1];
    });
    const d = new Date();
    const greg = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(last.name).toBe(`${greg}.md`);
    expect(last.content.startsWith(`# ${greg}\n`)).toBe(true);
  });

  test('Hijri daily note produces a Hijri-shaped filename distinct from Gregorian', async ({ page }) => {
    const last = await page.evaluate(() => {
      window.setCalendar('hijri');
      window.newDailyNote();
      const fs = window._appState.files;
      return fs[fs.length - 1];
    });
    expect(last.name).toMatch(/^\d{3,4}-\d{2}-\d{2}\.md$/);
    // heading mirrors the filename (minus .md)
    expect(last.content.startsWith(`# ${last.name.replace(/\.md$/, '')}\n`)).toBe(true);
    // Hijri year (~1447) differs from the Gregorian year, so names differ
    const d = new Date();
    const greg = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.md`;
    expect(last.name).not.toBe(greg);
  });
});
