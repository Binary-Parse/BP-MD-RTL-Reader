'use strict';

/**
 * linux-smoke.js — start a packaged Linux build and prove the main flow works (audit B11).
 *
 *   node tests/packaged/linux-smoke.js dist/linux-unpacked/bpmdrtlreader
 *
 * Needs a display (WSLg, X11 or Wayland). It starts the real packaged binary three times, each
 * with its own empty profile, and drives the window over the Chromium DevTools protocol:
 *   1. a note passed by path opens and is rendered;
 *   2. text typed into it is written to the file by Ctrl+S;
 *   3. a note passed as a file:// URL (the `%U` of the .desktop entry) opens;
 *   4. no spellchecker dictionary was downloaded into any of the profiles (audit M38).
 * Exits non-zero on the first step that fails.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const PORT = 9333;
const MARK = 'typed by the smoke test';

async function withApp(binary, profile, noteArgument, run) {
  const child = spawn(binary, [`--remote-debugging-port=${PORT}`, noteArgument], {
    env: { ...process.env, XDG_CONFIG_HOME: profile }, stdio: 'ignore',
  });
  let browser = null;
  try {
    const deadline = Date.now() + 30000;
    while (!browser) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch (error) {
        if (Date.now() > deadline) throw new Error(`the app did not start: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    const page = browser.contexts()[0].pages()[0];
    await page.waitForSelector('#noteContent h1', { timeout: 20000 });
    return await run(page);
  } finally {
    if (browser) await browser.close().catch(() => {});
    child.kill();
    await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); });
  }
}

async function main() {
  const binary = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || !fs.existsSync(binary)) throw new Error('usage: node tests/packaged/linux-smoke.js <path to the packaged binary>');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-smoke-'));
  const byPath = path.join(work, 'by-path.md');
  const byUrl = path.join(work, 'by url ملف.md');
  fs.writeFileSync(byPath, '# Opened by path\n\nfirst line\n');
  fs.writeFileSync(byUrl, '# Opened by URL\n\nمرحبا\n');
  const profile = (name) => { const dir = path.join(work, name); fs.mkdirSync(dir); return dir; };

  const heading = await withApp(binary, profile('p1'), byPath, (page) => page.textContent('#noteContent h1'));
  if (heading.trim() !== 'Opened by path') throw new Error(`open by path: the window shows "${heading}"`);
  console.log('ok  1/4 a note passed by path opens');

  await withApp(binary, profile('p2'), byPath, async (page) => {
    await page.evaluate(() => window.setViewMode('edit'));
    await page.click('.cm-content');
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`\n${MARK}\n`);
    await page.keyboard.press('Control+s');
    const deadline = Date.now() + 10000;
    while (!fs.readFileSync(byPath, 'utf8').includes(MARK)) {
      if (Date.now() > deadline) throw new Error('save: the typed text is not in the file 10 s after Ctrl+S');
      await page.waitForTimeout(200);
    }
  });
  const saved = fs.readFileSync(byPath, 'utf8');
  if (!saved.startsWith('# Opened by path\n\nfirst line\n')) throw new Error(`save: the original text changed: ${JSON.stringify(saved)}`);
  console.log('ok  2/4 typed text is saved to the file by Ctrl+S');

  const urlHeading = await withApp(binary, profile('p3'), pathToFileURL(byUrl).href, (page) => page.textContent('#noteContent h1'));
  if (urlHeading.trim() !== 'Opened by URL') throw new Error(`open by file:// URL: the window shows "${urlHeading}"`);
  console.log('ok  3/4 a note passed as a file:// URL opens');

  // audit M38: the first packaged 2.0.0 build wrote Dictionaries/en-US-10-1.bdic into a new
  // profile a few seconds after it started, with the spellchecker disabled. Give the app the
  // time it needed, then look in every profile of this run.
  await withApp(binary, profile('p4'), byPath, (page) => page.waitForTimeout(12000));
  const dictionaries = fs.readdirSync(work, { recursive: true }).map(String).filter((name) => /\.bdic$/i.test(name));
  if (dictionaries.length) throw new Error(`a spellchecker dictionary was downloaded: ${dictionaries.join(', ')}`);
  console.log('ok  4/4 no spellchecker dictionary was downloaded');

  fs.rmSync(work, { recursive: true, force: true });
}

main().catch((error) => { console.error(`FAILED: ${error.message}`); process.exit(1); });
