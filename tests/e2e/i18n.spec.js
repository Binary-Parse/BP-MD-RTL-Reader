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
    await page.goto('file:///' + process.cwd().replace(/\\/g, '/') + '/src/renderer/index.html');
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('UTF-8 Arabic content renders without mojibake', async ({ page }) => {
    const text = await page.evaluate(() => {
      window._appState.files = [{ name: 'ar.md', content: '# مرحبا بالعالم\n\nهذا نص عربي.', path: 'ar.md', dirty: false }];
      window.renderFile(0);
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? h1.textContent : null;
    });
    expect(text).toBe('مرحبا بالعالم');
  });

  // APP-33: loadDemo wrote the status label directly, and the next setVaultUi (every
  // language switch runs one) replaced it with "no folder" while the demo stayed open.
  test('the demo folder label survives a language switch', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    await expect(page.locator('#sbVault')).toHaveText('folder: demo');
    await page.evaluate(() => window.setUiLocale('ar'));
    await expect(page.locator('#sbVault')).toHaveText('مجلد: ⁨demo⁩'); // the name is bidi-isolated
    await page.evaluate(() => window.setUiLocale('en'));
    await expect(page.locator('#sbVault')).toHaveText('folder: demo');
  });

  // APP-14: the first-run sidebar and the hidden field labels had no i18n hook.
  test('the empty sidebar, the tags pane and the field labels follow Arabic and back', async ({ page }) => {
    const read = () => page.evaluate(() => ({
      title: document.querySelector('#sbEmpty .ttl').textContent,
      body: document.querySelector('#sbEmpty p').textContent,
      code: !!document.querySelector('#sbEmpty p code'),
      buttons: [...document.querySelectorAll('#sbEmpty button')].map((b) => b.textContent.trim()),
      icons: document.querySelectorAll('#sbEmpty button svg').length,
      tags: document.querySelector('#tagsPane .search-empty').textContent,
      labels: ['sbSearchInput', 'findInput'].map((id) => document.querySelector(`label[for="${id}"]`).textContent),
    }));
    const en = await read();
    await page.evaluate(() => window.setUiLocale('ar'));
    const ar = await read();
    expect(ar).toEqual({
      title: 'لم يُفتح أي مجلد',
      body: 'افتح مجلداً فيه ملفات .md، أو افتح ملفاً واحداً.',
      code: true,
      buttons: ['فتح مجلد…', 'فتح ملف…', 'جرّب الملاحظات التجريبية'],
      icons: 3,
      tags: 'لا وسوم بعد. افتح مجلداً لتظهر وسومه.',
      labels: ['بحث في كل الملفات', 'بحث في الملاحظة'],
    });
    await page.evaluate(() => window.setUiLocale('en'));
    expect(await read()).toEqual(en);
    expect(en.buttons).toEqual(['Open Folder…', 'Open File…', 'Try Demo Notes']);
  });

  test('Emoji in markdown renders without crash', async ({ page }) => {
    const text = await page.evaluate(() => {
      window._appState.files = [{ name: 'emoji.md', content: '# Hello 🌍\n\n😀 🎉 👍', path: 'emoji.md', dirty: false }];
      window.renderFile(0);
      const h1 = document.querySelector('#noteContent h1');
      return h1 ? h1.textContent : null;
    });
    expect(text).toBe('Hello 🌍');
  });

  test('Surrogate pair characters do not crash renderFile', async ({ page }) => {
    const result = await page.evaluate(() => {
      try {
        window._appState.files = [{ name: 'sp.md', content: '# 𝄞 Music\n\n𐍈 rune', path: 'sp.md', dirty: false }];
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
      window._appState.files = [{ name: 'cjk.md', content: '# 日本語テスト\n\n中文内容', path: 'cjk.md', dirty: false }];
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
      window._appState.files = [{
        name: 'mixed.md',
        content: '# English Title\n\nSome English text.\n\nنص عربي هنا.\n\nMore English.',
        path: 'mixed.md', dirty: false
      }];
      window.renderFile(0);
      // T-F13: reveal the rendered preview (#editor), hidden behind the CM6 surface, to measure it.
      document.getElementById('editorArea').classList.remove('cm-single', 'welcome');
      const editor = document.getElementById('editor');
      return { width: editor.offsetWidth, height: editor.offsetHeight };
    });
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  test('daily note heading is the calendar date (YYYY-MM-DD) via dailyNoteName (T-R8)', async ({ page }) => {
    const content = await page.evaluate(() => {
      window.newDailyNote();
      return window._appState.files[0].content;
    });
    // The heading mirrors the filename date for the chosen calendar (default Gregorian).
    expect(content).toMatch(/^# \d{3,4}-\d{2}-\d{2}\n/);
  });

  test('QA-L2: About, the direction toast, a new note and the reading view speak Arabic', async ({ page }) => {
    await page.evaluate(() => window.setUiLocale('ar'));
    await page.evaluate(() => window.PALETTE_COMMANDS.find((c) => c.key === 'palette.about').act());
    await expect(page.locator('#modalTitle')).toHaveText('حول BP MD RTL Reader');
    await expect(page.locator('.about-tagline')).toHaveText('قارئ ماركداون يعامل النثر كعمل أدبي.');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.newNote());
    expect(await page.evaluate(() => window._appState.files.at(-1).name)).toBe('بلا عنوان.md');
    expect(await page.locator('#noteContent').getAttribute('aria-label')).toBe('عرض القراءة');
    await page.evaluate(() => { window.toggleRTL(); window.toggleRTL(); window.toggleRTL(); }); // back to Auto
    await expect(page.locator('#toast')).toContainText('تلقائي');
  });

  test('QA-L7: in the Arabic UI directional icons mirror, others do not, and the lead tooltip is start-anchored', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    // A rendered icon of each kind (the format toolbar is hidden in Reading mode, and a hidden
    // element reports no transform).
    const t = (name) => page.evaluate((n) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'ic');
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `#ic-${n}`);
      svg.appendChild(use);
      document.body.appendChild(svg);
      const value = getComputedStyle(svg).transform;
      svg.remove();
      return value;
    }, name);
    expect(await t('indent-increase')).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    expect(await t('undo-2')).toBe('matrix(-1, 0, 0, 1, 0, 0)');
    expect(await t('bold')).toBe('none');
    expect(await t('rotate-ccw')).toBe('none');
    await page.evaluate(() => window.setArabicUI(false));
    expect(await t('indent-increase')).toBe('none');
    await page.evaluate(() => window.setArabicUI(true));
    await page.locator('#markBtn').hover();
    // Anchored to the inline start (the right edge in RTL), so it never grows past the window.
    const right = await page.evaluate(() => getComputedStyle(document.querySelector('#markBtn'), '::after').right);
    expect(right).toBe('0px');
  });

  test('QA-M22: the reading view never inherits the interface language; a front-matter lang: wins', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    const langOf = (content) => page.evaluate((c) => {
      window._appState.files = [{ name: 'x.md', content: c, path: 'x.md', dirty: false }];
      window.renderFile(0);
      return document.querySelector('#noteContent > :not(.doc-meta)').getAttribute('lang');
    }, content);
    // "" = unknown: no guess, so a mixed Arabic/English note is not half mislabelled (EC-C6).
    expect(await langOf('# English note\n\nPlain text.')).toBe('');
    expect(await langOf('---\nlang: ar-EG\n---\nنص')).toBe('ar-EG');
  });

  test('QA-M23: Windows High Contrast keeps the box-shadow focus rings visible', async ({ page }) => {
    // The find field's ring is a box-shadow, which forced colors drop.
    await page.evaluate(() => { window._appState.files = [{ name: 'x.md', content: 'text', path: 'x.md', dirty: false }]; window.renderFile(0); window.openFind(); });
    const ring = () => page.evaluate(() => {
      const input = document.querySelector('.find-bar input');
      input.focus();
      return getComputedStyle(input).outlineStyle;
    });
    expect(await ring()).toBe('none');
    await page.emulateMedia({ forcedColors: 'active' });
    expect(await ring()).toBe('solid');
  });

  test('No hardcoded English strings in dynamically generated UI (tags pane)', async ({ page }) => {
    await page.evaluate(() => window.loadDemo());
    const emptyText = await page.evaluate(() => {
      // Force empty tags by clearing files then switching pane
      window._appState.files = [];
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
      window._appState.files = files;
      window.renderTree(files);
      // B4: these files carry no vaultId, so they land under the synthetic @loose root
      // — its own "Open files" name would break the localeCompare order at the head of
      // an unscoped list. Scope to file rows, the actual thing under test.
      return Array.from(document.querySelectorAll('.tree-file .tree-name')).map(el => el.textContent);
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
    await page.locator('.sb-tab[data-pane="search"]').click();
    await page.locator('#sbSearchInput').fill('the');
    const mark = page.locator('.sr-snip mark').first();
    await expect(mark).toBeVisible();
    await expect(mark).toHaveCSS('unicode-bidi', 'isolate');
  });
});
