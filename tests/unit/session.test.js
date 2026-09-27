/**
 * session.test.js — T-B5/M6 last-session pure helpers.
 */
import { describe, test, expect } from 'vitest';
import { buildSession, pickActiveIndex, fileKey } from '../../src/renderer/session.js';

// B2/B4 (multi-folder workspaces): buildSession's return shape is the forest-ready
// { vaults: [{vaultId, openPaths}], activeVaultId, activePath }. audit UX-04: the vault list
// is derived from the OPEN FILES themselves and every vault is kept — restoring only
// vaults[0] used to drop every other open folder. A synthetic (non-`cap-`) id is never
// persisted: a browser File System Access API pick or the demo set names nothing readVault
// can re-open on the next launch.
describe('buildSession', () => {
  const files = [
    { path: 'a.md', vaultId: 'cap-vault' },
    { path: 'sub/b.md', vaultId: 'cap-vault' },
    { path: 'c.md', vaultId: 'cap-vault' },
  ];

  test('snapshots vaultId + openPaths + the active tab path, in the forest shape', () => {
    expect(buildSession(files, 1)).toEqual({
      vaults: [{ vaultId: 'cap-vault', openPaths: ['a.md', 'sub/b.md', 'c.md'] }],
      activeVaultId: 'cap-vault',
      activePath: 'sub/b.md',
    });
  });

  test('null when there is no vault-backed file (nothing to restore)', () => {
    expect(buildSession([], 0)).toBe(null);
    expect(buildSession(null, 0)).toBe(null);
    expect(buildSession([{ path: 'a.md' }, {}], 0)).toBe(null);          // no vaultId at all
    expect(buildSession([{ path: 'a.md', vaultId: 123 }], 0)).toBe(null); // non-string id
  });

  // Only main-issued `cap-` ids name something readVault can actually re-open.
  test('null for a non-capability vaultId (synthetic local-*/demo ids are never persisted)', () => {
    expect(buildSession([{ path: 'a.md', vaultId: 'local-abc123' }], 0)).toBe(null);
    expect(buildSession([{ path: 'a.md', vaultId: 'demo' }], 0)).toBe(null);
  });

  test('groups EVERY open vault, each listing only its own open tabs', () => {
    const multi = [
      { path: 'notes/todo.md', vaultId: 'cap-a', open: true },
      { path: 'notes/todo.md', vaultId: 'cap-b', open: true },
      { path: 'closed.md', vaultId: 'cap-b', open: false },
    ];
    expect(buildSession(multi, 1)).toEqual({
      vaults: [
        { vaultId: 'cap-a', openPaths: ['notes/todo.md'] },
        { vaultId: 'cap-b', openPaths: ['notes/todo.md'] },
      ],
      activeVaultId: 'cap-b',
      activePath: 'notes/todo.md',
    });
  });

  test('a vault whose every tab is closed contributes no entry (and only-vault → null)', () => {
    const filesWithClosed = [
      { path: 'a.md', vaultId: 'cap-a', open: true },
      { path: 'b.md', vaultId: 'cap-b', open: false },
    ];
    expect(buildSession(filesWithClosed, 0)).toEqual({
      vaults: [{ vaultId: 'cap-a', openPaths: ['a.md'] }],
      activeVaultId: 'cap-a',
      activePath: 'a.md',
    });
    expect(buildSession([{ path: 'b.md', vaultId: 'cap-b', open: false }], 0)).toBe(null);
  });

  test('activeVaultId is undefined when the active file carries no usable vault id', () => {
    const mixed = [
      { path: 'a.md', vaultId: 'cap-vault' },
      { path: 'loose.md', vaultId: 'local-1' },
    ];
    expect(buildSession(mixed, 1).activeVaultId).toBeUndefined();
    expect(buildSession(mixed, 1).activePath).toBe('loose.md');
  });

  test('activePath is undefined when the active file path is not a string', () => {
    expect(buildSession([{ path: 'a.md', vaultId: 'cap-v' }, { path: 42, vaultId: 'cap-v' }], 1).activePath).toBeUndefined();
  });

  test('activePath is undefined when the active index is null/out of range', () => {
    expect(buildSession(files, null).activePath).toBeUndefined();
    expect(buildSession(files, 9).activePath).toBeUndefined();
  });

  test('drops files without a string path from openPaths', () => {
    const mixed = [
      { path: 'a.md', vaultId: 'cap-v' },
      { handle: {}, vaultId: 'cap-v' },
      { path: 'b.md', vaultId: 'cap-v' },
    ];
    expect(buildSession(mixed, 0).vaults[0].openPaths).toEqual(['a.md', 'b.md']);
  });
});

describe('fileKey', () => {
  test('a document-capability file (single-file open) keys on its documentId', () => {
    expect(fileKey({ documentId: 'cap-doc-1', path: 'a.md' })).toBe('doc:cap-doc-1');
  });

  test('a vault file keys on vaultId + path, so two folders sharing a path never collide', () => {
    expect(fileKey({ vaultId: 'cap-a', path: 'notes/todo.md' })).toBe('vault:cap-a notes/todo.md');
    expect(fileKey({ vaultId: 'cap-b', path: 'notes/todo.md' })).toBe('vault:cap-b notes/todo.md');
  });

  test('a loose file (no documentId, no vaultId) keys on its bare path', () => {
    expect(fileKey({ path: 'untitled.md' })).toBe('loose:untitled.md');
  });

  test('vault identity takes priority over the per-session documentId, so persisted per-file state survives restarts (DATA-01)', () => {
    expect(fileKey({ documentId: 'cap-doc-9', vaultId: 'cap-a', path: 'x.md' })).toBe('vault:cap-a x.md');
    const sessionOne = fileKey({ documentId: 'cap-grant-1', vaultId: 'cap-a', path: 'x.md' });
    const sessionTwo = fileKey({ documentId: 'cap-grant-2', vaultId: 'cap-a', path: 'x.md' });
    expect(sessionOne).toBe(sessionTwo);
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

  // audit UX-04: two folders can share a relative path, so the (path, vaultId) pair wins
  // over a path-only match.
  test('prefers the exact (path, vaultId) match over another vault sharing the path', () => {
    const shared = [
      { path: 'notes/todo.md', vaultId: 'cap-a' },
      { path: 'notes/todo.md', vaultId: 'cap-b' },
      { path: 'other.md', vaultId: 'cap-c' },
    ];
    expect(pickActiveIndex(shared, 'notes/todo.md', 'cap-b')).toBe(1);
    expect(pickActiveIndex(shared, 'notes/todo.md', 'cap-a')).toBe(0);
  });

  test('falls back to a path-only match when the vault id is unknown/absent', () => {
    const shared = [
      { path: 'notes/todo.md', vaultId: 'cap-a' },
      { path: 'notes/todo.md', vaultId: 'cap-b' },
    ];
    expect(pickActiveIndex(shared, 'notes/todo.md', 'cap-gone')).toBe(0);
    expect(pickActiveIndex(shared, 'notes/todo.md')).toBe(0);
  });
});
