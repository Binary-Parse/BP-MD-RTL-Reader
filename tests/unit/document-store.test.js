/**
 * document-store.test.js — T-AI1. Pure helpers + factory behavior via mock fs.
 */
import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import {
  createDocumentStore, hasBOM, detectEol, applyEol, normalize, hashContent, isInsideRoot, atomicWriteFile, sweepStaleTempFiles,
  decodeBuffer, encodeBuffer, encodeWindows1256, firstUnmappableWindows1256Char, unmappableWindows1256Summary, validateWriteTarget,
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
    statSync: () => ({ mtimeMs: 123, size: 100 }),
  };
}

describe('write (EC-A1/A2/A3)', () => {
  test('uses canonical containment and rejects a symlink-resolved escape', () => {
    const fs = mockFs({ '/v/link.md': 'outside' });
    fs.realpathSync = (p) => p === '/v' ? '/v' : '/outside/secret.md';
    const store = createDocumentStore({ fs, path: path.posix });
    expect(store.write('/v/link.md', 'mine', { root: '/v' })).toEqual({ error: 'unauthorized-path' });
  });

  test('restricts document writes to Markdown files', () => {
    const fs = mockFs({ '/v/image.png': 'png' });
    fs.realpathSync = (p) => p;
    const store = createDocumentStore({ fs, path: path.posix });
    expect(store.write('/v/image.png', 'mine', { root: '/v' })).toEqual({ error: 'invalid-file-type' });
  });
  test('preserves BOM + CRLF + final newline', () => {
    const fs = mockFs();
    const store = createDocumentStore({ fs, path: path.posix });
    const r = store.write('/v/a.md', 'x\ny', { root: '/v', bom: true, eol: '\r\n', finalNewline: true });
    expect(r.ok).toBe(true);
    expect(fs._files['/v/a.md']).toBe('﻿x\r\ny\r\n');
    expect(r.meta).toMatchObject({ bom: true, eol: '\r\n', finalNewline: true });
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

describe('atomicWriteFile', () => {
  test('writes binary output through a sibling temp file and rename', () => {
    const fs = mockFs();
    const data = Buffer.from('PDF');
    expect(atomicWriteFile(fs, '/out/note.pdf', data)).toEqual({ ok: true });
    expect(fs._files['/out/note.pdf']).toBe(data);
    expect(Object.keys(fs._files)).toEqual(['/out/note.pdf']);
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

// ── Mutation-hardening round 2: kill the residual survivors precisely. ───────
describe('document-store — residual mutation survivors', () => {
  const dirent = (name, kind) => ({ name, isDirectory: () => kind === 'd', isFile: () => kind === 'f', isSymbolicLink: () => kind === 's' });

  // 13:10 — hasBOM's `typeof content === 'string' &&` guard (ConditionalExpression→true).
  test('hasBOM returns false for non-string input (guard not just true)', () => {
    expect(hasBOM(0xFEFF)).toBe(false);     // a number whose value equals BOM code point
    expect(hasBOM(null)).toBe(false);
    expect(hasBOM(undefined)).toBe(false);
  });

  // 21:29 Regex + 21:48 ArrayDeclaration — detectEol's lf counter `/(^|[^\r])\n/g`.
  // A leading bare LF only matches via the `^` alternation; the `||[]` fallback only
  // matters when match() returns null (no LF at all).
  test('detectEol counts a leading bare LF (anchored ^ alternation)', () => {
    // one CRLF, two bare LF (one is leading) → lf(2) > crlf(1) → LF wins.
    expect(detectEol('\na\r\nb\nc')).toBe('\n');
  });
  test('detectEol with zero newlines hits the ||[] fallback → LF', () => {
    expect(detectEol('plain')).toBe('\n'); // both matches null → 0/0 → '\n'
  });

  // createHash('sha256') / digest('hex') string args.
  test('hashContent passes sha256/hex to crypto', () => {
    const calls = {};
    const crypto = {
      createHash: (algo) => { calls.algo = algo; return { update() { return this; }, digest: (enc) => { calls.enc = enc; return 'H'; } }; },
    };
    expect(hashContent('x', crypto)).toBe('H');
    expect(calls.algo).toBe('sha256');
    expect(calls.enc).toBe('hex');
  });

  // 40:51 — fallback hash arithmetic `h * 31 + charCodeAt(i)`.
  // Pin exact known values so * → / and + → - mutants die.
  test('fallback hash exact value (kills *31 → /31 and + → -)', () => {
    // 'A' = 65; h = (0*31 + 65)>>>0 = 65
    expect(hashContent('A')).toBe('65');
    // 'AB': h='65' step then (65*31 + 66)>>>0 = 2015+66 = 2081
    expect(hashContent('AB')).toBe('2081');
  });

  // 81:26 — `out.endsWith(eol)` (MethodExpression→startsWith). finalNewline should NOT
  // double-append when content already ends with the EOL.
  test('finalNewline does not double-append when out already ends with eol', () => {
    const fs = mockFs();
    createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'x\n', { root: '/v', eol: '\n', finalNewline: true });
    expect(fs._files['/v/a.md']).toBe('x\n'); // startsWith('x') would wrongly append → 'x\n\n'
  });

  // v1.2 — read() now reads BYTES (no encoding arg) so the encoding can be detected;
  // write()'s conflict re-read still reads the utf8 string so legacy meta hashes match.
  test('read reads bytes (no encoding); write conflict re-read forwards utf8', () => {
    const encs = [];
    const base = mockFs({ '/v/a.md': 'old\n' });
    const fs = { ...base, readFileSync: (p, enc) => { encs.push(enc); return base._files[p]; } };
    const store = createDocumentStore({ fs, path: path.posix });
    store.read('/v/a.md');
    store.write('/v/a.md', 'new', { root: '/v', baseHash: hashContent('old\n'), eol: '\n' });
    expect(encs).toEqual([undefined, 'utf8']);
  });

  // writeFileSync carries { encoding, flag: 'wx' } + openSync(tmp, 'r+') for the fsync pass.
  test('writeFileSync receives {encoding:utf8, flag:wx} and openSync receives r+', () => {
    const fs = mockFs();
    let wOpts; let openFlag;
    fs.writeFileSync = (p, c, opts) => { wOpts = opts; fs._files[p] = c; };
    fs.fsyncSync = vi.fn(); fs.openSync = (p, flag) => { openFlag = flag; return 7; }; fs.closeSync = vi.fn();
    createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'x', { root: '/v', eol: '\n' });
    expect(wOpts).toEqual({ encoding: 'utf8', flag: 'wx' });
    expect(openFlag).toBe('r+');
  });

  // 85:37 — Math.random().toString(36) radix; tmp name must be derived (not literal).
  test('temp file name is randomized (radix-36 suffix), distinct per write', () => {
    const fs = mockFs();
    const tmps = [];
    fs.writeFileSync = (p, c) => { if (String(p).includes('.tmp-')) tmps.push(p); fs._files[p] = c; };
    const store = createDocumentStore({ fs, path: path.posix });
    store.write('/v/a.md', 'x', { root: '/v', eol: '\n' });
    store.write('/v/b.md', 'y', { root: '/v', eol: '\n' });
    expect(tmps[0]).toMatch(/^\/v\/a\.md\.tmp-[0-9a-z-]+$/);
    expect(tmps[1]).toMatch(/^\/v\/b\.md\.tmp-[0-9a-z-]+$/);
  });

  // 88:11 / 93 — fsyncSync-absent branch (ConditionalExpression→true would call it).
  test('no fsyncSync → write still succeeds without touching openSync', () => {
    const fs = mockFs();
    fs.openSync = vi.fn();
    // deliberately no fs.fsyncSync
    const r = createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'x', { root: '/v', eol: '\n' });
    expect(r.ok).toBe(true);
    expect(fs.openSync).not.toHaveBeenCalled();
  });

  // 93:11/93:17 — cleanup branch: on rename failure, an EXISTING tmp is unlinked.
  test('rename failure unlinks the leftover temp file (cleanup branch)', () => {
    const fs = mockFs();
    const unlinked = [];
    fs.renameSync = vi.fn(() => { throw Object.assign(new Error('x'), { code: 'EPERM' }); });
    fs.unlinkSync = (p) => { unlinked.push(p); delete fs._files[p]; };
    createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'x', { root: '/v', eol: '\n' });
    expect(unlinked).toHaveLength(1);
    expect(unlinked[0]).toMatch(/\.tmp-/); // the temp, not the target
  });
  test('rename failure with NO leftover temp → unlinkSync not called (existsSync false)', () => {
    const fs = mockFs();
    fs.renameSync = vi.fn(() => { throw Object.assign(new Error('x'), { code: 'EPERM' }); });
    // writeFileSync that never records the tmp, so existsSync(tmp) === false
    fs.writeFileSync = vi.fn();
    fs.unlinkSync = vi.fn();
    const r = createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'x', { root: '/v', eol: '\n' });
    expect(r).toEqual({ error: 'write-failed' });
    expect(fs.unlinkSync).not.toHaveBeenCalled();
  });

  // 109:31 — `out.length >= maxFiles` top-of-walk guard (>= vs >, and →false).
  // With maxFiles:1 and two md files, exactly one is returned; a `>` mutant would
  // allow a 2nd dir-recursion to overshoot.
  test('listMarkdown maxFiles is an inclusive cap across nested dirs (>= not >)', () => {
    const tree = {
      '/v': [dirent('a.md', 'f'), dirent('sub', 'd')],
      '/v/sub': [dirent('b.md', 'f')],
    };
    const fs = { realpathSync: (p) => p, readdirSync: (p) => tree[p] || [] };
    const out = createDocumentStore({ fs, path: path.posix }).listMarkdown('/v', { maxFiles: 1 });
    expect(out.map((x) => x.relPath)).toEqual(['a.md']); // recursion into /sub blocked by the guard
  });

  // 112:11 — visited cycle guard: a self-loop dir must be visited only once.
  test('listMarkdown cycle guard: realpath repeat is pruned (visited.has)', () => {
    const tree = {
      '/v': [dirent('a.md', 'f'), dirent('loop', 'd')],
      '/v/loop': [dirent('b.md', 'f'), dirent('again', 'd')],
      '/v/loop/again': [dirent('c.md', 'f')],
    };
    // /v/loop/again resolves back to /v/loop → already visited → pruned (c.md excluded)
    const real = { '/v': '/v', '/v/loop': '/v/loop', '/v/loop/again': '/v/loop' };
    const fs = { realpathSync: (p) => real[p] || p, readdirSync: (p) => tree[p] || [] };
    const out = createDocumentStore({ fs, path: path.posix }).listMarkdown('/v').map((x) => x.relPath);
    expect(out).toEqual(['a.md', 'loop/b.md']);
  });

  // 115:43 / 115:60 — readdirSync second arg `{ withFileTypes: true }`.
  test('readdirSync is called with { withFileTypes: true }', () => {
    let opts;
    const fs = { realpathSync: (p) => p, readdirSync: (p, o) => { opts = o; return [dirent('a.md', 'f')]; } };
    createDocumentStore({ fs, path: path.posix }).listMarkdown('/v');
    expect(opts).toEqual({ withFileTypes: true });
  });

  // 120:19 / 120:56 — entry classification: only (isFile||isSymbolicLink) AND /\.(md|markdown)$/i.
  test('a directory named like markdown is recursed, not pushed (isFile/isSymlink guard)', () => {
    const tree = {
      '/v': [dirent('a.md', 'd'), dirent('real.md', 'f'), dirent('note.markdown', 'f'), dirent('x.mdx', 'f'), dirent('y.md.txt', 'f')],
      '/v/a.md': [dirent('inner.md', 'f')],
    };
    const fs = { realpathSync: (p) => p, readdirSync: (p) => tree[p] || [] };
    const out = createDocumentStore({ fs, path: path.posix }).listMarkdown('/v').map((x) => x.relPath).sort();
    // a.md (dir) recursed → a.md/inner.md; .mdx and .md.txt excluded by the anchored regex
    expect(out).toEqual(['a.md/inner.md', 'note.markdown', 'real.md']);
  });

  // 137:9 — watch's `typeof fs.watch !== 'function'` guard (ConditionalExpression→false
  // would try to call a non-function). Already covered by no-op test; add: a real
  // function IS used (guard not always-false) by asserting fs.watch gets called.
  test('watch with a real fs.watch function actually subscribes (guard not false)', () => {
    const watcher = { close: vi.fn() };
    const fs = { ...mockFs(), watch: vi.fn(() => watcher) };
    const h = createDocumentStore({ fs, path: path.posix }).watch('/v', () => {});
    expect(fs.watch).toHaveBeenCalledTimes(1);
    h.close();
  });

  // 149:13 — `if (filename) pending.add(...)`: a null filename must NOT be added.
  test('watch ignores a null filename (does not add empty/garbage to the set)', () => {
    vi.useFakeTimers();
    let listener;
    const fs = { ...mockFs(), watch: vi.fn((r, o, cb) => { listener = cb; return { close() {} }; }) };
    const cb = vi.fn();
    createDocumentStore({ fs, path: path.posix }).watch('/v', cb, { debounceMs: 50 });
    listener('change', null);      // filename falsy → not added
    listener('change', 'a.md');
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].files).toEqual(['a.md']); // only the real file
    vi.useRealTimers();
  });

  // 150:13 — `if (timer) clearTimeout(timer)`: a 2nd event before flush must reset the
  // debounce (so only one flush fires after the LAST event, not the first).
  test('watch debounce is re-armed by each event (clearTimeout on existing timer)', () => {
    vi.useFakeTimers();
    let listener;
    const fs = { ...mockFs(), watch: vi.fn((r, o, cb) => { listener = cb; return { close() {} }; }) };
    const cb = vi.fn();
    createDocumentStore({ fs, path: path.posix }).watch('/v', cb, { debounceMs: 100 });
    listener('change', 'a.md');
    vi.advanceTimersByTime(60);   // not yet
    listener('change', 'b.md');   // re-arms: must extend the window
    vi.advanceTimersByTime(60);   // 120ms since first, but only 60ms since last → no fire yet
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);   // now 100ms since last
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].files.sort()).toEqual(['a.md', 'b.md']);
    vi.useRealTimers();
  });

  // 153:17 — the fs.watch-throws catch returns a real disposable ({close(){}}), not
  // an empty body. A close() must exist and be callable.
  test('fs.watch throwing returns a disposable whose close() is a function', () => {
    const fs = { ...mockFs(), watch: () => { throw new Error('EMFILE'); } };
    const h = createDocumentStore({ fs, path: path.posix }).watch('/v', () => {});
    expect(typeof h.close).toBe('function');
    expect(() => h.close()).not.toThrow();
  });

  // 156:28 — disposable close(): `if (timer) clearTimeout(timer)` then watcher.close().
  test('close() clears a pending timer AND closes the watcher (both branches)', () => {
    vi.useFakeTimers();
    let listener;
    const watcher = { close: vi.fn() };
    const fs = { ...mockFs(), watch: vi.fn((r, o, cb) => { listener = cb; return watcher; }) };
    const cb = vi.fn();
    const h = createDocumentStore({ fs, path: path.posix }).watch('/v', cb, { debounceMs: 100 });
    listener('change', 'a.md'); // arms a timer
    h.close();
    expect(watcher.close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200); // the timer was cleared → cb never fires
    expect(cb).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  test('close() with no pending timer still closes the watcher (timer falsy branch)', () => {
    const watcher = { close: vi.fn() };
    const fs = { ...mockFs(), watch: vi.fn(() => watcher) };
    const h = createDocumentStore({ fs, path: path.posix }).watch('/v', () => {});
    h.close(); // no event fired → timer stayed null
    expect(watcher.close).toHaveBeenCalledTimes(1);
  });
});

