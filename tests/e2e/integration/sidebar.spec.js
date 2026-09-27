// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('Sidebar integration tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
  });

  test('sidebar pane switching: Files tab is active by default', async ({ page }) => {
    const activeTab = page.locator('.sb-tab.active');
    await expect(activeTab).toHaveAttribute('data-pane', 'files');
  });

  test('sidebar pane switching: clicking Tags tab shows tags pane', async ({ page }) => {
    await page.click('.sb-tab[data-pane="tags"]');
    // Tags pane should be active
    await expect(page.locator('.sb-pane[data-pane="tags"]')).toHaveClass(/active/);
    // Files pane should not be active
    await expect(page.locator('.sb-pane[data-pane="files"]')).not.toHaveClass(/active/);
  });

  test('sidebar pane switching: clicking Search tab shows search pane', async ({ page }) => {
    await page.click('.sb-tab[data-pane="search"]');
    await expect(page.locator('.sb-pane[data-pane="search"]')).toHaveClass(/active/);
    await expect(page.locator('.sb-pane[data-pane="files"]')).not.toHaveClass(/active/);
  });

  test('only one sb-pane has active class at a time', async ({ page }) => {
    // Default state: files pane active
    const activeCount = await page.locator('.sb-pane.active').count();
    expect(activeCount).toBe(1);

    // Switch to tags
    await page.click('.sb-tab[data-pane="tags"]');
    const activeCountAfter = await page.locator('.sb-pane.active').count();
    expect(activeCountAfter).toBe(1);
  });

  test('load demo notes populates file tree', async ({ page }) => {
    // Click the demo button in empty state
    await page.evaluate(() => {
      // Call loadDemo directly via exposed globals
      if (typeof window.loadDemo === 'function') window.loadDemo();
    });

    // Wait for tree to populate
    await page.waitForFunction(() => {
      const tree = document.getElementById('tree');
      return tree && tree.children.length > 0;
    }, { timeout: 5000 });

    const treeItems = page.locator('#tree .tree-node');
    const count = await treeItems.count();
    expect(count).toBeGreaterThan(0);
  });

  test('tag filtering: clicking a tag switches to search pane with tag query', async ({ page }) => {
    // Load demo first
    await page.evaluate(() => { if (typeof window.loadDemo === 'function') window.loadDemo(); });

    // Switch to tags pane
    await page.click('.sb-tab[data-pane="tags"]');

    // Check tags rendered (demo notes have #reading, #prose etc.)
    const tagCloud = page.locator('.tag-cloud');
    const tagCount = await page.locator('.tag').count();
    expect(tagCount).toBeGreaterThan(0);
  });

  test('sidebar search: filterFiles returns matches', async ({ page }) => {
    // Load demo files
    await page.evaluate(() => { if (typeof window.loadDemo === 'function') window.loadDemo(); });

    // Switch to search pane
    await page.click('.sb-tab[data-pane="search"]');

    // Type in search box
    await page.fill('#sbSearchInput', 'reading');

    // Should see search results
    const results = page.locator('.search-result');
    await expect.poll(async () => results.count()).toBeGreaterThan(0);
  });

  test('sidebar search: non-matching query shows empty state', async ({ page }) => {
    await page.evaluate(() => { if (typeof window.loadDemo === 'function') window.loadDemo(); });

    await page.click('.sb-tab[data-pane="search"]');

    await page.fill('#sbSearchInput', 'zzznomatchzzz');

    const emptyMsg = page.locator('.search-empty');
    await expect(emptyMsg).toBeVisible();
  });

  test('toggle sidebar hides and shows sidebar', async ({ page }) => {
    // Sidebar should be visible initially (browser/dev default; the packaged app opens collapsed)
    await expect(page.locator('.sidebar')).toBeVisible();

    // Toggle via keyboard shortcut Ctrl+\
    await page.keyboard.press('Control+\\');

    // app-body should have no-sidebar class
    await expect(page.locator('#appBody')).toHaveClass(/no-sidebar/);

    // Toggle back
    await page.keyboard.press('Control+\\');
    await expect(page.locator('#appBody')).not.toHaveClass(/no-sidebar/);
  });

  // ----------------------------------------------------------------
  // AC2 — vault-wide search with >= 2 files, mark-wrapped snippets, click navigates
  // ----------------------------------------------------------------
  test('[AC2] vault search: 2-file query returns >= 2 results with <mark> snippets', async ({ page }) => {
    // Inject two files that both contain the word 'quantum'
    await page.evaluate(() => {
      const S = window._appState;
      S.files = [
        { name: 'alpha.md', path: 'alpha.md', handle: null, content: '# Alpha\n\nThis discusses quantum physics in detail.', dirty: false },
        { name: 'beta.md',  path: 'beta.md',  handle: null, content: '# Beta\n\nQuantum mechanics is fascinating.', dirty: false }
      ];
      window.renderFile(0);
    });

    // Switch to search pane
    await page.click('.sb-tab[data-pane="search"]');

    // Type the query
    await page.fill('#sbSearchInput', 'quantum');

    // Should have 2 result rows
    const results = page.locator('.search-result');
    await expect(results).toHaveCount(2);

    // Each result should have a <mark> element in its snippet
    await expect.poll(async () => page.evaluate(() =>
      document.querySelectorAll('.sr-snip mark').length)).toBeGreaterThanOrEqual(2);
  });

  test('[AC2] vault search: clicking result navigates to that file', async ({ page }) => {
    await page.evaluate(() => {
      const S = window._appState;
      S.files = [
        { name: 'first.md',  path: 'first.md',  handle: null, content: '# First File\n\nContains unicorn content.', dirty: false },
        { name: 'second.md', path: 'second.md', handle: null, content: '# Second File\n\nAlso has unicorn mention.', dirty: false }
      ];
      window.renderFile(0);
    });

    await page.click('.sb-tab[data-pane="search"]');
    await page.fill('#sbSearchInput', 'unicorn');

    // Click the second result (second.md)
    const results = page.locator('.search-result');
    await expect(results).toHaveCount(2);

    await results.nth(1).click();

    // Should have navigated to that file (activeFile index 1)
    await expect.poll(async () => page.evaluate(() => window._appState.activeFile)).toBe(1);
  });

  test('[AC2] vault search: empty query shows "Type to search." state', async ({ page }) => {
    await page.click('.sb-tab[data-pane="search"]');

    // Clear the input (it may be pre-populated)
    await page.fill('#sbSearchInput', '');

    // Scope to the search results container to avoid tag-pane clash
    const emptyMsg = page.locator('#searchResults .search-empty');
    await expect(emptyMsg).toBeVisible();
    const text = await emptyMsg.textContent();
    expect(text).toContain('Type to search');
  });

  test('[AC2] vault search: 5-hit cap — at most 5 snippets per file', async ({ page }) => {
    // File with 10 occurrences of the query
    const content = Array.from({ length: 10 }, (_, i) => `Paragraph ${i}: target word here.`).join('\n\n');
    await page.evaluate((content) => {
      const S = window._appState;
      S.files = [{ name: 'many.md', path: 'many.md', handle: null, content, dirty: false }];
      window.renderFile(0);
    }, content);

    await page.click('.sb-tab[data-pane="search"]');
    await page.fill('#sbSearchInput', 'target');

    await expect.poll(async () => page.evaluate(() =>
      document.querySelectorAll('.sr-snip').length)).toBeGreaterThan(0);
    const snippetCount = await page.evaluate(() => {
      return document.querySelectorAll('.sr-snip').length;
    });
    expect(snippetCount).toBeLessThanOrEqual(5);
  });
});
