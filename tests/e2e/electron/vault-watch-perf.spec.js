// @ts-check
/**
 * vault-watch-perf.spec.js — H15: every file event used to re-read the whole folder.
 *
 * Real Electron, real files on disk, a folder of 500 notes. The main process' own `fs.promises`
 * is instrumented from the test so the numbers are observed, not assumed:
 *   - "full re-reads" = readdir() of the vault ROOT (every fs:readVault starts with exactly one)
 *   - "files re-read" = readFile() of a .md inside the vault (one per note decoded)
 *   - "events"        = vault:changed notifications that reach the renderer
 *
 * Requirements (from the audit, not from the code):
 *   1. one save made BY THE APP causes no vault:changed event, no full re-read, no file re-read;
 *   2. an EXTERNAL edit is still picked up, and re-reads only the file that changed;
 *   3. an external edit made right after an own save is never hidden;
 *   4. an external delete still removes the note from the tree (marked missing, tab kept).
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const { closeApp } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const NOTE_COUNT = 500;
// trailing debounce 300 ms, max-wait 2 s: wait comfortably longer than both
const SETTLE_MS = 3500; // deliberate windows: they prove that no event or re-read arrives

test.describe('vault watcher cost against real Electron @electron', () => {
  let electronApp;
  let page;
  let tempRoot;
  let folder;

  test.beforeEach(async () => {
    test.setTimeout(90000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-watch-perf-'));
    folder = path.join(tempRoot, 'Big');
    fs.mkdirSync(folder);
    for (let d = 0; d < 10; d++) {
      const dir = path.join(folder, `topic-${d}`);
      fs.mkdirSync(dir);
      for (let i = 0; i < NOTE_COUNT / 10; i++) {
        fs.writeFileSync(path.join(dir, `note-${i}.md`), `# Note ${d}-${i}\n\nbody ${d}-${i}\n`, 'utf8');
      }
    }
    // noise a note-taking folder really has: a .git directory and a non-note file
    fs.mkdirSync(path.join(folder, '.git'));
    fs.writeFileSync(path.join(folder, '.git', 'index'), 'x', 'utf8');
    fs.writeFileSync(path.join(folder, 'image.png'), 'png', 'utf8');
    fs.writeFileSync(path.join(folder, 'note.md'), '# original\n', 'utf8');

    electronApp = await electron.launch({
      args: ['--user-data-dir=' + path.join(tempRoot, 'profile'), ROOT],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.openVault === 'function');

    await electronApp.evaluate(async ({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      const nodeFs = process.mainModule.require('fs');
      const counters = { rootReads: 0, mdReads: 0, rawEvents: 0, root: dir };
      globalThis.__watchCounters = counters;
      const readdir = nodeFs.promises.readdir.bind(nodeFs.promises);
      const readFile = nodeFs.promises.readFile.bind(nodeFs.promises);
      const watch = nodeFs.watch.bind(nodeFs);
      nodeFs.watch = (p, opts, cb) => watch(p, opts, (...args) => { counters.rawEvents++; return cb(...args); });
      nodeFs.promises.readdir = (p, ...rest) => {
        if (String(p) === counters.root) counters.rootReads++;
        return readdir(p, ...rest);
      };
      nodeFs.promises.readFile = (p, ...rest) => {
        if (String(p).startsWith(counters.root) && /\.md$/i.test(String(p))) counters.mdReads++;
        return readFile(p, ...rest);
      };
    }, folder);
    await page.evaluate(() => window.openVault());
    await page.waitForFunction(() => window._appState.files.length >= 501);
    await page.evaluate(() => {
      window.__events = [];
      window.electronAPI.onVaultChanged((e) => window.__events.push(e));
    });
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }
    await page.locator('.tree-file', { hasText: 'note.md' }).first().click();
    await page.waitForFunction(() => window.getActiveCmAdapter() != null);
    // let the open itself settle, then zero the counters: only the SAVE is measured
    await page.waitForTimeout(SETTLE_MS);
    await resetCounters();
  });

  test.afterEach(async () => {
    await closeApp(electronApp, page);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function resetCounters() {
    await electronApp.evaluate(() => { globalThis.__watchCounters.rootReads = 0; globalThis.__watchCounters.mdReads = 0; globalThis.__watchCounters.rawEvents = 0; });
    await page.evaluate(() => { window.__events.length = 0; });
  }
  async function counters() {
    const main = await electronApp.evaluate(() => ({ ...globalThis.__watchCounters }));
    const events = await page.evaluate(() => window.__events.length);
    return { fullReads: main.rootReads, filesReRead: main.mdReads, events, rawFsEvents: main.rawEvents };
  }
  async function saveFromApp(text) {
    await page.evaluate((t) => window.getActiveCmAdapter().replaceSelection(t), text);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => window._appState.files.every((f) => !f.dirty));
  }

  test('one save from the app causes no event, no full re-read and no file re-read', async () => {
    await saveFromApp('edited by the app');
    expect(fs.readFileSync(path.join(folder, 'note.md'), 'utf8')).toContain('edited by the app');
    await page.waitForTimeout(SETTLE_MS);
    const result = await counters();
    test.info().annotations.push({ type: 'measured', description: JSON.stringify(result) });
    console.log('H15 own save ->', JSON.stringify(result));
    expect(result).toMatchObject({ fullReads: 0, filesReRead: 0, events: 0 });
    expect(result.rawFsEvents).toBeGreaterThan(0); // the watcher still SEES the write; it just does not forward it
  });

  test('an external edit is picked up and only that file is re-read', async () => {
    fs.writeFileSync(path.join(folder, 'topic-3', 'note-7.md'), '# Note 3-7\n\nchanged outside\n', 'utf8');
    await page.waitForFunction(() => window._appState.files.some((f) => f.path.endsWith('note-7.md') && f.content.includes('changed outside')), null, { timeout: 8000 });
    await page.waitForTimeout(SETTLE_MS);
    const result = await counters();
    test.info().annotations.push({ type: 'measured', description: JSON.stringify(result) });
    console.log('H15 external edit ->', JSON.stringify(result));
    expect(result.fullReads).toBe(0);
    expect(result.filesReRead).toBe(1);
    expect(result.events).toBeGreaterThanOrEqual(1);
  });

  test('an external edit right after an own save is never hidden', async () => {
    await saveFromApp('first, from the app');
    fs.writeFileSync(path.join(folder, 'note.md'), '# changed externally right after the save\n', 'utf8');
    await page.waitForFunction(() => window._appState.files.some((f) => f.path === 'note.md' && f.content.includes('changed externally')), null, { timeout: 8000 });
  });

  test('an external delete still takes the note out of the live tree', async () => {
    fs.rmSync(path.join(folder, 'topic-1', 'note-2.md'));
    await page.waitForFunction(() => {
      const f = window._appState.files.find((x) => x.path.endsWith('topic-1/note-2.md'));
      return !!f && f.missing === true;
    }, null, { timeout: 8000 });
    const result = await counters();
    expect(result.fullReads).toBe(0);
  });

  test('a new external note appears; .git and non-note files cause no event', async () => {
    fs.writeFileSync(path.join(folder, '.git', 'index'), 'changed', 'utf8');
    fs.writeFileSync(path.join(folder, 'image.png'), 'changed', 'utf8');
    await page.waitForTimeout(SETTLE_MS);
    expect((await counters()).events).toBe(0);
    fs.writeFileSync(path.join(folder, 'brand-new.md'), '# brand new\n', 'utf8');
    await page.waitForFunction(() => window._appState.files.some((f) => f.path === 'brand-new.md'), null, { timeout: 8000 });
  });
});