// ── Post-review hardening: unmappable cp1256 refusal, write-hash consistency,
//    and the segment-based containment check. ────────────────────────────────
function byteMockFs(initial = {}) {
  const files = { ...initial };
  return {
    _files: files,
    existsSync: (p) => p in files,
    readFileSync: (p, enc) => {
      if (!(p in files)) { const e = new Error('no'); e.code = 'ENOENT'; throw e; }
      const v = files[p];
      if (enc == null || !Buffer.isBuffer(v)) return v;
      return enc === 'utf8' ? v.toString('utf8') : v;
    },
    writeFileSync: (p, c) => { files[p] = c; },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    unlinkSync: (p) => { delete files[p]; },
    statSync: () => ({ mtimeMs: 123 }),
  };
}

describe('windows-1256 write refuses unmappable characters instead of writing "?"', () => {
  test('an emoji in a cp1256 save is refused and the file is untouched', () => {
    const fs = mockFs({ '/v/legacy.md': 'old' });
    const store = createDocumentStore({ fs, path: path.posix });
    const r = store.write('/v/legacy.md', 'نص 😀', { root: '/v', encoding: 'windows-1256', eol: '\n' });
    expect(r.error).toBe('unmappable-character');
    expect(r.char).toBe('😀');
    expect(r.count).toBe(1);
    expect(r.samples).toEqual(['😀']);
    expect(fs._files['/v/legacy.md']).toBe('old');
    expect(Object.keys(fs._files)).toEqual(['/v/legacy.md']);
  });

  test('the error summary counts every occurrence and samples distinct characters', () => {
    const fs = mockFs();
    const r = createDocumentStore({ fs, path: path.posix })
      .write('/v/a.md', '😀 🎉 😀', { root: '/v', encoding: 'windows-1256', eol: '\n' });
    expect(r.error).toBe('unmappable-character');
    expect(r.count).toBe(3);
    expect(r.samples).toEqual(['😀', '🎉']);
  });

  test('pure cp1256-representable Arabic text still writes', () => {
    const fs = mockFs();
    const r = createDocumentStore({ fs, path: path.posix })
      .write('/v/a.md', 'مرحبا', { root: '/v', encoding: 'windows-1256', eol: '\n' });
    expect(r.ok).toBe(true);
    expect(Buffer.isBuffer(fs._files['/v/a.md'])).toBe(true);
  });

  test('a second identical cp1256 save with the returned hash is NOT a false conflict', () => {
    const fs = byteMockFs();
    const store = createDocumentStore({ fs, path: path.posix });
    const first = store.write('/v/a.md', 'مرحبا', { root: '/v', encoding: 'windows-1256', eol: '\n' });
    expect(first.ok).toBe(true);
    const second = store.write('/v/a.md', 'مرحبا', { root: '/v', encoding: 'windows-1256', eol: '\n', baseHash: first.meta.hash });
    expect(second.ok).toBe(true);
  });

  test('a utf16le save also returns a hash the next conflict check accepts', () => {
    const fs = byteMockFs();
    const store = createDocumentStore({ fs, path: path.posix });
    const first = store.write('/v/a.md', 'hello', { root: '/v', encoding: 'utf16le', eol: '\n' });
    const second = store.write('/v/a.md', 'hello', { root: '/v', encoding: 'utf16le', eol: '\n', baseHash: first.meta.hash });
    expect(second.ok).toBe(true);
  });
});

