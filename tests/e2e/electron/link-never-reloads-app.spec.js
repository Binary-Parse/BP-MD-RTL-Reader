// @ts-check
/**
 * link-never-reloads-app.spec.js — defect B5, against the REAL main process.
 *
 * Requirement: after the app page has loaded, no link in a note may navigate the main frame,
 * whatever its URL. (The bug: a link whose target resolves to the app's own page, e.g.
 * `[x](index.html)`, was allowed and reloaded the renderer; unsaved work was lost.)
 *
 *   R1  a link that resolves to the app page starts no navigation; the renderer is not reloaded;
 *   R2  unsaved text in another note survives the click;
 *   R3  an external link is handed to the OS and starts no navigation;
 *   R4  an in-document anchor still works without a navigation.
 *
 * No fixed sleeps: the main process records `will-navigate` (the request arrived) and
 * `did-navigate` (a new document was committed), and the tests wait on those records.
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const { closeApp } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const UNSAVED = '\nUNSAVED-WORK\n';

const LINKS_NOTE = [
  '# Links',
  '',
  '[bare](index.html)',
  '',
  '[dotted](./index.html)',
  '',
  '[query](index.html?x=1)',
  '',
  '[external](https://example.com/b5)',
  '',
  '[anchor](#target)',
  '',
  '## Target',
  '',
  'end',
  '',
].join('\n');

test.describe('a link in a note never reloads the app @electron', () => {
  let electronApp;
  let page;
  let tempRoot;
  let folder;

  test.beforeEach(async () => {
    test.setTimeout(120000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-b5-'));
    folder = path.join(tempRoot, 'Vault');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'links.md'), LINKS_NOTE, 'utf8');
    fs.writeFileSync(path.join(folder, 'work.md'), 'SAVED', 'utf8');

    electronApp = await electron.launch({
      args: ['--user-data-dir=' + path.join(tempRoot, 'profile'), ROOT],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.openVault === 'function');
    await electronApp.evaluate(async ({ dialog, shell, BrowserWindow }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      globalThis.__opened = [];
      shell.openExternal = async (url) => { globalThis.__opened.push(url); };
      globalThis.__willNavigate = [];
      globalThis.__committed = [];
      globalThis.__loads = 0;
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      wc.on('will-navigate', (_e, url) => { globalThis.__willNavigate.push(url); });
      // did-navigate = a main-frame document was committed, i.e. the renderer was replaced.
      wc.on('did-navigate', (_e, url) => { globalThis.__committed.push(url); });
      wc.on('did-finish-load', () => { globalThis.__loads += 1; });
    }, folder);
    await page.evaluate(() => window.openVault());
    await page.waitForFunction(() => window._appState.files.some((f) => f.name === 'links.md'));
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') {
      await page.click('#sidebarToggleBtn');
    }
    // unsaved work in one note, autosave off so it stays unsaved
    await page.evaluate(() => { window._appState.autosave = false; });
    await openNote('work.md');
    await page.evaluate((t) => {
      const cm = window.getActiveCmAdapter();
      const end = cm.getValue().length;
      cm.setSelection({ start: end, end });
      cm.replaceSelection(t);
    }, UNSAVED);
    await page.waitForFunction(() => window._appState.files.find((f) => f.name === 'work.md').dirty === true);
    await openNote('links.md');
    await page.evaluate(() => window.setViewMode('reading'));
    await expect(page.locator('a', { hasText: 'bare' }).first()).toBeVisible();
    await page.evaluate(() => { window.__sameRenderer = true; });
  });

  test.afterEach(async () => {
    // The window holds unsaved work on purpose; close without the Save dialog.
    await closeApp(electronApp, page, { exit: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  async function openNote(name) {
    await page.locator('.tree-file', { hasText: name }).first().click();
    await page.waitForFunction((n) => {
      const f = window._appState.files[window._appState.activeFile];
      return f && f.name === n;
    }, name);
  }
  const mainState = () => electronApp.evaluate(({ BrowserWindow }) => ({
    willNavigate: globalThis.__willNavigate.slice(),
    committed: globalThis.__committed.slice(),
    loading: BrowserWindow.getAllWindows()[0].webContents.isLoading(),
    loads: globalThis.__loads,
    opened: globalThis.__opened.slice(),
  }));
  // A real click on the link, without Playwright waiting for a navigation that must not happen.
  const clickLink = (label) => page.locator('a', { hasText: label }).first().evaluate((el) => el.click());
  // The request reached the main process and whatever it started has finished.
  async function navigationRequestSettled() {
    await expect.poll(async () => (await mainState()).willNavigate.length).toBeGreaterThan(0);
    await expect.poll(async () => (await mainState()).loading).toBe(false);
  }
  async function expectSameRendererWithUnsavedWork() {
    const state = await mainState();
    expect(state.committed).toEqual([]);
    expect(state.loads).toBe(0);
    expect(await page.evaluate(() => window.__sameRenderer === true)).toBe(true);
    expect(await page.evaluate(() => {
      const f = window._appState.files.find((x) => x.name === 'work.md');
      return f ? { content: f.content, dirty: !!f.dirty } : null;
    })).toEqual({ content: 'SAVED' + UNSAVED, dirty: true });
  }

  for (const label of ['bare', 'dotted', 'query']) {
    test(`R1 + R2: clicking the "${label}" link to the app page starts no navigation and keeps unsaved work`, async () => {
      const appUrl = page.url();
      await clickLink(label);
      await navigationRequestSettled();
      await expectSameRendererWithUnsavedWork();
      expect(page.url()).toBe(appUrl);
      expect((await mainState()).opened).toEqual([]);
    });
  }

  test('R1: a script-made navigation to the exact app URL is prevented by the main process', async () => {
    const appUrl = page.url();
    // The same request a link to the app page makes, without relying on how the renderer
    // handles clicks: an anchor with the absolute app URL, clicked.
    await page.evaluate((href) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = 'absolute';
      a.id = 'b5-absolute';
      document.body.appendChild(a);
    }, appUrl);
    await page.evaluate(() => document.getElementById('b5-absolute').click());
    await navigationRequestSettled();
    await expectSameRendererWithUnsavedWork();
  });

  test('R3: an external link is handed to the OS and starts no navigation', async () => {
    await clickLink('external');
    await expect.poll(async () => (await mainState()).opened).toEqual(['https://example.com/b5']);
    await expect.poll(async () => (await mainState()).loading).toBe(false);
    await expectSameRendererWithUnsavedWork();
  });

  test('R4: an in-document anchor still works and starts no navigation', async () => {
    await clickLink('anchor');
    await expect(page.locator('h2', { hasText: 'Target' }).first()).toBeInViewport();
    expect((await mainState()).willNavigate).toEqual([]);
    await expectSameRendererWithUnsavedWork();
  });
});
