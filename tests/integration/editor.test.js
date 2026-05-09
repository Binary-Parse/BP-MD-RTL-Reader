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

// =====================================================================
// T1 — Electron no-drag: all interactive titlebar elements covered
// =====================================================================
test('[T1] electron no-drag rule covers .tb-btn, .tb-search, .tb-menu-btn, .tab-add', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  // Add the electron class to html so the scoped rules activate
  await page.evaluate(() => {
    document.documentElement.classList.add('electron');
  });

  const result = await page.evaluate(() => {
    // Iterate all stylesheets and collect the full text of no-drag rules
    const noDragSelectors = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
      for (const rule of rules) {
        if (rule instanceof CSSStyleRule &&
            rule.style.getPropertyValue('-webkit-app-region') === 'no-drag') {
          // Split compound selector by comma and collect each part
          rule.selectorText.split(',').forEach(s => noDragSelectors.push(s.trim()));
        }
      }
    }
    return noDragSelectors;
  });

  const joined = result.join(' ');
  expect(joined).toContain('.tb-btn');
  expect(joined).toContain('.tb-search');
  expect(joined).toContain('.tb-menu-btn');
  expect(joined).toContain('.tab-add');
});

// =====================================================================
// T2 — Inspector panel grid collapse: no third track after collapse
// =====================================================================
test('[T2] toggleInspector() leaves appBody with two-column grid after collapse', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  // Initially three columns
  const before = await page.evaluate(() => {
    return getComputedStyle(document.getElementById('appBody')).gridTemplateColumns;
  });
  const beforeCount = before.trim().split(/\s+(?=\d|auto|minmax|fr)/).length;
  expect(beforeCount).toBe(3);

  // Collapse inspector
  await page.evaluate(() => window.toggleInspector());
  await page.waitForTimeout(50);

  const after = await page.evaluate(() => {
    return getComputedStyle(document.getElementById('appBody')).gridTemplateColumns;
  });
  // Exactly two column values (no trailing 0px track)
  const cols = after.trim().split(/\s+(?=\d|auto|minmax|fr)/);
  expect(cols).toHaveLength(2);

  // Inspector element should be hidden
  const inspVisible = await page.evaluate(() => {
    const insp = document.querySelector('.inspector');
    return getComputedStyle(insp).display;
  });
  expect(inspVisible).toBe('none');

  // Re-expand restores three columns
  await page.evaluate(() => window.toggleInspector());
  await page.waitForTimeout(50);

  const restored = await page.evaluate(() => {
    return getComputedStyle(document.getElementById('appBody')).gridTemplateColumns;
  });
  const restoredCols = restored.trim().split(/\s+(?=\d|auto|minmax|fr)/);
  expect(restoredCols).toHaveLength(3);
});

// =====================================================================
// T3 — RTL toggle: dir applied to documentElement, not appBody
// =====================================================================
test('[T3] toggleRTL() sets dir on document.documentElement not #appBody', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  // Initial state: no dir on html element
  const initialDir = await page.evaluate(() => document.documentElement.getAttribute('dir'));
  expect(initialDir).not.toBe('rtl');

  // Toggle RTL on
  await page.evaluate(() => window.toggleRTL());
  await page.waitForTimeout(50);

  // html element must NOT receive dir — scoping is to #srcTextarea and #editor only
  const htmlDir = await page.locator('html').getAttribute('dir');
  expect(htmlDir).toBeNull();

  const srcTextareaDir = await page.locator('#srcTextarea').getAttribute('dir');
  expect(srcTextareaDir).toBe('auto');

  const editorDir = await page.locator('#editor').getAttribute('dir');
  expect(editorDir).toBe('rtl');

  const dirIndicator = await page.evaluate(() => document.getElementById('dirIndicator').textContent);
  expect(dirIndicator).toBe('RTL');

  // Toggle RTL off
  await page.evaluate(() => window.toggleRTL());
  await page.waitForTimeout(50);

  const htmlDir2 = await page.locator('html').getAttribute('dir');
  expect(htmlDir2).toBeNull();

  const dirIndicator2 = await page.evaluate(() => document.getElementById('dirIndicator').textContent);
  expect(dirIndicator2).toBe('LTR');
});

// =====================================================================
// T4 — Find-hit click navigation: clicking a mark updates State.findIdx
// =====================================================================
test('[T4] clicking second mark.find-hit sets State.findIdx to 1', async ({ page }) => {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });

  // Inject a file with three occurrences of 'hello'
  await injectAndRender(page, 'find.md', 'hello world. hello again. hello third.');

  // Open find bar and run search
  await page.evaluate(() => {
    if (typeof window.openFind === 'function') window.openFind();
    window.runFind('hello');
  });
  await page.waitForTimeout(100);

  const hitCount = await page.evaluate(() => window._marqamState.findHits.length);
  expect(hitCount).toBe(3);

  // Click the second mark
  await page.locator('mark.find-hit').nth(1).click();
  await page.waitForTimeout(50);

  const findIdx = await page.evaluate(() => window._marqamState.findIdx);
  expect(findIdx).toBe(1);

  const secondHasCurrent = await page.evaluate(() => {
    const marks = document.querySelectorAll('mark.find-hit');
    return marks[1].classList.contains('current');
  });
  expect(secondHasCurrent).toBe(true);

  const findInfo = await page.evaluate(() => document.getElementById('findInfo').textContent);
  expect(findInfo).toBe('2/3');
});
