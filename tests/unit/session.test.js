/**
 * session.test.js — T-B5/M6 last-session pure helpers.
 */
import { describe, test, expect } from 'vitest';
import { buildSession, pickActiveIndex, fileKey } from '../../src/renderer/session.js';

// B2 (multi-folder workspaces): buildSession's return shape moved from a flat
// { vaultId, openPaths, activePath } to a forest-ready { vaults: [{vaultId, openPaths}],
// activeVaultId, activePath } — settings.js's migrate() reads both shapes so an old
// settings.json still restores. Only one vault is ever open going into this array
// today (workspace-controller.js still tracks a single vaultId); Track B3/B4 populate
// more than one entry once multiple folders can stay open at once.
describe('buildSession', () => {
  const files = [{ path: 'a.md' }, { path: 'sub/b.md' }, { path: 'c.md' }];

  test('snapshots vaultId + openPaths + the active tab path, in the forest shape', () => {
    expect(buildSession('cap-vault', files, 1)).toEqual({
      vaults: [{ vaultId: 'cap-vault', openPaths: ['a.md', 'sub/b.md', 'c.md'] }],
      activeVaultId: 'cap-vault',
      activePath: 'sub/b.md',
    });
  });

  test('null when there is no vault or no files (nothing to restore)', () => {
    expect(buildSession('', files, 0)).toBe(null);
    expect(buildSession(null, files, 0)).toBe(null);
    expect(buildSession('cap-vault', [], null)).toBe(null);
    expect(buildSession('cap-vault', [{}, {}], 0)).toBe(null); // no disk paths
    expect(buildSession(123, files, 0)).toBe(null);            // type guard: truthy non-string vaultPath
  });

  // A synthetic, non-capability id (a browser File System Access API pick, or the demo
  // set) must never be persisted as a restorable vault — only main-issued `cap-` ids
  // name something readVault can actually re-open on the next launch.
  test('null for a non-capability vaultId (synthetic local-*/demo ids are never persisted)', () => {
    expect(buildSession('local-abc123', files, 0)).toBe(null);
    expect(buildSession('demo', files, 0)).toBe(null);
  });

  test('activePath is undefined when the active file path is not a string', () => {
    expect(buildSession('cap-vault', [{ path: 'a.md' }, { path: 42 }], 1).activePath).toBeUndefined();
  });

  test('activePath is undefined when the active index is null/out of range', () => {
    expect(buildSession('cap-vault', files, null).activePath).toBeUndefined();
    expect(buildSession('cap-vault', files, 9).activePath).toBeUndefined();
  });

  test('drops files without a string path from openPaths', () => {
    const mixed = [{ path: 'a.md' }, { handle: {} }, { path: 'b.md' }];
    expect(buildSession('cap-v', mixed, 0).vaults[0].openPaths).toEqual(['a.md', 'b.md']);
  });
});

describe('fileKey', () => {
  test('a document-capability file (single-file open) keys on its documentId', () => {
    expect(fileKey({ documentId: 'cap-doc-1', vaultId: 'cap-vault-a', path: 'a.md' })).toBe('doc:cap-doc-1');
  });

  test('a vault file keys on vaultId + path, so two folders sharing a path never collide', () => {
    expect(fileKey({ vaultId: 'cap-a', path: 'notes/todo.md' })).toBe('vault:cap-a notes/todo.md');
    expect(fileKey({ vaultId: 'cap-b', path: 'notes/todo.md' })).toBe('vault:cap-b notes/todo.md');
  });

  test('a loose file (no documentId, no vaultId) keys on its bare path', () => {
    expect(fileKey({ path: 'untitled.md' })).toBe('loose:untitled.md');
  });

  test('documentId takes priority over vaultId when both are present', () => {
    expect(fileKey({ documentId: 'cap-doc-9', vaultId: 'cap-a', path: 'x.md' })).toBe('doc:cap-doc-9');
  });

  test('null for a falsy file or a file with no usable identity', () => {
    expect(fileKey(null)).toBeNull();
    expect(fileKey({})).toBeNull();
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
