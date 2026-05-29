/**
 * Renderer coverage collector for index.html inline JS.
 * Uses Chromium DevTools Protocol to collect V8 coverage while exercising
 * renderer code paths via direct function calls + minimal UI interaction.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const INDEX_PATH = path.resolve(process.cwd(), 'index.html');
const INDEX_URL = 'file:///' + INDEX_PATH.replace(/\\/g, '/');
const COVERAGE_DIR = path.join(process.cwd(), 'coverage', 'renderer');

if (!fs.existsSync(COVERAGE_DIR)) {
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
}

test.describe('Renderer coverage collector', () => {
  test.beforeEach(async ({ page }) => {
    await page.coverage.startJSCoverage();
  });

  test.afterEach(async ({ page }, testInfo) => {
    const coverage = await page.coverage.stopJSCoverage();
    const fileName = `${testInfo.title.replace(/[^a-z0-9]/gi, '_')}.json`;
    fs.writeFileSync(
      path.join(COVERAGE_DIR, fileName),
      JSON.stringify(coverage, null, 2)
    );
  });

  test('welcome + demo + core functions', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await page.click('#emptyLoadDemo');
    await page.waitForSelector('.tree-node', { state: 'visible' });

    // Exercise pure functions
    await page.evaluate(() => {
      window.isArabicHeavy('مرحبا');
      window.isArabicHeavy('hello');
      window.escapeHtml('<script>alert(1)</script>');
      window.vaultSearch('test');
      window.setZoom(1.2);
      window.setZoom(1.0);
      window.cycleTheme();
      window.cycleTheme();
      window.cycleTheme();
    });
  });

  test('RTL + theme + editor modes', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await page.click('#emptyLoadDemo');
    await page.evaluate(() => {
      window.toggleRTL();
      window.toggleRTL();
      window.setEditorMode('source');
      window.setEditorMode('live');
      window.setEditorMode('split');
      window.setEditorMode('live');
    });
    await page.click('#themeBtn');
    await page.click('#themeBtn');
    await page.click('#themeBtn');
  });

  test('find bar + search + toast', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await page.click('#emptyLoadDemo');
    await page.evaluate(() => {
      window.openFind();
      window.runFind('hello');
      window.findStep(1);
      window.findStep(-1);
      window.closeFind();
      window.showToast('Test message', 'info');
      window.showToast('Error message', 'error');
    });
  });

  test('palette + inspector + new note', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await page.evaluate(() => {
      window.openPalette();
      window.closePalette();
      window.toggleInspector();
      window.toggleInspector();
      window.newNote();
      window.newDailyNote();
    });
  });

  test('vault search + tags + export', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await page.evaluate(() => {
      window._appState.files = [
        { name: 'a.md', content: 'hello world #tag1', path: 'a.md' },
        { name: 'b.md', content: 'hello again #tag2', path: 'b.md' },
      ];
      window.renderTree(window._appState.files);
      window.renderTags();
      window.renderFile(0);
      window.vaultSearch('hello');
      window.vaultSearch('world');
      window.exportHTML();
    });
  });

  test('file operations + drag drop + external', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('.app', { state: 'visible' });
    await page.evaluate(() => {
      window.openExternalFile({ name: 'test.md', content: '# Hello', path: 'test.md' });
      window.initDragDrop();
      window.loadDemo();
      window.saveCurrent();
    });
  });
});
