// @ts-check
/**
 * offline-network.spec.js — local-first / 0-runtime-network probe (SC2). Blocks
 * every non-file:// request and proves the app still loads and renders code +
 * math: the vendored marked / DOMPurify / KaTeX / highlight.js all resolve
 * locally, and none of the F9 deps are fetched from a CDN.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

test.describe('local-first / network', () => {
  test('renders code + math with all external network blocked (vendored locally)', async ({ page }) => {
    const external = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file:')) return route.continue();
      external.push(url); // record + block any non-file (CDN/font) request
      return route.abort();
    });

    await page.goto(INDEX_URL);

    // Engines/sanitizer/math are blocking vendor scripts. highlight.js is NOT: audit
    // PERF-07 moved its 1.08 MB off first paint, so it must be absent until a fenced
    // block renders (asserted below, still with the network blocked).
    const libs = await page.evaluate(() => ({
      marked: typeof window.marked,
      DOMPurify: typeof window.DOMPurify,
      katex: typeof window.katex,
      hljs: typeof window.hljs,
    }));
    expect(libs.marked).not.toBe('undefined');
    expect(libs.DOMPurify).not.toBe('undefined');
    expect(libs.katex).toBe('object');
    expect(libs.hljs).toBe('undefined');

    // Render a note with math + a code block + a Mermaid diagram — all must work offline.
    await page.evaluate(() => {
      window._appState.files = [{ name: 't.md', path: 't.md', content: '$x^2 + 1$\n\n```js\nconst y = 2;\n```\n\n```mermaid\ngraph TD; A-->B\n```\n', dirty: false }];
      window.renderFile(0);
    });
    await expect(page.locator('#noteContent .math-inline .katex')).toHaveCount(1);
    await expect(page.locator('#noteContent pre code.hljs')).toHaveCount(1);
    expect(await page.evaluate(() => typeof window.hljs)).toBe('object');
    // Mermaid lazy-loads from the local vendor bundle and renders even offline.
    await expect(page.locator('#noteContent .mermaid svg')).toHaveCount(1, { timeout: 15000 });

    // Fonts are self-hosted (T-B3/T1/T3): explicitly loading each family succeeds from
    // the local woff2 even with the network blocked (a CDN font would fail to load here).
    const fontsLoaded = await page.evaluate(async () => {
      const specs = ["700 16px 'Literata'", "italic 400 16px 'Literata'", "500 16px 'Inter'", "italic 400 16px 'Inter'", "16px 'JetBrains Mono'", "600 16px 'IBM Plex Sans Arabic'"];
      const out = {};
      for (const s of specs) {
        try { out[s] = (await document.fonts.load(s)).length > 0; } catch (_) { out[s] = false; }
      }
      return out;
    });
    for (const [spec, ok] of Object.entries(fontsLoaded)) {
      expect(ok, `font failed to load locally: ${spec}`).toBe(true);
    }

    // None of the F9/F16 deps, NO font CDN, NO CDN at all was requested — all vendored.
    const cdnish = external.filter((u) => /katex|highlight|hljs|mermaid|d3|jsdelivr|unpkg|cdnjs|googleapis|gstatic|fontsource/i.test(u));
    expect(cdnish).toEqual([]);
    // audit CMP-14: the stronger, unfiltered claim — the app issues ZERO non-file requests.
    // If this ever fails, the list above names the offender and it is a real regression,
    // not a test problem.
    expect(external, `unexpected external request(s): ${external.join(', ')}`).toEqual([]);
    // T7.1: the update check is opt-in, and 'manual' is the default — with no settings bridge
    // the renderer never even asks, which is why the zero-request claim above holds.
    expect(await page.evaluate(() => window._appState.updateCheck)).toBe('manual');
  });
});
