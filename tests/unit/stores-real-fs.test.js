/**
 * QA-M29: the stores were unit-tested on an in-memory file system only. These run the same
 * code against a real temporary directory, so rename, exclusive create, fsync, directory
 * listing and the corrupt-file set-aside are the operating system's, not a fake's.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { atomicWriteJson, readJsonFileChecked, setAsideCorruptFile, sweepStaleJsonTemps } = require('../../src/main/json-store.js');
const { createAnnotationsStore } = require('../../src/main/annotations-store.js');
const { createDocumentStore } = require('../../src/main/document-store.js');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-store-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const isObject = (v) => v && typeof v === 'object';
const leftovers = () => fs.readdirSync(dir).filter((n) => n.includes('.tmp-'));

describe('json-store on a real directory', () => {
  test('write, overwrite and read back, leaving no temp file', () => {
    const file = path.join(dir, 'data.json');
    expect(atomicWriteJson(fs, file, JSON.stringify({ v: 1 }))).toEqual({ ok: true });
    expect(atomicWriteJson(fs, file, JSON.stringify({ v: 2 }))).toEqual({ ok: true });
    expect(readJsonFileChecked(fs, file, isObject)).toEqual({ status: 'ok', value: { v: 2 } });
    expect(leftovers()).toEqual([]);
  });

  test('missing, torn and wrong-shape files are told apart', () => {
    const file = path.join(dir, 'data.json');
    expect(readJsonFileChecked(fs, file, isObject).status).toBe('missing');
    fs.writeFileSync(file, '{"v": 1');
    expect(readJsonFileChecked(fs, file, isObject).status).toBe('corrupt');
    fs.writeFileSync(file, '42');
    expect(readJsonFileChecked(fs, file, isObject).status).toBe('corrupt');
  });

  test('a damaged file is moved aside next to itself, never deleted', () => {
    const file = path.join(dir, 'data.json');
    fs.writeFileSync(file, 'not json');
    const moved = setAsideCorruptFile(fs, file, Date.UTC(2026, 9, 13, 8, 0, 0));
    expect(path.basename(moved)).toBe('data.json.corrupt-20261013T080000000Z');
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readFileSync(moved, 'utf8')).toBe('not json');
  });

  test('only temp files older than an hour are swept', () => {
    const file = path.join(dir, 'data.json');
    const old = `${file}.tmp-old`;
    const fresh = `${file}.tmp-fresh`;
    fs.writeFileSync(old, 'x');
    fs.writeFileSync(fresh, 'y');
    const twoHoursAgo = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(old, twoHoursAgo, twoHoursAgo);
    sweepStaleJsonTemps(fs, file);
    expect(leftovers()).toEqual(['data.json.tmp-fresh']);
  });

  test('a target in a missing directory fails cleanly and says the folder is gone', () => {
    expect(atomicWriteJson(fs, path.join(dir, 'nope', 'data.json'), '{}')).toEqual({ error: 'gone' });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  // Windows: rename onto a file another process holds open fails with EPERM/EBUSY. The retry
  // (atomic-rename.js) must give up cleanly, and succeed once the handle is closed.
  test.runIf(process.platform === 'win32')('a held target fails cleanly and succeeds once released', () => {
    const file = path.join(dir, 'data.json');
    fs.writeFileSync(file, '{"v":0}');
    const fd = fs.openSync(file, 'r');
    let held;
    try {
      held = atomicWriteJson(fs, file, '{"v":1}', { sleep: () => {} });
    } finally {
      fs.closeSync(fd);
    }
    // Node opens files with FILE_SHARE_DELETE on Windows, so a read handle may not block the
    // rename at all; either way nothing may be lost or left behind.
    if (held.error) expect(fs.readFileSync(file, 'utf8')).toBe('{"v":0}');
    expect(atomicWriteJson(fs, file, '{"v":2}')).toEqual({ ok: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('{"v":2}');
    expect(leftovers()).toEqual([]);
  });
});

describe('annotations store on a real directory', () => {
  const highlight = { id: 'h1', text: 'hello', note: '', at: 1, anchor: { headingSlug: 'intro', ordinal: 0 } };

  test('highlights survive a new store instance (a restart)', () => {
    const first = createAnnotationsStore({ fs, path, userDataDir: dir });
    const put = first.put('doc:cap-1', [highlight]);
    expect(put).toEqual({ ok: true, count: 1 });
    const second = createAnnotationsStore({ fs, path, userDataDir: dir });
    expect(second.get('doc:cap-1').highlights).toHaveLength(1);
    expect(second.loadStatus()).toBe('ok');
  });

  test('a damaged annotations.json is kept aside and a fresh one is written', () => {
    fs.writeFileSync(path.join(dir, 'annotations.json'), '{"version":');
    const store = createAnnotationsStore({ fs, path, userDataDir: dir });
    expect(store.loadStatus()).toBe('corrupt');
    expect(store.put('doc:cap-1', [highlight])).toEqual({ ok: true, count: 1 });
    const names = fs.readdirSync(dir).sort();
    expect(names[0]).toBe('annotations.json');
    expect(names[1]).toMatch(/^annotations\.json\.corrupt-/);
  });
});

describe('document store on a real directory', () => {
  const store = () => createDocumentStore({ fs, path, crypto });

  test('a CRLF file with a BOM is read and written back byte-faithfully', () => {
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('# T\r\n\r\nbody\r\n')]));
    const read = store().read(file);
    expect(read.meta).toMatchObject({ bom: true, eol: '\r\n', finalNewline: true });
    const written = store().write(file, `${read.content}more\n`, { baseHash: read.meta.hash, bom: true, eol: '\r\n', finalNewline: true });
    expect(written.ok).toBe(true);
    const bytes = fs.readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
    expect(bytes.subarray(3).toString('utf8')).toBe('# T\r\n\r\nbody\r\nmore\r\n');
    expect(leftovers()).toEqual([]);
  });

  test('a Windows-1256 file keeps its encoding on save', () => {
    const file = path.join(dir, 'arabic.md');
    fs.writeFileSync(file, Buffer.from([0xC7, 0xE1, 0xDA, 0xD1, 0xC8, 0xED, 0xC9, 0x0A])); // "العربية\n"
    const read = store().read(file, { encoding: 'windows-1256' });
    expect(read.content).toContain('العربية');
    const written = store().write(file, read.content, { baseHash: read.meta.hash, eol: '\n', finalNewline: true, encoding: 'windows-1256' });
    expect(written.ok).toBe(true);
    expect([...fs.readFileSync(file)]).toEqual([0xC7, 0xE1, 0xDA, 0xD1, 0xC8, 0xED, 0xC9, 0x0A]);
  });
});
