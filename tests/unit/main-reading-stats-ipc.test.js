/**
 * main-reading-stats-ipc.test.js — T8.1 `stats:get` / `stats:addMinutes` IPC handlers.
 *
 * The store owns the day key and the caps (covered in reading-stats-store.test.js); this file
 * pins the channel contract: main's LOCAL date key travels with every response, the renderer
 * can only ever add whole minutes, and the JSON lands in the user's own profile.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../src/main/index.js';
import { dateKey } from '../../src/main/reading-stats-store.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const STATS_FILE = path.join('/mock/userData/userData', 'reading-stats.json');
const getHandle = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];

describe('stats IPC (T8.1)', () => {
  let electron, fs, getHandler, addHandler;
  beforeEach(async () => {
    electron = buildMockElectron();
    fs = buildMockFs();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 50));
    getHandler = getHandle(electron, 'stats:get');
    addHandler = getHandle(electron, 'stats:addMinutes');
  });

  test('both handlers are registered', () => {
    expect(typeof getHandler).toBe('function');
    expect(typeof addHandler).toBe('function');
  });

  test('a fresh profile reports zero today, an empty history and main’s own local day', async () => {
    const stats = await getHandler();
    expect(stats).toMatchObject({ today: 0, streak: 0, days: {} });
    expect(stats.date).toBe(dateKey(new Date())); // the DAY KEY is main's, never the renderer's
  });

  test('adding a minute returns the refreshed summary and persists to <userData>', async () => {
    expect(await addHandler({}, 1)).toMatchObject({ ok: true, today: 1, streak: 1 });
    expect(await addHandler({}, 1)).toMatchObject({ ok: true, today: 2 });
    expect(await getHandler()).toMatchObject({ today: 2, streak: 1 });

    const write = fs.writeFileSync.mock.calls.find((c) => String(c[0]).startsWith(STATS_FILE));
    expect(write, 'the stats file is written under userData').toBeTruthy();
    expect(String(write[0]).startsWith(`${STATS_FILE}.tmp-`)).toBe(true);
    expect(fs.renameSync).toHaveBeenCalledWith(write[0], STATS_FILE);
  });

  test('the channel refuses anything that is not exactly one minute', async () => {
    for (const bad of [0, -5, 2, 2.5, '10', null, undefined, NaN, 120, 5000]) {
      expect(await addHandler({}, bad)).toEqual({ error: 'invalid-minutes' });
    }
    expect(await getHandler()).toMatchObject({ today: 0 });
  });

  test('the renderer cannot name a day: every write lands on main’s today', async () => {
    await addHandler({}, 1);
    const forced = await addHandler({ date: '1999-12-31', minutes: 3 }, 1);
    expect(forced.date).toBe(dateKey(new Date()));
    const stats = await getHandler();
    expect(stats.days[stats.date]).toBe(2);
    expect(Object.keys(stats.days)).toHaveLength(1);
  });

  test('two reads of the same store are stable (no accidental double counting)', async () => {
    await addHandler({}, 1);
    expect(await getHandler()).toMatchObject({ today: 1 });
    expect(await getHandler()).toMatchObject({ today: 1 });
  });
});
