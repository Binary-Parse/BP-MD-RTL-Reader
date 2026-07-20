/**
 * settings.test.js — T-B5 versioned settings: migrate, clamp, store, fail-safe.
 */
import { describe, test, expect } from 'vitest';
import path from 'node:path';
import { defaultSettings, migrate, clampZoom, clampWindowBounds, createSettingsStore } from '../../src/main/settings.js';

describe('migrate (EC-D1)', () => {
  test('v2 persists opaque capability IDs but never filesystem paths', () => {
    const migrated = migrate({
      recents: [
        { name: 'a.md', path: 'sub/a.md', vaultId: 'cap-vault', documentId: 'cap-doc', vaultRoot: '/forged', abs: '/forged/a.md' },
        { name: 'legacy.md', path: 'legacy.md', vaultRoot: '/legacy' },
      ],
      lastSession: { vaultId: 'cap-vault', vaultPath: '/forged', openPaths: ['sub/a.md'], activePath: 'sub/a.md' },
    });
    expect(migrated.version).toBe(2);
    expect(migrated.recents).toEqual([
      { name: 'a.md', path: 'sub/a.md', vaultId: 'cap-vault', documentId: 'cap-doc' },
    ]);
    expect(migrated.lastSession).toEqual({ vaultId: 'cap-vault', openPaths: ['sub/a.md'], activePath: 'sub/a.md' });
    expect(JSON.stringify(migrated)).not.toContain('/forged');
    expect(JSON.stringify(migrated)).not.toContain('/legacy');
  });
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
    expect(m.version).toBe(2);
  });
  test('arabicKashida (T-R10): defaults false; accepts boolean; coerces non-boolean to default', () => {
    expect(defaultSettings().arabicKashida).toBe(false);   // ragged by default
    expect(migrate({ arabicKashida: true }).arabicKashida).toBe(true);
    expect(migrate({ arabicKashida: 'yes' }).arabicKashida).toBe(false); // non-boolean → default
    expect(migrate({}).arabicKashida).toBe(false);
  });

  test('italicRecolor (T-F11): defaults true (recolor on); opt-out via boolean false', () => {
    expect(defaultSettings().italicRecolor).toBe(true);    // recolor ON by default (opt-OUT feature)
    expect(migrate({ italicRecolor: false }).italicRecolor).toBe(false);
    expect(migrate({ italicRecolor: 'no' }).italicRecolor).toBe(true); // non-boolean → default true
    expect(migrate({}).italicRecolor).toBe(true);
  });

  test('cmEditor (A1): defaults false; opt-in via boolean true; non-boolean → default', () => {
    expect(defaultSettings().cmEditor).toBe(false);
    expect(migrate({ cmEditor: true }).cmEditor).toBe(true);
    expect(migrate({ cmEditor: 'yes' }).cmEditor).toBe(false); // non-boolean → default
    expect(migrate({}).cmEditor).toBe(false);
  });

  test('side panels default to CLOSED (clean editor-first launch); a saved boolean is kept', () => {
    expect(defaultSettings().sidebarVisible).toBe(false);
    expect(defaultSettings().inspectorVisible).toBe(false);
    // a user who opened a panel has it remembered
    expect(migrate({ sidebarVisible: true }).sidebarVisible).toBe(true);
    expect(migrate({ inspectorVisible: true }).inspectorVisible).toBe(true);
    expect(migrate({}).sidebarVisible).toBe(false); // no saved value → closed
  });

  test('lastSession (M6): round-trips an opaque-capability session and drops legacy/corrupt authority', () => {
    expect(defaultSettings().lastSession).toBe(null);
    const ls = { vaultId: 'cap-vault', openPaths: ['a.md', 'sub/b.md'], activePath: 'sub/b.md' };
    expect(migrate({ lastSession: ls }).lastSession).toEqual(ls);
    expect(migrate({ lastSession: { vaultPath: '/legacy', openPaths: [], activePath: 'a.md' } }).lastSession).toBeNull();
    const dirty = migrate({ lastSession: { vaultId: 'cap-vault', openPaths: 'nope', activePath: { x: 1 } } }).lastSession;
    expect(dirty).toEqual({ vaultId: 'cap-vault', openPaths: [], activePath: undefined });
    // non-string entries are filtered out of openPaths
    expect(migrate({ lastSession: { vaultId: 'cap-vault', openPaths: ['a.md', 7, null, 'b.md'] } }).lastSession.openPaths).toEqual(['a.md', 'b.md']);
    // a non-object lastSession → null (default)
    expect(migrate({ lastSession: 'nope' }).lastSession).toBe(null);
  });

  test('recents sanitized + capped at 10', () => {
    const recents = Array.from({ length: 15 }, (_, i) => ({ name: 'n' + i, path: 'p' + i, vaultId: `cap-v${i}` }));
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

// ── Mutation-hardening (audit F-3): every migrate field + window clamp branch. ──
describe('migrate — enum + type coercion (exact, mutation kills)', () => {
  test('theme: valid kept, invalid → default paper', () => {
    expect(migrate({ theme: 'ink' }).theme).toBe('ink');
    expect(migrate({ theme: 'sepia' }).theme).toBe('sepia');
    expect(migrate({ theme: 'neon' }).theme).toBe('paper');
    expect(migrate({ theme: 42 }).theme).toBe('paper');
  });
  test('editorMode: valid kept, invalid → live', () => {
    expect(migrate({ editorMode: 'split' }).editorMode).toBe('split');
    expect(migrate({ editorMode: 'source' }).editorMode).toBe('source');
    expect(migrate({ editorMode: 'zoomy' }).editorMode).toBe('live');
  });
  test('viewMode (T-F17): reading-first default; valid kept; invalid/missing → reading', () => {
    expect(defaultSettings().viewMode).toBe('reading');
    expect(migrate({ viewMode: 'edit' }).viewMode).toBe('edit');
    expect(migrate({ viewMode: 'reading' }).viewMode).toBe('reading');
    expect(migrate({ viewMode: 'bogus' }).viewMode).toBe('reading'); // invalid → default
    expect(migrate({ viewMode: 42 }).viewMode).toBe('reading');      // non-string → default
    expect(migrate({}).viewMode).toBe('reading');                    // missing → default
  });
  test('uiDirection rtl/ltr only', () => {
    expect(migrate({ uiDirection: 'rtl' }).uiDirection).toBe('rtl');
    expect(migrate({ uiDirection: 'ltr' }).uiDirection).toBe('ltr');
    expect(migrate({ uiDirection: 'sideways' }).uiDirection).toBe('ltr');
  });
  test('uiLocale ar/en, numerals, calendar enums', () => {
    expect(migrate({ uiLocale: 'ar' }).uiLocale).toBe('ar');
    expect(migrate({ uiLocale: 'fr' }).uiLocale).toBe('en');
    expect(migrate({ numerals: 'arabic-indic' }).numerals).toBe('arabic-indic');
    expect(migrate({ numerals: 'roman' }).numerals).toBe('western');
    expect(migrate({ calendar: 'hijri' }).calendar).toBe('hijri');
    expect(migrate({ calendar: 'mayan' }).calendar).toBe('gregorian');
  });
  test('boolean flags: true/false preserved, non-boolean → default', () => {
    for (const k of ['sidebarVisible', 'inspectorVisible', 'arabicKashida', 'italicRecolor', 'cmEditor']) {
      expect(migrate({ [k]: true })[k]).toBe(true);
      expect(migrate({ [k]: false })[k]).toBe(false);
      expect(migrate({ [k]: 'yes' })[k]).toBe(defaultSettings()[k]); // non-boolean ignored
    }
  });
  test('zoomFactor routed through clampZoom', () => {
    expect(migrate({ zoomFactor: 5 }).zoomFactor).toBe(2.0);
    expect(migrate({ zoomFactor: 0.1 }).zoomFactor).toBe(0.6);
    expect(migrate({ zoomFactor: 'x' }).zoomFactor).toBe(1);
  });
  test('recents: non-array/legacy paths dropped; capability entries sanitized and capped', () => {
    expect(migrate({ recents: 'nope' }).recents).toEqual([]);
    expect(migrate({ recents: [{ path: 'legacy', vaultRoot: '/v' }, { name: 'B', path: 'b', vaultId: 'cap-v' }, { name: 'C', path: 'c', documentId: 'cap-d' }, { nopath: 1 }, null] }).recents)
      .toEqual([{ name: 'B', path: 'b', vaultId: 'cap-v', documentId: null }, { name: 'C', path: 'c', vaultId: null, documentId: 'cap-d' }]);
    const many = Array.from({ length: 15 }, (_, i) => ({ path: 'p' + i, vaultId: `cap-v${i}` }));
    expect(migrate({ recents: many }).recents.length).toBe(10);
  });
  test('window: finite x/y kept, non-finite dropped; w/h default; maximized coerced', () => {
    expect(migrate({ window: { x: 10, y: 20, w: 800, h: 600, maximized: 1 } }).window)
      .toEqual({ x: 10, y: 20, w: 800, h: 600, maximized: true });
    expect(migrate({ window: { x: NaN, y: 'q', maximized: 0 } }).window)
      .toEqual({ x: undefined, y: undefined, w: 1280, h: 820, maximized: false });
  });
  test('lastSession mapping filters non-string openPaths', () => {
    expect(migrate({ lastSession: { vaultId: 'cap-v', openPaths: ['a', 2, 'b', null], activePath: 'a' } }).lastSession)
      .toEqual({ vaultId: 'cap-v', openPaths: ['a', 'b'], activePath: 'a' });
    expect(migrate({ lastSession: { openPaths: 'x' } }).lastSession).toBeNull();
  });
  test('version is always stamped', () => {
    expect(migrate({ version: 999 }).version).toBe(2);
  });
});

describe('clampWindowBounds — geometry branches (exact)', () => {
  const DISP = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  test('no win / empty or non-array displays → default size, no x/y', () => {
    expect(clampWindowBounds(null, DISP)).toEqual({ w: 1280, h: 820, maximized: false });
    expect(clampWindowBounds({ x: 1, y: 1, w: 800, h: 600 }, [])).toEqual({ w: 1280, h: 820, maximized: false });
    expect(clampWindowBounds({ x: 1, y: 1 }, 'nope')).toEqual({ w: 1280, h: 820, maximized: false });
  });
  test('null x/y → keep size, drop position, coerce maximized', () => {
    expect(clampWindowBounds({ x: null, y: null, w: 900, h: 700, maximized: 'yes' }, DISP))
      .toEqual({ w: 900, h: 700, maximized: true });
    expect(clampWindowBounds({ w: undefined, h: undefined }, DISP)) // missing x/y AND w/h → def w/h
      .toEqual({ w: 1280, h: 820, maximized: false });
  });
  test('on-screen window keeps x/y/w/h', () => {
    expect(clampWindowBounds({ x: 100, y: 100, w: 800, h: 600, maximized: false }, DISP))
      .toEqual({ x: 100, y: 100, w: 800, h: 600, maximized: false });
  });
  test('fully off-screen window drops x/y (keeps size)', () => {
    expect(clampWindowBounds({ x: 5000, y: 5000, w: 800, h: 600 }, DISP))
      .toEqual({ w: 800, h: 600, maximized: false });
    expect(clampWindowBounds({ x: -2000, y: -2000, w: 800, h: 600 }, DISP))
      .toEqual({ w: 800, h: 600, maximized: false });
  });
  test('partially on-screen (overlaps an edge) is kept', () => {
    expect(clampWindowBounds({ x: 1900, y: 1000, w: 800, h: 600 }, DISP).x).toBe(1900); // overlaps right/bottom edge
  });
});
