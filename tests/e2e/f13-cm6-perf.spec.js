// @ts-check
/**
 * f13-cm6-perf.spec.js — T-F13 perf budget on the REAL CodeMirror 6 engine.
 *
 * The unit test (live-preview-perf.test.js) pins the viewport-bounded algorithm invariant
 * against a zero-cost FAKE engine — it proves the decoration build doesn't scale with doc
 * size, but its millisecond assertions are essentially free. This spec measures the ACTUAL
 * vendored CM6: a 10k-line live-preview doc must build < 100ms and absorb a keystroke < 16ms,
 * and a 10× larger doc must NOT cost ~10× more (viewport-bounded, not doc-size-bounded).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../index.html').replace(/\\/g, '/');

const BUILD_BUDGET_MS = 100;
const KEYSTROKE_BUDGET_MS = 16;

test.describe('[T-F13] real CM6 perf budget', () => {
  test('10k-line live-preview doc builds < 100ms and absorbs a keystroke < 16ms', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const lines = [];
      for (let i = 0; i < 10000; i++) lines.push(`# Heading ${i} with **bold** and \`code\` and [a](b) — مرحبا بالعالم`);
      const doc = lines.join('\n');
      const div = document.createElement('div');
      div.style.height = '600px';
      document.body.appendChild(div);

      const t0 = performance.now();
      const ad = window.createCodeMirrorAdapter(div, { CM6, doc });
      void div.querySelector('.cm-content')?.textContent; // force the initial viewport build
      const buildMs = performance.now() - t0;

      const mid = Math.floor(doc.length / 2);
      ad.setSelection({ start: mid, end: mid });
      await new Promise((res) => setTimeout(res, 30));
      const k0 = performance.now();
      ad.replaceSelection('x');
      void div.querySelector('.cm-content')?.textContent;
      const keyMs = performance.now() - k0;

      ad.destroy(); div.remove();
      return { buildMs, keyMs };
    });
    expect(r.buildMs, `10k-line build ${r.buildMs.toFixed(1)}ms`).toBeLessThan(BUILD_BUDGET_MS);
    expect(r.keyMs, `keystroke ${r.keyMs.toFixed(1)}ms`).toBeLessThan(KEYSTROKE_BUDGET_MS);
  });

  test('a 10× larger doc still builds well under budget (real-engine smoke; the doc-size INVARIANT is pinned by live-preview-perf.test.js)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app');
    const r = await page.evaluate(async () => {
      const CM6 = await window.loadCM6();
      const make = (n) => {
        const lines = [];
        for (let i = 0; i < n; i++) lines.push(`# H${i} **b** \`c\` [a](b) مرحبا`);
        return lines.join('\n');
      };
      const buildOnce = (doc) => {
        const div = document.createElement('div');
        div.style.height = '600px';
        document.body.appendChild(div);
        const t0 = performance.now();
        const ad = window.createCodeMirrorAdapter(div, { CM6, doc });
        void div.querySelector('.cm-content')?.textContent;
        const ms = performance.now() - t0;
        ad.destroy(); div.remove();
        return ms;
      };
      buildOnce(make(1000)); // warm up JIT so the ratio reflects steady state, not first-compile
      const small = buildOnce(make(1000));
      const big = buildOnce(make(10000));
      return { small, big };
    });
    // The 10k build stays under the real-engine budget…
    expect(r.big, `10k build ${r.big.toFixed(1)}ms`).toBeLessThan(BUILD_BUDGET_MS);
    // …and isn't pathologically worse than the 1k baseline. Only assert the ratio when the
    // baseline is above timer resolution (else the comparison is meaningless noise); the true
    // doc-size-invariance is proven by the node-visit-count unit test, not wall-clock here.
    if (r.small >= 3) {
      expect(r.big, `10k ${r.big.toFixed(1)}ms vs 1k ${r.small.toFixed(1)}ms`).toBeLessThan(r.small * 5);
    }
  });
});
