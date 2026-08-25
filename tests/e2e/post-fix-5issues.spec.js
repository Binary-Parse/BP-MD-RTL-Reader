// @ts-check
/**
 * Tests for the 5 post-build issues fixed in this run.
 *
 *  1. Find in Source mode
 *  2. Keyboard shortcuts modal lists all current shortcuts
 *  3. White screen when both sidebar AND inspector hidden
 *  4. Layout when only sidebar hidden / only inspector hidden
 *  5. T-F18: both panel toggles now live in the titlebar (Cursor-style), so they stay
 *     visible while their panel is collapsed. This replaced the floating reveal strips,
 *     whose [F4] block was removed with them.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const FILE_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function goto(page) {
  await page.goto(FILE_URL);
  await page.waitForSelector('.app', { state: 'visible' });
}

async function injectFile(page, content) {
  await page.evaluate((c) => {
    window._appState.files = [{ name: 'a.md', path: 'a.md', handle: null, content: c, dirty: false }];
    window.renderFile(0);
  }, content);
  await page.waitForTimeout(150);
}

// ===========================================================================
// 1 — Find in the CM6 editor (T-F13: the sole editor surface)
// ===========================================================================
test.describe('[F1] Find works in the CM6 editor', () => {
  test('runFind matches the CM6 source surface', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'hello world\nhello again\nhello once more');
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    await page.evaluate(() => window.openFind());
    await page.fill('#findInput', 'hello');
    await page.waitForTimeout(200);
    const count = await page.$eval('#findInfo', el => el.textContent);
    // Expect "1/3"
    expect(count).toMatch(/1\s*\/\s*3/);
  });

  test('findNext cycles through matches in the CM6 editor', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'foo one\nfoo two\nfoo three');
    await expect(page.locator('.cm-mount .cm-editor')).toHaveCount(1, { timeout: 8000 });
    await page.evaluate(() => window.openFind());
    await page.fill('#findInput', 'foo');
    await page.waitForTimeout(200);
    const first = await page.$eval('#findInfo', el => el.textContent);
    await page.click('#findNextBtn');
    await page.waitForTimeout(150);
    const second = await page.$eval('#findInfo', el => el.textContent);
    expect(first).toMatch(/1\s*\/\s*3/);
    expect(second).toMatch(/2\s*\/\s*3/);
  });
});

// ===========================================================================
// 2 — Keyboard shortcuts modal includes new entries
// ===========================================================================
test.describe('[F2] Keyboard shortcuts modal is current', () => {
  async function openShortcutsModal(page) {
    await goto(page);
    // Trigger via keyboard shortcut Ctrl+/ which is the documented path
    await page.keyboard.press('Control+/');
    await page.waitForTimeout(200);
  }

  test('Zoom In/Out/Reset listed', async ({ page }) => {
    await openShortcutsModal(page);
    const html = await page.$eval('#modalBody', el => el.innerHTML);
    expect(html).toMatch(/Zoom In/);
    expect(html).toMatch(/Zoom Out/);
    expect(html).toMatch(/Reset Zoom/);
  });

  test('Undo/Redo/Cut/Copy/Paste/Select All listed', async ({ page }) => {
    await openShortcutsModal(page);
    const html = await page.$eval('#modalBody', el => el.innerHTML);
    for (const name of ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select All']) {
      expect(html.includes(name), `Shortcuts missing "${name}"`).toBe(true);
    }
  });

  test('Save As + New Daily Note listed', async ({ page }) => {
    await openShortcutsModal(page);
    const html = await page.$eval('#modalBody', el => el.innerHTML);
    expect(html).toMatch(/Save As/);
    expect(html).toMatch(/New Daily Note/);
  });
});

// ===========================================================================
// 3 — Layout when both panels hidden (no white screen)
// ===========================================================================
test.describe('[F3] Layout — both panels hidden does not blank the editor', () => {
  test('editor takes full width when both sidebar and inspector hidden', async ({ page }) => {
    await goto(page);
    await injectFile(page, '# heading\n\nbody');
    // Hide both
    await page.evaluate(() => {
      if (window._appState.sidebarVisible)   window.toggleSidebar = window.toggleSidebar || (()=>{});
      // Use button clicks for reliability
    });
    await page.click('#sidebarToggleBtn');
    await page.waitForTimeout(100);
    // Now click the inspector toggle
    await page.click('#inspectorToggleBtn');
    await page.waitForTimeout(100);
    const layout = await page.evaluate(() => {
      const body = document.getElementById('appBody');
      const editor = document.querySelector('.editor-wrap');
      return {
        bodyHasNoSidebar: body.classList.contains('no-sidebar'),
        bodyHasNoInspector: body.classList.contains('no-inspector'),
        editorWidth: editor.getBoundingClientRect().width,
        bodyWidth: body.getBoundingClientRect().width
      };
    });
    expect(layout.bodyHasNoSidebar).toBe(true);
    expect(layout.bodyHasNoInspector).toBe(true);
    // Editor should occupy the whole body width once both panel tracks collapse
    expect(layout.editorWidth / layout.bodyWidth).toBeGreaterThan(0.9);
  });

  test('editor visible when only sidebar hidden', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'content');
    await page.click('#sidebarToggleBtn');
    await page.waitForTimeout(100);
    const w = await page.evaluate(() => {
      return document.querySelector('.editor-wrap').getBoundingClientRect().width;
    });
    expect(w).toBeGreaterThan(200);
  });

  test('editor visible when only inspector hidden', async ({ page }) => {
    await goto(page);
    await injectFile(page, 'content');
    await page.click('#inspectorToggleBtn');
    await page.waitForTimeout(100);
    const w = await page.evaluate(() => {
      return document.querySelector('.editor-wrap').getBoundingClientRect().width;
    });
    expect(w).toBeGreaterThan(200);
  });
});

// ===========================================================================
// 4 — Panel toggles live in the titlebar (T-F18)
// ===========================================================================
// T-F18 deliberately reverses the earlier F5 decision ("toggle moved OUT of the
// titlebar"): a toggle parked inside the panel it collapses disappears with that
// panel, so the only way back was a floating reveal strip. Parking both toggles
// in the titlebar (Cursor/VS Code style) keeps them reachable in either state,
// which is why the strips — and their [F4] block — are gone.
test.describe('[F5/T-F18] Panel toggles live in the titlebar', () => {
  test('#menuBtn no longer exists', async ({ page }) => {
    await goto(page);
    const exists = await page.$('#menuBtn');
    expect(exists).toBeNull();
  });

  test('#sidebarToggleBtn lives inside the titlebar, not in the sidebar', async ({ page }) => {
    await goto(page);
    const parent = await page.$eval('#sidebarToggleBtn', el => {
      let p = el;
      while (p) {
        if (p.classList && p.classList.contains('sidebar')) return 'sidebar';
        if (p.classList && p.classList.contains('titlebar')) return 'titlebar';
        p = p.parentElement;
      }
      return 'other';
    });
    expect(parent).toBe('titlebar');
  });

  test('#inspectorToggleBtn lives inside the titlebar, not in the inspector', async ({ page }) => {
    await goto(page);
    const parent = await page.$eval('#inspectorToggleBtn', el => {
      let p = el;
      while (p) {
        if (p.classList && p.classList.contains('inspector')) return 'inspector';
        if (p.classList && p.classList.contains('titlebar')) return 'titlebar';
        p = p.parentElement;
      }
      return 'other';
    });
    expect(parent).toBe('titlebar');
  });

  test('both toggles stay visible while their panel is collapsed', async ({ page }) => {
    await goto(page);
    await page.click('#sidebarToggleBtn');
    await page.click('#inspectorToggleBtn');
    await expect(page.locator('#appBody')).toHaveClass(/no-sidebar/);
    await expect(page.locator('#appBody')).toHaveClass(/no-inspector/);
    await expect(page.locator('#sidebarToggleBtn')).toBeVisible();
    await expect(page.locator('#inspectorToggleBtn')).toBeVisible();
  });
});
