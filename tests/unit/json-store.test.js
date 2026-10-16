/**
 * json-store.test.js — T8.1: the shared atomic-write / guarded-read helpers used by every
 * JSON file main owns.
 */
import { describe, test, expect, vi } from 'vitest';
import { atomicWriteJson, readJsonFileChecked, sweepStaleJsonTemps } from '../../src/main/json-store.js';
import { buildMockFs } from './main-harness.js';

const FILE = 'C:\\mock\\userData\\thing.json';

describe('atomicWriteJson (T8.1)', () => {
  test('writes an O_EXCL random-UUID temp file, then renames it onto the target (never a partial target)', () => {
    const fs = buildMockFs();
    expect(atomicWriteJson(fs, FILE, '{"a":1}')).toEqual({ ok: true });
    const tmp = fs.writeFileSync.mock.calls[0][0];
    expect(tmp.startsWith(`${FILE}.tmp-`)).toBe(true);
    expect(tmp.length).toBeGreaterThan(`${FILE}.tmp-`.length);
    expect(fs.writeFileSync).toHaveBeenCalledWith(tmp, '{"a":1}', { encoding: 'utf8', flag: 'wx' });
    expect(fs.renameSync).toHaveBeenCalledWith(tmp, FILE);
    // The rename is what publishes the data, so it must come last.
    expect(fs.renameSync.mock.invocationCallOrder[0]).toBeGreaterThan(fs.writeFileSync.mock.invocationCallOrder[0]);
  });

  test('a write failure reports a typed error instead of throwing', () => {
    const fs = buildMockFs();
    fs.writeFileSync.mockImplementationOnce(() => { throw new Error('ENOSPC'); });
    expect(atomicWriteJson(fs, FILE, '{}')).toEqual({ error: 'write-failed' });
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  test('a rename failure reports write-failed and removes the leftover temp file', () => {
    const fs = buildMockFs();
    fs.renameSync.mockImplementationOnce(() => { throw new Error('EPERM'); });
    fs.existsSync.mockReturnValue(true);
    expect(atomicWriteJson(fs, FILE, '{}')).toEqual({ error: 'write-failed' });
    const tmp = fs.writeFileSync.mock.calls[0][0];
    expect(fs.unlinkSync).toHaveBeenCalledWith(tmp);
  });

  test('M14: a target held for a moment is retried, so settings and annotations are not lost to a scanner', () => {
    const fs = buildMockFs();
    const busy = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };
    fs.renameSync.mockImplementationOnce(busy).mockImplementationOnce(busy);
    const sleep = vi.fn();
    expect(atomicWriteJson(fs, FILE, '{}', { sleep })).toEqual({ ok: true });
    expect(fs.renameSync).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  // MAIN-4: the JSON stores share the note writer, so a held file and a full disk get the
  // same specific codes a note save gets.
  test('M14: held through every retry it reports locked and removes the temp file', () => {
    const fs = buildMockFs();
    fs.renameSync.mockImplementation(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });
    fs.existsSync.mockReturnValue(true);
    expect(atomicWriteJson(fs, FILE, '{}', { sleep: vi.fn() })).toEqual({ error: 'locked' });
    expect(fs.renameSync).toHaveBeenCalledTimes(5);
    expect(fs.unlinkSync).toHaveBeenCalledWith(fs.writeFileSync.mock.calls[0][0]);
  });

  test('MAIN-4: a full disk reports enospc', () => {
    const fs = buildMockFs();
    fs.writeFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); });
    expect(atomicWriteJson(fs, FILE, '{}')).toEqual({ error: 'enospc' });
  });

  test('MAIN-4: the JSON file keeps its permission bits across a write', () => {
    const fs = buildMockFs({ statSync: vi.fn(() => ({ mode: 0o100600 })), chmodSync: vi.fn() });
    expect(atomicWriteJson(fs, FILE, '{}')).toEqual({ ok: true });
    expect(fs.chmodSync).toHaveBeenCalledWith(fs.writeFileSync.mock.calls[0][0], 0o600);
  });
});

