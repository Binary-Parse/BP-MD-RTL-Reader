const { test, expect } = require('@playwright/test');

/**
 * Performance tests (§6).
 * Basic render-time budgets and memory-leak detection.
 * For a desktop Electron app without a backend, we measure:
 * - Completed Markdown/layout time (Electron startup is covered by runtime-boundary.spec.js)
 * - Markdown render time for large documents
 * - Repeated operation stability (no unbounded growth)
 */

test.describe('Performance budgets', () => {
  test('Render 10k-word document within 1 second', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/src/renderer/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
    const content = '# Title\n\n' + 'word '.repeat(10000);
    const result = await page.evaluate(async (md) => {
      const t0 = performance.now();
      window._appState.files = [{ name: 'big.md', content: md, path: 'big.md', dirty: false }];
      window.renderFile(0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const editor = document.querySelector('.cm-mount .cm-editor');
      const rect = editor.getBoundingClientRect();
      return {
        elapsed: performance.now() - t0,
        contentLength: window._appState.files[0].content.length,
        laidOut: rect.width > 0 && rect.height > 0
      };
    }, content);
    expect(result.contentLength).toBe(content.length);
    expect(result.laidOut).toBe(true);
    expect(result.elapsed, `Completed render took ${result.elapsed}ms`).toBeLessThan(1000);
  });

  test('Render 100-heading document within 500ms', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/src/renderer/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
    const content = Array.from({ length: 100 }, (_, i) => `## Heading ${i}\n\nparagraph ${i}\n`).join('\n');
    const result = await page.evaluate(async (md) => {
      const t0 = performance.now();
      window._appState.files = [{ name: 'headings.md', content: md, path: 'headings.md', dirty: false }];
      window.renderFile(0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const outlineItems = document.querySelectorAll('.toc-item');
      outlineItems[0]?.getBoundingClientRect();
      return { elapsed: performance.now() - t0, headings: outlineItems.length };
    }, content);
    expect(result.headings).toBe(100);
    expect(result.elapsed, `Completed render took ${result.elapsed}ms`).toBeLessThan(500);
  });

  test('Zoom toggle does not cause layout thrash (>16ms/frame budget)', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/src/renderer/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(() => window.loadDemo());
    await expect(page.locator('.cm-mount .cm-editor')).toBeVisible();
    const elapsed = await page.evaluate(async () => {
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) {
        window.zoomIn();
        await new Promise(resolve => requestAnimationFrame(resolve));
        window.zoomOut();
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return performance.now() - t0;
    });
    const perOperation = elapsed / 40;
    expect(perOperation, `Average completed zoom operation took ${perOperation}ms`).toBeLessThan(25);
  });

  test('Memory: repeated file open/close keeps heap, DOM nodes, and listeners bounded', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/src/renderer/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
    const cdp = await page.context().newCDPSession(page);

    const exercise = async (cycles) => page.evaluate(async count => {
      for (let i = 0; i < count; i++) {
        window._appState.files = [{ name: `f${i}.md`, content: `# ${i}\n\ntext`, path: `f${i}.md`, dirty: false }];
        window.renderFile(0);
        window._appState.files = [];
        window.showWelcome();
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, cycles);

    const metrics = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const [heap, dom] = await Promise.all([
        cdp.send('Runtime.getHeapUsage'),
        cdp.send('Memory.getDOMCounters')
      ]);
      return { heap: heap.usedSize, nodes: dom.nodes, listeners: dom.jsEventListeners };
    };

    await exercise(5); // Warm caches and lazy module state before taking the baseline.
    const before = await metrics();
    await exercise(30);
    const after = await metrics();

    expect(after.heap - before.heap, `Heap growth: ${after.heap - before.heap} bytes`).toBeLessThan(3 * 1024 * 1024);
    expect(after.nodes - before.nodes, `DOM node growth: ${after.nodes - before.nodes}`).toBeLessThan(75);
    expect(after.listeners - before.listeners, `Listener growth: ${after.listeners - before.listeners}`).toBeLessThan(20);
  });
});
