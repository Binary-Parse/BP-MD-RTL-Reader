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

  // v10 redesign (2026-08-25): the professional-tree elbow connectors. A depth>0 row
  // carries .tree-indent and draws an elbow (::after) into its own row; a row followed
  // by another indented row also draws a trunk (::before) continuing the vertical line.
  test('[v10] indented rows carry elbow connectors, and the active row lights up', async ({ page }) => {
    // B4 (multi-folder workspaces): these fixture files carry no vaultId, so they land
    // under the synthetic @loose root -- the only depth-0, non-indented row now is that
    // root itself; every file inside it, including root.md, sits one level deeper.
    const looseRoot = page.locator('.tree-root').first();
    const rootFileRow = page.locator('.tree-node', { hasText: 'root.md' }).first();
    const fileRow = page.locator('.tree-file', { hasText: 'a.md' });
    await expect(looseRoot).not.toHaveClass(/tree-indent/);
    await expect(rootFileRow).toHaveClass(/tree-indent/);
    await expect(fileRow).toHaveClass(/tree-indent/);

    const elbowBorder = await fileRow.evaluate((el) => {
      const cs = getComputedStyle(el, '::after');
      return cs.borderInlineStartWidth;
    });
    expect(parseFloat(elbowBorder)).toBeGreaterThan(0);

    // docs/a.md is followed by docs/b.md (also indented) -> trunk continuation
    const trunkBorder = await fileRow.evaluate((el) => {
      const cs = getComputedStyle(el, '::before');
      return cs.borderInlineStartWidth;
    });
    expect(parseFloat(trunkBorder)).toBeGreaterThan(0);

    // open a nested file and check its elbow recolors to --accent
    await page.evaluate(() => window.renderFile(1)); // a.md is State.files[1]
    const activeElbowColor = await page.locator('.tree-file.active').evaluate((el) => {
      return getComputedStyle(el, '::after').borderInlineStartColor;
    });
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(activeElbowColor).toBe(await page.evaluate((hex) => {
      const probe = document.createElement('div');
      probe.style.color = hex;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    }, accent));
  });

  test('[v10] elbow connectors mirror under RTL (logical border swaps physical side)', async ({ page }) => {
    const fileRow = page.locator('.tree-file', { hasText: 'a.md' });
    const ltr = await fileRow.evaluate((el) => {
      const cs = getComputedStyle(el, '::after');
      return { left: parseFloat(cs.borderLeftWidth), right: parseFloat(cs.borderRightWidth) };
    });
    expect(ltr.left).toBeGreaterThan(0);
    expect(ltr.right).toBe(0);

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    const rtl = await fileRow.evaluate((el) => {
      const cs = getComputedStyle(el, '::after');
      return { left: parseFloat(cs.borderLeftWidth), right: parseFloat(cs.borderRightWidth) };
    });
    expect(rtl.right).toBeGreaterThan(0);
    expect(rtl.left).toBe(0);
  });

  test('[v10] twisty rotates -90deg when collapsed, back to 0 when expanded (no double-encoding)', async ({ page }) => {
    const docs = page.locator('.tree-dir', { hasText: 'docs' });
    const twisty = docs.locator('.tree-twisty');
    const glyphOpen = await twisty.textContent();
    const rotateOpen = await twisty.evaluate((el) => getComputedStyle(el).rotate);
    await docs.click();
    const glyphCollapsed = await twisty.textContent();
    const rotateCollapsed = await twisty.evaluate((el) => getComputedStyle(el).rotate);
    // the glyph itself never changes -- only rotation encodes the state
    expect(glyphCollapsed).toBe(glyphOpen);
    expect(rotateOpen === 'none' || rotateOpen === '0deg').toBe(true);
    expect(rotateCollapsed).toContain('-90deg');
  });

  test('clicking a folder collapses/expands it and persists the state', async ({ page }) => {
    await page.locator('.tree-dir', { hasText: 'docs' }).click();
    expect(await page.locator('.tree-file').count()).toBe(2);          // a.md + b.md hidden → c.md, root.md
    expect(await page.locator('.tree-dir', { hasText: 'docs' }).getAttribute('aria-expanded')).toBe('false');
    // B4: loose files live under the @loose pseudo-root, so their collapse-state paths
    // carry that prefix (docs is really @loose/docs) -- the same namespacing a named
    // vault root gives its own subfolders.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bpmd-tree-collapsed') || '[]'))).toContain('@loose/docs');
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