describe('a UTF-8 BOM over non-UTF-8 bytes is not trusted (cp1256 behind a BOM)', () => {
  const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
  const CP1256_MARHABA = Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC7]);

  test('reads as windows-1256 text, never U+FFFD mojibake', () => {
    const fs = byteMockFs({ '/v/bom1256.md': Buffer.concat([BOM, CP1256_MARHABA]) });
    const r = createDocumentStore({ fs, path: path.posix }).read('/v/bom1256.md');
    expect(r.content).toBe('مرحبا');
    expect(r.content.includes('\uFFFD')).toBe(false);
    expect(r.meta.encoding).toBe('windows-1256');
    expect(r.meta.bom).toBe(false);
  });

  test('a save keyed to that read does not false-conflict and keeps cp1256 bytes', () => {
    const fs = byteMockFs({ '/v/bom1256.md': Buffer.concat([BOM, CP1256_MARHABA]) });
    const store = createDocumentStore({ fs, path: path.posix });
    const r = store.read('/v/bom1256.md');
    const w = store.write('/v/bom1256.md', 'مرحبا', {
      root: '/v', encoding: r.meta.encoding, bom: r.meta.bom,
      eol: r.meta.eol, finalNewline: false, baseHash: r.meta.hash,
    });
    expect(w.ok).toBe(true);
    expect(Array.from(fs._files['/v/bom1256.md'])).toEqual(Array.from(CP1256_MARHABA));
  });

  test('a valid UTF-8 body behind a BOM still reads as utf8 bom:true', () => {
    const fs = byteMockFs({ '/v/bomutf8.md': Buffer.concat([BOM, Buffer.from('مرحبا', 'utf8')]) });
    const r = createDocumentStore({ fs, path: path.posix }).read('/v/bomutf8.md');
    expect(r.content).toBe('مرحبا');
    expect(r.meta.encoding).toBe('utf8');
    expect(r.meta.bom).toBe(true);
  });
});

