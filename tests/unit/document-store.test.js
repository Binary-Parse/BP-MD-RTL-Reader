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

// ── Mutation-hardening (audit F-3): EOL heuristic, hash fallback, read meta, write
//    encoding/conflict/atomic/error branches, and the vault-walk guards. ──
import { stripBOM } from '../../src/main/document-store.js';

describe('encoding helpers — exact branches (mutation kills)', () => {
  test('detectEol: pure/mixed/equal/none', () => {
    expect(detectEol('a\nb\nc')).toBe('\n');               // pure LF
    expect(detectEol('a\r\nb\r\n')).toBe('\r\n');           // pure CRLF
    expect(detectEol('a\r\nb\r\nc\nd')).toBe('\r\n');       // crlf(2) >= lf(1)
    expect(detectEol('a\nb\nc\r\nd')).toBe('\n');           // lf(2) > crlf(1)
    expect(detectEol('a\r\nb\nc')).toBe('\r\n');            // equal (1==1), crlf>0 → CRLF (>=)
    expect(detectEol('no newlines here')).toBe('\n');       // crlf 0 → LF
  });
  test('applyEol: only CRLF target converts; anything else → LF', () => {
    expect(applyEol('a\nb\nc', '\r\n')).toBe('a\r\nb\r\nc');
    expect(applyEol('a\r\nb', '\n')).toBe('a\nb');
    expect(applyEol('a\r\nb', 'lf-ish')).toBe('a\nb'); // non-CRLF target normalizes to LF
  });
  test('stripBOM only strips a leading BOM', () => {
    expect(stripBOM('﻿hi')).toBe('hi');
    expect(stripBOM('hi')).toBe('hi');
    expect(stripBOM('a﻿b')).toBe('a﻿b'); // BOM not at index 0 is kept
  });
});

describe('hashContent — crypto path vs deterministic fallback', () => {
  test('uses crypto.createHash when available', () => {
    const crypto = { createHash: () => ({ update() { return this; }, digest: () => 'SHA1HEX' }) };
    expect(hashContent('x', crypto)).toBe('SHA1HEX');
  });
  test('fallback hash is deterministic + content-sensitive', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
    expect(hashContent('abc')).not.toBe(hashContent('abd'));
    expect(hashContent('')).toBe('0');
    expect(typeof hashContent('abc')).toBe('string');
  });
});

describe('read — faithful meta (mutation kills)', () => {
  test('captures bom/eol/finalNewline/hash/mtime and normalizes the body', () => {
    const fs = { ...mockFs({ '/v/a.md': '﻿x\r\ny\r\n' }), statSync: () => ({ mtimeMs: 777 }) };
    const store = createDocumentStore({ fs, path: path.posix });
    const { content, meta } = store.read('/v/a.md');
    expect(content).toBe('x\ny\n'); // BOM stripped, CRLF→LF (trailing newline preserved)
    expect(meta.bom).toBe(true);
    expect(meta.eol).toBe('\r\n');
    expect(meta.finalNewline).toBe(true);
    expect(meta.mtimeMs).toBe(777);
    expect(typeof meta.hash).toBe('string');
  });
  test('no BOM, no final newline → meta reflects it', () => {
    const fs = { ...mockFs({ '/v/b.md': 'x\ny' }), statSync: () => ({ mtimeMs: 1 }) };
    const { meta } = createDocumentStore({ fs, path: path.posix }).read('/v/b.md');
    expect(meta.bom).toBe(false);
    expect(meta.finalNewline).toBe(false);
    expect(meta.eol).toBe('\n');
  });
});

