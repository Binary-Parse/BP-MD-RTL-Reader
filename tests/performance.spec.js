const { test, expect } = require('@playwright/test');

/**
 * Performance tests (§6).
 * Basic render-time budgets and memory-leak detection.
 * For a desktop Electron app without a backend, we measure:
 * - Initial load time
 * - Markdown render time for large documents
 * - Repeated operation stability (no unbounded growth)
 */

test.describe('Performance budgets', () => {
  test('Initial page load completes within 3 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/marqam.html');
    await page.waitForSelector('#app', { state: 'visible' });
    const elapsed = Date.now() - start;
    expect(elapsed, `Load took ${elapsed}ms`).toBeLessThan(3000);
  });

  test('Render 10k-word document within 1 second', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/marqam.html');
    await page.waitForSelector('#app', { state: 'visible' });
    const content = '# Title\n\n' + 'word '.repeat(10000);
    const elapsed = await page.evaluate((md) => {
      const t0 = performance.now();
      window._marqamState.files = [{ name: 'big.md', content: md, path: 'big.md', dirty: false }];
      window.renderFile(0);
      return performance.now() - t0;
    }, content);
    expect(elapsed, `Render took ${elapsed}ms`).toBeLessThan(1000);
  });

  test('Render 100-heading document within 500ms', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/marqam.html');
    await page.waitForSelector('#app', { state: 'visible' });
    const content = Array.from({ length: 100 }, (_, i) => `## Heading ${i}\n\nparagraph ${i}\n`).join('\n');
    const elapsed = await page.evaluate((md) => {
      const t0 = performance.now();
      window._marqamState.files = [{ name: 'headings.md', content: md, path: 'headings.md', dirty: false }];
      window.renderFile(0);
      return performance.now() - t0;
    }, content);
    expect(elapsed, `Render took ${elapsed}ms`).toBeLessThan(500);
  });

  test('Zoom toggle does not cause layout thrash (>16ms/frame budget)', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/marqam.html');
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    const elapsed = await page.evaluate(() => {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) {
        window.zoomIn();
        window.zoomOut();
      }
      return performance.now() - t0;
    });
    expect(elapsed / 20, `Average zoom toggle took ${elapsed / 20}ms`).toBeLessThan(16);
  });

  test('Memory: repeated file open/close does not leak DOM nodes', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/marqam.html');
    await page.waitForSelector('#app', { state: 'visible' });
    const growth = await page.evaluate(() => {
      const counts = [];
      for (let i = 0; i < 10; i++) {
        window._marqamState.files = [{ name: `f${i}.md`, content: `# ${i}\n\ntext`, path: `f${i}.md`, dirty: false }];
        window.renderFile(0);
        counts.push(document.querySelectorAll('*').length);
        window._marqamState.files = [];
        window.showWelcome();
      }
      // After cleanup, node count should not grow unboundedly
      const first = counts[0];
      const last = counts[counts.length - 1];
      return last - first;
    });
    // Allow modest growth due to welcome-screen recents caching etc.
    expect(growth, `DOM node growth: ${growth}`).toBeLessThan(150);
  });
});
