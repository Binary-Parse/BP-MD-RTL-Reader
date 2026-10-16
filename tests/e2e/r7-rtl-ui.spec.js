// @ts-check
/**
 * r7-rtl-ui.spec.js — T-R7 full RTL/Arabic UI: the chrome mirrors (sidebar → right) and
 * localizes (en/ar) when the Arabic interface is on, via uiDirection/uiLocale; toggling
 * back restores the English chrome (incl. the accelerator <u> underlines).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../../src/renderer/index.html');
const INDEX_URL = `file:///${INDEX_PATH.replace(/\\/g, '/')}`;

const xOf = (page, sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().x, sel);

test.describe('[T-R7] full RTL/Arabic UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(INDEX_URL);
    await page.waitForSelector('#app', { state: 'visible' });
  });

  test('default UI is LTR + English (sidebar on the left; menus say File/Edit/View/Help)', async ({ page }) => {
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).not.toBe('rtl');
    expect(await xOf(page, '.sidebar')).toBeLessThan(await xOf(page, '.inspector')); // sidebar left of inspector
    expect(await page.locator('.tb-menu-item[data-menu="file"]').textContent()).toContain('File');
  });

  test('Arabic UI mirrors the layout (sidebar → right) and localizes the chrome', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('rtl');
    expect(await xOf(page, '.sidebar')).toBeGreaterThan(await xOf(page, '.inspector')); // mirrored
    expect(await page.locator('.tb-menu-item[data-menu="file"]').textContent()).toBe('ملف');
    expect(await page.locator('.tb-menu-item[data-menu="view"]').textContent()).toBe('عرض');
    expect(await page.locator('.sb-tab[data-pane="files"]').textContent()).toBe('الملفات');
    expect(await page.evaluate(() => window._appState.uiLocale)).toBe('ar');
  });

  test('Arabic UI localizes the inspector + status chrome', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    expect(await page.locator('.insp-title').textContent()).toBe('المُعايِن');
    expect(await page.locator('.insp-section h4[data-i18n="panel.outline"]').textContent()).toBe('المخطّط');
    expect(await page.locator('.prop-key[data-i18n="prop.file"]').textContent()).toBe('الملف');
    expect(await page.locator('.prop-key[data-i18n="prop.direction"]').textContent()).toBe('الاتجاه');
    expect(await page.locator('[data-i18n="status.markdown"]').textContent()).toBe('ماركداون');
    // back to English
    await page.evaluate(() => window.setArabicUI(false));
    expect(await page.locator('.insp-title').textContent()).toBe('Inspector');
    expect(await page.locator('.prop-key[data-i18n="prop.file"]').textContent()).toBe('File');
  });

  test('toggling back to English restores the chrome incl. the accelerator underline', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    await page.evaluate(() => window.setArabicUI(false));
    expect(await page.evaluate(() => document.documentElement.getAttribute('dir'))).toBe('ltr');
    expect(await xOf(page, '.sidebar')).toBeLessThan(await xOf(page, '.inspector'));
    // The <u>F</u>ile accelerator markup is restored (not flattened to plain text).
    expect(await page.locator('.tb-menu-item[data-menu="file"]').innerHTML()).toContain('<u>F</u>');
    expect(await page.locator('.sb-tab[data-pane="files"]').textContent()).toBe('Files');
  });

  test('Arabic UI localizes the dropdown MENU items (File menu)', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    await page.locator('.tb-menu-item[data-menu="file"]').click();
    const names = await page.locator('#dropdown .dd-name').allTextContents();
    expect(names).toContain('ملاحظة جديدة');        // New Note → Arabic
    expect(names).toContain('فتح مجلد…');            // Open Folder… (ellipsis preserved)
    // No Latin leaks into the Arabic menu — except the acronyms that ARE the content
    // (HTML / PDF / EPUB are format names, not untranslated English).
    const leftover = names.map((n) => n.replace(/HTML|PDF|EPUB/g, '')).join('');
    expect(/[A-Za-z]/.test(leftover)).toBe(false);
  });

  test('English MENU items are unchanged by default (exact strings incl. ellipsis)', async ({ page }) => {
    await page.locator('.tb-menu-item[data-menu="file"]').click();
    const names = await page.locator('#dropdown .dd-name').allTextContents();
    expect(names).toContain('Open Folder…');         // dedicated key preserves the exact string
    expect(names).toContain('Export PDF');
  });

  test('English note CONTENT stays LTR even when the UI is Arabic/RTL (no leak)', async ({ page }) => {
    await page.evaluate(() => {
      window.setArabicUI(true); // chrome → rtl
      window._appState.files = [{ name: 'e.md', path: 'e.md', content: '# English heading\n\nA plain English paragraph that must read left-to-right.\n', dirty: false }];
      window.renderFile(0);
    });
    const dir = await page.evaluate(() => ({
      editor: getComputedStyle(document.getElementById('editor')).direction,
      para: getComputedStyle(document.querySelector('#noteContent p')).direction,
    }));
    expect(dir.editor).toBe('ltr'); // content anchored LTR, independent of the RTL chrome
    expect(dir.para).toBe('ltr');
  });

  test('Arabic UI localizes the welcome screen (title, buttons, lede markup, recent)', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    expect(await page.locator('.welcome-card h1').textContent()).toContain('مرحبًا');
    expect(await page.locator('.welcome-card h1 em').textContent()).toBe('BP MD RTL Reader'); // brand stays Latin
    expect(await page.locator('[data-i18n="welcome.openFolder"]').textContent()).toBe('فتح مجلد');
    expect(await page.locator('[data-i18n="welcome.tryDemo"]').textContent()).toBe('جرّب العرض');
    expect(await page.locator('[data-i18n="welcome.recent"]').textContent()).toBe('الأخيرة');
    // the lede keeps its inline <code>.md</code> after the HTML-aware swap
    expect(await page.locator('.welcome-card .lede code').textContent()).toBe('.md');
    expect(await page.locator('.welcome-card .lede').textContent()).toContain('قارئ ماركداون');
    // no Latin leak in a localized button label
    expect(/[A-Za-z]/.test(await page.locator('[data-i18n="welcome.openFile"]').textContent())).toBe(false);
  });

  test('Arabic UI localizes the find + search placeholders and find-button tooltips', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    expect(await page.locator('#findInput').getAttribute('placeholder')).toBe('بحث في الملاحظة…');
    expect(await page.locator('#sbSearchInput').getAttribute('placeholder')).toBe('بحث في كل الملفات…');
    expect(await page.locator('.tb-search [data-i18n="titlebar.search"]').textContent()).toBe('بحث في الملفات…');
    expect(await page.locator('#findPrevBtn').getAttribute('data-tip')).toBe('السابق');
    expect(await page.locator('#findCloseBtn').getAttribute('data-tip')).toBe('إغلاق');
    // toggling back to English restores the originals exactly
    await page.evaluate(() => window.setArabicUI(false));
    expect(await page.locator('#findInput').getAttribute('placeholder')).toBe('Find in note…');
    expect(await page.locator('.welcome-card h1').textContent()).toContain('Welcome to');
    expect(await page.locator('#findNextBtn').getAttribute('data-tip')).toBe('Next');
  });

  test('Arabic UI localizes the command palette (commands, sections, placeholder, footer)', async ({ page }) => {
    await page.evaluate(() => { window.setArabicUI(true); window.openPalette(); });
    expect(await page.locator('#palInput').getAttribute('placeholder')).toBe('اكتب أمرًا أو ابحث في الملفات…');
    expect(await page.locator('[data-i18n="palette.navigate"]').textContent()).toBe('تنقّل');
    const names = await page.locator('#palResults .pi-name').allTextContents();
    expect(names).toContain('فتح مجلد…');        // Open Folder…
    expect(names).toContain('السمة: ورقي');       // Theme: Paper
    expect(names).not.toContain('Open Folder…');  // English is gone
    expect(names).not.toContain('Theme: Paper');
    // Latin acronyms/brand stay verbatim INSIDE Arabic command names
    expect(names).toContain('تصدير HTML');
    expect(await page.locator('#palResults .pal-section-label').first().textContent()).toBe('الملفات');
  });

  test('the default English palette is unchanged (en keys match verbatim)', async ({ page }) => {
    await page.evaluate(() => window.openPalette());
    const names = await page.locator('#palResults .pi-name').allTextContents();
    expect(names).toContain('Open Folder…');
    // (the 'Mode: …' palette entries were removed with the view modes — T-F13)
    expect(await page.locator('#palResults .pal-section-label').first().textContent()).toBe('Files');
    expect(await page.locator('#palInput').getAttribute('placeholder')).toBe('Type a command, search files…');
  });

  test('[Visual] Arabic (RTL) chrome at 1440x900 @visual', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      window.loadDemo();
      window.setArabicUI(true);
      // T-F13: reveal the rendered preview (hidden behind cm-single) so the chrome shot keeps
      // showing rendered content rather than the CM6 source surface.
      document.getElementById('editorArea').classList.remove('cm-single', 'welcome');
    });
    await expect(page).toHaveScreenshot('rtl-ui-chrome-1440x900.png', { maxDiffPixels: 8000, threshold: 0.2 });
  });

  test('M21: the theme and the folder state are named in Arabic', async ({ page }) => {
    const labels = () => page.evaluate(() => ({
      theme: document.getElementById('themeLabel').textContent,
      folder: document.getElementById('sbVault').textContent,
    }));
    expect(await labels()).toEqual({ theme: 'paper', folder: 'no folder' });
    await page.evaluate(() => window.setArabicUI(true));
    expect(await labels()).toEqual({ theme: 'ورقي', folder: 'لا مجلد' });

    await page.evaluate(() => window.cycleTheme());
    expect((await labels()).theme).toBe('حبر');
    await expect(page.locator('.toast').last()).toHaveText('السمة: حبر');

    // Back to English: the id-like names of before, and the capitalised name in the toast.
    await page.evaluate(() => window.setArabicUI(false));
    expect(await labels()).toEqual({ theme: 'ink', folder: 'no folder' });
    await page.evaluate(() => window.cycleTheme());
    await expect(page.locator('.toast').last()).toHaveText('Theme: Sepia');
  });

  test('M21: a callout with no title is named in the language of the callout, not of the interface', async ({ page }) => {
    await page.evaluate(() => {
      window._appState.files = [{ name: 'c.md', path: 'c.md', handle: null, dirty: false,
        content: '> [!NOTE]\n> هذه ملاحظة عربية قصيرة\n\n> [!WARNING]\n> An English warning\n' }];
      window.renderFile(0);
    });
    const titles = () => page.locator('#noteContent .callout-title-text').allTextContents();
    expect(await titles()).toEqual(['ملاحظة', 'Warning']);
    await page.evaluate(() => window.setArabicUI(true));
    expect(await titles()).toEqual(['ملاحظة', 'Warning']);
  });

  test('M17: a file name keeps its own reading order in the Arabic UI', async ({ page }) => {
    await page.evaluate(() => window.setArabicUI(true));
    const order = (name) => page.evaluate((fileName) => {
      window._appState.files.push({ name: fileName, path: fileName, handle: null, content: '# x', dirty: false, open: true });
      window.renderFile(window._appState.files.length - 1);
      const edges = (el) => {
        const text = el.firstChild;
        const at = (i) => { const r = document.createRange(); r.setStart(text, i); r.setEnd(text, i + 1); return r.getBoundingClientRect().x; };
        return at(0) < at(text.length - 1) ? 'first-on-left' : 'first-on-right';
      };
      return { tab: edges(document.querySelector('.tab.active .tab-name')), inspector: edges(document.querySelector('#propFile')) };
    }, name);
    // Was drawn as md.2026-10-10: the digits and the extension changed places.
    expect(await order('2026-10-10.md')).toEqual({ tab: 'first-on-left', inspector: 'first-on-left' });
    expect(await order('ملاحظة.md')).toEqual({ tab: 'first-on-right', inspector: 'first-on-right' });
  });
});
