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
    await page.waitForTimeout(500);

    // Engines/sanitizer/math/highlighter are all present despite blocked network.
    const libs = await page.evaluate(() => ({
      marked: typeof window.marked,
      DOMPurify: typeof window.DOMPurify,
      katex: typeof window.katex,
      hljs: typeof window.hljs,
    }));
    expect(libs.marked).not.toBe('undefined');
    expect(libs.DOMPurify).not.toBe('undefined');
    expect(libs.katex).toBe('object');
    expect(libs.hljs).toBe('object');

    // Render a note with math + a code block + a Mermaid diagram — all must work offline.
    await page.evaluate(() => {
      window._appState.files = [{ name: 't.md', path: 't.md', content: '$x^2 + 1$\n\n```js\nconst y = 2;\n```\n\n```mermaid\ngraph TD; A-->B\n```\n', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(200);
    await expect(page.locator('#noteContent .math-inline .katex')).toHaveCount(1);
    await expect(page.locator('#noteContent pre code.hljs')).toHaveCount(1);
    // Mermaid lazy-loads from the local vendor bundle and renders even offline.
    await expect(page.locator('#noteContent .mermaid svg')).toHaveCount(1, { timeout: 15000 });

    // Fonts are self-hosted (T-B3/T1/T3): explicitly loading each family succeeds from
    // the local woff2 even with the network blocked (a CDN font would fail to load here).
    const fontsLoaded = await page.evaluate(async () => {
      const specs = ["700 16px 'Fraunces'", "italic 400 16px 'Fraunces'", "500 16px 'Inter'", "italic 400 16px 'Inter'", "16px 'JetBrains Mono'", "600 16px 'IBM Plex Sans Arabic'"];
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
  });
});
