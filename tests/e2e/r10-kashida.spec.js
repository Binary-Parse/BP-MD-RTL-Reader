// @ts-check
/**
 * r10-kashida.spec.js — T-R10 Arabic justification: RAGGED by default; an optional kashida
 * toggle fills RTL blocks via inter-character distribution. LTR text is never justified.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

const AR = 'الكتابة العربية جميلة وذات تاريخ عريق في الحضارة الإنسانية والثقافة العالمية على مر العصور والأزمان المختلفة.';
const EN = 'English prose stays ragged-right and is never justified regardless of the kashida setting at all.';

const align = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const cs = getComputedStyle(el);
  return { textAlign: cs.textAlign, textJustify: cs.textJustify };
}, sel);

test.describe('[T-R10] Arabic kashida justification', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
    await page.evaluate(({ ar, en }) => {
      window.setKashida(false); // start from the ragged default
      window._appState.files = [{ name: 'a.md', path: 'a.md', content: `${ar}\n\n${en}\n`, dirty: false }];
      window.renderFile(0);
    }, { ar: AR, en: EN });
    await page.waitForTimeout(100);
    // Tag the AR (dir=rtl) and EN (not rtl) paragraphs for stable selection.
    await page.evaluate(() => {
      const ps = [...document.querySelectorAll('#noteContent p')];
      const ar = ps.find((p) => p.getAttribute('dir') === 'rtl');
      const en = ps.find((p) => p.getAttribute('dir') !== 'rtl');
      if (ar) ar.id = '__ar'; if (en) en.id = '__en';
    });
  });

  test('default is RAGGED — Arabic blocks are not justified', async ({ page }) => {
    expect((await align(page, '#__ar')).textAlign).not.toBe('justify');
    const onBody = await page.evaluate(() => document.querySelector('.kashida') !== null);
    expect(onBody).toBe(false);
  });

  test('kashida ON justifies Arabic blocks via inter-character; OFF reverts to ragged', async ({ page }) => {
    await page.evaluate(() => window.setKashida(true));
    const ar = await align(page, '#__ar');
    expect(ar.textAlign).toBe('justify');
    expect(ar.textJustify).toBe('inter-character');

    await page.evaluate(() => window.setKashida(false));
    expect((await align(page, '#__ar')).textAlign).not.toBe('justify');
  });

  test('LTR (English) text is NEVER justified, even with kashida ON', async ({ page }) => {
    await page.evaluate(() => window.setKashida(true));
    expect((await align(page, '#__en')).textAlign).not.toBe('justify');
  });

  test('kashida applies to prose blocks only — RTL headings stay ragged', async ({ page }) => {
    await page.evaluate((ar) => {
      window.setKashida(true);
      window._appState.files = [{ name: 'h.md', path: 'h.md', content: `## ${ar}\n\n${ar}\n`, dirty: false }];
      window.renderFile(0);
    }, AR);
    await page.waitForTimeout(100);
    const kinds = await page.evaluate(() => {
      const h = document.querySelector('#noteContent h2[dir="rtl"]');
      const p = document.querySelector('#noteContent p[dir="rtl"]');
      return { heading: h && getComputedStyle(h).textAlign, para: p && getComputedStyle(p).textAlign };
    });
    expect(kinds.para).toBe('justify');      // prose justifies
    expect(kinds.heading).not.toBe('justify'); // heading does not
  });

  test('the View menu exposes a Kashida Justification check item reflecting state', async ({ page }) => {
    await page.evaluate(() => window.setKashida(true));
    await page.locator('.tb-menu-item[data-menu="view"]').click();
    const item = page.locator('#dropdown .dd-item', { hasText: 'Kashida Justification' });
    await expect(item).toHaveCount(1);
    await expect(item).toHaveClass(/checked/); // reflects arabicKashida === true
  });
});
