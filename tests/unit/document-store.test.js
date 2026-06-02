/**
 * document-store.test.js — T-AI1. Pure helpers + factory behavior via mock fs.
 */
import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import {
  createDocumentStore, hasBOM, detectEol, applyEol, normalize, hashContent, isInsideRoot,
} from '../../src/main/document-store.js';

// ── Pure helpers ────────────────────────────────────────────────────────────
describe('encoding helpers (EC-A1)', () => {
  test('hasBOM / normalize strips BOM + CRLF', () => {
    expect(hasBOM('﻿hi')).toBe(true);
    expect(normalize('﻿a\r\nb')).toBe('a\nb');
  });
  test('detectEol', () => {
    expect(detectEol('a\r\nb\r\n')).toBe('\r\n');
    expect(detectEol('a\nb\n')).toBe('\n');
  });
  test('applyEol round-trips', () => {
    expect(applyEol('a\nb', '\r\n')).toBe('a\r\nb');
    expect(applyEol('a\r\nb', '\n')).toBe('a\nb');
  });
  test('isInsideRoot (EC-A4)', () => {
    expect(isInsideRoot('/v/a.md', '/v', path.posix)).toBe(true);
    expect(isInsideRoot('/etc/x', '/v', path.posix)).toBe(false);
    expect(isInsideRoot('/v', '/v', path.posix)).toBe(false);
  });
});

// ── Mock fs ───────────────────────────────────────────────────────────────
function mockFs(initial = {}) {
  const files = { ...initial };
  return {
    _files: files,
    existsSync: (p) => p in files,
    readFileSync: (p) => { if (!(p in files)) { const e = new Error('no'); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFileSync: (p, c) => { files[p] = c; },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    unlinkSync: (p) => { delete files[p]; },
    statSync: () => ({ mtimeMs: 123 }),
  };
}

describe('write (EC-A1/A2/A3)', () => {
  test('preserves BOM + CRLF + final newline', () => {
    const fs = mockFs();
    const store = createDocumentStore({ fs, path: path.posix });
    const r = store.write('/v/a.md', 'x\ny', { root: '/v', bom: true, eol: '\r\n', finalNewline: true });
    expect(r.ok).toBe(true);
    expect(fs._files['/v/a.md']).toBe('﻿x\r\ny\r\n');
  });

  test('rejects conflict when on-disk hash differs from baseHash (EC-A2)', () => {
    const fs = mockFs({ '/v/a.md': 'ON DISK CHANGED' });
    const store = createDocumentStore({ fs, path: path.posix });
    const r = store.write('/v/a.md', 'mine', { root: '/v', baseHash: 'stale', eol: '\n' });
    expect(r).toEqual({ error: 'conflict' });
    expect(fs._files['/v/a.md']).toBe('ON DISK CHANGED'); // untouched
  });

  test('writes when baseHash matches current', () => {
    const fs = mockFs({ '/v/a.md': 'old\n' });
    const store = createDocumentStore({ fs, path: path.posix });
    const base = hashContent('old\n');
    const r = store.write('/v/a.md', 'new', { root: '/v', baseHash: base, eol: '\n' });
    expect(r.ok).toBe(true);
    expect(fs._files['/v/a.md']).toBe('new\n');
  });

  test('rejects out-of-root path (EC-A4)', () => {
    const fs = mockFs();
    const store = createDocumentStore({ fs, path: path.posix });
    expect(store.write('/etc/passwd', 'x', { root: '/v' })).toEqual({ error: 'unauthorized-path' });
  });

  test('atomic: writes temp then renames (no partial under target on failure)', () => {
    const fs = mockFs();
    fs.renameSync = vi.fn(() => { throw Object.assign(new Error('lock'), { code: 'EPERM' }); });
    const store = createDocumentStore({ fs, path: path.posix });
    const r = store.write('/v/a.md', 'x', { root: '/v', eol: '\n' });
    expect(r).toEqual({ error: 'write-failed' });
    expect('/v/a.md' in fs._files).toBe(false);
  });
});

describe('watch (T-B9 — external-change notification, EC-A2)', () => {
  test('debounces a burst of fs.watch events into one changed callback carrying the files', () => {
    vi.useFakeTimers();
    let listener;
    const watcher = { close: vi.fn() };
    const fs = { ...mockFs(), watch: vi.fn((root, opts, cb) => { listener = cb; return watcher; }) };
    const store = createDocumentStore({ fs, path: path.posix });
    const cb = vi.fn();
    const handle = store.watch('/v', cb, { debounceMs: 100 });
    expect(fs.watch).toHaveBeenCalledWith('/v', { recursive: true }, expect.any(Function));

    listener('change', 'a.md');
    listener('change', 'a.md'); // dup coalesced
    listener('rename', 'b.md');
    expect(cb).not.toHaveBeenCalled(); // still within the debounce window

    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].files.sort()).toEqual(['a.md', 'b.md']);

    handle.close();
    expect(watcher.close).toHaveBeenCalled();
    vi.useRealTimers();
  });

  test('missing fs.watch, or a watch that throws (EMFILE), → safe no-op disposable', () => {
    const s1 = createDocumentStore({ fs: { ...mockFs() }, path: path.posix }); // no .watch
    expect(() => s1.watch('/v', () => {}).close()).not.toThrow();
    const fs2 = { ...mockFs(), watch: () => { throw Object.assign(new Error('too many'), { code: 'EMFILE' }); } };
    const s2 = createDocumentStore({ fs: fs2, path: path.posix });
    expect(() => s2.watch('/v', () => {}).close()).not.toThrow();
  });
});

describe('listMarkdown (EC-A5)', () => {
  function dirent(name, kind) {
    return { name, isDirectory: () => kind === 'd', isFile: () => kind === 'f', isSymbolicLink: () => kind === 's' };
  }
  test('recurses subfolders, returns relPaths, cycle-safe', () => {
    const tree = {
      '/v': [dirent('a.md', 'f'), dirent('sub', 'd')],
      '/v/sub': [dirent('b.md', 'f'), dirent('loop', 'd')],
      '/v/sub/loop': [dirent('c.txt', 'f')], // non-md ignored; loop realpath -> /v
    };
    const realpaths = { '/v': '/v', '/v/sub': '/v/sub', '/v/sub/loop': '/v' };
    const fs = {
      realpathSync: (p) => realpaths[p] || p,
      readdirSync: (p) => tree[p] || [],
    };
    const store = createDocumentStore({ fs, path: path.posix });
    const out = store.listMarkdown('/v').map(x => x.relPath);
    expect(out).toEqual(['a.md', 'sub/b.md']); // loop pruned, .txt excluded
  });
  test('respects maxFiles', () => {
    const fs = {
      realpathSync: (p) => p,
      readdirSync: () => [dirent('1.md', 'f'), dirent('2.md', 'f'), dirent('3.md', 'f')],
    };
    const store = createDocumentStore({ fs, path: path.posix });
    expect(store.listMarkdown('/v', { maxFiles: 2 })).toHaveLength(2);
  });
});