describe('BOM-less UTF-16 detection (parity heuristic)', () => {
  const swapPairs = (buf) => {
    const out = Buffer.from(buf);
    for (let i = 0; i + 1 < out.length; i += 2) {
      const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t;
    }
    return out;
  };
  const LE = Buffer.concat([Buffer.from('مرحبا', 'utf16le'), Buffer.from('\n', 'utf16le')]);
  const BE = swapPairs(LE);
  const asciiLe = Buffer.from('hello markdown\n', 'utf16le');

  test('UTF-16LE without a BOM reads as Arabic text, never mojibake', () => {
    const fs = byteMockFs({ '/v/nole.md': LE });
    const r = createDocumentStore({ fs, path: path.posix }).read('/v/nole.md');
    expect(r.content).toBe('مرحبا\n');
    expect(r.meta.encoding).toBe('utf16le');
    expect(r.meta.bom).toBe(false);
    expect(r.content.includes('\uFFFD')).toBe(false);
  });

  test('UTF-16BE without a BOM reads as Arabic text too', () => {
    const fs = byteMockFs({ '/v/nobe.md': BE });
    const r = createDocumentStore({ fs, path: path.posix }).read('/v/nobe.md');
    expect(r.content).toBe('مرحبا\n');
    expect(r.meta.encoding).toBe('utf16be');
    expect(r.meta.bom).toBe(false);
  });

  test('ASCII-only UTF-16LE without a BOM is detected', () => {
    const fs = byteMockFs({ '/v/ascii.md': asciiLe });
    const r = createDocumentStore({ fs, path: path.posix }).read('/v/ascii.md');
    expect(r.content).toBe('hello markdown\n');
    expect(r.meta.encoding).toBe('utf16le');
  });

  test('a save keyed to a BOM-less read round-trips the exact bytes (no false conflict)', () => {
    const fs = byteMockFs({ '/v/rt.md': LE });
    const store = createDocumentStore({ fs, path: path.posix });
    const r = store.read('/v/rt.md');
    const w = store.write('/v/rt.md', 'مرحبا\n', {
      root: '/v', encoding: r.meta.encoding, bom: r.meta.bom,
      eol: r.meta.eol, finalNewline: false, baseHash: r.meta.hash,
    });
    expect(w.ok).toBe(true);
    expect(Array.from(fs._files['/v/rt.md'])).toEqual(Array.from(LE));
  });

  test('single-byte text never trips the parity heuristic', () => {
    const fs = byteMockFs({
      '/v/cp.md': Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC7]),
      '/v/utf8.md': Buffer.from('مرحبا ثم English text هنا', 'utf8'),
    });
    const store = createDocumentStore({ fs, path: path.posix });
    expect(store.read('/v/cp.md').meta.encoding).toBe('windows-1256');
    expect(store.read('/v/utf8.md').meta.encoding).toBe('utf8');
  });
});

