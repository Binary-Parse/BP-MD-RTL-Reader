// @ts-check
/**
 * known-issues.spec.js — the 1.3.0 "Known issues" list, now fixed:
 *   2. Arabic inspector-toggle tooltip rendered mirrored (button scaleX(-1) mirrored its ::after)
 *   3. strings stay English after switching the interface language
 *   4. line/column readout only updated on edits, not on clicks
 *   5. a tab kept its unsaved dot after undo returned the text to the saved state
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_URL = 'file:///' + path.resolve(__dirname, '../../src/renderer/index.html').replace(/\\/g, '/');

async function boot(page) {
  await page.goto(INDEX_URL);
  await page.waitForSelector('#app');
  await page.waitForFunction(() => !!window._appState && !!window.getActiveCmAdapter, null, { timeout: 8000 });
}

test.describe('#2 RTL panel toggles mirror the icon, not the button (so tooltips read correctly)', () => {
  test('button is not mirrored, the icon inside is', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await page.waitForTimeout(150);
    for (const id of ['sidebarToggleBtn', 'inspectorToggleBtn']) {
      const t = await page.evaluate((i) => {
        const b = document.getElementById(i);
        return { btn: getComputedStyle(b).transform, icon: getComputedStyle(b.querySelector('.ic')).transform };
      }, id);
      expect(t.btn === 'none' || t.btn === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
      expect(t.icon).toMatch(/^matrix\(-1,/);
    }
  });

  test('the tooltip of the inspector toggle is not mirrored in the Arabic UI', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => { document.documentElement.setAttribute('dir', 'rtl'); document.documentElement.setAttribute('lang', 'ar'); });
    await page.hover('#inspectorToggleBtn');
    await page.waitForTimeout(500);
    const net = await page.evaluate(() => {
      const b = document.getElementById('inspectorToggleBtn');
      // product of the horizontal scale of the button and its ::after tooltip
      const scaleX = (t) => (t === 'none' ? 1 : parseFloat(t.slice(7)));
      return scaleX(getComputedStyle(b).transform) * scaleX(getComputedStyle(b, '::after').transform);
    });
    expect(net).toBeGreaterThan(0);
  });
});

const setFiles = (page, files, active = 0) => page.evaluate(({ files, active }) => {
  window._appState.files = files.map(f => ({ name: f.name, path: f.name, content: f.content, dirty: false }));
  window.renderFile(active);
}, { files, active });

test.describe('#3 switching the interface language re-localizes what is already rendered', () => {
  test('read time, word count and the doc-meta strip switch to Arabic with a note open', async ({ page }) => {
    await boot(page);
    await setFiles(page, [{ name: 'n.md', content: `# T\n\n${'word '.repeat(440)}` }]);
    await page.waitForSelector('.cm-mount .cm-editor');
    await page.evaluate(() => window.setUiLocale('ar'));
    const t = await page.evaluate(() => ({
      readTime: document.getElementById('readTime').textContent,
      propRead: document.getElementById('propRead').textContent,
      words: document.getElementById('wordCount').textContent,
      kicker: document.querySelector('#noteContent .doc-meta span').textContent,
    }));
    expect(t.readTime).toContain('قراءة');
    expect(t.propRead).toContain('قراءة');
    expect(t.words).toContain('كلمة');
    expect(t.kicker).toBe('مقالة');
    expect(t.readTime).not.toMatch(/read/);
  });

  test('with no note open the placeholders are Arabic too, and back to English', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.setUiLocale('ar'));
    expect(await page.evaluate(() => document.getElementById('readTime').textContent)).toContain('قراءة');
    expect(await page.evaluate(() => document.getElementById('wordCount').textContent)).toContain('كلمة');
    await page.evaluate(() => window.setUiLocale('en'));
    expect(await page.evaluate(() => document.getElementById('readTime').textContent)).toContain('read');
    expect(await page.evaluate(() => document.getElementById('wordCount').textContent)).toBe('0 words');
  });
});

test.describe('#4 the line/column readout follows the caret, not only edits', () => {
  test('moving the caret without typing updates ln/col', async ({ page }) => {
    await boot(page);
    await setFiles(page, [{ name: 'p.md', content: 'abc\ndefgh\nij' }]);
    await page.waitForSelector('.cm-mount .cm-editor');
    await page.evaluate(() => window.getActiveCmAdapter().setSelection({ start: 6 })); // 'f' on line 2
    await expect.poll(() => page.evaluate(() => document.getElementById('cursorPos').textContent)).toBe('ln 2 · col 3');
    await page.evaluate(() => window.getActiveCmAdapter().setSelection({ start: 11 })); // 'j' on line 3
    await expect.poll(() => page.evaluate(() => document.getElementById('cursorPos').textContent)).toBe('ln 3 · col 2');
  });
});

test.describe('#5 the unsaved dot follows the text, not the edit history', () => {
  const dirty = (page) => page.evaluate(() => window._appState.files[0].dirty);
  const dot = (page) => page.evaluate(() => document.querySelector('.tab.active').classList.contains('dirty'));

  test('undo back to the saved text clears the dot; redo brings it back', async ({ page }) => {
    await boot(page);
    await setFiles(page, [{ name: 'u.md', content: 'saved text' }]);
    await page.waitForSelector('.cm-mount .cm-editor');
    await page.evaluate(() => { const a = window.getActiveCmAdapter(); a.setSelection({ start: 10 }); a.replaceSelection('!'); });
    await expect.poll(() => dirty(page)).toBe(true);
    expect(await dot(page)).toBe(true);
    await page.evaluate(() => window.getActiveCmAdapter().undo());
    await expect.poll(() => dirty(page)).toBe(false);
    expect(await dot(page)).toBe(false);
    await page.evaluate(() => window.getActiveCmAdapter().redo());
    await expect.poll(() => dirty(page)).toBe(true);
  });

  test('typing the original text back by hand also clears the dot', async ({ page }) => {
    await boot(page);
    await setFiles(page, [{ name: 'h.md', content: 'abc' }]);
    await page.waitForSelector('.cm-mount .cm-editor');
    await page.evaluate(() => { const a = window.getActiveCmAdapter(); a.setSelection({ start: 3 }); a.replaceSelection('d'); });
    await expect.poll(() => dirty(page)).toBe(true);
    await page.evaluate(() => { const a = window.getActiveCmAdapter(); a.setSelection({ start: 3, end: 4 }); a.replaceSelection(''); });
    await expect.poll(() => dirty(page)).toBe(false);
  });
});
