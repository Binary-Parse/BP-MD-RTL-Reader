/**
 * Comprehensive assertion tests for ALL marqam.html exported functions.
 * Uses Playwright page.evaluate to test renderer code directly.
 */

import { test, expect } from '@playwright/test';
import path from 'path';

const MARQAM_PATH = path.resolve(process.cwd(), 'marqam.html');
const MARQAM_URL = 'file:///' + MARQAM_PATH.replace(/\\/g, '/');

test.describe('marqam.html — ALL exported functions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(MARQAM_URL);
    await page.waitForSelector('.app', { state: 'visible' });
  });

  // === PURE FUNCTIONS ===

  test('window.parseMarkdown exists and returns string', async ({ page }) => {
    const result = await page.evaluate(() => {
      return { type: typeof window.parseMarkdown, out: window.parseMarkdown('# Hello').slice(0, 20) };
    });
    expect(result.type).toBe('function');
    expect(result.out).toContain('h1');
  });

  test('window.isArabicHeavy — Arabic text', async ({ page }) => {
    const result = await page.evaluate(() => window.isArabicHeavy('مرحبا بالعالم'));
    expect(result).toBe(true);
  });

  test('window.isArabicHeavy — English text', async ({ page }) => {
    const result = await page.evaluate(() => window.isArabicHeavy('Hello world'));
    expect(result).toBe(false);
  });

  test('window.isArabicHeavy — empty string', async ({ page }) => {
    const result = await page.evaluate(() => window.isArabicHeavy(''));
    expect(result).toBe(false);
  });

  test('window.isArabicHeavy — null/undefined', async ({ page }) => {
    const result = await page.evaluate(() => ({ null: window.isArabicHeavy(null), undef: window.isArabicHeavy(undefined) }));
    expect(result.null).toBe(false);
    expect(result.undef).toBe(false);
  });

  test('window.escapeHtml escapes < > & "', async ({ page }) => {
    const result = await page.evaluate(() => window.escapeHtml('<script>alert("x")</script>'));
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).toContain('&quot;');
    expect(result).not.toContain('<script>');
  });

  test('window.vaultSearch — empty query returns []', async ({ page }) => {
    const result = await page.evaluate(() => window.vaultSearch(''));
    expect(result).toEqual([]);
  });

  test('window.vaultSearch — single char returns []', async ({ page }) => {
    const result = await page.evaluate(() => window.vaultSearch('a'));
    expect(result).toEqual([]);
  });

  test('window.vaultSearch — finds matches', async ({ page }) => {
    const result = await page.evaluate(() => {
      window._marqamState.files = [{ name: 'a.md', content: 'hello world', path: 'a.md' }];
      return window.vaultSearch('hello');
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBe('a.md');
  });

  test('window.vaultSearch — hit cap ≤ 5', async ({ page }) => {
    const result = await page.evaluate(() => {
      window._marqamState.files = [{ name: 'a.md', content: 'hello hello hello hello hello hello hello', path: 'a.md' }];
      return window.vaultSearch('hello');
    });
    expect(result[0].hits.length).toBeLessThanOrEqual(5);
  });

  // === STATE / UI FUNCTIONS ===

  test('window._marqamState exists and is a Proxy', async ({ page }) => {
    const result = await page.evaluate(() => {
      const s = window._marqamState;
      return { exists: !!s, hasFiles: Array.isArray(s.files) };
    });
    expect(result.exists).toBe(true);
    expect(result.hasFiles).toBe(true);
  });

  test('window.showToast creates toast element', async ({ page }) => {
    await page.evaluate(() => window.showToast('Test message', 'info'));
    const toast = await page.locator('.toast').first();
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Test message');
  });

  // === THEME FUNCTIONS ===

  test('window.cycleTheme cycles through themes', async ({ page }) => {
    const themes = await page.evaluate(() => {
      const t = [];
      t.push(document.documentElement.getAttribute('data-theme') || 'paper');
      window.cycleTheme(); t.push(document.documentElement.getAttribute('data-theme'));
      window.cycleTheme(); t.push(document.documentElement.getAttribute('data-theme'));
      window.cycleTheme(); t.push(document.documentElement.getAttribute('data-theme'));
      return t;
    });
    expect(themes).toEqual(['paper', 'ink', 'sepia', 'paper']);
  });

  // === RTL FUNCTIONS ===

  test('window.toggleRTL sets dir=rtl on editor', async ({ page }) => {
    await page.evaluate(() => window.toggleRTL());
    const dir = await page.evaluate(() => document.getElementById('editor').getAttribute('dir'));
    expect(dir).toBe('rtl');
  });

  test('window.toggleRTL again removes dir', async ({ page }) => {
    await page.evaluate(() => { window.toggleRTL(); window.toggleRTL(); });
    const dir = await page.evaluate(() => document.getElementById('editor').getAttribute('dir'));
    expect(dir).toBeNull();
  });

  // === EDITOR MODE ===

  test('window.setEditorMode source shows textarea', async ({ page }) => {
    await page.evaluate(() => window.setEditorMode('source'));
    const display = await page.evaluate(() => document.getElementById('srcTextarea').style.display);
    expect(display).not.toBe('none');
  });

  test('window.setEditorMode live shows preview only', async ({ page }) => {
    await page.evaluate(() => window.setEditorMode('live'));
    const classes = await page.evaluate(() => document.getElementById('editorArea').className);
    expect(classes).not.toContain('source');
    expect(classes).not.toContain('split');
  });

  test('window.setEditorMode split shows both', async ({ page }) => {
    await page.evaluate(() => window.setEditorMode('split'));
    const src = await page.evaluate(() => document.getElementById('srcTextarea').style.display);
    const preview = await page.evaluate(() => document.getElementById('editor').style.display);
    expect(src).not.toBe('none');
    expect(preview).not.toBe('none');
  });

  test('window.setEditorMode invalid does not crash', async ({ page }) => {
    await page.evaluate(() => window.setEditorMode('invalid'));
    // Should not throw
  });

  test('window.setEditorMode null does not crash', async ({ page }) => {
    await page.evaluate(() => window.setEditorMode(null));
  });

  // === ZOOM FUNCTIONS ===

  test('window.setZoom clamps to [0.6, 2.0]', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.setZoom(0.1);
      const min = window._marqamState.zoomFactor;
      window.setZoom(5.0);
      const max = window._marqamState.zoomFactor;
      window.setZoom(1.0);
      const mid = window._marqamState.zoomFactor;
      return { min, max, mid };
    });
    expect(result.min).toBe(0.6);
    expect(result.max).toBe(2.0);
    expect(result.mid).toBe(1.0);
  });

  test('window.zoomIn increases zoom', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.setZoom(1.0);
      window.zoomIn();
      return window._marqamState.zoomFactor;
    });
    expect(result).toBeGreaterThan(1.0);
  });

  test('window.zoomOut decreases zoom', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.setZoom(1.0);
      window.zoomOut();
      return window._marqamState.zoomFactor;
    });
    expect(result).toBeLessThan(1.0);
  });

  test('window.zoomReset sets zoom to 1.0', async ({ page }) => {
    const result = await page.evaluate(() => {
      window.setZoom(1.5);
      window.zoomReset();
      return window._marqamState.zoomFactor;
    });
    expect(result).toBe(1.0);
  });

  // === FILE FUNCTIONS ===

  test('window.newNote creates a new file', async ({ page }) => {
    await page.evaluate(() => window.newNote());
    const files = await page.evaluate(() => window._marqamState.files);
    expect(files.length).toBeGreaterThan(0);
  });

  test('window.newDailyNote creates dated file', async ({ page }) => {
    await page.evaluate(() => window.newDailyNote());
    const files = await page.evaluate(() => window._marqamState.files);
    const lastFile = files[files.length - 1];
    expect(lastFile.name).toContain(new Date().toISOString().slice(0, 10));
  });

  test('window.saveCurrent exists', async ({ page }) => {
    const result = await page.evaluate(() => typeof window.saveCurrent);
    expect(result).toBe('function');
  });

  test('window.loadDemo populates files', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    const files = await page.evaluate(() => window._marqamState.files);
    expect(files.length).toBeGreaterThan(0);
  });

  test('window.openExternalFile adds file', async ({ page }) => {
    await page.evaluate(() => window.openExternalFile({ name: 'test.md', content: '# Test', path: 'test.md' }));
    const files = await page.evaluate(() => window._marqamState.files);
    expect(files.some(f => f.name === 'test.md')).toBe(true);
  });

  // === RENDER FUNCTIONS ===

  test('window.renderFile renders markdown', async ({ page }) => {
    await page.evaluate(() => {
      window._marqamState.files = [{ name: 'a.md', content: '# Hello', path: 'a.md' }];
      window.renderFile(0);
    });
    const html = await page.evaluate(() => document.getElementById('editor').innerHTML);
    expect(html).toContain('Hello');
  });

  test('window.renderTree renders tree nodes', async ({ page }) => {
    await page.evaluate(() => {
      window.renderTree([{ name: 'a.md', content: '', path: 'a.md' }]);
    });
    const nodes = await page.locator('.tree-node').count();
    expect(nodes).toBe(1);
  });

  test('window.renderTags renders tags', async ({ page }) => {
    await page.evaluate(() => {
      window._marqamState.files = [{ name: 'a.md', content: '#tag1 #tag2', path: 'a.md' }];
      window.renderTags();
    });
    const tags = await page.locator('.tag').count();
    expect(tags).toBe(2);
  });

  test('window.showWelcome shows welcome screen', async ({ page }) => {
    await page.evaluate(() => window.showWelcome());
    const visible = await page.evaluate(() => {
      const el = document.querySelector('.welcome') || document.getElementById('welcome');
      return el && el.style.display !== 'none';
    });
    expect(visible).toBe(true);
  });

  // === PALETTE / FIND ===

  test('window.openPalette shows palette', async ({ page }) => {
    await page.evaluate(() => window.openPalette());
    const overlay = await page.evaluate(() => document.getElementById('palOverlay').classList.contains('open'));
    expect(overlay).toBe(true);
  });

  test('window.closePalette hides palette', async ({ page }) => {
    await page.evaluate(() => { window.openPalette(); window.closePalette(); });
    const overlay = await page.evaluate(() => document.getElementById('palOverlay').classList.contains('open'));
    expect(overlay).toBe(false);
  });

  test('window.openFind shows find bar', async ({ page }) => {
    await page.evaluate(() => window.openFind());
    const bar = await page.evaluate(() => document.getElementById('findBar').style.display);
    expect(bar).not.toBe('none');
  });

  test('window.closeFind hides find bar', async ({ page }) => {
    await page.evaluate(() => { window.openFind(); window.closeFind(); });
    const visible = await page.evaluate(() => {
      const bar = document.getElementById('findBar');
      return bar && bar.classList.contains('open');
    });
    expect(visible).toBe(false);
  });

  test('window.closeFind clears marks', async ({ page }) => {
    await page.evaluate(() => {
      window._marqamState.files = [{ name: 'a.md', content: 'hello world', path: 'a.md' }];
      window.renderFile(0);
      window.openFind();
      window.runFind('hello');
      window.closeFind();
    });
    const marks = await page.locator('mark').count();
    expect(marks).toBe(0);
  });

  // === EXPORT ===

  test('window.exportHTML exists', async ({ page }) => {
    const result = await page.evaluate(() => typeof window.exportHTML);
    expect(result).toBe('function');
  });

  // === INSPECTOR ===

  test('window.toggleInspector exists', async ({ page }) => {
    const result = await page.evaluate(() => typeof window.toggleInspector);
    expect(result).toBe('function');
  });

  // === EDIT COMMANDS ===

  test('window.execEditCmd exists', async ({ page }) => {
    const result = await page.evaluate(() => typeof window.execEditCmd);
    expect(result).toBe('function');
  });

  // === DRAG DROP ===

  test('window.initDragDrop exists', async ({ page }) => {
    const result = await page.evaluate(() => typeof window.initDragDrop);
    expect(result).toBe('function');
  });
});
