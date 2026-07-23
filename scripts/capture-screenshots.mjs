/**
 * capture-screenshots.mjs — regenerate the documentation screenshots in docs/assets/.
 *
 * Loads the renderer (index.html) headlessly via Playwright/Chromium, injects sample
 * English + Arabic notes through the same State proxy the e2e tests use, and captures
 * the three themes, RTL/Arabic rendering, the editor view, and the command palette.
 *
 *   node scripts/capture-screenshots.mjs
 *
 * Requires the Playwright Chromium browser (installed by `npm run postinstall`).
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fileUrl = 'file:///' + path.join(root, 'src', 'renderer', 'index.html').replace(/\\/g, '/');
const outDir = path.join(root, 'docs', 'assets');
mkdirSync(outDir, { recursive: true });

const ENGLISH = [
  '# The Slow Web',
  '',
  'Reading is an act of **attention**. In a world of infinite scroll, the page that',
  'asks you to *slow down* is a quiet act of resistance.',
  '',
  '> A good text is not read once — it is re-read.',
  '',
  '## Why plain text?',
  '',
  'Markdown keeps your words in plain `.md` files you own: no proprietary format,',
  'no lock-in, no telemetry.',
  '',
  '- Portable across every editor',
  '- Diff-friendly and future-proof',
  '- Yours, forever',
  '',
  '## At a glance',
  '',
  '| Capability        | Status |',
  '| ----------------- | ------ |',
  '| RTL + Arabic      | yes    |',
  '| Themes            | three  |',
  '| Telemetry         | none   |',
  '',
  'Tagged with #reading #focus.',
  '',
].join('\n');

const ARABIC = [
  '# مقالة في القراءة',
  '',
  'القراءة فعلٌ من أفعال **الانتباه**. في زمن التمرير اللانهائي، صار التأني نوعًا',
  'من المقاومة الهادئة.',
  '',
  '> النصّ الجيّد لا يُقرأ مرّة واحدة، بل يُعاد.',
  '',
  '## لماذا النص العادي؟',
  '',
  'تحفظ صيغة ماركداون كلماتك في ملفات نصّية تملكها أنت — بلا صيغة مغلقة ولا احتكار.',
  '',
  '- محمولة بين كل المحرّرات',
  '- صديقة لأنظمة المقارنة',
  '- مِلكُك إلى الأبد',
  '',
  'موسومة بـ #القراءة #تأمل',
  '',
].join('\n');

const shot = (page, name) =>
  page.screenshot({ path: path.join(outDir, name), animations: 'disabled' });

// --allow-file-access-from-files lets the file:// page import its ES modules
// (src/renderer/*.js) — the same flag playwright.config.js uses for the e2e suite.
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 850 }, deviceScaleFactor: 2 });
await page.goto(fileUrl);
await page.waitForSelector('.app', { state: 'visible' });
await page.waitForLoadState('networkidle');
// Wait for the renderer module to expose its debug hooks before injecting content.
await page.waitForFunction(
  () => !!window._appState && typeof window.renderFile === 'function',
  null,
  { timeout: 20000 },
);

await page.evaluate(({ en, ar }) => {
  const s = window._appState;
  s.files = [
    { name: 'the-slow-web.md', path: 'the-slow-web.md', handle: null, content: en, dirty: false },
    { name: 'مقالة-القراءة.md', path: 'مقالة-القراءة.md', handle: null, content: ar, dirty: false },
  ];
  window.renderFile(0);
}, { en: ENGLISH, ar: ARABIC });
// Hide transient toast notifications so they never pollute a screenshot.
await page.addStyleTag({ content: '#toast{opacity:0!important;visibility:hidden!important}' });
await page.waitForTimeout(600);

// Themes (default is paper). #themeBtn cycles paper -> ink -> sepia -> paper.
await shot(page, 'theme-paper.png');
await page.click('#themeBtn'); await page.waitForTimeout(450);
await shot(page, 'theme-ink.png');
await page.click('#themeBtn'); await page.waitForTimeout(450);
await shot(page, 'theme-sepia.png');
await page.click('#themeBtn'); await page.waitForTimeout(450); // back to paper

// RTL / Arabic: the Arabic-heavy note auto-detects and flips to RTL on render
// (no manual toggle — that would turn it back off).
await page.evaluate(() => window.renderFile(1));
await page.waitForTimeout(700);
await shot(page, 'rtl-arabic.png');

// Editor view on the English note (auto-detects LTR).
await page.evaluate(() => window.renderFile(0));
await page.waitForTimeout(500);
await shot(page, 'editor.png');

// Command palette.
await page.keyboard.press('Control+k'); await page.waitForTimeout(400);
await shot(page, 'command-palette.png');
await page.keyboard.press('Escape');

await browser.close();
console.log('Screenshots written to docs/assets/: theme-paper, theme-ink, theme-sepia, rtl-arabic, editor, command-palette');
