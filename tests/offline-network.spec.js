// @ts-check
/**
 * offline-network.spec.js — local-first / 0-runtime-network probe (SC2). Blocks
 * every non-file:// request and proves the app still loads and renders code +
 * math: the vendored marked / DOMPurify / KaTeX / highlight.js all resolve
 * locally, and none of the F9 deps are fetched from a CDN.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
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

    // Render a note with math + a code block — both must work offline.
    await page.evaluate(() => {
      window._appState.files = [{ name: 't.md', path: 't.md', content: '$x^2 + 1$\n\n```js\nconst y = 2;\n```\n', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForTimeout(200);
    await expect(page.locator('#noteContent .math-inline .katex')).toHaveCount(1);
    await expect(page.locator('#noteContent pre code.hljs')).toHaveCount(1);

    // None of the F9 deps (or any CDN) were requested — they are vendored locally.
    const cdnish = external.filter((u) => /katex|highlight|hljs|jsdelivr|unpkg|cdnjs/i.test(u));
    expect(cdnish).toEqual([]);
  });
});
