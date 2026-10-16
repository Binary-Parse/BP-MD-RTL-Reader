/**
 * large-files-main.test.js — tiered note sizes in the main process.
 *
 *   <= 5 MiB       unchanged
 *   5-20 MiB       opens like any note (the renderer says it is large)
 *   20-100 MiB     asked about first: {error:'confirm-large'} until the read says confirmLarge
 *   > 100 MiB      refused: {error:'file-too-large'} with the size
 *
 * Every tier edge is tested exactly at the edge and one byte over, on every way a note opens:
 * Open File, a recent file (fs:readFile), a dropped/picked file (text:decode), a folder read
 * and the launch arguments ("Open with"). Also: the conflict hash above the old 10 MiB limit,
 * crash recovery of a large note, and the export size limits and PDF timeout scaling.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';
import fsReal from 'node:fs';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';
import {
  MIB, LARGE_NOTE_BYTES, CONFIRM_NOTE_BYTES, MAX_FILE_BYTES, MAX_VAULT_FILE_BYTES, MAX_CUMULATIVE_BYTES,
  MAX_PDF_EXPORT_BYTES, MAX_HTML_EXPORT_BYTES, MAX_EPUB_BYTES, pdfTimeoutMs, getLimits, noteSizeTier,
  parseFileArgs,
} from '../../src/main/main-logic.js';
import { DEFAULT_LIMITS } from '../../src/renderer/components/large-file.js';

const NOTE = path.join('/docs', 'big.md');
const dirent = (name) => ({ name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false });

function setup({ argv = ['node', 'src/main/index.js'] } = {}) {
  const el = buildMockElectron();
  const handlers = {};
  el.ipcMain.handle.mockImplementation((n, fn) => { handlers[n] = fn; });
  const files = {};
  const sizes = {};
  const fsMock = buildMockFs({
    existsSync: (p) => p in files,
    readFileSync: (p) => files[p],
    writeFileSync: (p, c) => { files[p] = c; },
    renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
  });
  fsMock.statSync = (p) => ({ isFile: () => p !== '/vault', isDirectory: () => p === '/vault', size: sizes[p] ?? Buffer.byteLength(files[p] ?? ''), mtimeMs: 1 });
  bootstrap({ electron: el, fs: fsMock, proc: buildMockProc(argv) });
  return { el, handlers, files, sizes, fsMock };
}

describe('one source of truth for the limits', () => {
  test('the numbers are the documented ones', () => {
    expect(LARGE_NOTE_BYTES).toBe(5 * MIB);
    expect(CONFIRM_NOTE_BYTES).toBe(20 * MIB);
    expect(MAX_FILE_BYTES).toBe(100 * MIB);
    expect(MAX_VAULT_FILE_BYTES).toBe(20 * MIB);
    expect(MAX_CUMULATIVE_BYTES).toBe(100 * MIB);
    expect(MAX_PDF_EXPORT_BYTES).toBe(64 * MIB);
    expect(MAX_HTML_EXPORT_BYTES).toBe(256 * MIB);
    expect(MAX_EPUB_BYTES).toBe(64 * MIB);
  });

  test('app:limits returns exactly what the renderer falls back to (no drift between the two copies)', async () => {
    const { handlers } = setup();
    await new Promise((r) => setTimeout(r, 30));
    const fromMain = await handlers['app:limits']();
    expect(fromMain).toEqual(getLimits());
    expect(fromMain).toEqual(DEFAULT_LIMITS);
  });

  test('noteSizeTier: exactly-at stays in the lower tier, one byte over moves up', () => {
    expect(noteSizeTier(LARGE_NOTE_BYTES)).toBe('normal');
    expect(noteSizeTier(LARGE_NOTE_BYTES + 1)).toBe('large');
    expect(noteSizeTier(CONFIRM_NOTE_BYTES)).toBe('large');
    expect(noteSizeTier(CONFIRM_NOTE_BYTES + 1)).toBe('confirm');
    expect(noteSizeTier(MAX_FILE_BYTES)).toBe('confirm');
    expect(noteSizeTier(MAX_FILE_BYTES + 1)).toBe('refused');
  });

  test('src/main/index.js stays within its 350-line budget', () => {
    const text = fsReal.readFileSync(path.join(__dirname, '../../src/main/index.js'), 'utf8');
    expect(text.split('\n').length).toBeLessThanOrEqual(350);
  });
});

describe('Open File and recent files: the tier edges', () => {
  let ctx;
  beforeEach(async () => {
    ctx = setup();
    await new Promise((r) => setTimeout(r, 30));
    ctx.files[NOTE] = '# big\n';
    ctx.el.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [NOTE] });
  });
  const open = (size) => { ctx.sizes[NOTE] = size; return ctx.handlers['dialog:openFile']({}); };

  test.each([
    ['5 MiB', LARGE_NOTE_BYTES], ['5 MiB + 1', LARGE_NOTE_BYTES + 1], ['20 MiB', CONFIRM_NOTE_BYTES],
  ])('%s opens at once with no question', async (_label, size) => {
    const r = await open(size);
    expect(r.error).toBeUndefined();
    expect(r.content).toBe('# big\n');
    expect(r.size).toBe(size);
  });

  test.each([
    ['20 MiB + 1', CONFIRM_NOTE_BYTES + 1], ['100 MiB', MAX_FILE_BYTES],
  ])('%s asks first; nothing is read until the answer is yes', async (_label, size) => {
    const r = await open(size);
    expect(r).toMatchObject({ error: 'confirm-large', size, name: 'big.md' });
    expect(r.content).toBeUndefined();
    expect(typeof r.documentId).toBe('string');
    // A read without the confirmation asks again; with it, the note comes back.
    expect(await ctx.handlers['fs:readFile']({}, r.documentId)).toMatchObject({ error: 'confirm-large' });
    expect(await ctx.handlers['fs:readFile']({}, r.documentId, { confirmLarge: false })).toMatchObject({ error: 'confirm-large' });
    expect(await ctx.handlers['fs:readFile']({}, r.documentId, { confirmLarge: 'yes' })).toMatchObject({ error: 'confirm-large' });
    const read = await ctx.handlers['fs:readFile']({}, r.documentId, { confirmLarge: true });
    expect(read).toMatchObject({ content: '# big\n', size });
    expect(read.error).toBeUndefined();
  });

  test('100 MiB + 1 is refused with its size, and even a confirmed read stays refused', async () => {
    const r = await open(MAX_FILE_BYTES + 1);
    expect(r.error).toBe('file-too-large');
    // Authorize it as a recent file by opening a small one, then growing it past the limit.
    const small = await open(10);
    ctx.sizes[NOTE] = MAX_FILE_BYTES + 1;
    expect(await ctx.handlers['fs:readFile']({}, small.documentId, { confirmLarge: true }))
      .toMatchObject({ error: 'file-too-large', size: MAX_FILE_BYTES + 1, name: 'big.md' });
  });
});

describe('dropped or picked files (text:decode)', () => {
  test('exactly 100 MiB decodes; one byte more is refused', async () => {
    const { handlers } = setup();
    await new Promise((r) => setTimeout(r, 30));
    const ok = await handlers['text:decode']({}, new Uint8Array(MAX_FILE_BYTES).fill(0x61));
    expect(ok.ok).toBe(true);
    expect(ok.text.length).toBe(MAX_FILE_BYTES);
    expect(await handlers['text:decode']({}, new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61))).toEqual({ error: 'file-too-large' });
  });
});

describe('folder read', () => {
  let ctx;
  beforeEach(async () => {
    ctx = setup();
    await new Promise((r) => setTimeout(r, 30));
    ctx.el.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/vault'] });
  });

  async function readFolder(sizesByName) {
    const picked = await ctx.handlers['dialog:openFolder']();
    const names = Object.keys(sizesByName);
    ctx.fsMock.promises.readdir.mockResolvedValueOnce(names.map(dirent));
    for (const n of names) {
      ctx.files[path.join('/vault', n)] = 'x';
      ctx.fsMock.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, isFile: () => true, size: sizesByName[n] });
    }
    return ctx.handlers['fs:readVault']({}, picked.vault.id);
  }

  test('a note of exactly 20 MiB is read; one byte more is named as skipped, not lost silently', async () => {
    const r = await readFolder({ 'a.md': MAX_VAULT_FILE_BYTES, 'b.md': MAX_VAULT_FILE_BYTES + 1 });
    expect(r.entries.map((e) => e.name)).toEqual(['a.md']);
    expect(r.skipped).toMatchObject({ oversized: 1 });
  });

  test('the folder total is capped at 100 MiB: notes that fit are read, the rest are left out and flagged', async () => {
    const r = await readFolder({ 'a.md': 20 * MIB, 'b.md': 20 * MIB, 'c.md': 20 * MIB, 'd.md': 20 * MIB, 'e.md': 20 * MIB, 'f.md': 1 });
    expect(r.entries.map((e) => e.name)).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']); // exactly 100 MiB
    expect(r.truncated).toBe(true); // f.md would take the folder past 100 MiB
  });
});

describe('launch arguments ("Open with")', () => {
  test('a note of any size is returned, not dropped; the question is asked when it is delivered', () => {
    const stat = (size) => () => ({ isFile: () => true, size });
    for (const size of [5 * MIB, 20 * MIB + 1, 100 * MIB, 100 * MIB + 1]) {
      const out = parseFileArgs(['electron', '/docs/x.md'], { statSync: stat(size), realpathSync: (p) => p });
      expect(out).toEqual(['/docs/x.md']);
    }
  });
});

describe('the conflict check covers every note that can open', () => {
  let ctx;
  const SIZE = 12 * MIB; // above the old 10 MiB limit of the check
  beforeEach(async () => {
    ctx = setup();
    await new Promise((r) => setTimeout(r, 30));
    ctx.el.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [NOTE] });
  });
  const save = (doc, content) => ctx.handlers['fs:writeFile']({}, {
    documentId: doc.documentId, content, baseHash: doc.meta.hash, eol: '\n', finalNewline: false, encoding: doc.meta.encoding,
  });

  test('a 12 MiB note that changed on disk is a conflict, not silently overwritten', async () => {
    ctx.files[NOTE] = Buffer.alloc(SIZE, 0x61);
    const doc = await ctx.handlers['dialog:openFile']({});
    expect(doc.meta.hash).toBeTruthy();
    const other = Buffer.alloc(SIZE, 0x61);
    other[100] = 0x62; // same size, one byte different
    ctx.files[NOTE] = other;
    expect(await save(doc, doc.content)).toEqual({ error: 'conflict' });
    expect(ctx.files[NOTE]).toBe(other);
  });

  test('the same note unchanged on disk saves', async () => {
    ctx.files[NOTE] = Buffer.alloc(SIZE, 0x61);
    const doc = await ctx.handlers['dialog:openFile']({});
    expect(await save(doc, doc.content)).toMatchObject({ ok: true });
  });

  test('a target swapped for a file past 100 MiB is a conflict', async () => {
    ctx.files[NOTE] = Buffer.from('# small\n');
    const doc = await ctx.handlers['dialog:openFile']({});
    ctx.sizes[NOTE] = MAX_FILE_BYTES + 1;
    expect(await save(doc, 'new text')).toEqual({ error: 'conflict' });
  });
});

describe('crash recovery keeps large notes', () => {
  let ctx;
  beforeEach(async () => {
    ctx = setup();
    await new Promise((r) => setTimeout(r, 30));
  });

  test('a 30 MiB note is mirrored and comes back in full', async () => {
    const content = 'a'.repeat(30 * MIB);
    expect(await ctx.handlers['recovery:snapshot']({}, [{ name: 'big.md', content }])).toMatchObject({ ok: true, count: 1 });
    const popped = await ctx.handlers['recovery:pop']();
    expect(popped.files).toHaveLength(1);
    expect(popped.files[0].content.length).toBe(content.length);
  });

  test('mirroring the same large set twice does not rewrite it', async () => {
    const content = 'a'.repeat(30 * MIB);
    ctx.fsMock.promises.stat.mockImplementation(async (p) => ({ size: ctx.files[p] ? ctx.files[p].length : 0 }));
    const first = await ctx.handlers['recovery:snapshot']({}, [{ name: 'big.md', content }]);
    expect(first.unchanged).toBeUndefined();
    const second = await ctx.handlers['recovery:snapshot']({}, [{ name: 'big.md', content }]);
    expect(second).toMatchObject({ ok: true, unchanged: true, count: 1 });
    const changed = await ctx.handlers['recovery:snapshot']({}, [{ name: 'big.md', content: `${content}b` }]);
    expect(changed.unchanged).toBeUndefined();
  });

  test('a note past what any note can become is named in `skipped`; the others are kept', async () => {
    const reply = await ctx.handlers['recovery:snapshot']({}, [
      { name: 'ok.md', content: 'fine' },
      { name: 'huge.md', content: 'م'.repeat(160 * MIB) }, // 320 MiB as UTF-8
    ]);
    expect(reply).toMatchObject({ ok: true, count: 1, skipped: ['huge.md'] });
  });
});

describe('export limits and PDF timeouts', () => {
  test('the PDF timeout is 30 s plus 10 s per MiB, capped at 5 minutes', () => {
    expect(pdfTimeoutMs(0)).toBe(30000);
    expect(pdfTimeoutMs(1 * MIB)).toBe(40000);
    expect(pdfTimeoutMs(10 * MIB)).toBe(130000);
    expect(pdfTimeoutMs(27 * MIB)).toBe(300000);
    expect(pdfTimeoutMs(64 * MIB)).toBe(300000);
    expect(pdfTimeoutMs(MAX_PDF_EXPORT_BYTES * 10)).toBe(300000);
  });

  test('export:pdf at exactly 64 MiB goes on to the save dialog; one byte more is too-large', async () => {
    const { el, handlers } = setup();
    await new Promise((r) => setTimeout(r, 30));
    el.dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await handlers['export:pdf']({}, { html: 'x'.repeat(MAX_PDF_EXPORT_BYTES) })).toEqual({ canceled: true });
    expect(await handlers['export:pdf']({}, { html: 'x'.repeat(MAX_PDF_EXPORT_BYTES + 1) })).toEqual({ error: 'too-large' });
  });

  test('export:html at exactly 256 MiB goes on; one byte more is too-large', async () => {
    const { el, handlers } = setup();
    await new Promise((r) => setTimeout(r, 30));
    el.dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await handlers['export:html']({}, { html: 'x'.repeat(MAX_HTML_EXPORT_BYTES) })).toEqual({ canceled: true });
    expect(await handlers['export:html']({}, { html: 'x'.repeat(MAX_HTML_EXPORT_BYTES + 1) })).toEqual({ error: 'too-large' });
  });

  test('export:epub at exactly 64 MiB goes on; one byte more is too-large', async () => {
    const { el, handlers } = setup();
    await new Promise((r) => setTimeout(r, 30));
    el.dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await handlers['export:epub']({}, { bytes: new Uint8Array(MAX_EPUB_BYTES) })).toEqual({ canceled: true });
    expect(await handlers['export:epub']({}, { bytes: new Uint8Array(MAX_EPUB_BYTES + 1) })).toEqual({ error: 'too-large' });
  });
});

describe('"Open with" delivery to the window', () => {
  let el, fsMock, didFinishLoad, openFile;
  beforeEach(async () => {
    el = buildMockElectron();
    const appListeners = {};
    el.app.on.mockImplementation((event, fn) => { appListeners[event] = fn; });
    el._mockWin.webContents.on.mockImplementation((event, fn) => { if (event === 'did-finish-load') didFinishLoad = fn; });
    fsMock = buildMockFs({ readFileSync: vi.fn(() => '# opened') });
    bootstrap({ electron: el, fs: fsMock, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 50));
    didFinishLoad();
    openFile = appListeners['open-file'];
  });
  const deliver = (size) => {
    fsMock.statSync.mockReturnValue({ isFile: () => true, isDirectory: () => false, size, mtimeMs: 1 });
    el.BrowserWindow.getAllWindows.mockReturnValueOnce([el._mockWin]);
    el._mockWin.webContents.send.mockClear();
    openFile({ preventDefault: vi.fn() }, '/abs/dir/Big.md');
    return el._mockWin.webContents.send.mock.calls.map((c) => c[1]);
  };

  test('up to 20 MiB the note is sent with its content', () => {
    const [payload] = deliver(CONFIRM_NOTE_BYTES);
    expect(payload).toMatchObject({ name: 'Big.md', content: '# opened', size: CONFIRM_NOTE_BYTES });
  });

  test('above 20 MiB the window gets the question (name, size, documentId) and no content', () => {
    const [payload] = deliver(CONFIRM_NOTE_BYTES + 1);
    expect(payload).toMatchObject({ error: 'confirm-large', name: 'Big.md', size: CONFIRM_NOTE_BYTES + 1 });
    expect(typeof payload.documentId).toBe('string');
    expect(payload.content).toBeUndefined();
  });

  test('above 100 MiB the window gets the refusal with the size, not a silent drop', () => {
    const [payload] = deliver(MAX_FILE_BYTES + 1);
    expect(payload).toMatchObject({ error: 'file-too-large', name: 'Big.md', size: MAX_FILE_BYTES + 1 });
  });
});
