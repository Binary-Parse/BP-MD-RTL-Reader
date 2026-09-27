/**
 * reading-progress.test.js — T4.1a pure helpers for the Continue-reading shelf.
 * Plain node environment (like session.test.js): nothing here touches the DOM.
 */
import { describe, test, expect } from 'vitest';
import {
  PROGRESS_CAP,
  scrollRatio,
  progressPercent,
  progressEntryFor,
  sanitizeProgress,
  upsertProgress,
  relativeTime,
} from '../../src/renderer/reading-progress.js';

const vaultFile = (over = {}) => ({
  name: 'a.md', path: 'a.md', vaultId: 'cap-v', documentId: 'cap-d', ...over,
});

describe('scrollRatio', () => {
  test('0 at the top, 1 at the bottom', () => {
    expect(scrollRatio({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 })).toBe(0);
    expect(scrollRatio({ scrollTop: 500, scrollHeight: 1000, clientHeight: 500 })).toBe(1);
    expect(scrollRatio({ scrollTop: 250, scrollHeight: 1000, clientHeight: 500 })).toBe(0.5);
  });

  test('null when the element cannot scroll (short note, no layout, no element)', () => {
    expect(scrollRatio({ scrollTop: 0, scrollHeight: 400, clientHeight: 500 })).toBeNull();
    expect(scrollRatio({ scrollTop: 0, scrollHeight: 500, clientHeight: 500 })).toBeNull();
    expect(scrollRatio({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500.5 })).not.toBeNull();
    expect(scrollRatio(null)).toBeNull();
    expect(scrollRatio(undefined)).toBeNull();
  });

  test('clamps out-of-range scrollTop and rejects non-numeric geometry', () => {
    expect(scrollRatio({ scrollTop: -40, scrollHeight: 1000, clientHeight: 500 })).toBe(0);
    expect(scrollRatio({ scrollTop: 99999, scrollHeight: 1000, clientHeight: 500 })).toBe(1);
    expect(scrollRatio({ scrollTop: 'x', scrollHeight: 1000, clientHeight: 500 })).toBeNull();
    expect(scrollRatio({ scrollTop: 10, scrollHeight: NaN, clientHeight: 500 })).toBeNull();
  });
});

describe('progressPercent', () => {
  test('rounds to an integer percentage and clamps', () => {
    expect(progressPercent(0)).toBe(0);
    expect(progressPercent(0.5)).toBe(50);
    expect(progressPercent(1)).toBe(100);
    expect(progressPercent(0.666)).toBe(67);
    expect(progressPercent(2)).toBe(100);
    expect(progressPercent(-1)).toBe(0);
  });

  test('non-numbers read as 0', () => {
    for (const bad of [undefined, null, '0.5', NaN, Infinity]) expect(progressPercent(bad)).toBe(0);
  });
});

describe('progressEntryFor', () => {
  test('builds the stored shape for a vault file and for a document-only file', () => {
    expect(progressEntryFor(vaultFile(), 0.25, 1000)).toEqual({
      key: 'vault:cap-v a.md', name: 'a.md', path: 'a.md',
      vaultId: 'cap-v', documentId: 'cap-d', ratio: 0.25, at: 1000,
    });
    const docOnly = progressEntryFor({ name: 'b.md', path: 'b.md', documentId: 'cap-d2' }, 1, 2000);
    expect(docOnly).toMatchObject({ key: 'doc:cap-d2', vaultId: null, documentId: 'cap-d2' });
    const vaultOnly = progressEntryFor({ name: 'c.md', path: 'c.md', vaultId: 'cap-v2' }, 0.5, 3000);
    expect(vaultOnly).toMatchObject({ key: 'vault:cap-v2 c.md', vaultId: 'cap-v2', documentId: null });
  });

  test('rejects a loose/untitled file, a bad ratio, and malformed ids', () => {
    expect(progressEntryFor({ name: 'loose.md', path: 'loose.md' }, 0.5, 1)).toBeNull();
    expect(progressEntryFor({ path: 'x.md', vaultId: 'v' }, 0.5, 1)).toBeNull();   // id not cap-
    expect(progressEntryFor({ path: 'x.md', vaultId: 'cap-v' }, 'half', 1)).toBeNull();
    expect(progressEntryFor({ path: 'x.md', vaultId: 'cap-v' }, NaN, 1)).toBeNull();
    expect(progressEntryFor(null, 0.5, 1)).toBeNull();
    expect(progressEntryFor({ path: '' }, 0.5, 1)).toBeNull(); // no key at all
  });

  test('clamps the ratio and stamps a missing/!finite `at` with now', () => {
    expect(progressEntryFor(vaultFile(), 1.5, 1000).ratio).toBe(1);
    expect(progressEntryFor(vaultFile(), -1, 1000).ratio).toBe(0);
    const noStamp = progressEntryFor(vaultFile(), 0.5, undefined);
    expect(noStamp.at).toBeGreaterThan(0);
    expect(progressEntryFor(vaultFile(), 0.5, -5).at).toBeGreaterThan(0);
    expect(progressEntryFor(vaultFile(), 0.5, NaN).at).toBeGreaterThan(0);
  });
});

