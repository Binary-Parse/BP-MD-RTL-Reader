/**
 * main-export-epub.test.js — T6.1c `export:epub` IPC handler.
 *
 * Unlike export:pdf there is nothing to render: the renderer ships the finished archive as
 * opaque BYTES, so main validates the payload, asks for a path, and writes the file
 * atomically. These tests pin exactly that — including the absence of any rendering session,
 * which is what keeps EPUB export a zero-network operation.
 *
 * Drives the real bootstrap({ electron, fs, proc }) via the shared harness seam.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const getHandle = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const EPUB_BYTES = Uint8Array.from([0x50, 0x4B, 0x03, 0x04, 1, 2, 3]);
const MAX_EPUB_BYTES = 64 * 1024 * 1024;

describe('export:epub (T6.1c)', () => {
  let electron, fs, handler;
  beforeEach(async () => {
    electron = buildMockElectron();
    fs = buildMockFs();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 50));
    handler = getHandle(electron, 'export:epub');
  });

  test('the handler is registered', () => {
    expect(typeof handler).toBe('function');
  });

  test('invalid payloads → { error: "invalid" }, no dialog', async () => {
    electron.dialog.showSaveDialog.mockClear();
    expect(await handler({}, {})).toEqual({ error: 'invalid' });
    expect(await handler({}, null)).toEqual({ error: 'invalid' });
    expect(await handler({}, { bytes: 'PK' })).toEqual({ error: 'invalid' });
    expect(await handler({}, { bytes: [0x50, 0x4B] })).toEqual({ error: 'invalid' }); // a plain array is not Uint8Array
    expect(await handler({}, { bytes: new Uint8Array(0) })).toEqual({ error: 'invalid' }); // empty archive
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  test('a payload past the size cap → { error: "too-large" }, no dialog', async () => {
    electron.dialog.showSaveDialog.mockClear();
    const huge = new Uint8Array(MAX_EPUB_BYTES + 1);
    expect(await handler({}, { bytes: huge })).toEqual({ error: 'too-large' });
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  test('canceled save dialog → { canceled: true } and nothing written', async () => {
    // Bootstrap itself writes the capability store, so count writes instead of asserting none.
    const writesBefore = fs.writeFileSync.mock.calls.length;
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    expect(await handler({}, { bytes: EPUB_BYTES, defaultName: 'note.epub' })).toEqual({ canceled: true });
    expect(fs.writeFileSync.mock.calls.length).toBe(writesBefore);
    expect(fs.writeFileSync.mock.calls.some((c) => String(c[0]).includes('note.epub'))).toBe(false);
    // Not canceled but an EMPTY path is still a cancel (kills the || → && mutant).
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '' });
    expect(await handler({}, { bytes: EPUB_BYTES, defaultName: 'note.epub' })).toEqual({ canceled: true });
    expect(fs.writeFileSync.mock.calls.length).toBe(writesBefore);
  });

  test('the save dialog is titled "Export EPUB" with an .epub filter and the given name', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    await handler({}, { bytes: EPUB_BYTES, defaultName: 'My Note.epub' });
    const [, opts] = electron.dialog.showSaveDialog.mock.calls.at(-1);
    expect(opts.title).toBe('Export EPUB');
    expect(opts.defaultPath).toBe('My Note.epub');
    expect(opts.filters).toEqual([{ name: 'EPUB Book', extensions: ['epub'] }]);
  });

  test('a missing/empty/non-string defaultName falls back to "document.epub"', async () => {
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    await handler({}, { bytes: EPUB_BYTES });
    expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[1].defaultPath).toBe('document.epub');
    await handler({}, { bytes: EPUB_BYTES, defaultName: '' });
    expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[1].defaultPath).toBe('document.epub');
    await handler({}, { bytes: EPUB_BYTES, defaultName: 42 });
    expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[1].defaultPath).toBe('document.epub');
  });

  test('success writes the exact bytes atomically and reports ok', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.epub' });
    const res = await handler({}, { bytes: EPUB_BYTES, defaultName: 'note.epub' });
    expect(res).toEqual({ ok: true });
    const [tmpPath, data] = fs.writeFileSync.mock.calls.at(-1);
    expect(tmpPath).toMatch(/^\/out\/note\.epub\.tmp-/); // temp-then-rename, never a partial file
    expect(Buffer.isBuffer(data)).toBe(true);
    expect([...data]).toEqual([...EPUB_BYTES]);
    expect(fs.renameSync).toHaveBeenCalledWith(tmpPath, '/out/note.epub');
  });

  test('a byteOffset view writes only its own bytes (not the whole backing buffer)', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/sliced.epub' });
    const backing = Uint8Array.from([9, 9, 0x50, 0x4B, 9, 9]);
    const view = backing.subarray(2, 4);
    await handler({}, { bytes: view, defaultName: 'sliced.epub' });
    expect([...fs.writeFileSync.mock.calls.at(-1)[1]]).toEqual([0x50, 0x4B]);
  });

  test('a write failure → { error: "write-failed" } (never a false success)', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.epub' });
    fs.writeFileSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    expect(await handler({}, { bytes: EPUB_BYTES, defaultName: 'note.epub' })).toEqual({ error: 'write-failed' });
  });

  test('no rendering and no network: no offscreen window, no export session', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.epub' });
    electron._mockWin.webContents.printToPDF.mockClear();
    await handler({}, { bytes: EPUB_BYTES, defaultName: 'note.epub' });
    expect(electron._mockWin.webContents.printToPDF).not.toHaveBeenCalled();
    expect(electron._mockWin.loadFile).not.toHaveBeenCalled();
    expect(electron.session.fromPartition).not.toHaveBeenCalled();
  });

  test('no focused window → still exports (dialog tolerates a null parent)', async () => {
    electron.BrowserWindow.getFocusedWindow.mockReturnValueOnce(null);
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.epub' });
    const res = await handler({}, { bytes: EPUB_BYTES, defaultName: 'note.epub' });
    expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[0]).toBeNull();
    expect(res).toEqual({ ok: true });
  });
});