describe('isInsideRoot rejects only a literal .. segment (names like ..notes.md are inside)', () => {
  test('a file whose name starts with dots stays inside; real traversal does not', () => {
    expect(isInsideRoot('/v/..notes.md', '/v', path.posix)).toBe(true);
    expect(isInsideRoot('/v/sub/..deep.md', '/v', path.posix)).toBe(true);
    expect(isInsideRoot('/v/../escape.md', '/v', path.posix)).toBe(false);
    expect(isInsideRoot('/v/sub/../../escape.md', '/v', path.posix)).toBe(false);
  });
});

describe('sweepStaleTempFiles — crash-orphaned <name>.tmp-<uuid> cleanup', () => {
  const OLD = 'note.md.tmp-11111111-1111-4111-8111-111111111111';
  const FRESH = 'note.md.tmp-22222222-2222-4222-8222-222222222222';
  const UNRELATED = 'keep.tmp-backup';
  function sweepFs(entries, mtimes, dirs = new Set()) {
    return {
      readdirSync: vi.fn((dir) => (dir === '/v' ? entries : [])),
      statSync: vi.fn((p) => ({
        isFile: () => true,
        isDirectory: () => dirs.has(p),
        mtimeMs: mtimes[p.slice(p.lastIndexOf(String.fromCharCode(47)) + 1)] ?? Date.now(),
      })),
      unlinkSync: vi.fn(),
    };
  }

  test('removes only aged uuid-suffixed temps; fresh temps, the live file, and strangers survive', () => {
    const fs = sweepFs([OLD, FRESH, UNRELATED, 'note.md'], { [OLD]: 0, [FRESH]: Date.now() });
    const removed = sweepStaleTempFiles(fs, path.posix, '/v', { now: 10 * 60 * 60 * 1000 });
    expect(removed).toBe(1);
    expect(fs.unlinkSync).toHaveBeenCalledTimes(1);
    expect(fs.unlinkSync).toHaveBeenCalledWith(path.posix.join('/v', OLD));
  });

  test('a directory-shaped temp entry is skipped, and an unreadable directory yields 0', () => {
    const fs = {
      readdirSync: vi.fn(() => [OLD]),
      statSync: vi.fn(() => ({ isFile: () => false, mtimeMs: 0 })),
      unlinkSync: vi.fn(),
    };
    expect(sweepStaleTempFiles(fs, path.posix, '/v', { now: 10 * 60 * 60 * 1000 })).toBe(0);
    expect(fs.unlinkSync).not.toHaveBeenCalled();
    expect(sweepStaleTempFiles({ readdirSync: vi.fn(() => { throw new Error('EACCES'); }) }, path.posix, '/v')).toBe(0);
  });
});

