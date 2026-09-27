/**
 * reading-stats-store.test.js — T8.1: local reading minutes per day and the streak.
 *
 * The clock is injected, so "today" is whatever the test says — which is also how the DATE KEY
 * contract is pinned: the key comes from main's local calendar, never from a renderer.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { createReadingStatsStore, computeStreak, dateKey, previousDay } from '../../src/main/reading-stats-store.js';
import { buildMockFs } from './main-harness.js';

const USER_DATA = 'C:\\mock\\userData';
const FILE = `${USER_DATA}\\reading-stats.json`;

/** fs backed by an in-memory map so the store round-trips through a real file shape. */
function memFs(seed = {}) {
  const files = { ...seed };
  return buildMockFs({
    readFileSync: vi.fn((p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; }),
    writeFileSync: vi.fn((p, c) => { files[p] = c; }),
    renameSync: vi.fn((a, b) => { files[b] = files[a]; delete files[a]; }),
    existsSync: vi.fn((p) => p in files),
    _files: files,
  });
}

const storeAt = (iso, fs, extra = {}) =>
  createReadingStatsStore({ fs, path, userDataDir: USER_DATA, now: () => new Date(`${iso}T12:00:00`), ...extra });

describe('dateKey / previousDay (T8.1)', () => {
  test('dateKey is the LOCAL calendar day', () => {
    expect(dateKey(new Date(2026, 0, 2, 23, 59, 59))).toBe('2026-01-02');
    expect(dateKey(new Date(2026, 11, 31, 0, 0, 1))).toBe('2026-12-31');
  });

  test('previousDay walks back across month and year boundaries', () => {
    expect(previousDay('2026-01-02')).toBe('2026-01-01');
    expect(previousDay('2026-01-01')).toBe('2025-12-31');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(previousDay('2024-03-01')).toBe('2024-02-29'); // leap year
  });
});

describe('computeStreak (T8.1)', () => {
  const map = (entries) => new Map(entries);

  test('counts consecutive days ending today', () => {
    expect(computeStreak(map([['2026-01-01', 5], ['2026-01-02', 7], ['2026-01-03', 1]]), '2026-01-03')).toBe(3);
  });

  test('a missing day ends the chain (the streak resets)', () => {
    expect(computeStreak(map([['2026-01-01', 5], ['2026-01-03', 7]]), '2026-01-03')).toBe(1);
    // Only a stale entry, nothing recent at all → 0.
    expect(computeStreak(map([['2025-12-01', 30]]), '2026-01-03')).toBe(0);
  });

  test('reading only yesterday still counts as 1 (an evening streak survives the morning)', () => {
    expect(computeStreak(map([['2026-01-02', 4]]), '2026-01-03')).toBe(1);
    expect(computeStreak(map([['2026-01-01', 4], ['2026-01-02', 4]]), '2026-01-03')).toBe(2);
  });

  test('zero-minute days do not count', () => {
    expect(computeStreak(map([['2026-01-03', 0]]), '2026-01-03')).toBe(0);
    expect(computeStreak(map([['2026-01-02', 0], ['2026-01-01', 9]]), '2026-01-03')).toBe(0);
  });

  test('a non-Map or a malformed "today" is 0, never a throw', () => {
    expect(computeStreak({ '2026-01-03': 5 }, '2026-01-03')).toBe(0);
    expect(computeStreak(map([['2026-01-03', 5]]), 'today')).toBe(0);
    expect(computeStreak(null, '2026-01-03')).toBe(0);
  });
});