describe('write — encoding, conflict, atomic, error branches (mutation kills)', () => {
  test('finalNewline:false leaves no trailing EOL; bom:false adds no BOM', () => {
    const fs = mockFs();
    const store = createDocumentStore({ fs, path: path.posix });
    store.write('/v/a.md', 'x\ny', { root: '/v', eol: '\n', finalNewline: false, bom: false });
    expect(fs._files['/v/a.md']).toBe('x\ny'); // no trailing \n, no BOM
  });
  test('baseHash null → writes even when the file already exists (no conflict check)', () => {
    const fs = mockFs({ '/v/a.md': 'whatever' });
    createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'new', { root: '/v', eol: '\n' });
    expect(fs._files['/v/a.md']).toBe('new\n');
  });
  test('baseHash set but file absent → no conflict, writes', () => {
    const fs = mockFs();
    const r = createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'new', { root: '/v', baseHash: 'x', eol: '\n' });
    expect(r.ok).toBe(true);
  });
  test('ENOSPC → {error:enospc}; ENOENT → {error:gone}', () => {
    const mkFail = (code) => {
      const fs = mockFs();
      fs.writeFileSync = vi.fn((p) => { if (String(p).includes('.tmp-')) { const e = new Error('x'); e.code = code; throw e; } });
      return fs;
    };
    expect(createDocumentStore({ fs: mkFail('ENOSPC'), path: path.posix }).write('/v/a.md', 'x', { root: '/v' })).toEqual({ error: 'enospc' });
    expect(createDocumentStore({ fs: mkFail('ENOENT'), path: path.posix }).write('/v/a.md', 'x', { root: '/v' })).toEqual({ error: 'gone' });
  });
  test('fsync best-effort path runs when fs.fsyncSync exists (and never throws out)', () => {
    const fs = mockFs();
    fs.fsyncSync = vi.fn(); fs.openSync = vi.fn(() => 7); fs.closeSync = vi.fn();
    const r = createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'x', { root: '/v', eol: '\n' });
    expect(r.ok).toBe(true);
    expect(fs.fsyncSync).toHaveBeenCalledWith(7);
  });
  test('returns hash/bom/eol meta on success', () => {
    const fs = mockFs();
    const r = createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'x', { root: '/v', eol: '\r\n', bom: true });
    expect(r.meta.eol).toBe('\r\n');
    expect(r.meta.bom).toBe(true);
    expect(typeof r.meta.hash).toBe('string');
  });
  test('no root → path guard skipped (writes anywhere)', () => {
    const fs = mockFs();
    expect(createDocumentStore({ fs, path: path.posix }).write('/tmp/x.md', 'x', { eol: '\n' }).ok).toBe(true);
  });
});

describe('listMarkdown — guard branches (mutation kills)', () => {
  const dirent = (name, kind) => ({ name, isDirectory: () => kind === 'd', isFile: () => kind === 'f', isSymbolicLink: () => kind === 's' });
  test('maxDepth stops recursion', () => {
    const tree = { '/v': [dirent('a.md', 'f'), dirent('sub', 'd')], '/v/sub': [dirent('b.md', 'f')] };
    const fs = { realpathSync: (p) => p, readdirSync: (p) => tree[p] || [] };
    expect(createDocumentStore({ fs, path: path.posix }).listMarkdown('/v', { maxDepth: 0 }).map((x) => x.relPath)).toEqual(['a.md']);
  });
  test('realpathSync throwing skips the dir (no crash)', () => {
    const fs = { realpathSync: () => { throw new Error('eacces'); }, readdirSync: () => [dirent('a.md', 'f')] };
    expect(createDocumentStore({ fs, path: path.posix }).listMarkdown('/v')).toEqual([]);
  });
  test('readdirSync throwing skips the dir', () => {
    const fs = { realpathSync: (p) => p, readdirSync: () => { throw new Error('eperm'); } };
    expect(createDocumentStore({ fs, path: path.posix }).listMarkdown('/v')).toEqual([]);
  });
  test('symlinked .md is included; results are sorted', () => {
    const fs = { realpathSync: (p) => p, readdirSync: () => [dirent('z.md', 'f'), dirent('a.md', 's'), dirent('img.png', 'f')] };
    expect(createDocumentStore({ fs, path: path.posix }).listMarkdown('/v').map((x) => x.relPath)).toEqual(['a.md', 'z.md']);
  });
});
