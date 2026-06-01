// @ts-check
/**
 * rtl-perline.spec.js — T-R1/R2 live per-line RTL (per-block direction + inline
 * bidi isolation) on a mixed Arabic/English document, rendered through the real
 * index.html pipeline (no whole-document flip, no manual toggle).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;
const MIXED = fs.readFileSync(path.resolve(__dirname, 'fixtures/mixed-ltr-rtl.md'), 'utf8');

async function injectMarkdown(page, content) {
  return page.evaluate((md) => {
    window._appState.files = [{ name: 'mixed.md', path: 'mixed.md', handle: null, content: md, dirty: false }];
    window.renderFile(0);
  }, content);
}

test.describe('[T-R1/R2] live per-line RTL on a mixed AR/EN document', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    // NO manual #rtlBtn — exercise the pure per-block path.
    await injectMarkdown(page, MIXED);
    await page.waitForTimeout(200);
  });

  // ── T-R1: each block carries its own direction ───────────────────────────

  test('[R1] Arabic heading → dir=rtl + lang=ar (EC-C6)', async ({ page }) => {
    const h1 = page.locator('#noteContent h1').first();
    await expect(h1).toHaveAttribute('dir', 'rtl');
    await expect(h1).toHaveAttribute('lang', 'ar');
  });

  test('[R1] Arabic paragraph → rtl; English paragraph → ltr (no whole-doc flip)', async ({ page }) => {
    const dirs = await page.$$eval('#noteContent p', (ps) =>
      ps.map((p) => ({ dir: p.getAttribute('dir'), ar: /[؀-ۿ]/.test(p.textContent || '') })));
    const arabicPara = dirs.find((d) => d.ar);
    const englishPara = dirs.find((d) => !d.ar);
    expect(arabicPara?.dir).toBe('rtl');
    expect(englishPara?.dir).toBe('ltr');
  });

  test('[R1] the editor container is NOT whole-document flipped to rtl', async ({ page }) => {
    const editorDir = await page.evaluate(() => getComputedStyle(document.getElementById('editor')).direction);
    expect(editorDir).toBe('ltr'); // per-block only; container stays ltr without manual toggle
  });

  test('[R1] list items, blockquotes and table cells resolve per block', async ({ page }) => {
    const liDirs = await page.$$eval('#noteContent li', (els) => els.map((e) => e.getAttribute('dir')));
    expect(liDirs).toContain('rtl');
    expect(liDirs).toContain('ltr');

    const bqDirs = await page.$$eval('#noteContent blockquote', (els) => els.map((e) => e.getAttribute('dir')));
    expect(bqDirs).toContain('rtl');
    expect(bqDirs).toContain('ltr');

    const cellDirs = await page.$$eval('#noteContent td, #noteContent th', (els) =>
      els.map((e) => ({ dir: e.getAttribute('dir'), ar: /[؀-ۿ]/.test(e.textContent || '') })));
    expect(cellDirs.find((c) => c.ar)?.dir).toBe('rtl');
    expect(cellDirs.some((c) => !c.ar && c.dir === 'ltr')).toBe(true);
  });

  // ── T-R2: inline opposite/neutral runs isolated inside RTL blocks ─────────

  test('[R2] inline code inside an RTL paragraph is wrapped in <bdi>', async ({ page }) => {
    const wrapped = await page.$$eval('#noteContent p[dir="rtl"] code', (codes) =>
      codes.map((c) => c.parentElement?.tagName));
    expect(wrapped.length).toBeGreaterThan(0);
    expect(wrapped.every((t) => t === 'BDI')).toBe(true);
  });

  test('[R2] a number and a #tag inside an RTL paragraph are isolated in <bdi>', async ({ page }) => {
    const bdiTexts = await page.$$eval('#noteContent p[dir="rtl"] bdi', (b) => b.map((x) => x.textContent));
    expect(bdiTexts).toContain('42');
    expect(bdiTexts.some((t) => t && t.includes('#'))).toBe(true);
  });

  test('[R2] an LTR link inside an RTL paragraph is isolated in <bdi>', async ({ page }) => {
    const linkParent = await page.$$eval('#noteContent p[dir="rtl"] a', (as) =>
      as.map((a) => a.parentElement?.tagName));
    expect(linkParent).toContain('BDI');
  });

  test('[R2] English (LTR) blocks stay clean — no <bdi> noise', async ({ page }) => {
    const bdiInLtr = await page.$$eval('#noteContent p[dir="ltr"] bdi', (b) => b.length);
    expect(bdiInLtr).toBe(0);
  });

  // ── Visual baseline ──────────────────────────────────────────────────────

  test('[Visual] mixed per-line RTL renders correctly at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot('mixed-perline-1440x900.png', {
      maxDiffPixels: 5000,
      threshold: 0.2,
    });
  });
});

test.describe('[T-R1/R2] manual override + bidi-aware export', () => {
  test('[override] manual ⇄ toggle re-resolves a neutral-only block (EC-C1)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    // English-first doc → baseDir ltr → the neutral "123" block resolves ltr…
    await injectMarkdown(page, '# Title\n\n123\n');
    await page.waitForTimeout(150);
    const neutral = page.locator('#noteContent p').first();
    await expect(neutral).toHaveAttribute('dir', 'ltr');
    // …manual RTL override flips the base → the neutral block re-resolves to rtl.
    await page.click('#rtlBtn');
    await page.waitForTimeout(150);
    await expect(neutral).toHaveAttribute('dir', 'rtl');
  });

  test('[export] Arabic doc exports as RTL/lang=ar with per-block direction (no manual toggle)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await injectMarkdown(page, '# مرحبا بالعالم\n\nفقرة عربية مع رقم 42.\n');
    await page.waitForTimeout(150);
    const out = await page.evaluate(() => window.exportHTML());
    expect(out).toMatch(/<html lang="ar" dir="rtl">/);
    expect(out).toMatch(/<h1[^>]*dir="rtl"/);
    expect(out).toMatch(/<p[^>]*dir="rtl"/);
    expect(out).toContain('<bdi>42</bdi>'); // inline isolation carried into export
  });

  test('[Arabic typography] a per-block RTL paragraph uses the Arabic font (no manual flip)', async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForLoadState('networkidle');
    await injectMarkdown(page, '# عنوان\n\nفقرة عربية كاملة.\n');
    await page.waitForTimeout(150);
    const fonts = await page.evaluate(() => {
      const p = document.querySelector('#noteContent p[dir="rtl"]');
      const editor = document.getElementById('editor');
      return {
        editorDir: getComputedStyle(editor).direction,
        family: getComputedStyle(p).fontFamily,
        lineHeight: parseFloat(getComputedStyle(p).lineHeight) / parseFloat(getComputedStyle(p).fontSize),
        letterSpacing: getComputedStyle(p).letterSpacing,
      };
    });
    expect(fonts.editorDir).toBe('ltr');                 // container not flipped
    expect(fonts.family.toLowerCase()).toContain('arabic'); // per-block Arabic face
    expect(fonts.lineHeight).toBeGreaterThanOrEqual(1.8);   // SPEC R3 leading
    expect(fonts.letterSpacing === 'normal' || parseFloat(fonts.letterSpacing) === 0).toBe(true); // R4
  });
});
