/**
 * settings.test.js — T-B5 versioned settings: migrate, clamp, store, fail-safe.
 */
import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { defaultSettings, migrate, clampZoom, clampWindowBounds, createSettingsStore } from '../../src/main/settings.js';

describe('migrate (EC-D1)', () => {
  test('garbage → defaults', () => {
    expect(migrate(null)).toEqual(defaultSettings());
    expect(migrate('nope')).toEqual(defaultSettings());
    expect(migrate(42)).toEqual(defaultSettings());
  });
  test('keeps valid known fields, drops unknown/invalid', () => {
    const m = migrate({ theme: 'ink', editorMode: 'bogus', zoomFactor: 5, evil: 1 });
    expect(m.theme).toBe('ink');
    expect(m.editorMode).toBe('live');   // invalid → default
    expect(m.zoomFactor).toBe(2.0);      // clamped
    expect('evil' in m).toBe(false);
    expect(m.version).toBe(1);
  });
  test('recents sanitized + capped at 10', () => {
    const recents = Array.from({ length: 15 }, (_, i) => ({ name: 'n' + i, path: '/p' + i }));
    recents.push({ name: 'bad' }); // no path → dropped
    const m = migrate({ recents });
    expect(m.recents).toHaveLength(10);
    expect(m.recents.every(r => typeof r.path === 'string')).toBe(true);
  });
});

describe('clampZoom', () => {
  test('bounds 0.6–2.0; NaN → 1', () => {
    expect(clampZoom(0.1)).toBe(0.6);
    expect(clampZoom(9)).toBe(2.0);
    expect(clampZoom('x')).toBe(1);
  });
});

describe('clampWindowBounds (EC-D2)', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  test('keeps on-screen bounds', () => {
    expect(clampWindowBounds({ x: 100, y: 100, w: 800, h: 600 }, displays))
      .toMatchObject({ x: 100, y: 100, w: 800, h: 600 });
  });
  test('drops off-screen coordinates', () => {
    const r = clampWindowBounds({ x: 9000, y: 9000, w: 800, h: 600 }, displays);
    expect(r.x).toBeUndefined();
    expect(r.w).toBe(800);
  });
});

describe('createSettingsStore', () => {
  function memFs(seed) {
    const files = { ...seed };
    return {
      _files: files,
      readFileSync: (p) => { if (!(p in files)) throw new Error('no'); return files[p]; },
      writeFileSync: (p, c) => { files[p] = c; },
      renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    };
  }
  const file = path.join('/ud', 'settings.json');

  test('load returns defaults when file missing', () => {
    const store = createSettingsStore({ fs: memFs(), path, userDataDir: '/ud' });
    expect(store.load()).toEqual(defaultSettings());
  });
  test('load on corrupt JSON → defaults (no throw)', () => {
    const store = createSettingsStore({ fs: memFs({ [file]: '{ broken' }), path, userDataDir: '/ud' });
    expect(store.load().theme).toBe('paper');
  });
  test('save then load round-trips migrated settings', () => {
    const fs = memFs();
    const store = createSettingsStore({ fs, path, userDataDir: '/ud' });
    store.save({ theme: 'sepia', zoomFactor: 1.5 });
    const loaded = store.load();
    expect(loaded.theme).toBe('sepia');
    expect(loaded.zoomFactor).toBe(1.5);
  });
});
