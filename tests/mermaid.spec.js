// @ts-check
/**
 * mermaid.spec.js — T-F16 Mermaid diagrams: lazy-loaded vendored engine, SVG
 * sanitized, dir=ltr, per-block error→code fallback.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;
const DOC = fs.readFileSync(path.resolve(__dirname, 'fixtures/mermaid.md'), 'utf8');

async function inject(page, content) {
  return page.evaluate((md) => {
    window._appState.files = [{ name: 'd.md', path: 'd.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
    // T-F13: reveal the rendered preview (export render path) hidden behind `cm-single`.
    document.getElementById('editorArea').classList.remove('cm-single', 'welcome');
  }, content);
}

test.describe('[T-F16] Mermaid diagrams', () => {
  test('mermaid is lazy: not loaded until a diagram is rendered', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(() => typeof window.mermaidNS)).toBe('undefined'); // not loaded on the welcome screen
    await inject(page, DOC);
    await expect.poll(() => page.evaluate(() => typeof window.mermaidNS), { timeout: 15000 }).toBe('object');
  });

  test('a valid block renders an inline SVG (dir=ltr, no foreignObject); invalid → code fallback', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await inject(page, DOC);
    // valid diagram becomes an SVG (lazy load + async render)
    await expect(page.locator('#noteContent .mermaid svg')).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('#noteContent .mermaid')).toHaveAttribute('dir', 'ltr');
    expect(await page.locator('#noteContent .mermaid foreignObject').count()).toBe(0); // sanitizer-safe SVG text
    expect(await page.locator('#noteContent .mermaid script').count()).toBe(0);
    // invalid diagram keeps its code block as a fallback
    await expect(page.locator('#noteContent pre[data-mermaid-error]')).toHaveCount(1, { timeout: 15000 });
  });

  test('a hostile diagram SVG is sanitized end-to-end (EC-B3): script/foreignObject/handlers stripped', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    // Stub the (lazy) engine so it emits a HOSTILE SVG; renderMermaid must run it
    // through the real sanitizeSvg (browser DOMPurify) before insertion.
    await page.evaluate(() => {
      window.mermaidNS = { default: {
        initialize() {},
        render: async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>window.__mmd_xss=1<\/script><foreignObject><img src=x onerror="window.__mmd_xss=1"></foreignObject><text>safe label</text></svg>' }),
      } };
    });
    await inject(page, '```mermaid\ngraph TD; A-->B\n```\n');
    await expect(page.locator('#noteContent .mermaid svg')).toHaveCount(1, { timeout: 5000 });
    expect(await page.locator('#noteContent .mermaid script').count()).toBe(0);
    expect(await page.locator('#noteContent .mermaid foreignObject').count()).toBe(0);
    expect(await page.locator('#noteContent .mermaid img').count()).toBe(0);
    expect(await page.evaluate(() => window.__mmd_xss)).toBeUndefined();
    expect(await page.locator('#noteContent .mermaid text').textContent()).toBe('safe label'); // benign content kept
  });

  test('[Visual] diagram renders at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await inject(page, DOC);
    await expect(page.locator('#noteContent .mermaid svg')).toHaveCount(1, { timeout: 15000 });
    await page.waitForTimeout(300);
    await expect(page).toHaveScreenshot('mermaid-1440x900.png', { maxDiffPixels: 8000, threshold: 0.2 });
  });
});
