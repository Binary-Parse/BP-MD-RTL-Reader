/**
 * document-store-extra.test.js — read(), error mapping, fsync, crypto hash,
 * and list() catch/branch coverage for T-AI1.
 */
import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import { createDocumentStore } from '../../src/main/document-store.js';

describe('read()', () => {
  test('normalizes BOM/CRLF and reports meta', () => {
    const fs = { readFileSync: () => '﻿a\r\nb\r\n', statSync: () => ({ mtimeMs: 42 }) };
    const store = createDocumentStore({ fs, path: path.posix });
    const { content, meta } = store.read('/v/a.md');
    expect(content).toBe('a\nb\n');
    expect(meta).toMatchObject({ bom: true, eol: '\r\n', finalNewline: true, mtimeMs: 42 });
    expect(typeof meta.hash).toBe('string');
  });
});

describe('write() error mapping + fsync + crypto', () => {
  function fsWith(over) {
    const files = {};
    return Object.assign({
      _files: files,
      existsSync: (p) => p in files,
      readFileSync: (p) => files[p],
      writeFileSync: (p, c) => { files[p] = c; },
      renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
      unlinkSync: (p) => { delete files[p]; },
    }, over);
  }

  test('ENOSPC → enospc, ENOENT → gone', () => {
    const a = fsWith({ renameSync: () => { throw Object.assign(new Error(), { code: 'ENOSPC' }); } });
    expect(createDocumentStore({ fs: a, path: path.posix }).write('/v/x.md', 'y', { root: '/v', eol: '\n' }))
      .toEqual({ error: 'enospc' });
    const b = fsWith({ renameSync: () => { throw Object.assign(new Error(), { code: 'ENOENT' }); } });
    expect(createDocumentStore({ fs: b, path: path.posix }).write('/v/x.md', 'y', { root: '/v', eol: '\n' }))
      .toEqual({ error: 'gone' });
  });

  test('fsync path runs when fsyncSync present', () => {
    const calls = { fsync: 0 };
    const fs = fsWith({
      openSync: vi.fn(() => 3), closeSync: vi.fn(), fsyncSync: vi.fn(() => { calls.fsync++; }),
    });
    const r = createDocumentStore({ fs, path: path.posix }).write('/v/x.md', 'y', { root: '/v', eol: '\n' });
    expect(r.ok).toBe(true);
    expect(calls.fsync).toBe(1);
  });

  test('uses injected crypto for the hash', () => {
    const fs = fsWith({});
    const crypto = { createHash: () => ({ update() { return this; }, digest: () => 'HASHED' }) };
    const r = createDocumentStore({ fs, path: path.posix, crypto }).write('/v/x.md', 'y', { root: '/v', eol: '\n' });
    expect(r.meta.hash).toBe('HASHED');
  });

  test('finalNewline:false leaves no trailing newline', () => {
    const fs = fsWith({});
    createDocumentStore({ fs, path: path.posix }).write('/v/x.md', 'a\nb', { root: '/v', eol: '\n', finalNewline: false });
    expect(fs._files['/v/x.md']).toBe('a\nb');
  });
});

describe('listMarkdown() branches', () => {
  const dirent = (name, kind) => ({ name, isDirectory: () => kind === 'd', isFile: () => kind === 'f', isSymbolicLink: () => kind === 's' });

  test('readdir throw is caught (returns what it had)', () => {
    const fs = { realpathSync: (p) => p, readdirSync: () => { throw new Error('EACCES'); } };
    expect(createDocumentStore({ fs, path: path.posix }).listMarkdown('/v')).toEqual([]);
  });

  test('realpath throw on a subdir is caught', () => {
    const tree = { '/v': [dirent('a.md', 'f'), dirent('bad', 'd')] };
    const fs = {
      realpathSync: (p) => { if (p === '/v/bad') throw new Error('x'); return p; },
      readdirSync: (p) => tree[p] || [],
    };
    expect(createDocumentStore({ fs, path: path.posix }).listMarkdown('/v').map(x => x.relPath)).toEqual(['a.md']);
  });

  test('maxDepth halts recursion', () => {
    const tree = { '/v': [dirent('sub', 'd')], '/v/sub': [dirent('deep.md', 'f')] };
    const fs = { realpathSync: (p) => p, readdirSync: (p) => tree[p] || [] };
    const store = createDocumentStore({ fs, path: path.posix });
    expect(store.listMarkdown('/v', { maxDepth: 0 })).toEqual([]); // never descends
  });
});
