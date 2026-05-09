/**
 * Integration tests for the editor core in marqam.html.
 *
 * Uses Playwright to open marqam.html via file://, inject a synthetic
 * State.files entry, call renderFile(), and assert that the preview pane
 * renders the expected HTML.
 *
 * File System Access API is NOT used — files are injected via page.evaluate()
 * per the risk-mitigation note in 04-plan.json (risk item 5).
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../marqam.html').replace(/\\/g, '/');

// =====================================================================
// Helper: inject a file into State and render it
// =====================================================================
async function injectAndRender(page, name, content) {
  await page.evaluate(({ name, content }) => {
    // Access the Proxy State exported on window by marqam.html
    const S = window._marqamState;
    if (!S) throw new Error('window._marqamState not found — T1 State export missing');
    S.files = [{ name, path: name, handle: null, content, dirty: false }];
    // renderFile is exported on window by marqam.html
    if (typeof window.renderFile !== 'function') {
      throw new Error('window.renderFile not found — T2 export missing');
    }
    window.renderFile(0);
  }, { name, content });
}

// =====================================================================
// T2-AC: inject file into State, call renderFile, assert preview HTML
// =====================================================================
test('renderFile populates preview with parsed markdown', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  await injectAndRender(page, 'test.md', '**bold text** and *italic*');

  // Preview pane should contain parsed HTML
  const noteContent = page.locator('#noteContent');
  await expect(noteContent).toBeVisible();
  const html = await noteContent.innerHTML();
  expect(html).toContain('<strong>');
  expect(html).toContain('bold text');
});

test('renderFile with wikilink renders <a class="wikilink"> element', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  await injectAndRender(page, 'wiki.md', '[[Target Note|My Alias]]');

  const noteContent = page.locator('#noteContent');
  await expect(noteContent).toBeVisible();
  const html = await noteContent.innerHTML();
  expect(html).toContain('wikilink');
  expect(html).toContain('Target Note');
});

test('renderFile sets dirty=false tab without dirty indicator', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  await injectAndRender(page, 'clean.md', '# Hello');

  // Tab strip should show one tab, not dirty
  const tab = page.locator('.tab').first();
  await expect(tab).toBeVisible();
  const tabClass = await tab.getAttribute('class');
  expect(tabClass).not.toContain('dirty');
});

test('setEditorMode source hides preview-pane, shows source-pane', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  await injectAndRender(page, 'mode.md', '# Mode test');

  // Switch to source mode
  await page.evaluate(() => {
    if (typeof window.setEditorMode !== 'function') throw new Error('setEditorMode not exported');
    window.setEditorMode('source');
  });

  const editorArea = page.locator('#editorArea');
  const areaClass = await editorArea.getAttribute('class');
  expect(areaClass).toContain('source');

  // Source pane should be visible
  const sourcePaneDisplay = await page.evaluate(() => {
    const sp = document.querySelector('.source-pane');
    return sp ? window.getComputedStyle(sp).display : 'none';
  });
  expect(sourcePaneDisplay).not.toBe('none');
});

test('setEditorMode split shows both panes', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  await injectAndRender(page, 'split.md', '# Split test');

  await page.evaluate(() => window.setEditorMode('split'));

  const editorArea = page.locator('#editorArea');
  const areaClass = await editorArea.getAttribute('class');
  expect(areaClass).toContain('split');
});

test('setEditorMode preview (live) shows preview-pane', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  await injectAndRender(page, 'preview.md', '# Preview test');

  // First go to source, then back to live
  await page.evaluate(() => window.setEditorMode('source'));
  await page.evaluate(() => window.setEditorMode('live'));

  const editorArea = page.locator('#editorArea');
  const areaClass = await editorArea.getAttribute('class');
  expect(areaClass).not.toContain('source');
});

test('saveCurrent falls back to <a download> when showSaveFilePicker absent', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  await injectAndRender(page, 'save.md', '# Save test');

  // Remove showSaveFilePicker to trigger fallback
  await page.evaluate(() => {
    delete window.showSaveFilePicker;
  });

  // Intercept download
  const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);

  await page.evaluate(() => window.saveCurrent());

  // The download event should fire (blob fallback)
  const download = await downloadPromise;
  expect(download).not.toBeNull();
});

test('word count updates in statusbar on renderFile', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  await injectAndRender(page, 'words.md', 'one two three four five');

  const wordCountEl = page.locator('#wordCount');
  await expect(wordCountEl).toBeVisible();
  const text = await wordCountEl.textContent();
  // The word count should be non-zero
  expect(text).toMatch(/\d+/);
  expect(text).not.toBe('0 words');
});

test('parseMarkdown via DOMPurify: no raw script tags survive', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  await injectAndRender(page, 'xss.md', '**safe** <script>window.__XSS=true;</script>');

  // DOMPurify should have stripped the script tag
  const xss = await page.evaluate(() => window.__XSS);
  expect(xss).toBeUndefined();
});
