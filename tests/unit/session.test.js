/**
 * session.test.js — T-B5/M6 last-session pure helpers.
 */
import { describe, test, expect } from 'vitest';
import { buildSession, pickActiveIndex } from '../../src/renderer/session.js';

describe('buildSession', () => {
  const files = [{ path: 'a.md' }, { path: 'sub/b.md' }, { path: 'c.md' }];

  test('snapshots vaultId + openPaths + the active tab path', () => {
    expect(buildSession('cap-vault', files, 1)).toEqual({
      vaultId: 'cap-vault',
      openPaths: ['a.md', 'sub/b.md', 'c.md'],
      activePath: 'sub/b.md',
    });
  });

  test('null when there is no vault or no files (nothing to restore)', () => {
    expect(buildSession('', files, 0)).toBe(null);
    expect(buildSession(null, files, 0)).toBe(null);
    expect(buildSession('/vault', [], null)).toBe(null);
    expect(buildSession('/vault', [{}, {}], 0)).toBe(null); // no disk paths
    expect(buildSession(123, files, 0)).toBe(null);         // type guard: truthy non-string vaultPath
  });

  test('activePath is undefined when the active file path is not a string', () => {
    expect(buildSession('/vault', [{ path: 'a.md' }, { path: 42 }], 1).activePath).toBeUndefined();
  });

  test('activePath is undefined when the active index is null/out of range', () => {
    expect(buildSession('/vault', files, null).activePath).toBeUndefined();
    expect(buildSession('/vault', files, 9).activePath).toBeUndefined();
  });

  test('drops files without a string path from openPaths', () => {
    const mixed = [{ path: 'a.md' }, { handle: {} }, { path: 'b.md' }];
    expect(buildSession('/v', mixed, 0).openPaths).toEqual(['a.md', 'b.md']);
  });
});

describe('pickActiveIndex', () => {
  const files = [{ path: 'a.md' }, { path: 'b.md' }, { path: 'c.md' }];

  test('returns the index of the matching activePath', () => {
    expect(pickActiveIndex(files, 'b.md')).toBe(1);
    expect(pickActiveIndex(files, 'c.md')).toBe(2);
  });

  test('falls back to 0 for a missing/undefined path or empty list', () => {
    expect(pickActiveIndex(files, 'gone.md')).toBe(0);
    expect(pickActiveIndex(files, undefined)).toBe(0);
    expect(pickActiveIndex([], 'a.md')).toBe(0);
  });

  test('returns 0 without throwing for a non-array files argument', () => {
    expect(pickActiveIndex(null, 'a.md')).toBe(0);
    expect(pickActiveIndex(undefined, 'x')).toBe(0);
  });
});
