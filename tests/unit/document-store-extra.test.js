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

  test('a save reports the bytes it wrote, in the encoding of the file', () => {
    const run = (content, opts) => createDocumentStore({ fs: fsWith({}), path: path.posix })
      .write('/v/x.md', content, { root: '/v', eol: '\n', finalNewline: false, ...opts });
    expect(run('abc', {})).toMatchObject({ ok: true, size: 3 });
    expect(run('مرحبا', {}).size).toBe(10); // five Arabic letters, two bytes each in UTF-8
    expect(run('a\nb', { eol: '\r\n' }).size).toBe(4); // the line ending is counted as written
    expect(run('abc', { bom: true }).size).toBe(6); // U+FEFF is three bytes in UTF-8
    expect(run('مرحبا', { encoding: 'windows-1256' }).size).toBe(5);
    expect(run('abc', { encoding: 'utf16le' }).size).toBe(6);
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