describe('atomicWriteFile preserves the target mode', () => {
  test('a 0600 target is re-applied to the temp before rename (perms never widen)', () => {
    const seen = {};
    const fs = {
      statSync: vi.fn(() => ({ mode: 0o600 })),
      writeFileSync: vi.fn(),
      openSync: vi.fn(() => 7),
      fsyncSync: vi.fn(),
      closeSync: vi.fn(),
      chmodSync: vi.fn((p, m) => { seen.mode = m; }),
      renameSync: vi.fn(),
      existsSync: vi.fn(() => false),
    };
    expect(atomicWriteFile(fs, '/v/note.md', 'x', 'utf8')).toEqual({ ok: true });
    expect(seen.mode).toBe(0o600);
    expect(fs.renameSync).toHaveBeenCalledTimes(1);
  });

  test('a missing target keeps the default mode (no chmod attempted)', () => {
    const fs = {
      statSync: vi.fn(() => { throw new Error('ENOENT'); }),
      writeFileSync: vi.fn(),
      renameSync: vi.fn(),
      existsSync: vi.fn(() => false),
      chmodSync: vi.fn(),
    };
    expect(atomicWriteFile(fs, '/v/new.md', 'x')).toEqual({ ok: true });
    expect(fs.chmodSync).not.toHaveBeenCalled();
  });
});

describe('readAsync — the async vault lane', () => {
  test('decodes fs.promises bytes, reuses a known stat, and never touches the sync path', async () => {
    const raw = Buffer.from('\uFEFF# hi', 'utf16le');
    const fs = {
      readFileSync: vi.fn(() => { throw new Error('sync path must not run'); }),
      statSync: vi.fn(() => { throw new Error('sync path must not run'); }),
      promises: {
        readFile: vi.fn(async () => raw),
        stat: vi.fn(async () => ({ mtimeMs: 5 })),
      },
    };
    const store = createDocumentStore({ fs, path: path.posix });
    const r = await store.readAsync('/v/a.md', { mtimeMs: 9 });
    expect(r.content).toBe('# hi');
    expect(r.meta).toMatchObject({ encoding: 'utf16le', bom: true, mtimeMs: 9 });
    expect(fs.promises.stat).not.toHaveBeenCalled();
  });

  test('without a known stat it fetches one best-effort; without promises it falls back to read()', async () => {
    const fs = {
      readFileSync: vi.fn(() => Buffer.from('# sync', 'utf8')),
      statSync: vi.fn(() => ({ mtimeMs: 3 })),
      promises: { readFile: vi.fn(async () => Buffer.from('# async', 'utf8')), stat: vi.fn(async () => ({ mtimeMs: 4 })) },
    };
    const store = createDocumentStore({ fs, path: path.posix });
    const withStat = await store.readAsync('/v/a.md');
    expect(withStat.content).toBe('# async');
    expect(withStat.meta.mtimeMs).toBe(4);
    const fallback = createDocumentStore({ fs: { readFileSync: fs.readFileSync, statSync: fs.statSync }, path: path.posix });
    const r = await fallback.readAsync('/v/a.md');
    expect(r.content).toBe('# sync');
    expect(r.meta.mtimeMs).toBe(3);
  });
});

