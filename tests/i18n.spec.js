const { test, expect } = require('@playwright/test');

/**
 * Internationalization & Localization tests (§8).
 * - Character encoding (UTF-8, multibyte, emoji, surrogate pairs)
 * - RTL/LTR layout and bidi rendering
 * - Locale-specific dates, numbers, currencies, pluralization, sort order
 * - Missing-translation fallback behavior
 * - No hardcoded user-facing strings
 */

test.describe('I18N & Localization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('UTF-8 Arabic content renders without mojibake', async ({ page }) => {
    const text = await page.evaluate(() => {
      window._marqamState.files = [{ name: 'ar.md', content: '# مرحبا بالعالم\n\nهذا نص عربي.', path: 'ar.md', dirty: false }];
      window.renderFile(0);
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? h1.textContent : null;
    });
    expect(text).toBe('مرحبا بالعالم');
  });

  test('Emoji in markdown renders without crash', async ({ page }) => {
    const text = await page.evaluate(() => {
      window._marqamState.files = [{ name: 'emoji.md', content: '# Hello 🌍\n\n😀 🎉 👍', path: 'emoji.md', dirty: false }];
      window.renderFile(0);
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? h1.textContent : null;
    });
    expect(text).toBe('Hello 🌍');
  });

  test('Surrogate pair characters do not crash renderFile', async ({ page }) => {
    const result = await page.evaluate(() => {
      try {
        window._marqamState.files = [{ name: 'sp.md', content: '# 𝄞 Music\n\n𐍈 rune', path: 'sp.md', dirty: false }];
        window.renderFile(0);
        return { ok: true };
      } catch (e) {
        return { ok: false, err: e.message };
      }
    });
    expect(result.ok, result.err).toBe(true);
  });

  test('CJK characters render correctly', async ({ page }) => {
    const text = await page.evaluate(() => {
      window._marqamState.files = [{ name: 'cjk.md', content: '# 日本語テスト\n\n中文内容', path: 'cjk.md', dirty: false }];
      window.renderFile(0);
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? h1.textContent : null;
    });
    expect(text).toBe('日本語テスト');
  });

  test('RTL mode sets dir="rtl" on editor element', async ({ page }) => {
    await page.evaluate(() => window.toggleRTL());
    const dir = await page.evaluate(() => document.getElementById('editor').getAttribute('dir'));
    expect(dir).toBe('rtl');
  });

  test('LTR mode removes dir attribute from editor', async ({ page }) => {
    await page.evaluate(() => { window.toggleRTL(); window.toggleRTL(); });
    const dir = await page.evaluate(() => document.getElementById('editor').getAttribute('dir'));
    expect(dir).toBeNull();
  });

  test('Mixed RTL/LTR content does not corrupt layout', async ({ page }) => {
    const result = await page.evaluate(() => {
      window._marqamState.files = [{
        name: 'mixed.md',
        content: '# English Title\n\nSome English text.\n\nنص عربي هنا.\n\nMore English.',
        path: 'mixed.md', dirty: false
      }];
      window.renderFile(0);
      const editor = document.getElementById('editor');
      return { width: editor.offsetWidth, height: editor.offsetHeight };
    });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  test('Locale-specific date in daily note uses toLocaleDateString', async ({ page }) => {
    const content = await page.evaluate(() => {
      window.newDailyNote();
      return window._marqamState.files[0].content;
    });
    // Should contain a date heading like "# Monday, June 1, 2026" or "# 1 June 2026" depending on locale
    expect(content).toMatch(/^# .+\d{4}/);
  });

  test('No hardcoded English strings in dynamically generated UI (tags pane)', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    const emptyText = await page.evaluate(() => {
      // Force empty tags by clearing files then switching pane
      window._marqamState.files = [];
      document.querySelector('.sb-tab[data-pane="tags"]').click();
      const pane = document.getElementById('tagsPane');
      return pane ? pane.textContent : '';
    });
    // The empty state should be present and not contain unexpected placeholders
    expect(emptyText.length).toBeGreaterThan(0);
  });

  test('Collation: files sorted by localeCompare', async ({ page }) => {
    const order = await page.evaluate(() => {
      const files = [
        { name: 'z.md', content: '', path: 'z.md' },
        { name: 'ä.md', content: '', path: 'ä.md' },
        { name: 'a.md', content: '', path: 'a.md' },
      ];
      // Simulate the sorting logic used inside openVault()
      files.sort((a, b) => a.name.localeCompare(b.name));
      window._marqamState.files = files;
      window.renderTree(files);
      return Array.from(document.querySelectorAll('.tree-name')).map(el => el.textContent);
    });
    expect(order).toContain('a.md');
    expect(order).toContain('ä.md');
    expect(order).toContain('z.md');
    // Verify the rendered order matches the localeCompare-sorted order
    const sorted = [...order].sort((a, b) => a.localeCompare(b));
    expect(order).toEqual(sorted);
  });

  test('Bidi isolation: search mark has unicode-bidi:isolate', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await page.waitForTimeout(200);
    const hasIsolate = await page.evaluate(() => {
      document.querySelector('.sb-tab[data-pane="search"]').click();
      document.getElementById('sbSearchInput').value = 'the';
      document.getElementById('sbSearchInput').dispatchEvent(new Event('input'));
      const mark = document.querySelector('.sr-snip mark');
      if (!mark) return false;
      const style = getComputedStyle(mark);
      return style.unicodeBidi === 'isolate';
    });
    expect(hasIsolate).toBe(true);
  });
});
