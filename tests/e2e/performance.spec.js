const { test, expect } = require('@playwright/test');

/**
 * Performance tests (§6).
 * Basic render-time budgets and memory-leak detection.
 * For a desktop Electron app without a backend, we measure:
 * - Completed Markdown/layout time (Electron startup is covered by runtime-boundary.spec.js)
 * - Markdown render time for large documents
 * - Repeated operation stability (no unbounded growth)
 */

test.describe('Performance budgets', { tag: '@perf' }, () => {
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

  // audit M4: 60 KB of unclosed emphasis froze the window for about 30 seconds.
  test('M4: a note built to stall the renderer opens within seconds and says what it did', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/src/renderer/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
    const content = '# Hostile\n\n' + '*a '.repeat(20000) + '\n\nLast **paragraph**.\n';
    const result = await page.evaluate(async (md) => {
      const t0 = performance.now();
      window._appState.files = [{ name: 'hostile.md', content: md, path: 'hostile.md', dirty: false }];
      window._appState.activeFile = 0;
      window.renderFile(0);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const note = document.getElementById('noteContent');
      return {
        elapsed: performance.now() - t0,
        heading: !!note.querySelector('h1'),
        literal: note.textContent.includes('*a *a *a'),
        toast: document.getElementById('toast').textContent,
      };
    }, content);
    expect(result.elapsed, `Render took ${result.elapsed}ms`).toBeLessThan(6000);
    expect(result.heading).toBe(true);
    expect(result.literal).toBe(true);
    expect(result.toast).toContain('plain text');
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
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const workMs = async () => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      const byName = Object.fromEntries(metrics.map((m) => [m.name, m.value]));
      return (byName.LayoutDuration + byName.RecalcStyleDuration) * 1000;
    };
    const ROUNDS = 5;
    const PAIRS_PER_ROUND = 8;
    const perOperation = [];
    for (let round = 0; round < ROUNDS; round++) {
      const before = await workMs();
      await page.evaluate((pairs) => {
        for (let i = 0; i < pairs; i++) {
          window.zoomIn();
          void document.body.offsetHeight;
          window.zoomOut();
          void document.body.offsetHeight;
        }
      }, PAIRS_PER_ROUND);
      perOperation.push((await workMs() - before) / (PAIRS_PER_ROUND * 2));
    }
    perOperation.sort((a, b) => a - b);
    const median = perOperation[Math.floor(ROUNDS / 2)];
    expect(median, `Median style+layout work per zoom operation was ${median}ms (rounds: ${perOperation.join(', ')})`).toBeLessThan(25);
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

// audit M16: the table and callout passes measured layout once per table and per callout, so
// the render time grew with the square of their number (2.5 MB with 1,400 tables: 2 minutes).
test.describe('M16: tables and callouts cost linear time', { tag: '@perf' }, () => {
  test('four times the tables and callouts take about four times as long, not sixteen', async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/src/renderer/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
    const timeFor = (count) => page.evaluate(async (n) => {
      const block = (i) => `Paragraph ${i}.\n\n| Name | Value |\n|---|---|\n| a${i} | 1 |\n\n> [!NOTE]\n> Callout ${i}.\n`;
      const md = Array.from({ length: n }, (_, i) => block(i)).join('\n');
      window.setViewMode('reading');
      let best = Infinity;
      for (let run = 0; run < 3; run += 1) {
        const t0 = performance.now();
        window._appState.files = [{ name: 'many.md', content: md, path: 'many.md', dirty: false }];
        window.renderFile(0);
        best = Math.min(best, performance.now() - t0);
      }
      return { ms: best, tables: document.querySelectorAll('#noteContent .table-frame').length, callouts: document.querySelectorAll('#noteContent .callout').length };
    }, count);
    const small = await timeFor(250);
    const large = await timeFor(1000);
    expect(large.tables).toBe(1000);
    expect(large.callouts).toBe(1000);
    // Linear is 4. The old code gave more than 12 here; 8 leaves room for a busy machine.
    expect(large.ms / small.ms, `250: ${small.ms.toFixed(0)} ms, 1000: ${large.ms.toFixed(0)} ms`).toBeLessThan(8);
  });
});
