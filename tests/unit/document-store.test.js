/**
 * document-store.test.js — T-AI1. Pure helpers + factory behavior via mock fs.
 */
import { describe, test, expect, vi } from 'vitest';
import path from 'node:path';
import {
  createDocumentStore, hasBOM, detectEol, applyEol, normalize, hashContent, isInsideRoot, atomicWriteFile,
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

  // 36:30/36:61 — createHash('sha1') / digest('hex') string args.
  test('hashContent passes sha1/hex to crypto', () => {
    const calls = {};
    const crypto = {
      createHash: (algo) => { calls.algo = algo; return { update() { return this; }, digest: (enc) => { calls.enc = enc; return 'H'; } }; },
    };
    expect(hashContent('x', crypto)).toBe('H');
    expect(calls.algo).toBe('sha1');
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

  // 53:42 / 70:48? / 75:60 — readFileSync('utf8') encoding arg in read() and write()'s
  // conflict re-read. mock asserts the encoding is forwarded.
  test('read + write forward the utf8 encoding to readFileSync', () => {
    const encs = [];
    const base = mockFs({ '/v/a.md': 'old\n' });
    const fs = { ...base, readFileSync: (p, enc) => { encs.push(enc); return base._files[p]; } };
    const store = createDocumentStore({ fs, path: path.posix });
    store.read('/v/a.md');
    store.write('/v/a.md', 'new', { root: '/v', baseHash: hashContent('old\n'), eol: '\n' });
    expect(encs).toEqual(['utf8', 'utf8']);
  });

  // 87:34 / 89:43 — writeFileSync('utf8') + openSync(tmp, 'r+') string args.
  test('writeFileSync receives utf8 and openSync receives r+', () => {
    const fs = mockFs();
    let wEnc; let openFlag;
    fs.writeFileSync = (p, c, enc) => { wEnc = enc; fs._files[p] = c; };
    fs.fsyncSync = vi.fn(); fs.openSync = (p, flag) => { openFlag = flag; return 7; }; fs.closeSync = vi.fn();
    createDocumentStore({ fs, path: path.posix }).write('/v/a.md', 'x', { root: '/v', eol: '\n' });
    expect(wEnc).toBe('utf8');
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
    expect(tmps[0]).toMatch(/^\/v\/a\.md\.tmp-[0-9a-z]+$/);
    expect(tmps[1]).toMatch(/^\/v\/b\.md\.tmp-[0-9a-z]+$/);
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
