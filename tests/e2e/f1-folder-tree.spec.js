// @ts-check
/**
 * f1-folder-tree.spec.js — T-F1 / M3: the sidebar renders a nested, COLLAPSIBLE folder
 * tree (not a flat list). Dirs toggle via click + keyboard, the collapse state persists
 * (localStorage), and files still open by their State.files index.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

const NESTED = [
  { name: 'root.md', path: 'root.md', content: '# root', dirty: false },
  { name: 'a.md', path: 'docs/a.md', content: '# a', dirty: false },
  { name: 'b.md', path: 'docs/b.md', content: '# b', dirty: false },
  { name: 'c.md', path: 'notes/c.md', content: '# c', dirty: false },
];

test.describe('[T-F1] collapsible folder tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate((files) => {
      localStorage.removeItem('bpmd-tree-collapsed');
      window._appState.files = files;
      window.renderTree(files);
    }, NESTED);
  });

  test('renders dir nodes + nested files (not a flat list)', async ({ page }) => {
    expect(await page.locator('.tree-dir').count()).toBe(2);           // docs, notes
    expect(await page.locator('.tree-file').count()).toBe(4);          // a, b, c, root
    // dirs sort first and carry an expanded twisty
    const dirNames = await page.locator('.tree-dir .tree-name').allTextContents();
    expect(dirNames).toEqual(['docs', 'notes']);
    expect(await page.locator('.tree-dir').first().getAttribute('aria-expanded')).toBe('true');
    // files are indented deeper than their parent dir
    const dirPad = await page.locator('.tree-dir').first().evaluate(e => parseFloat(getComputedStyle(e).paddingInlineStart));
    const filePad = await page.locator('.tree-file', { hasText: 'a.md' }).evaluate(e => parseFloat(getComputedStyle(e).paddingInlineStart));
    expect(filePad).toBeGreaterThan(dirPad);
  });

  test('clicking a folder collapses/expands it and persists the state', async ({ page }) => {
    await page.locator('.tree-dir', { hasText: 'docs' }).click();
    expect(await page.locator('.tree-file').count()).toBe(2);          // a.md + b.md hidden → c.md, root.md
    expect(await page.locator('.tree-dir', { hasText: 'docs' }).getAttribute('aria-expanded')).toBe('false');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bpmd-tree-collapsed') || '[]'))).toContain('docs');
    // expand again
    await page.locator('.tree-dir', { hasText: 'docs' }).click();
    expect(await page.locator('.tree-file').count()).toBe(4);
  });

  test('keyboard ArrowLeft collapses / ArrowRight expands a focused folder', async ({ page }) => {
    const docs = page.locator('.tree-dir', { hasText: 'docs' });
    await docs.focus();
    await docs.press('ArrowLeft');
    expect(await page.locator('.tree-file').count()).toBe(2);
    await page.locator('.tree-dir', { hasText: 'docs' }).press('ArrowRight');
    expect(await page.locator('.tree-file').count()).toBe(4);
  });

  test('clicking a nested file opens it by its State.files index', async ({ page }) => {
    await page.locator('.tree-file', { hasText: 'c.md' }).click();
    // c.md is index 3 in State.files
    expect(await page.evaluate(() => window._appState.activeFile)).toBe(3);
  });

  test('the active-file highlight survives collapsing/expanding another folder (regression)', async ({ page }) => {
    await page.evaluate(() => window.renderFile(0)); // open root.md (top-level, always visible)
    const activeNames = () => page.locator('.tree-file.active .tree-name').allTextContents();
    expect(await activeNames()).toEqual(['root.md']);
    // toggling a DIFFERENT folder re-renders the whole tree — the highlight must persist
    await page.locator('.tree-dir', { hasText: 'docs' }).click();      // collapse
    expect(await activeNames()).toEqual(['root.md']);
    await page.locator('.tree-dir', { hasText: 'docs' }).click();      // expand
    expect(await activeNames()).toEqual(['root.md']);
  });
});
