// @ts-check
/**
 * robustness-high.spec.js — audit H9 (heading regex freeze) and H10 (Ctrl+N reuses a name).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function boot(page) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.renderFile && !!window.newNote, null, { timeout: 8000 });
}

test.describe('[H9] a heading with trailing whitespace does not freeze the app', () => {
  test('`# Title` + 2500 spaces opens, shows its outline entry and the inspector title at once', async ({ page }) => {
    await boot(page);
    const ms = await page.evaluate(() => {
      const t0 = performance.now();
      window._appState.files = [{ name: 'slow.md', path: 'slow.md', handle: null, content: '# Title' + ' '.repeat(2500) + '\n\nBody text\n', dirty: false }];
      window.renderFile(0);
      document.getElementById('editorArea').classList.remove('cm-single', 'welcome');
      return performance.now() - t0;
    });
    // the old regex needed 13.6 s for this input
    expect(ms).toBeLessThan(3000);
    await expect(page.locator('#tocList .toc-item')).toHaveCount(1);
    await expect(page.locator('#tocList .toc-item').first()).toHaveText('Title');
  });

  test('the same heading in the CodeMirror source (edit mode) maps to its outline entry', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window._appState.files = [{ name: 'slow.md', path: 'slow.md', handle: null, content: '# Title' + ' '.repeat(2500) + '\n\nBody\n\n## Next ##\n', dirty: false }];
      window.renderFile(0);
      window.setViewMode('edit');
    });
    await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
    await expect(page.locator('#tocList .toc-item')).toHaveCount(2);
    await expect(page.locator('#tocList .toc-item').nth(1)).toHaveText('Next');
  });
});

test.describe('[H10] Ctrl+N always picks a free name', () => {
  const names = (page) => page.evaluate(() => window._appState.files.map((f) => f.name));

  test('new, new, close the first, new: three distinct tabs and no conflict', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window._appState.files = []; window.newNote(); window.newNote(); });
    expect(await names(page)).toEqual(['Untitled.md', 'Untitled-1.md']);
    await page.evaluate(() => window.closeTab(0)); // close "Untitled.md"
    expect(await names(page)).toEqual(['Untitled-1.md']);
    await page.evaluate(() => window.newNote());
    const after = await names(page);
    expect(after).toEqual(['Untitled-1.md', 'Untitled.md']);
    expect(new Set(after).size).toBe(after.length);
    expect(await page.evaluate(() => window._appState.files.some((f) => f.conflict))).toBe(false);
    await expect(page.locator('.tab.conflict')).toHaveCount(0);
  });

  test('the keyboard shortcut does the same', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { window._appState.files = []; });
    await page.keyboard.press('Control+n');
    await page.keyboard.press('Control+n');
    expect(await names(page)).toEqual(['Untitled.md', 'Untitled-1.md']);
  });
});
