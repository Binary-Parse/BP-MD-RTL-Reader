// @ts-check
/**
 * r7-rtl-ui.spec.js — T-R7 full RTL/Arabic UI: the chrome mirrors (sidebar → right) and
 * localizes (en/ar) when the Arabic interface is on, via uiDirection/uiLocale; toggling
 * back restores the English chrome (incl. the accelerator <u> underlines).
 */
const { test, expect } = require('@playwright/test');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '../index.html');
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
    expect(await page.locator('.insp-title').textContent()).toBe('المعاينة');
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
    // No Latin leaks into the Arabic menu — except the acronyms that ARE the content (HTML/PDF).
    const leftover = names.map((n) => n.replace(/HTML|PDF/g, '')).join('');
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
    await page.waitForTimeout(80);
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
    expect(await page.locator('#findPrevBtn').getAttribute('title')).toBe('السابق');
    expect(await page.locator('#findCloseBtn').getAttribute('title')).toBe('إغلاق');
    // toggling back to English restores the originals exactly
    await page.evaluate(() => window.setArabicUI(false));
    expect(await page.locator('#findInput').getAttribute('placeholder')).toBe('Find in note…');
    expect(await page.locator('.welcome-card h1').textContent()).toContain('Welcome to');
    expect(await page.locator('#findNextBtn').getAttribute('title')).toBe('Next');
  });

  test('Arabic UI localizes the command palette (commands, sections, placeholder, footer)', async ({ page }) => {
    await page.evaluate(() => { window.setArabicUI(true); window.openPalette(); });
    await page.waitForTimeout(60);
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
    await page.waitForTimeout(60);
    const names = await page.locator('#palResults .pi-name').allTextContents();
    expect(names).toContain('Open Folder…');
    expect(names).toContain('Mode: Live preview');
    expect(await page.locator('#palResults .pal-section-label').first().textContent()).toBe('Files');
    expect(await page.locator('#palInput').getAttribute('placeholder')).toBe('Type a command, search files…');
  });

  test('[Visual] Arabic (RTL) chrome at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { window.loadDemo(); window.setArabicUI(true); });
    await page.waitForTimeout(250);
    await expect(page).toHaveScreenshot('rtl-ui-chrome-1440x900.png', { maxDiffPixels: 8000, threshold: 0.2 });
  });
});
