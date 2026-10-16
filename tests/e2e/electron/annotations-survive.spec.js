// @ts-check
/**
 * annotations-survive.spec.js — defect B3, against the REAL main process, real files and real
 * restarts.
 *
 * Requirement: a highlight or margin note is never deleted behind the user's back.
 *   R1  a standalone note keeps its highlight after more files than the recents list holds were
 *       opened and the app was restarted;
 *   R2  a folder note keeps its highlight after the folder was closed, other files were opened,
 *       the app was restarted and the folder was opened again;
 *   R3  a truncated settings.json deletes nothing and is kept as settings.json.corrupt-<timestamp>;
 *   R4  a damaged annotations.json is kept as annotations.json.corrupt-<timestamp>.
 *
 * (The bug: at every start the main process forgot each note the recents list no longer named,
 * the note got a new id when it was opened again, and its highlights were deleted as orphans.)
 */
const { test, expect, _electron: electron } = require('@playwright/test');
const { closeApp } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const NOTE = '# Title\n\nSome text with ALPHA-WORD inside the paragraph.\n';
const HIGHLIGHT = {
  id: 'b3-h1', text: 'ALPHA-WORD', note: 'my margin note', at: 1760000000000,
  anchor: { headingSlug: 'title', ordinal: 0 },
};

