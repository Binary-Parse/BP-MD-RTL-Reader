/**
 * recovery-two-files.test.js — audit B4 (decision D11).
 *
 * The 10 s recovery mirror used to overwrite an unanswered recovery offer with this session's
 * (often empty) set, destroying the crashed-away work. Now the offered snapshot.json is not
 * written while an offer is open; the session mirrors into live.json, and a second crash
 * offers both.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const DIR = path.join('/mock/userData/userData', 'recovery');
const SNAPSHOT = path.join(DIR, 'snapshot.json');
const LIVE = path.join(DIR, 'live.json');
const handler = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

function memoryFs(files) {
  return buildMockFs({
    readFileSync: (p) => { if (p in files) return files[p]; throw enoent(); },
    writeFileSync: (p, c) => { files[p] = String(c); },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    existsSync: (p) => p in files,
    promises: {
      ...buildMockFs().promises,
      readFile: async (p) => { if (p in files) return files[p]; throw enoent(); },
      unlink: async (p) => { if (!(p in files)) throw enoent(); delete files[p]; },
      rename: async (a, b) => { if (!(a in files)) throw enoent(); files[b] = files[a]; delete files[a]; },
    },
  });
}

const names = (text) => JSON.parse(text).files.map((f) => f.name + '=' + f.content);
const crashed = JSON.stringify({ files: [{ name: 'lost.md', content: 'crashed-away work', at: 1 }] });

/** One app run over the same disk. */
async function launch(files) {
  const electron = buildMockElectron();
  bootstrap({ electron, fs: memoryFs(files), proc: buildMockProc(['node', 'src/main/index.js']) });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return {
    pop: () => handler(electron, 'recovery:pop')(),
    snapshot: (list) => handler(electron, 'recovery:snapshot')({}, list),
    clear: () => handler(electron, 'recovery:clear')(),
  };
}

describe('B4: an unanswered recovery offer is never overwritten', () => {
  let files;
  beforeEach(() => { files = { [SNAPSHOT]: crashed }; });

  test('the mirror of the new session leaves the offered snapshot untouched', async () => {
    const app = await launch(files);
    expect((await app.pop()).files.map((f) => f.name)).toEqual(['lost.md']);
    await app.snapshot([]); // the 10 s tick with nothing dirty: this used to wipe the offer
    await app.snapshot([{ name: 'new.md', content: 'typed after Esc' }]);
    expect(files[SNAPSHOT]).toBe(crashed);
    expect(names(files[LIVE])).toEqual(['new.md=typed after Esc']);
  });

  test('a mirror tick that arrives before the offer is read does not overwrite it either', async () => {
    const app = await launch(files);
    await app.snapshot([]);
    await app.snapshot([{ name: 'early.md', content: 'x' }]);
    expect(files[SNAPSHOT]).toBe(crashed);
    expect((await app.pop()).files.map((f) => f.name)).toEqual(['lost.md']);
  });

  test('work typed after dismissing the offer survives a second crash: the next launch offers both', async () => {
    const first = await launch(files);
    await first.pop();
    await first.snapshot([{ name: 'new.md', content: 'typed after Esc' }]);
    // crash: no clear. Next launch:
    const second = await launch(files);
    const offered = await second.pop();
    expect(offered.files.map((f) => f.name + '=' + f.content)).toEqual(['lost.md=crashed-away work', 'new.md=typed after Esc']);
    expect(files[LIVE]).toBeUndefined();
    // and that merged offer is protected in turn
    await second.snapshot([]);
    expect(names(files[SNAPSHOT])).toEqual(['lost.md=crashed-away work', 'new.md=typed after Esc']);
  });

  test('answering the offer removes it and makes this session\'s mirror the snapshot', async () => {
    const app = await launch(files);
    await app.pop();
    await app.snapshot([{ name: 'new.md', content: 'typed before answering' }]);
    expect(await app.clear()).toEqual({ ok: true });
    expect(names(files[SNAPSHOT])).toEqual(['new.md=typed before answering']);
    expect(files[LIVE]).toBeUndefined();
    // from now on the mirror is the snapshot again
    await app.snapshot([{ name: 'new.md', content: 'more' }]);
    expect(names(files[SNAPSHOT])).toEqual(['new.md=more']);
    expect(files[LIVE]).toBeUndefined();
  });

  test('answering with nothing mirrored yet leaves no file', async () => {
    const app = await launch(files);
    await app.pop();
    expect(await app.clear()).toEqual({ ok: true });
    expect(files).toEqual({});
  });

  test('a sanctioned close with the offer still open drops only this session\'s mirror', async () => {
    const app = await launch(files);
    await app.pop();
    await app.snapshot([{ name: 'new.md', content: 'saved before closing' }]);
    await app.snapshot([]); // what the renderer sends on a sanctioned close with an unanswered offer
    const next = await launch(files);
    expect((await next.pop()).files.map((f) => f.name)).toEqual(['lost.md']);
  });

  test('a sanctioned close with no offer removes both files', async () => {
    files = {};
    const app = await launch(files);
    expect((await app.pop()).files).toEqual([]);
    await app.snapshot([{ name: 'a.md', content: 'x' }]);
    expect(names(files[SNAPSHOT])).toEqual(['a.md=x']);
    expect(files[LIVE]).toBeUndefined();
    expect(await app.clear()).toEqual({ ok: true });
    expect(files).toEqual({});
  });

  test('an offer that cannot be removed is reported, and stays offered', async () => {
    const electron = buildMockElectron();
    const fs = memoryFs(files);
    fs.promises.unlink = async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await handler(electron, 'recovery:pop')();
    expect(await handler(electron, 'recovery:clear')()).toEqual({ error: 'clear-failed' });
    await handler(electron, 'recovery:snapshot')({}, []);
    expect(files[SNAPSHOT]).toBe(crashed); // still protected
  });
});

describe('M11: a page reloaded after a crash is offered everything, in the same run', () => {
  test('work mirrored while an offer was open joins the offer after the reload', async () => {
    const files = { [SNAPSHOT]: crashed };
    const electron = buildMockElectron();
    electron._mockWin.webContents.reload = vi.fn();
    bootstrap({ electron, fs: memoryFs(files), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await handler(electron, 'recovery:pop')();
    await handler(electron, 'recovery:snapshot')({}, [{ name: 'new.md', content: 'typed before the crash' }]);
    expect(names(files[LIVE])).toEqual(['new.md=typed before the crash']);

    const gone = electron._mockWin.webContents.on.mock.calls.find(([event]) => event === 'render-process-gone')[1];
    gone({}, { reason: 'crashed' });
    expect(electron._mockWin.webContents.reload).toHaveBeenCalledTimes(1);

    // the reloaded page: its first mirror is empty, and must not cost the work
    await handler(electron, 'recovery:snapshot')({}, []);
    const offered = await handler(electron, 'recovery:pop')();
    expect(offered.files.map((f) => f.name + '=' + f.content)).toEqual(['lost.md=crashed-away work', 'new.md=typed before the crash']);
  });
});