// HYG-02 (2026-09-26): the sweep walks subdirectories — notes live there (the read
// walks 12 levels), and a root-only listing never saw their crash orphans.
describe('sweepStaleTempFiles recursion (HYG-02)', () => {
  const AGED = 'a.md.tmp-33333333-3333-4333-8333-333333333333';
  const FRESH = 'b.md.tmp-44444444-4444-4444-8444-444444444444';
  const { vi: viMod } = { vi };
  test('an aged temp in a subdirectory is swept; a fresh one survives', () => {
    const fs = {
      readdirSync: viMod.fn((dir) => (dir === '/v' ? ['sub'] : dir === '/v/sub' ? [AGED, FRESH] : [])),
      statSync: viMod.fn((p) => ({
        isFile: () => !p.endsWith('sub'),
        isDirectory: () => p.endsWith('sub'),
        mtimeMs: p.includes(AGED.slice(0, 12)) ? 1 : 2e12 - 100,
      })),
      unlinkSync: viMod.fn(),
    };
    const removed = sweepStaleTempFiles(fs, path.posix, '/v', { now: 2e12, maxAgeMs: 1000 });
    expect(removed).toBe(1);
    expect(fs.unlinkSync).toHaveBeenCalledWith(path.posix.join('/v/sub', AGED));
  });
  test('the depth cap bounds the walk', () => {
    let calls = 0;
    const fs = {
      readdirSync: viMod.fn((dir) => { calls++; return ['d']; }),
      statSync: viMod.fn(() => ({ isFile: () => false, isDirectory: () => true, mtimeMs: 0 })),
      unlinkSync: viMod.fn(),
    };
    sweepStaleTempFiles(fs, path.posix, '/v', { now: 1e12 });
    expect(calls).toBeLessThanOrEqual(13);
  });
});

// ── GATE-01 (2026-09-26): every decode/encode branch and write-guard lane that had
// drifted below the coverage floors after the 09-24 fix pass.
describe('decodeBuffer full branch battery (GATE-01)', () => {
  test('a UTF-16BE buffer with BOM swaps to readable text', () => {
    const le = Buffer.from('\uFEFFمرحبا', 'utf16le');
    const be = Buffer.from(le);
    for (let i = 0; i + 1 < be.length; i += 2) { const t = be[i]; be[i] = be[i + 1]; be[i + 1] = t; }
    const dec = decodeBuffer(be);
    expect(dec.encoding).toBe('utf16be');
    expect(dec.bom).toBe(true);
    expect(dec.text.replace(/^\uFEFF/, '')).toBe('مرحبا');
  });

  test('BOM-less UTF-16 parity (LE and BE) decodes without the BOM', () => {
    const le = Buffer.from('hi', 'utf16le');
    const dec = decodeBuffer(le);
    expect(dec).toMatchObject({ text: 'hi', encoding: 'utf16le', bom: false });
    const beBody = Buffer.from('hi', 'utf16le');
    const be = Buffer.from(beBody);
    for (let i = 0; i + 1 < be.length; i += 2) { const t = be[i]; be[i] = be[i + 1]; be[i + 1] = t; }
    const decBe = decodeBuffer(be);
    expect(decBe).toMatchObject({ text: 'hi', encoding: 'utf16be', bom: false });
  });

  test('a short/odd buffer skips the parity paths and reads as utf8', () => {
    expect(decodeBuffer(Buffer.from([0x61]))).toMatchObject({ text: 'a', encoding: 'utf8' });
    expect(decodeBuffer(Buffer.from([0x00, 0x41, 0x00]))).toMatchObject({ encoding: 'utf8' });
  });

  test('invalid utf8 with no BOM falls back to windows-1256', () => {
    const bytes = Buffer.from([0xC7, 0xE1, 0xCE]); // invalid utf8 sequence, valid cp1256 Arabic letters
    const dec = decodeBuffer(bytes);
    expect(dec.encoding).toBe('windows-1256');
    expect(dec.bom).toBe(false);
    expect(dec.text.length).toBe(3);
  });

  test('a legacy string or a non-buffer, non-string value degrades to text', () => {
    expect(decodeBuffer('plain')).toMatchObject({ text: 'plain', encoding: 'utf8' });
    expect(decodeBuffer(null)).toMatchObject({ text: '', encoding: 'utf8' });
    expect(decodeBuffer(42)).toMatchObject({ text: '42', encoding: 'utf8' });
  });
});

