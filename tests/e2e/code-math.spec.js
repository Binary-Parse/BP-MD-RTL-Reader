// @ts-check
/**
 * code-math.spec.js — T-F9 code syntax highlighting + KaTeX math, rendered through
 * the real index.html pipeline (vendored highlight.js + KaTeX, sanitized).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;
const DOC = fs.readFileSync(path.resolve(__dirname, '../fixtures/code-math.md'), 'utf8');

async function inject(page, content) {
  return page.evaluate((md) => {
    window._appState.files = [{ name: 'doc.md', path: 'doc.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
    // T-F13: reveal the rendered preview (the export render pipeline) — hidden behind
    // `cm-single` now that CM6 is the on-screen editor — so this visual test snapshots it.
    document.getElementById('editorArea').classList.remove('cm-single', 'welcome');
  }, content);
}

test.describe('[T-F9] code highlighting + KaTeX math', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await inject(page, DOC);
    // audit PERF-07: highlight.js is no longer a blocking <script> — it is injected on the
    // first fenced block, so the engine arrives asynchronously.
    await page.waitForFunction(() => typeof window.hljs !== 'undefined');
  });

  test('the vendored libraries are available locally', async ({ page }) => {
    const libs = await page.evaluate(() => ({ katex: typeof window.katex, hljs: typeof window.hljs }));
    expect(libs.katex).toBe('object');
    expect(libs.hljs).toBe('object');
  });

  test('fenced code block is syntax-highlighted and forced dir=ltr', async ({ page }) => {
    const code = page.locator('#noteContent pre code.hljs');
    await expect(code).toHaveCount(1);
    await expect(code.locator('.hljs-keyword').first()).toBeVisible(); // function/const/return
    await expect(page.locator('#noteContent pre')).toHaveAttribute('dir', 'ltr');
    const dir = await page.evaluate(() => getComputedStyle(document.querySelector('#noteContent pre')).direction);
    expect(dir).toBe('ltr');
  });

  test('inline $...$ renders as KaTeX', async ({ page }) => {
    await expect(page.locator('#noteContent .math-inline')).toHaveCount(3); // E=mc^2, a*b*c, Arabic
    await expect(page.locator('#noteContent .math-inline .katex').first()).toBeVisible();
    await expect(page.locator('#noteContent .math-inline').first()).toHaveAttribute('dir', 'ltr');
  });

  test('LaTeX is NOT corrupted by markdown (raw TeX reaches KaTeX; emphasis-safe)', async ({ page }) => {
    // KaTeX emits the source TeX in a MathML <annotation> — assert it survived intact.
    const annotations = await page.locator('#noteContent .katex annotation').allTextContents();
    expect(annotations.some((a) => a.includes('\\,'))).toBe(true);              // block \, thin-space preserved
    expect(annotations.some((a) => a.replace(/\s/g, '') === 'a*b*c')).toBe(true); // $a*b*c$ not mangled into <em>
    // the emphasis chars did NOT become <em>, and no stray $ leaked into the prose
    await expect(page.locator('#noteContent p em')).toHaveCount(0);
    const first = await page.locator('#noteContent p').first().textContent();
    expect(first).not.toContain('$');
  });

  test('the math sanitizer allow-list survives the Trusted Types default policy', async ({ page }) => {
    // sanitizeMath() allows <semantics>/<annotation> and forbids <annotation-xml>, but a
    // PLAIN STRING assigned to innerHTML is re-run through the 'default' Trusted Types
    // policy, whose narrower config undoes that. This asserts the allow-list actually
    // reaches the DOM — and that no raw TeX is left loose inside <math> for a screen
    // reader to announce alongside the MathML it duplicates.
    const kept = await page.evaluate(() => ({
      semantics: document.querySelectorAll('#noteContent .katex semantics').length,
      annotation: document.querySelectorAll('#noteContent .katex annotation').length,
      strayText: [...document.querySelectorAll('#noteContent .katex-mathml math')].some((m) =>
        [...m.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')),
    }));
    expect(kept.semantics).toBeGreaterThan(0);
    expect(kept.annotation).toBeGreaterThan(0);
    expect(kept.strayText).toBe(false);
  });

  test('block $$...$$ renders as a centered KaTeX display', async ({ page }) => {
    await expect(page.locator('#noteContent .math-block .katex')).toHaveCount(1);
    const ta = await page.evaluate(() => getComputedStyle(document.querySelector('#noteContent .math-block')).textAlign);
    expect(ta).toBe('center');
  });

  test('math inside an RTL paragraph is LTR-isolated (composes with R1/R2)', async ({ page }) => {
    const m = page.locator('#noteContent p[dir="rtl"] .math-inline');
    await expect(m).toHaveCount(1);
    await expect(m).toHaveAttribute('dir', 'ltr');
    const dir = await page.evaluate(() => {
      const el = document.querySelector('#noteContent p[dir="rtl"] .math-inline');
      return getComputedStyle(el).direction;
    });
    expect(dir).toBe('ltr');
    // KaTeX digits must NOT be wrapped in <bdi> by the bidi pass
    await expect(page.locator('#noteContent .katex bdi')).toHaveCount(0);
  });

  test('hostile payloads are neutralised in code + math (sanitize + KaTeX trust:false)', async ({ page }) => {
    await inject(page, [
      'A link-injection attempt in math: $\\href{javascript:alert(1)}{x}$ here.',
      '',
      '```html',
      '</code></pre><img src=x onerror="window.__xss = 1">',
      '```',
    ].join('\n'));
    await expect(page.locator('#noteContent script')).toHaveCount(0);
    await expect(page.locator('#noteContent img[onerror]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    // KaTeX trust:false → \href must NOT produce a javascript: anchor
    const hrefs = await page.locator('#noteContent a').evaluateAll((els) => els.map((a) => a.getAttribute('href') || ''));
    expect(hrefs.some((h) => /javascript:/i.test(h))).toBe(false);
  });

  test('[Visual] code + math render at 1440x900 @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page).toHaveScreenshot('code-math-1440x900.png', { maxDiffPixels: 6000, threshold: 0.2 });
  });
});

// Math/code inside the CM6 block widgets (callout + table) must render too — the widget path
// previously skipped restoreMath, leaving a raw KaTeX placeholder hash on screen.
test.describe('[T-F9] math renders inside CM6 block widgets', () => {
  test('KaTeX renders inside a callout and a table cell (no placeholder)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForFunction(() => !!window._appState && !!window.getActiveCmAdapter, null, { timeout: 8000 });
    await page.evaluate(() => {
      window._appState.files = [{ name: 'm.md', path: 'm.md', content:
        '# Title\n\n> [!NOTE] Math\n> Mass-energy: $E = mc^2$ inline.\n\n| Eq | Value |\n| --- | --- |\n| $a^2+b^2$ | $c^2$ |\n\nend\n', dirty: false }];
      window.renderFile(0);
    });
    await page.waitForSelector('.cm-mount .cm-editor', { timeout: 8000 });
    // caret on line 1 so the callout + table render as block widgets (not the active raw line)
    await page.evaluate(() => window.getActiveCmAdapter().setSelection({ start: 0, end: 0 }));
    await expect(page.locator('.cm-mount .cm-lp-callout .katex')).toHaveCount(1);
    await expect(page.locator('.cm-mount .cm-lp-table .katex')).toHaveCount(2);
    // the raw placeholder (a long hex run) must not be visible anywhere in the editor
    const text = await page.evaluate(() => document.querySelector('.cm-mount .cm-content')?.textContent || '');
    expect(/\b[0-9a-f]{12,}\b/.test(text)).toBe(false);
  });
});

test.describe('floating copy button tracks the visible code block', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  // Enough leading prose that the first fence starts WELL below the viewport midline
  // at scrollTop 0, so the not-yet-reached (hidden) state is deterministic.
  const THREE_BLOCKS = [
    ...Array.from({ length: 24 }, (_, i) => `Intro paragraph ${i + 1}, with enough words to occupy real vertical space.`),
    '',
    '```js',
    'const one = 1;',
    '```',
    '',
    'Between one and two.',
    '',
    '```bash',
    'go build ./...',
    '```',
    '',
    'Between two and three.',
    '',
    '```python',
    'print("three")',
    '```',
    '',
    'Tail paragraph.',
  ].join('\n');

  async function scrollTopTo(page, value) {
    await page.evaluate((v) => { document.querySelector('.preview-pane').scrollTop = v; }, value);
    await page.waitForTimeout(200); // scroll → rAF-throttled track update
  }

  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await page.evaluate((md) => {
      window._appState.files = [{ name: 'doc.md', path: 'doc.md', handle: null, content: md, dirty: false }];
      window.renderFile(0);
      window.setViewMode('reading');
    }, THREE_BLOCKS);
  });

  test('hidden above the first block, then pinned to the current one while scrolling', async ({ page }) => {
    const btn = page.locator('#codeCopyFloat');
    // Everything (or enough) is below the midline at scrollTop 0 → nothing to copy yet.
    await expect(btn).toBeHidden();

    // Scroll so the SECOND block owns the midline.
    const tops = await page.evaluate(() => {
      const sc = document.querySelector('.preview-pane');
      return Array.from(document.querySelectorAll('#noteContent pre')).map((pre) => pre.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
    });
    await scrollTopTo(page, tops[1] - 200);
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('data-current', '1');
    const topFor1 = await btn.evaluate((el) => el.style.top);
    expect(Number.parseFloat(topFor1)).toBeGreaterThan(0);

    // Further down: the third block takes over and the button MOVES.
    await scrollTopTo(page, tops[2] - 100);
    await expect(btn).toHaveAttribute('data-current', '2');
    const topFor2 = await btn.evaluate((el) => el.style.top);
    expect(Number.parseFloat(topFor2)).toBeGreaterThan(Number.parseFloat(topFor1));

    // Scrolling back UP returns to earlier blocks by the same midline rule: place
    // block 0 just BELOW the midline (scrollTop = t0 − clientH/2 + 20 → mid just
    // past t0 but still well before t1) → block 0 is current again.
    const ch = await page.evaluate(() => document.querySelector('.preview-pane').clientHeight);
    await scrollTopTo(page, tops[0] - ch / 2 + 20);
    await expect(btn).toHaveAttribute('data-current', '0');
    // …and above everything it hides again.
    await scrollTopTo(page, 0);
    await expect(btn).toBeHidden();
  });

  test('clicking copies the current block source (trailing newline trimmed) and says so', async ({ page }) => {
    const tops = await page.evaluate(() => {
      const sc = document.querySelector('.preview-pane');
      return Array.from(document.querySelectorAll('#noteContent pre')).map((pre) => pre.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop);
    });
    await scrollTopTo(page, tops[1] - 200);
    const btn = page.locator('#codeCopyFloat');
    await expect(btn).toHaveAttribute('data-current', '1');
    await btn.click();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('go build ./...');
    await expect(page.locator('#toast')).toHaveClass(/show/);
    await expect(btn).toHaveClass(/copied/);
  });
});