describe('sanitizeProgress', () => {
  test('non-arrays and every malformed shape are dropped', () => {
    expect(sanitizeProgress('nope')).toEqual([]);
    expect(sanitizeProgress(null)).toEqual([]);
    expect(sanitizeProgress([
      null, 'x', {},
      { path: '', ratio: 0.5, at: 1, vaultId: 'cap-v' },
      { path: 'a.md', ratio: '0.5', at: 1, vaultId: 'cap-v' },
      { path: 'a.md', ratio: NaN, at: 1, vaultId: 'cap-v' },
      { path: 'a.md', ratio: 1.5, at: 1, vaultId: 'cap-v' },
      { path: 'a.md', ratio: 0.5, at: 0, vaultId: 'cap-v' },
      { path: 'a.md', ratio: 0.5, at: Infinity, vaultId: 'cap-v' },
      { path: 'a.md', ratio: 0.5, at: 1 },
      { path: 'a.md', ratio: 0.5, at: 1, vaultId: 'nope' },
      { path: 'a.md', ratio: 0.5, at: 1, documentId: 'nope' },
    ])).toEqual([]);
  });

  test('keeps valid entries, normalises missing fields, sorts newest first, caps at 30', () => {
    const kept = sanitizeProgress([{ path: 'a.md', ratio: 0.4, at: 5, vaultId: 'cap-v', extra: 1 }]);
    expect(kept).toEqual([{ key: '', name: '', path: 'a.md', vaultId: 'cap-v', documentId: null, ratio: 0.4, at: 5 }]);

    const many = Array.from({ length: 35 }, (_, i) => ({ path: `f${i}.md`, ratio: 0.5, at: i + 1, vaultId: 'cap-v' }));
    const capped = sanitizeProgress(many);
    expect(capped).toHaveLength(PROGRESS_CAP);
    expect(capped[0].at).toBe(35);
    expect(capped.at(-1).at).toBe(6);
  });
});

describe('upsertProgress', () => {
  test('puts the entry first, replaces the same key, and never mutates the input', () => {
    const list = [{ key: 'k1', at: 1 }, { key: 'k2', at: 2 }];
    const next = upsertProgress(list, { key: 'k2', at: 9 });
    expect(next.map((e) => e.key)).toEqual(['k2', 'k1']);
    expect(next[0].at).toBe(9);
    expect(list.map((e) => e.key)).toEqual(['k1', 'k2']); // untouched
    expect(next).not.toBe(list);
  });

  test('caps at 30 and tolerates a missing/!invalid list or entry', () => {
    const full = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, at: i }));
    const overflow = upsertProgress(full, { key: 'new', at: 99 });
    expect(overflow).toHaveLength(PROGRESS_CAP);
    expect(overflow[0].key).toBe('new');
    expect(overflow.at(-1).key).toBe('k28'); // k29 pushed past the cap
    expect(upsertProgress(null, { key: 'solo' })).toEqual([{ key: 'solo' }]);
    expect(upsertProgress(full, null)).toHaveLength(PROGRESS_CAP);
    expect(upsertProgress(null, null)).toEqual([]);
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 8, 21, 12, 0, 0);

  test('labels every bucket with a non-empty string in both locales', () => {
    const at = (secondsAgo) => now - secondsAgo * 1000;
    for (const secondsAgo of [10, 60 * 5, 3600 * 3, 86400 * 2, 86400 * 9, 86400 * 60, 86400 * 400]) {
      const en = relativeTime(at(secondsAgo), 'en', now);
      const ar = relativeTime(at(secondsAgo), 'ar', now);
      expect(en.length, `en for ${secondsAgo}s`).toBeGreaterThan(0);
      expect(ar.length, `ar for ${secondsAgo}s`).toBeGreaterThan(0);
      expect(en).not.toBe(ar); // really localized, not a passthrough
    }
  });

  test('a fresh entry reads as ~1 minute ago, and future stamps are positive', () => {
    expect(relativeTime(now, 'en', now)).toMatch(/minute/);
    expect(relativeTime(now + 3600 * 1000, 'en', now)).toMatch(/hour/);
  });

  test('defaults the locale and tolerates a non-numeric stamp', () => {
    expect(relativeTime(now - 3600 * 1000, undefined, now).length).toBeGreaterThan(0);
    expect(relativeTime('not-a-date', 'en', now)).toBe('');
  });
});