describe('reading stats store (T8.1)', () => {
  let fs;
  beforeEach(() => { fs = memFs(); });

  test('adds minutes to today and reports the running total', () => {
    const store = storeAt('2026-01-03', fs);
    expect(store.get()).toMatchObject({ today: 0, date: '2026-01-03', streak: 0 });
    expect(store.addMinutes(1)).toEqual({ ok: true, today: 1, date: '2026-01-03', streak: 1 });
    expect(store.addMinutes(1)).toEqual({ ok: true, today: 2, date: '2026-01-03', streak: 1 });
    expect(store.get().today).toBe(2);
  });

  test('persists atomically and reloads the history (streak survives a restart)', () => {
    storeAt('2026-01-02', fs).addMinutes(1);
    storeAt('2026-01-03', fs).addMinutes(1); // a NEW store instance = a new launch
    const reloaded = storeAt('2026-01-03', fs).get();
    expect(reloaded.today).toBe(1);
    expect(reloaded.streak).toBe(2);
    expect(reloaded.days).toEqual({ '2026-01-02': 1, '2026-01-03': 1 });
    const tmpWritten = fs.writeFileSync.mock.calls.map((c) => String(c[0])).find((p) => p.startsWith(`${FILE}.tmp-`));
    expect(tmpWritten, 'writes through a random O_EXCL temp name').toBeTruthy();
    expect(fs.renameSync).toHaveBeenCalledWith(tmpWritten, FILE); // temp + rename
    expect(JSON.parse(fs._files[FILE])).toEqual({
      version: 1,
      days: { '2026-01-02': 1, '2026-01-03': 1 },
    });
  });

  test('rejects every count but exactly 1 (integer 1..MAX_ADD_MINUTES) without touching the file', () => {
    const store = storeAt('2026-01-03', fs);
    for (const bad of [0, -1, 1.5, '1', null, NaN, 2, 5, 120, 121, 1000]) {
      expect(store.addMinutes(bad)).toEqual({ error: 'invalid-minutes' });
    }
    expect(store.get().today).toBe(0);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  test('caps a single day at 24 h', () => {
    const store = storeAt('2026-01-03', fs);
    for (let i = 0; i < 24 * 60; i += 1) store.addMinutes(1);
    expect(store.get().today).toBe(24 * 60);
    expect(store.addMinutes(1)).toEqual({ ok: true, today: 24 * 60, date: '2026-01-03', streak: 1 });
  });

  test('a write failure rolls back the in-memory total (memory and disk cannot disagree)', () => {
    const store = storeAt('2026-01-03', fs);
    store.addMinutes(1);
    fs.writeFileSync.mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(store.addMinutes(1)).toEqual({ error: 'write-failed' });
    expect(store.get().today).toBe(1);
  });

  test('a corrupt or foreign-version file degrades to empty instead of throwing', () => {
    expect(storeAt('2026-01-03', memFs({ [FILE]: 'not json' })).get()).toMatchObject({ today: 0, streak: 0 });
    expect(storeAt('2026-01-03', memFs({ [FILE]: JSON.stringify({ version: 99, days: { '2026-01-03': 9 } }) })).get())
      .toMatchObject({ today: 0, streak: 0 });
  });

  test('drops malformed day entries on load (only ISO keys with whole minutes survive)', () => {
    const seed = {
      [FILE]: JSON.stringify({
        version: 1,
        days: { '2026-01-03': 12, 'not-a-date': 5, '2026-01-02': -4, '2026-01-01': 3.5 },
      }),
    };
    const stats = storeAt('2026-01-03', memFs(seed)).get();
    expect(stats.days).toEqual({ '2026-01-03': 12 });
    expect(stats.streak).toBe(1);
  });

  test('keeps at most two years of history, dropping the oldest days', () => {
    const days = {};
    const start = Date.UTC(2020, 0, 1);
    for (let i = 0; i < 800; i += 1) {
      const d = new Date(start + i * 24 * 60 * 60 * 1000);
      days[`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`] = 5;
    }
    const store = storeAt('2026-01-03', memFs({ [FILE]: JSON.stringify({ version: 1, days }) }));
    store.addMinutes(1); // any write prunes
    const stats = store.get();
    expect(Object.keys(stats.days)).toHaveLength(730);
    // 800 seeded days + today's tick = 801 entries; the newest 730 start 71 days in.
    expect(Object.keys(stats.days)[0]).toBe('2020-03-12');
    expect(Object.keys(stats.days).at(-1)).toBe('2026-01-03');
  });
});

// GATE-01 (2026-09-26): computeStreak guards, sanitizeDays branches, corrupt-load
// degradation, and the add-minutes rollback lane.
describe('reading-stats hardening lanes (GATE-01)', () => {
  test('computeStreak refuses non-Map input and non-ISO dates', () => {
    expect(computeStreak(null, '2026-01-01')).toBe(0);
    expect(computeStreak(new Map(), '')).toBe(0);
    expect(computeStreak(new Map(), 'not-a-date')).toBe(0);
  });

  test('a missing yesterday ends the streak; an evening streak survives via previousDay', () => {
    const days = new Map([['2026-01-01', 10], ['2025-12-31', 5]]);
    expect(computeStreak(days, '2026-01-01')).toBe(2);
    expect(computeStreak(days, '2026-01-02')).toBe(2); // today unread → counts from yesterday
    expect(computeStreak(days, '2026-01-03')).toBe(0); // gap at 01-02 ends the chain
    expect(computeStreak(new Map([['2025-12-31', 5]]), '2026-01-01')).toBe(1);
  });

  test('a corrupt or foreign-version file degrades to no history', () => {
    const fs = buildMockFs({ readFileSync: () => '{torn' });
    const s1 = createReadingStatsStore({ fs, path, userDataDir: USER_DATA, now: () => new Date('2026-01-01T00:00:00Z') });
    expect(s1.get().today).toBe(0);
    const fs2 = buildMockFs({ readFileSync: () => JSON.stringify({ version: 99, days: { '2026-01-01': 50 } }) });
    const s2 = createReadingStatsStore({ fs: fs2, path, userDataDir: USER_DATA, now: () => new Date('2026-01-01T00:00:00Z') });
    expect(s2.get().today).toBe(0);
  });

  test('sanitize drops bad days, clamps the per-day cap, and refuses junk minutes', async () => {
    const fs = buildMockFs({
      readFileSync: () => JSON.stringify({
        version: 1,
        days: {
          '2026-01-01': 5,
          'junk': 5,
          '2026-01-02': -3,
          '2026-01-03': 'x',
          '2026-01-04': 999999,
        },
      }),
    });
    const s = createReadingStatsStore({ fs, path, userDataDir: USER_DATA, now: () => new Date('2026-01-04T00:00:00Z') });
    expect(s.get().days).toEqual({ '2026-01-01': 5, '2026-01-04': 1440 });
    expect(s.addMinutes(0)).toEqual({ error: 'invalid-minutes' });
    expect(s.addMinutes(61)).toEqual({ error: 'invalid-minutes' });
    expect(s.addMinutes('5')).toEqual({ error: 'invalid-minutes' });
  });

  test('a failed persist rolls the day back (memory and disk agree)', () => {
    const fs = buildMockFs();
    fs.writeFileSync = vi.fn(() => { throw new Error('ENOSPC'); });
    const s = createReadingStatsStore({ fs, path, userDataDir: USER_DATA, now: () => new Date('2026-01-01T00:00:00Z') });
    expect(s.addMinutes(1)).toEqual({ error: 'write-failed' });
    expect(s.get().today).toBe(0);
    expect(s.get().days).toEqual({});
  });
});