test.describe('highlights are never deleted behind the user\'s back @electron', () => {
  let electronApp;
  let page;
  let tempRoot;
  let profile;
  let notePath;
  let others;

  test.beforeEach(() => {
    test.setTimeout(180000);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-b3-'));
    profile = path.join(tempRoot, 'profile');
    fs.mkdirSync(profile);
    notePath = path.join(tempRoot, 'annotated.md');
    fs.writeFileSync(notePath, NOTE, 'utf8');
    // more files than the recents list (5) holds
    others = ['b', 'c', 'd', 'e', 'f', 'g', 'h'].map((name) => {
      const p = path.join(tempRoot, `${name}.md`);
      fs.writeFileSync(p, `# ${name}\n`, 'utf8');
      return p;
    });
  });

  test.afterEach(async () => {
    await quit();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const settingsFile = () => path.join(profile, 'settings.json');
  const annotationsFile = () => path.join(profile, 'annotations.json');
  const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

  async function launch(args, folder) {
    electronApp = await electron.launch({
      args: ['--user-data-dir=' + profile, ROOT, ...args],
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', ELECTRON_ENABLE_LOGGING: '0' },
    });
    page = await electronApp.firstWindow();
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.waitForFunction(() => typeof window.openVault === 'function');
    if (folder) {
      await electronApp.evaluate(async ({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
      }, folder);
    }
  }
  // A normal quit: the window closes through the app's own close flow, so settings are saved.
  async function quit() {
    if (!electronApp) return;
    const app = electronApp;
    electronApp = null;
    await closeApp(app, page);
  }
  const fileInfo = (name) => page.evaluate((n) => {
    const f = window._appState.files.find((x) => x.name === n);
    return f ? { documentId: f.documentId || null, vaultId: f.vaultId || null, path: f.path } : null;
  }, name);
  const waitForFile = (name) => page.waitForFunction(
    (n) => window._appState.files.some((f) => f.name === n && (f.documentId || f.vaultId)), name,
  );
  const keyOf = (info) => (info.vaultId ? `vault:${info.vaultId} ${info.path}` : `doc:${info.documentId}`);
  const put = (key) => page.evaluate(([k, h]) => window.electronAPI.annotationsPut({ docKey: k, highlights: [h] }), [key, HIGHLIGHT]);
  const get = (key) => page.evaluate((k) => window.electronAPI.annotationsGet(k), key);
  const recentIds = () => {
    const s = readJson(settingsFile());
    return s && Array.isArray(s.recents) ? s.recents.map((r) => r.documentId || r.vaultId) : null;
  };
  // The highlight as the reader sees it: a <mark> over the highlighted words in the reading view.
  async function expectHighlightOnScreen(name) {
    await page.locator('.tab', { hasText: name }).first().click();
    await page.evaluate(() => window.setViewMode('reading'));
    await expect(page.locator('#noteContent mark', { hasText: 'ALPHA-WORD' })).toHaveCount(1);
  }

  // Session 1 for the standalone cases: open the note, highlight it, quit normally.
  async function annotateStandaloneNote() {
    await launch([notePath]);
    await waitForFile('annotated.md');
    const info = await fileInfo('annotated.md');
    expect(info.documentId).toBeTruthy();
    expect(info.vaultId).toBeNull();
    const key = keyOf(info);
    expect(await put(key)).toEqual({ ok: true, count: 1 });
    await expect.poll(recentIds).toContain(info.documentId);
    await quit();
    expect(readJson(annotationsFile()).docs[key].highlights).toEqual([HIGHLIGHT]);
    return { info, key };
  }

  test('R1: a standalone note keeps its highlight after 7 other files were opened and the app restarted', async () => {
    const { info, key } = await annotateStandaloneNote();

    // Session 2: seven other files push the annotated note off the recents list.
    await launch(others);
    await waitForFile('h.md');
    await expect.poll(recentIds).not.toContain(info.documentId);
    await quit();

    // Session 3: the registry was pruned at this start. The note must come back as the same note.
    await launch([notePath]);
    await waitForFile('annotated.md');
    const again = await fileInfo('annotated.md');
    expect(again.documentId).toBe(info.documentId);
    expect(await get(key)).toEqual({ highlights: [HIGHLIGHT] });
    await expectHighlightOnScreen('annotated.md');
    await quit();

    // Session 4: still there after one more start with nothing opened.
    await launch([]);
    expect(await get(key)).toEqual({ highlights: [HIGHLIGHT] });
    expect(readJson(annotationsFile()).docs[key].highlights).toEqual([HIGHLIGHT]);
  });

  test('R2: a folder note keeps its highlight after the folder was closed, other files opened and the app restarted', async () => {
    const folder = path.join(tempRoot, 'Vault');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'annotated.md'), NOTE, 'utf8');

    await launch([], folder);
    await page.evaluate(() => window.openVault());
    await waitForFile('annotated.md');
    const info = await fileInfo('annotated.md');
    expect(info.vaultId).toBeTruthy();
    const key = keyOf(info);
    expect(await put(key)).toEqual({ ok: true, count: 1 });
    // close the folder so the next start does not restore it
    if ((await page.getAttribute('#sidebarToggleBtn', 'aria-expanded')) !== 'true') await page.click('#sidebarToggleBtn');
    await page.locator('.tree-root-close').first().click();
    await page.waitForFunction(() => !window._appState.files.some((f) => f.vaultId));
    await quit();

    await launch(others);
    await waitForFile('h.md');
    await expect.poll(recentIds).not.toContain(info.vaultId);
    expect(await page.evaluate(() => window._appState.files.some((f) => f.vaultId))).toBe(false);
    await quit();

    await launch([], folder);
    await page.evaluate(() => window.openVault());
    await waitForFile('annotated.md');
    const again = await fileInfo('annotated.md');
    expect(again.vaultId).toBe(info.vaultId);
    expect(await get(key)).toEqual({ highlights: [HIGHLIGHT] });
    await expectHighlightOnScreen('annotated.md');
  });

  test('R3: a truncated settings.json deletes nothing and is kept beside the new one', async () => {
    const { info, key } = await annotateStandaloneNote();
    const whole = fs.readFileSync(settingsFile(), 'utf8');
    const truncated = whole.slice(0, Math.floor(whole.length / 2));
    expect(() => JSON.parse(truncated)).toThrow();
    fs.writeFileSync(settingsFile(), truncated, 'utf8');

    await launch([notePath]);
    await waitForFile('annotated.md');
    expect((await fileInfo('annotated.md')).documentId).toBe(info.documentId);
    expect(await get(key)).toEqual({ highlights: [HIGHLIGHT] });
    await expectHighlightOnScreen('annotated.md');
    const kept = fs.readdirSync(profile).filter((name) => /^settings\.json\.corrupt-\d{8}T\d{9}Z$/.test(name));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(profile, kept[0]), 'utf8')).toBe(truncated);
  });

  test('R4: a damaged annotations.json is kept beside the new one, not overwritten', async () => {
    const { key } = await annotateStandaloneNote();
    const whole = fs.readFileSync(annotationsFile(), 'utf8');
    const damaged = whole.slice(0, whole.length - 20);
    fs.writeFileSync(annotationsFile(), damaged, 'utf8');

    await launch([notePath]);
    await waitForFile('annotated.md');
    expect(await get(key)).toEqual({ highlights: [] });
    const other = { ...HIGHLIGHT, id: 'b3-h2', note: 'written after the damage' };
    expect(await page.evaluate(([k, h]) => window.electronAPI.annotationsPut({ docKey: k, highlights: [h] }), [key, other]))
      .toEqual({ ok: true, count: 1 });
    const kept = fs.readdirSync(profile).filter((name) => /^annotations\.json\.corrupt-\d{8}T\d{9}Z$/.test(name));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(profile, kept[0]), 'utf8')).toBe(damaged);
    expect(readJson(annotationsFile()).docs[key].highlights).toEqual([other]);
  });
});
