/**
 * document-store.test.js — T-AI1. Pure helpers + factory behavior via mock fs.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import nodeCrypto from 'node:crypto';
import {
  createDocumentStore, hasBOM, detectEol, applyEol, hasMixedEol, applyEolPreserving, normalize, hashContent, isInsideRoot, atomicWriteFile, sweepStaleTempFiles,
  decodeBuffer, decodeBufferAs, utf8Profile, REOPEN_ENCODINGS, encodeBuffer, encodeWindows1256, firstUnmappableWindows1256Char, unmappableWindows1256Summary, validateWriteTarget,
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
    expect(r).toEqual({ error: 'locked' }); // audit M14: EPERM is a held or read-only target
    expect('/v/a.md' in fs._files).toBe(false);
  });
});

describe('M14: a target held by another program is retried', () => {
  const held = (code) => Object.assign(new Error(code), { code });
  const failing = (times, code) => {
    const fs = mockFs();
    const rename = fs.renameSync;
    let left = times;
    fs.renameSync = vi.fn((from, to) => { if (left > 0) { left -= 1; throw held(code); } rename(from, to); });
    return fs;
  };

  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    test(`${code} twice, then free: the write succeeds on the third attempt`, () => {
      const fs = failing(2, code);
      const sleep = vi.fn();
      expect(atomicWriteFile(fs, '/v/a.md', 'text', 'utf8', { sleep })).toEqual({ ok: true });
      expect(fs.renameSync).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([20, 50]);
      expect(fs._files['/v/a.md']).toBe('text');
      expect(Object.keys(fs._files)).toEqual(['/v/a.md']); // no temp file left
    });
  }

  test('held through every retry: five attempts, 370 ms of waiting, "locked", and no temp file left', () => {
    const fs = failing(Infinity, 'EBUSY');
    fs._files['/v/a.md'] = 'old';
    const sleep = vi.fn();
    expect(atomicWriteFile(fs, '/v/a.md', 'new', 'utf8', { sleep })).toEqual({ error: 'locked' });
    expect(fs.renameSync).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([20, 50, 100, 200]);
    expect(fs._files).toEqual({ '/v/a.md': 'old' });
  });

  test('other errors are not retried and keep their codes', () => {
    for (const [code, error] of [['ENOSPC', 'enospc'], ['ENOENT', 'gone'], ['EIO', 'write-failed']]) {
      const fs = failing(Infinity, code);
      const sleep = vi.fn();
      expect(atomicWriteFile(fs, '/v/a.md', 'x', 'utf8', { sleep })).toEqual({ error });
      expect(fs.renameSync).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  test('without an injected sleep the real wait is used and stays within its bound', () => {
    const fs = failing(1, 'EBUSY');
    const started = Date.now();
    expect(atomicWriteFile(fs, '/v/a.md', 'x', 'utf8')).toEqual({ ok: true });
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(15);
    expect(waited).toBeLessThan(2000);
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

// H15 step 1: a folder of notes is often a git repo too; every `git status` rewrites
// .git/index, every editor drops swap/temp files. None of those may wake the renderer into a
// full re-read of the vault.
describe('watch filtering and timing (H15 step 1)', () => {
  function setup(statSync, opts) {
    vi.useFakeTimers();
    let listener;
    const fs = { ...mockFs(), watch: vi.fn((r, o, cb) => { listener = cb; return { close() {} }; }) };
    if (statSync) fs.statSync = statSync;
    const cb = vi.fn();
    const handle = createDocumentStore({ fs, path: path.posix }).watch('/v', cb, opts);
    return { fire: (...a) => listener(...a), cb, handle };
  }
  const flushAll = () => vi.advanceTimersByTime(5000);
  const enoent = () => { const e = new Error('gone'); e.code = 'ENOENT'; throw e; };
  const asDir = () => ({ isDirectory: () => true });
  const asFile = () => ({ isDirectory: () => false });
  afterEach(() => vi.useRealTimers());

  test('events inside .git never reach the callback', () => {
    const { fire, cb } = setup();
    fire('change', '.git/index');
    fire('rename', '.git/index.lock');
    fire('rename', '.git');
    fire('change', 'sub/.git/HEAD');
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('events inside node_modules never reach the callback', () => {
    const { fire, cb } = setup();
    fire('change', 'node_modules/pkg/README.md');
    fire('change', 'docs/node_modules/x/readme.md');
    fire('rename', 'node_modules');
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('any dot-directory is ignored, even for Markdown files inside it', () => {
    const { fire, cb } = setup();
    fire('change', '.obsidian/workspace.md');
    fire('change', 'notes/.trash/old.md');
    fire('change', '.DS_Store');
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('a dot-FILE that is a note is still a note', () => {
    const { fire, cb } = setup();
    fire('change', '.scratch.md');
    flushAll();
    expect(cb.mock.calls[0][0].files).toEqual(['.scratch.md']);
  });

  test('Windows separators are understood (.git\\index dropped, sub\\a.md kept)', () => {
    const { fire, cb } = setup();
    fire('change', '.git\\index');
    fire('change', 'sub\\a.md');
    flushAll();
    expect(cb.mock.calls[0][0].files).toEqual(['sub\\a.md']);
  });

  test('non-note files are ignored: images, text, swap files', () => {
    const { fire, cb } = setup(enoent);
    fire('change', 'pic.png');
    fire('rename', 'pic.png');
    fire('change', 'todo.txt');
    fire('rename', 'a.md.swp');
    fire('rename', 'a.md~');
    fire('rename', 'a.md.tmp-1234');
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('both note extensions pass, case-insensitively', () => {
    const { fire, cb } = setup();
    fire('change', 'a.md');
    fire('change', 'b.MARKDOWN');
    fire('rename', 'c.Md');
    flushAll();
    expect(cb.mock.calls[0][0].files.sort()).toEqual(['a.md', 'b.MARKDOWN', 'c.Md']);
  });

  test('a directory rename/creation is forwarded (its notes moved with it)', () => {
    const { fire, cb } = setup(asDir);
    fire('rename', 'topic-2');
    flushAll();
    expect(cb.mock.calls[0][0].files).toEqual(['topic-2']);
  });

  test('a REMOVED directory (path gone, no extension) is forwarded, a removed picture is not', () => {
    const { fire, cb } = setup(enoent);
    fire('rename', 'deleted-folder');
    fire('rename', 'deleted.png');
    flushAll();
    expect(cb.mock.calls[0][0].files).toEqual(['deleted-folder']);
  });

  test('a plain "change" on a non-note path is never forwarded, directory or not', () => {
    const { fire, cb } = setup(asDir);
    fire('change', 'topic-2');
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('a renamed non-note FILE that exists is ignored', () => {
    const { fire, cb } = setup(asFile);
    fire('rename', 'LICENSE');
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('a stat result without isDirectory() counts as "not a directory"', () => {
    const { fire, cb } = setup(() => ({ size: 1 }));
    fire('rename', 'LICENSE');
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('dot-directories and node_modules are dropped even when stat says they exist as directories', () => {
    const { fire, cb } = setup(asDir);
    fire('rename', '.git');
    fire('rename', '.obsidian');
    fire('rename', 'sub/.trash');
    fire('rename', 'node_modules');
    fire('rename', 'docs/node_modules');
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('an empty or separator-only name is ignored without throwing', () => {
    const { fire, cb } = setup(asDir);
    expect(() => { fire('rename', '/'); fire('rename', '\\'); fire('rename', ''); fire('rename', undefined); fire('rename', null); }).not.toThrow();
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('a gone name that merely ENDS with a dot has no extension, so it may have been a folder', () => {
    const { fire, cb } = setup(enoent);
    fire('rename', 'archive.v2.');
    flushAll();
    expect(cb.mock.calls[0][0].files).toEqual(['archive.v2.']);
  });

  test('a gone name whose extension is not the last dot-run still counts as having one', () => {
    const { fire, cb } = setup(enoent);
    fire('rename', 'backup.tar.gz');
    flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  test('a mixed burst delivers only the relevant files, in one callback', () => {
    const { fire, cb } = setup(enoent);
    fire('change', '.git/index');
    fire('change', 'a.md');
    fire('change', 'pic.png');
    fire('rename', 'sub/b.md');
    flushAll();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].files.sort()).toEqual(['a.md', 'sub/b.md']);
  });

  test('a filtered event does not start (or extend) the debounce window', () => {
    const { fire, cb } = setup();
    fire('change', 'a.md');
    vi.advanceTimersByTime(200);
    fire('change', '.git/index');   // must NOT push the flush later
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('the default trailing debounce is 300 ms', () => {
    const { fire, cb } = setup();
    fire('change', 'a.md');
    vi.advanceTimersByTime(299);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('a steady stream below the debounce still flushes at the 2 s max-wait', () => {
    const { fire, cb } = setup();
    for (let t = 0; t < 2000; t += 250) {
      fire('change', 'a.md');
      vi.advanceTimersByTime(250);
    }
    // events at 0,250,...,1750; each re-arms the 300 ms timer, so without a ceiling nothing has fired yet
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].files).toEqual(['a.md']);
  });

  test('max-wait does not fire early', () => {
    const { fire, cb } = setup();
    for (let t = 0; t < 1750; t += 250) {
      fire('change', 'a.md');
      vi.advanceTimersByTime(250);
    }
    expect(cb).not.toHaveBeenCalled(); // 1750 ms elapsed, still inside the 2 s ceiling
    vi.advanceTimersByTime(250);       // now 2000 ms since the first event
    expect(cb).toHaveBeenCalledTimes(1);
  });

  test('after a flush the next event opens a fresh window (max-wait is per burst)', () => {
    const { fire, cb } = setup();
    fire('change', 'a.md');
    vi.advanceTimersByTime(300);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    fire('change', 'b.md');
    vi.advanceTimersByTime(299);
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0].files).toEqual(['b.md']);
  });

  test('debounceMs and maxWaitMs stay configurable', () => {
    const { fire, cb } = setup(undefined, { debounceMs: 50, maxWaitMs: 120 });
    fire('change', 'a.md');
    vi.advanceTimersByTime(49);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
    for (let t = 0; t < 120; t += 40) { fire('change', 'b.md'); vi.advanceTimersByTime(40); }
    expect(cb).toHaveBeenCalledTimes(2); // ceiling at 120 ms
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

  // v1.2 — read() reads BYTES (no encoding arg) so the encoding can be detected.
  // audit M8 — write()'s conflict re-read reads bytes too: a utf8 string of a cp1256 or
  // UTF-16 file turns its bytes into U+FFFD, and different files then hash the same.
  test('read and the write conflict re-read both read bytes (no encoding)', () => {
    const encs = [];
    const base = mockFs({ '/v/a.md': 'old\n' });
    const fs = { ...base, readFileSync: (p, enc) => { encs.push(enc); return base._files[p]; } };
    const store = createDocumentStore({ fs, path: path.posix });
    store.read('/v/a.md');
    store.write('/v/a.md', 'new', { root: '/v', baseHash: hashContent('old\n'), eol: '\n' });
    expect(encs).toEqual([undefined, undefined]);
  });

  test('M8: a same-length external edit of a windows-1256 file is a conflict, not an overwrite', () => {
    const before = Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC7, 0x0A]); // مرحبا
    const after = Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC8, 0x0A]); // one letter replaced
    const fs = mockFs({ '/v/a.md': before });
    const store = createDocumentStore({ fs, path: path.posix, crypto: nodeCrypto });
    const read = store.read('/v/a.md');
    expect(read.meta.encoding).toBe('windows-1256');
    fs._files['/v/a.md'] = after; // another program saved the file
    expect(store.read('/v/a.md').meta.hash).not.toBe(read.meta.hash);
    expect(store.write('/v/a.md', 'mine\n', { root: '/v', baseHash: read.meta.hash, encoding: 'windows-1256', eol: '\n' }))
      .toEqual({ error: 'conflict' });
    expect(fs._files['/v/a.md']).toBe(after);
  });

  test('M8: the hash of a UTF-8 file is unchanged (bytes and string hash the same)', () => {
    const text = '﻿نص — text\r\n';
    expect(hashContent(Buffer.from(text, 'utf8'), nodeCrypto)).toBe(hashContent(text, nodeCrypto));
    expect(hashContent(Buffer.from(text, 'utf8'))).toBe(hashContent(text));
  });

  test('M8: a UTF-16 file saved by the app hashes the same when read back', () => {
    const fs = mockFs({ '/v/a.md': Buffer.from('﻿old\n', 'utf16le') });
    const store = createDocumentStore({ fs, path: path.posix, crypto: nodeCrypto });
    const read = store.read('/v/a.md');
    const saved = store.write('/v/a.md', 'new — text', { root: '/v', baseHash: read.meta.hash, encoding: 'utf16le', bom: true, eol: '\n' });
    expect(saved.ok).toBe(true);
    expect(store.read('/v/a.md').meta.hash).toBe(saved.meta.hash);
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
    expect(r).toEqual({ error: 'locked' }); // audit M14
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

describe('M6: BOM-less UTF-16 with characters above U+08FF', () => {
  const be = (text) => Buffer.from(text, 'utf16le').swap16();
  const cases = {
    'an em dash': 'Title — subtitle\nsecond line\n',
    'Arabic with an em dash and quotes': 'مرحبا — «نص» عربي\nسطر ثانٍ\n',
    'a surrogate pair': 'emoji 😀 in a note\n',
  };

  for (const [label, text] of Object.entries(cases)) {
    test(`${label}: little-endian is read as utf16le and saved back byte for byte`, () => {
      const raw = Buffer.from(text, 'utf16le');
      const fs = mockFs({ '/v/a.md': raw });
      const store = createDocumentStore({ fs, path: path.posix, crypto: nodeCrypto });
      const read = store.read('/v/a.md');
      expect(read.meta).toMatchObject({ encoding: 'utf16le', bom: false });
      expect(read.content).toBe(text);
      const saved = store.write('/v/a.md', read.content, {
        root: '/v', encoding: read.meta.encoding, bom: read.meta.bom, eol: read.meta.eol,
        finalNewline: read.meta.finalNewline, baseHash: read.meta.hash,
      });
      expect(saved.ok).toBe(true);
      expect(Buffer.compare(fs._files['/v/a.md'], raw)).toBe(0);
    });

    test(`${label}: big-endian is read as utf16be`, () => {
      const dec = decodeBuffer(be(text));
      expect(dec).toMatchObject({ text, encoding: 'utf16be', bom: false });
      expect(Buffer.compare(encodeBuffer(dec.text, dec.encoding, dec.bom), be(text))).toBe(0);
    });
  }

  test('bytes that are not text in either byte order are not taken for UTF-16', () => {
    const lone = Buffer.from([0x00, 0xDC, 0xDC, 0x00]); // a lone low surrogate in both byte orders
    expect(decodeBuffer(lone).encoding).not.toMatch(/^utf16/);
    const cjkEitherWay = Buffer.from([0x4E, 0x00, 0x00, 0x4E]); // U+004E U+4E00, or U+4E00 U+004E
    expect(decodeBuffer(cjkEitherWay).encoding).not.toMatch(/^utf16/);
    const binary = Buffer.from([0x01, 0x00, 0x41, 0x41, 0x00, 0x41]); // a control character one way, mostly CJK the other
    expect(decodeBuffer(binary).encoding).not.toMatch(/^utf16/);
  });

  test('UTF-8 and Windows-1256 text, which hold no NUL byte, are untouched', () => {
    expect(decodeBuffer(Buffer.from('Title — نص\n', 'utf8')).encoding).toBe('utf8');
    expect(decodeBuffer(Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC7, 0x20, 0x41, 0x0A])).encoding).toBe('windows-1256');
  });
});

describe('M5: a file with mixed line endings keeps the ending of every untouched line', () => {
  const MIXED = 'one\r\ntwo\r\nthree\nfour\r\nfive\r\n'; // 4 CRLF + 1 LF
  const open = (raw) => {
    const fs = mockFs({ '/v/a.md': Buffer.from(raw, 'utf8') });
    const store = createDocumentStore({ fs, path: path.posix, crypto: nodeCrypto });
    const read = store.read('/v/a.md');
    const save = (content) => {
      const result = store.write('/v/a.md', content, {
        root: '/v', baseHash: read.meta.hash, bom: read.meta.bom, eol: read.meta.eol,
        finalNewline: read.meta.finalNewline, encoding: read.meta.encoding,
      });
      return { result, bytes: String(fs._files['/v/a.md']) };
    };
    return { read, save };
  };

  test('the read reports the mix and hands the editor LF only', () => {
    const { read } = open(MIXED);
    expect(read.meta).toMatchObject({ eol: '\r\n', eolMixed: true, finalNewline: true });
    expect(read.content).toBe('one\ntwo\nthree\nfour\nfive\n');
    expect(open('a\r\nb\r\n').read.meta.eolMixed).toBe(false);
    expect(open('a\nb\n').read.meta.eolMixed).toBe(false);
  });

  test('saved untouched, the bytes are identical', () => {
    const { read, save } = open(MIXED);
    const { result, bytes } = save(read.content);
    expect(result.ok).toBe(true);
    expect(result.meta.eolMixed).toBe(true);
    expect(bytes).toBe(MIXED);
  });

  test('an edited line keeps its own ending; no other line changes', () => {
    expect(open(MIXED).save('ONE\ntwo\nthree\nfour\nfive\n').bytes).toBe('ONE\r\ntwo\r\nthree\nfour\r\nfive\r\n');
    expect(open(MIXED).save('one\ntwo\nTHREE\nfour\nfive\n').bytes).toBe('one\r\ntwo\r\nTHREE\nfour\r\nfive\r\n');
    expect(open(MIXED).save('one\ntwo\nthree\nfour\nFIVE\n').bytes).toBe('one\r\ntwo\r\nthree\nfour\r\nFIVE\r\n');
  });

  test('an inserted line gets the dominant ending; the lines around it keep theirs', () => {
    expect(open(MIXED).save('one\ntwo\nnew\nthree\nfour\nfive\n').bytes).toBe('one\r\ntwo\r\nnew\r\nthree\nfour\r\nfive\r\n');
    expect(open(MIXED).save('new\none\ntwo\nthree\nfour\nfive\n').bytes).toBe('new\r\none\r\ntwo\r\nthree\nfour\r\nfive\r\n');
    expect(open(MIXED).save('one\ntwo\nthree\nfour\nfive\nnew\n').bytes).toBe('one\r\ntwo\r\nthree\nfour\r\nfive\r\nnew\r\n');
  });

  test('a deleted line takes its ending with it', () => {
    expect(open(MIXED).save('one\ntwo\nfour\nfive\n').bytes).toBe('one\r\ntwo\r\nfour\r\nfive\r\n');
    expect(open(MIXED).save('two\nthree\nfour\nfive\n').bytes).toBe('two\r\nthree\nfour\r\nfive\r\n');
  });

  test('a lone CR is an ending too, and is kept', () => {
    const raw = 'one\rtwo\nthree\r\nfour';
    const { read, save } = open(raw);
    expect(read.content).toBe('one\ntwo\nthree\nfour');
    expect(read.meta).toMatchObject({ eolMixed: true, finalNewline: false });
    expect(save(read.content).bytes).toBe(raw);
    expect(open(raw).save('one\ntwo\nthree\nFOUR').bytes).toBe('one\rtwo\nthree\r\nFOUR');
  });

  test('a file without a final newline stays without one; an added one gets the dominant ending', () => {
    const raw = 'one\r\ntwo\nthree\r\nfour';
    expect(open(raw).save('one\ntwo\nthree\nfour').bytes).toBe(raw);
    expect(open(raw).save('one\ntwo\nthree\nfour\n').bytes).toBe('one\r\ntwo\nthree\r\nfour\r\n');
  });

  test('a file with one ending style is written as before', () => {
    expect(open('one\r\ntwo\r\n').save('one\nnew\ntwo\n').bytes).toBe('one\r\nnew\r\ntwo\r\n');
    expect(open('one\ntwo\n').save('one\nnew\ntwo\n').bytes).toBe('one\nnew\ntwo\n');
  });

  test('applyEolPreserving and hasMixedEol on their own', () => {
    expect(hasMixedEol('a\r\nb\n')).toBe(true);
    expect(hasMixedEol('a\rb')).toBe(true);
    expect(hasMixedEol('a\r\nb\r\n')).toBe(false);
    expect(hasMixedEol('')).toBe(false);
    expect(applyEolPreserving('x\ny\nz', 'a\r\nb\nc', '\n')).toBe('x\r\ny\nz');
    expect(applyEolPreserving('', 'a\r\nb\n', '\r\n')).toBe('');
  });
});

describe('M7: a guessed encoding is reported as a guess', () => {
  const utf8Arabic = Buffer.from('# عنوان الملاحظة\n\nفقرة عربية طويلة فيها كلمات كثيرة، وفاصلة.\n', 'utf8');
  const damaged = Buffer.concat([utf8Arabic, Buffer.from([0xE3]), Buffer.from('\n', 'utf8')]); // one stray byte
  const cp1256 = new Uint8Array(encodeWindows1256('# عنوان الملاحظة\n\nفقرة عربية طويلة فيها كلمات كثيرة، وفاصلة؟ «نعم».\n'));

  test('UTF-8 with one invalid byte is read as UTF-8, flagged, with the damage counted', () => {
    const dec = decodeBuffer(damaged);
    expect(dec).toMatchObject({ encoding: 'utf8', bom: false, uncertain: true, invalidBytes: 1 });
    expect(dec.text.startsWith('# عنوان الملاحظة')).toBe(true); // not Windows-1256 mojibake
    expect(utf8Profile(damaged).invalid).toBe(1);
  });

  test('plain Windows-1256 Arabic, with commas and quotes, is not a guess', () => {
    const dec = decodeBuffer(Buffer.from(cp1256));
    expect(dec.encoding).toBe('windows-1256');
    expect(dec.uncertain).toBeUndefined();
    expect(dec.text).toContain('فقرة عربية');
  });

  test('valid UTF-8 and UTF-16 are not guesses', () => {
    expect(decodeBuffer(utf8Arabic).uncertain).toBeUndefined();
    expect(decodeBuffer(Buffer.from('﻿note', 'utf16le')).uncertain).toBeUndefined();
    expect(decodeBuffer(Buffer.from('Title — x\n', 'utf16le')).uncertain).toBeUndefined();
  });

  test('bytes between the two (few sequences, few stray bytes) are a Windows-1256 guess', () => {
    const dec = decodeBuffer(Buffer.from([0x41, 0xC9, 0xA1, 0x20, 0xE3, 0x20, 0xE4, 0x0A])); // 1 sequence, 2 stray
    expect(dec).toMatchObject({ encoding: 'windows-1256', uncertain: true });
  });

  test('valid UTF-8 that holds a NUL byte, and is not UTF-16, is a guess', () => {
    expect(decodeBuffer(Buffer.from('abc\u0000def', 'utf8'))).toMatchObject({ encoding: 'utf8', uncertain: true, invalidBytes: 0 });
  });

  test('a UTF-8 BOM before a body that is not UTF-8 is a guess either way', () => {
    const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
    expect(decodeBuffer(Buffer.concat([bom, Buffer.from(cp1256)]))).toMatchObject({ encoding: 'windows-1256', bom: false, uncertain: true });
    expect(decodeBuffer(Buffer.concat([bom, damaged]))).toMatchObject({ encoding: 'utf8', bom: true, uncertain: true, invalidBytes: 1 });
  });

  test('the read puts the guess in meta, and only then', () => {
    const fs = mockFs({ '/v/bad.md': damaged, '/v/good.md': utf8Arabic });
    const store = createDocumentStore({ fs, path: path.posix, crypto: nodeCrypto });
    expect(store.read('/v/bad.md').meta).toMatchObject({ encoding: 'utf8', encodingUncertain: true, encodingInvalidBytes: 1 });
    expect(Object.keys(store.read('/v/good.md').meta)).not.toContain('encodingUncertain');
  });

  test('decodeBufferAs reads the bytes with the chosen encoding', () => {
    expect(decodeBufferAs(Buffer.from(cp1256), 'windows-1256').text).toContain('فقرة عربية');
    expect(decodeBufferAs(Buffer.from(cp1256), 'windows-1256').uncertain).toBeUndefined();
    expect(decodeBufferAs(damaged, 'utf8')).toMatchObject({ encoding: 'utf8', uncertain: true, invalidBytes: 1 });
    expect(decodeBufferAs(utf8Arabic, 'utf8')).toMatchObject({ encoding: 'utf8', bom: false, uncertain: false, invalidBytes: 0 });
    expect(decodeBufferAs(Buffer.from('﻿hi', 'utf16le'), 'utf16le')).toMatchObject({ text: 'hi', bom: true });
    expect(decodeBufferAs(Buffer.from('hi', 'utf16le').swap16(), 'utf16be')).toMatchObject({ text: 'hi', bom: false });
    expect(decodeBufferAs(Buffer.from([0x41, 0x00, 0x42]), 'utf16le')).toBeNull(); // odd length
    expect(decodeBufferAs(utf8Arabic, 'latin1')).toBeNull();
    expect(REOPEN_ENCODINGS).toEqual(['utf8', 'windows-1256', 'utf16le', 'utf16be']);
  });

  test('store.read with an encoding the bytes cannot be reports a mismatch', () => {
    const fs = mockFs({ '/v/a.md': Buffer.from([0x41, 0x00, 0x42]) });
    const store = createDocumentStore({ fs, path: path.posix, crypto: nodeCrypto });
    expect(store.read('/v/a.md', { encoding: 'utf16le' })).toEqual({ error: 'encoding-mismatch' });
    expect(store.read('/v/a.md', { encoding: 'windows-1256' }).meta.encoding).toBe('windows-1256');
  });
});

describe('Windows-1256 is a byte-exact round trip', () => {
  test('every one of the 256 byte values decodes and encodes back to itself', () => {
    const all = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const text = new TextDecoder('windows-1256').decode(all);
    expect(new Set(text).size).toBe(256);
    expect(Buffer.compare(encodeWindows1256(text), all)).toBe(0);
    expect(firstUnmappableWindows1256Char(text)).toBeNull();
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