describe('readJsonFileChecked (T8.1, B3)', () => {
  const accept = (value) => !!(value && value.version === 1);

  test('returns the parsed value when the guard accepts it', () => {
    const fs = buildMockFs({ readFileSync: vi.fn(() => '{"version":1,"days":{}}') });
    expect(readJsonFileChecked(fs, FILE, accept)).toEqual({ status: 'ok', value: { version: 1, days: {} } });
  });

  test('a missing file, a failed read, and a damaged file each say so', () => {
    const missing = buildMockFs({ readFileSync: vi.fn(() => { throw new Error('ENOENT'); }) });
    expect(readJsonFileChecked(missing, FILE, accept)).toEqual({ status: 'missing' });

    const locked = buildMockFs({ readFileSync: vi.fn(() => { throw Object.assign(new Error('x'), { code: 'EACCES' }); }) });
    expect(readJsonFileChecked(locked, FILE, accept)).toEqual({ status: 'unreadable' });

    for (const text of ['not json', '{"version":99}', 'null']) {
      const fs = buildMockFs({ readFileSync: vi.fn(() => text) });
      expect(readJsonFileChecked(fs, FILE, accept), text).toEqual({ status: 'corrupt' });
    }
  });
});

describe('sweepStaleJsonTemps — orphaned <file>.tmp-<uuid> cleanup before each write', () => {
  test('removes only aged tmp siblings of THIS file; the live file and fresh temps survive', () => {
    const fs = buildMockFs();
    fs.readdirSync = vi.fn(() => ['thing.json.tmp-a', 'thing.json.tmp-b', 'thing.json']);
    fs.statSync = vi.fn((p) => ({ isFile: () => true, mtimeMs: p.endsWith('tmp-a') ? 0 : Date.now() }));
    fs.unlinkSync = vi.fn();
    sweepStaleJsonTemps(fs, FILE, { now: 10 * 60 * 60 * 1000 });
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    expect(fs.unlinkSync.mock.calls[0][0]).toContain('tmp-a');
  });

  test('an unreadable directory is swallowed (the sweep must never block the write)', () => {
    const fs = buildMockFs();
    fs.readdirSync = vi.fn(() => { throw new Error('EACCES'); });
    expect(() => sweepStaleJsonTemps(fs, FILE)).not.toThrow();
  });
});

// GATE-01 (2026-09-26): sweep stat-throw, aged-vs-fresh temps, fsync, and the
// write-failure cleanup lanes.
describe('json-store hardening lanes (GATE-01)', () => {
  const memFs = (files = {}) => {
    const key = (p) => String(p).replace(/\\/g, '/');
    return {
      readdirSync: () => Object.keys(files).map((k) => k.split('/').pop()),
      statSync: (p) => files[key(p)],
      unlinkSync: (p) => { delete files[key(p)]; },
      writeFileSync: (p, c) => { files[key(p)] = c; },
      renameSync: (a, b) => { files[key(b)] = files[key(a)]; delete files[key(a)]; },
      existsSync: (p) => key(p) in files,
    };
  };
  test('the sweep removes aged temps and leaves fresh ones', () => {
    const now = Date.now();
    const files = {
      '/u/a.json.tmp-1111': { isFile: () => true, mtimeMs: now - 7200000 },
      '/u/a.json.tmp-2222': { isFile: () => true, mtimeMs: now },
      '/u/dir-tmp-3333': { isFile: () => false, mtimeMs: 1 },
    };
    const fs = memFs(files);
    atomicWriteJson(fs, '/u/a.json', '{"v":1}');
    expect(Object.keys(files)).not.toContain('/u/a.json.tmp-1111');
    expect(Object.keys(files)).toContain('/u/dir-tmp-3333');
  });
  test('fsync runs when the fs provides it; a stat throw in the sweep is swallowed', () => {
    const files = {};
    const calls = [];
    const fs = memFs(files);
    fs.statSync = () => { throw new Error('locked'); };
    fs.openSync = () => { calls.push('open'); return 3; };
    fs.fsyncSync = () => calls.push('fsync');
    fs.closeSync = () => calls.push('close');
    expect(atomicWriteJson(fs, '/u/a.json', '{}')).toEqual({ ok: true });
    expect(calls).toEqual(['open', 'fsync', 'close']);
  });
  test('a failed write cleans the temp when it exists, and tolerates a failing cleanup', () => {
    const files = { '/u/a.json.tmp-old': { isFile: () => true, mtimeMs: 1 } };
    const fs = memFs(files);
    fs.writeFileSync = () => { throw new Error('no space'); };
    expect(atomicWriteJson(fs, '/u/a.json', '{}')).toEqual({ error: 'write-failed' });
    const gone = memFs({});
    gone.writeFileSync = () => { throw new Error('x'); };
    gone.existsSync = () => { throw new Error('y'); };
    expect(atomicWriteJson(gone, '/u/a.json', '{}')).toEqual({ error: 'write-failed' });
  });
});