describe('encodeBuffer / encodeWindows1256 battery (GATE-01)', () => {
  test('round-trips every encoding with and without the BOM', () => {
    for (const enc of ['utf8', 'utf16le', 'utf16be']) {
      for (const bom of [true, false]) {
        const bytes = encodeBuffer('مرحبا', enc, bom);
        const dec = decodeBuffer(bytes);
        expect(dec.text).toBe('مرحبا');
        expect(dec.encoding).toBe(enc);
        expect(dec.bom).toBe(bom);
      }
    }
  });

  test('windows-1256 encoding ignores the BOM flag and maps ASCII through', () => {
    const bytes = encodeBuffer('ab', 'windows-1256', true);
    expect([...bytes]).toEqual([0x61, 0x62]);
  });

  test('an unmappable character encodes as ? and the helpers report it', () => {
    expect([...encodeWindows1256('a😀b')]).toEqual([0x61, 0x3F, 0x3F, 0x62]); // surrogate pair → two code units
    expect(firstUnmappableWindows1256Char('a😀b')).toBe('😀');
    expect(firstUnmappableWindows1256Char('abc')).toBeNull();
    expect(unmappableWindows1256Summary('😀🎈🎊🎉🍕')).toEqual({
      count: 5,
      samples: ['😀', '🎈', '🎊', '🎉', '🍕'],
    });
  });
});

describe('validateWriteTarget lanes (GATE-01)', () => {
  const fsOf = (over = {}) => ({
    existsSync: () => false,
    realpathSync: (p) => p,
    ...over,
  });
  test('a root-bound target inside the root passes; outside is unauthorized', () => {
    expect(validateWriteTarget(fsOf(), path.posix, '/v/a.md', '/v')).toEqual({ path: '/v/a.md' });
    expect(validateWriteTarget(fsOf({ existsSync: () => true }), path.posix, '/other/a.md', '/v'))
      .toEqual({ error: 'unauthorized-path' });
  });
  test('a realpath failure is unauthorized, never a silent pass', () => {
    expect(validateWriteTarget(fsOf({ realpathSync: () => { throw new Error('x'); } }), path.posix, '/v/a.md', '/v'))
      .toEqual({ error: 'unauthorized-path' });
  });
  test('a non-markdown extension is refused regardless of root', () => {
    expect(validateWriteTarget(fsOf(), path.posix, '/v/a.txt', '/v')).toEqual({ error: 'invalid-file-type' });
  });
});

describe('atomicWriteFile hardening lanes (GATE-01)', () => {
  test('fsync + mode re-apply run when the fs provides them', () => {
    const files = { '/v/a.md': 'old' };
    const calls = [];
    const fs = {
      statSync: () => ({ mode: 0o600 }),
      writeFileSync: (p, c) => { files[p] = c; },
      renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
      existsSync: (p) => p in files,
      openSync: (p) => { calls.push(['open', p]); return 7; },
      fsyncSync: (fd) => calls.push(['fsync', fd]),
      closeSync: (fd) => calls.push(['close', fd]),
      chmodSync: (p, mode) => calls.push(['chmod', mode]),
    };
    expect(atomicWriteFile(fs, '/v/a.md', 'new')).toEqual({ ok: true });
    expect(calls.map((c) => c[0])).toEqual(['open', 'fsync', 'close', 'chmod']);
    expect(calls[2][1]).toBe(7);
    expect(calls[3][1]).toBe(0o600);
  });

  test('a mid-write failure cleans the temp and maps the error code', () => {
    const unlinked = [];
    const fs = {
      statSync: () => { throw new Error('new file'); },
      writeFileSync: () => { const e = new Error('x'); e.code = 'ENOSPC'; throw e; },
      renameSync: () => {},
      existsSync: () => true,
      unlinkSync: (p) => unlinked.push(p),
    };
    expect(atomicWriteFile(fs, '/v/a.md', 'new')).toEqual({ error: 'enospc' });
    expect(unlinked).toHaveLength(1);
    const gone = { ...fs, writeFileSync: () => { const e = new Error('x'); e.code = 'ENOENT'; throw e; }, existsSync: () => false };
    expect(atomicWriteFile(gone, '/v/a.md', 'new')).toEqual({ error: 'gone' });
  });
});

describe('listMarkdown caps (GATE-01)', () => {
  test('file-count and depth caps stop the walk', () => {
    const tree = new Map([
      ['/v', [{ name: 'a.md', file: true }, { name: 'b.md', file: true }, { name: 'c.md', file: true }, { name: 'd.md', file: true }, { name: 'sub', file: false }]],
      ['/v/sub', [{ name: 'deep.md', file: true }]],
    ]);
    const entry = (e) => ({
      name: e.name,
      isFile: () => !!e.file,
      isDirectory: () => !e.file,
      isSymbolicLink: () => false,
    });
    const fs = {
      realpathSync: (p) => p,
      readdirSync: (dir) => (tree.get(dir) || []).map(entry),
    };
    const store = createDocumentStore({ fs, path: path.posix });
    const res = store.listMarkdown('/v', { maxFiles: 3, maxDepth: 1 });
    expect(res.length).toBe(3);
    expect(res.every((f) => f.relPath.endsWith('.md'))).toBe(true);
  });
});
