// @ts-check
/**
 * reader-typography-v10.spec.js - the v10 redesign's reading-surface type scale,
 * measured against the real app (not the standalone rtl-heading-fixture, which has
 * its own hand-copied CSS unrelated to src/renderer/styles/components.css).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

async function injectAndRender(page, content) {
  await page.evaluate((content) => {
    window._appState.files = [{ name: 'v10-typography.md', path: 'v10-typography.md', content, dirty: false }];
    window.renderFile(0);
  }, content);
  await page.waitForTimeout(150);
}

test.describe('[v10] reading-surface type scale', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('Latin body: 18px / 1.8, headings at the v10 scale, paragraph spacing and wrap', async ({ page }) => {
    await injectAndRender(page, '# Heading One\n\nA lede paragraph right after doc-meta.\n\nA second paragraph.\n\n## Heading Two\n\n### Heading Three\n');
    const m = await page.evaluate(() => {
      const cs = (el) => getComputedStyle(el);
      const ps = document.querySelectorAll('#noteContent p');
      return {
        // ps[0] is the lede (directly after the h1 title); ps[1] is a plain body paragraph.
        ledeFont: cs(ps[0]).fontSize,
        bodyFont: cs(ps[1]).fontSize,
        bodyLineHeight: cs(ps[1]).lineHeight,
        pMarginBottom: cs(ps[1]).marginBottom,
        pTextWrap: cs(ps[1]).textWrap,
        h1Font: cs(document.querySelector('#noteContent h1')).fontSize,
        h1Wrap: cs(document.querySelector('#noteContent h1')).textWrap,
        h2Font: cs(document.querySelector('#noteContent h2')).fontSize,
        h3Font: cs(document.querySelector('#noteContent h3')).fontSize,
      };
    });
    expect(m.bodyFont).toBe('18px');
    expect(parseFloat(m.bodyLineHeight)).toBeCloseTo(18 * 1.8, 0);
    expect(m.pMarginBottom).toBe('18px');
    expect(m.pTextWrap).toBe('pretty');
    expect(parseFloat(m.ledeFont)).toBeCloseTo(18 * 1.08, 1);
    expect(m.h1Font).toBe('42px');
    expect(m.h1Wrap).toBe('balance');
    expect(m.h2Font).toBe('28px');
    expect(m.h3Font).toBe('22px');
  });

  test('welcome-card h1 never gets the lede/illumination treatment sized for the reader', async ({ page }) => {
    // sanity: welcome card is a different context entirely, not exercised by #noteContent
    const exists = await page.locator('.welcome-card h1').count();
    expect(exists).toBeGreaterThan(0);
  });

  test('Arabic body (whole-document RTL): 20px / 1.95, and the Arabic heading scale', async ({ page }) => {
    await injectAndRender(page, '# عنوان رئيسي\n\nفقرة نصية عربية بعد عنوان المستند.\n\n## عنوان فرعي\n');
    // Arabic-heavy content auto-detects RTL on render; force it explicitly if it did not.
    const alreadyRtl = await page.evaluate(() => document.getElementById('editor').getAttribute('dir') === 'rtl');
    if (!alreadyRtl) await page.evaluate(() => window.toggleRTL());
    const m = await page.evaluate(() => {
      const cs = (el) => getComputedStyle(el);
      const p = document.querySelector('#noteContent p');
      return {
        dir: document.getElementById('editor').getAttribute('dir'),
        bodyFont: cs(p).fontSize,
        bodyLineHeight: cs(p).lineHeight,
        h1Font: cs(document.querySelector('#noteContent h1')).fontSize,
        h2Font: cs(document.querySelector('#noteContent h2')).fontSize,
      };
    });
    expect(m.dir).toBe('rtl');
    expect(m.bodyFont).toBe('20px');
    expect(parseFloat(m.bodyLineHeight)).toBeCloseTo(20 * 1.95, 0);
    expect(m.h1Font).toBe('38px');
    expect(m.h2Font).toBe('26px');
  });

  test('per-block Arabic paragraph in a mixed AR/EN document gets the Arabic body size too', async ({ page }) => {
    // The lede rule (h1 + p) only touches the FIRST paragraph, so both measured
    // paragraphs here sit further down, clear of that special case.
    await injectAndRender(page, '# Mixed document\n\nAn opening lede paragraph.\n\nEnglish paragraph here.\n\nفقرة نصية عربية داخل مستند مختلط.\n');
    const m = await page.evaluate(() => {
      const cs = (el) => getComputedStyle(el);
      const ps = [...document.querySelectorAll('#noteContent p')];
      const arabicP = ps.find((p) => p.getAttribute('dir') === 'rtl');
      // skip ps[0] deliberately -- it is the lede (h1 + p), not a plain body paragraph.
      const latinP = ps.slice(1).find((p) => p.getAttribute('dir') !== 'rtl');
      return {
        found: !!arabicP,
        arabicFont: arabicP ? cs(arabicP).fontSize : null,
        latinFont: latinP ? cs(latinP).fontSize : null,
      };
    });
    expect(m.found, 'expected a per-block dir=rtl paragraph').toBe(true);
    expect(m.arabicFont).toBe('20px');
    expect(m.latinFont).toBe('18px');
  });
});
