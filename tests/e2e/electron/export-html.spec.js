// @ts-check
/**
 * export-html.spec.js (Electron lane) — audit H1 end to end. The real app runs under
 * `require-trusted-types-for 'script'`, so any string handed to DOMParser is sanitized as a
 * fragment by the default policy. The export used to re-parse its finished document on the
 * math/Mermaid path and lost <html lang/dir>, <meta charset>, the CSP meta and <title>. No unit
 * or file:// lane has that policy, so this is the only place the regression is observable.
 *
 * The native save dialog is answered in the MAIN process; everything else is the production
 * path (audit L3: main writes the file, the page reports only what main answers).
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');

const MATH_NOTE = [
  '# ملاحظة رياضية',
  '',
  'هذه فقرة عربية تشرح المعادلة التالية بما يكفي من النص ليكون المستند عربيًا.',
  '',
  '$E = mc^2$',
  '',
  '$$\\int_0^1 x^2 \\, dx$$',
  '',
].join('\n');

test.describe('HTML export @electron', () => {
  let electronApp;
  let page;
  let tempRoot;
  let htmlPath;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-html-test-'));
    const profile = path.join(tempRoot, 'profile');
    const notePath = path.join(tempRoot, 'math.md');
    htmlPath = path.join(tempRoot, 'math.html');
    fs.mkdirSync(profile);
    fs.writeFileSync(notePath, MATH_NOTE, 'utf8');

    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile, ROOT, notePath],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
        ELECTRON_ENABLE_LOGGING: '0',
      },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window._appState && window._appState.files.length > 0, null, { timeout: 10000 });
    await electronApp.evaluate(({ dialog, session }, savePath) => {
      global.__downloads = 0;
      session.defaultSession.on('will-download', () => { global.__downloads += 1; });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: savePath });
    }, htmlPath);
  });

  test.afterEach(async () => {
    if (electronApp) {
      if (page && !page.isClosed()) await page.evaluate(() => window.electronAPI.closeWindow());
      await electronApp.close();
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('a math note exports a complete standalone document', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#noteContent .katex').length >= 2, null, { timeout: 10000 });
    const returned = await page.evaluate(() => window.exportHTML());
    // audit L3: the file is on disk by the time the page is answered, and the toast follows.
    expect(fs.existsSync(htmlPath)).toBe(true);
    const saved = fs.readFileSync(htmlPath, 'utf8');
    expect(saved).toBe(returned);
    expect(saved.length).toBeGreaterThan(1000);
    await expect(page.locator('#toast')).toContainText('Exported math.html');
    expect(await electronApp.evaluate(() => global.__downloads)).toBe(0);

    expect(saved.startsWith('<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="UTF-8">')).toBe(true);
    expect(saved).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
    expect(saved).toContain('<title>math</title>');
    // The vendored KaTeX stylesheet rides along (font faces stripped), so each formula
    // renders once: the span copy is styled and the MathML copy is hidden by that CSS.
    const head = saved.slice(0, saved.indexOf('</head>'));
    expect(head).toContain('.katex');
    expect(saved).not.toContain('@font-face');
    expect((saved.match(/class="katex-html"/g) || []).length).toBe(2);
    expect(saved).toContain('ملاحظة رياضية');
  });

  test('[L3] a cancelled save dialog writes nothing and says nothing', async () => {
    await electronApp.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
    });
    await page.evaluate(() => window.exportHTML());
    expect(fs.existsSync(htmlPath)).toBe(false);
    await expect(page.locator('#toast')).not.toContainText('Exported');
    expect(fs.readdirSync(tempRoot).filter((name) => name.endsWith('.html'))).toEqual([]);
  });
});
