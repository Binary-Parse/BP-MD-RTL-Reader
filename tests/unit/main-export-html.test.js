/**
 * main-export-html.test.js — audit L3 `export:html` IPC handler.
 *
 * The page used to start a blob download and say "Exported" at once. Main now asks for the
 * path and writes the finished document, so the answer is true: ok, canceled or an error.
 *
 * Drives the real bootstrap({ electron, fs, proc }) via the shared harness seam.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const getHandle = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const HTML = '<!DOCTYPE html>\n<html lang="ar" dir="rtl"><body><p>مرحبا</p></body></html>';
const MAX_HTML_EXPORT_BYTES = 256 * 1024 * 1024;

describe('export:html (audit L3)', () => {
  let electron, fs, handler;
  beforeEach(async () => {
    electron = buildMockElectron();
    fs = buildMockFs();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 50));
    handler = getHandle(electron, 'export:html');
  });

  test('invalid payloads → { error: "invalid" }, no dialog', async () => {
    electron.dialog.showSaveDialog.mockClear();
    for (const payload of [null, {}, { html: 42 }, { html: '' }, { html: new Uint8Array([1]) }]) {
      expect(await handler({}, payload)).toEqual({ error: 'invalid' });
    }
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  test('a document past the size cap → { error: "too-large" }, no dialog; one at the cap is asked for', async () => {
    electron.dialog.showSaveDialog.mockClear();
    expect(await handler({}, { html: 'x'.repeat(MAX_HTML_EXPORT_BYTES + 1) })).toEqual({ error: 'too-large' });
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    expect(await handler({}, { html: 'x'.repeat(MAX_HTML_EXPORT_BYTES) })).toEqual({ canceled: true });
  });

  test('the cap counts bytes, not characters', async () => {
    electron.dialog.showSaveDialog.mockClear();
    // Each Arabic letter is two bytes in UTF-8: half the cap in letters, plus one, is over it.
    const html = 'م'.repeat(MAX_HTML_EXPORT_BYTES / 2 + 1);
    expect(await handler({}, { html })).toEqual({ error: 'too-large' });
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  test('a canceled dialog, or one without a path → { canceled: true } and nothing written', async () => {
    const writesBefore = fs.writeFileSync.mock.calls.length;
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    expect(await handler({}, { html: HTML, defaultName: 'note.html' })).toEqual({ canceled: true });
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '' });
    expect(await handler({}, { html: HTML, defaultName: 'note.html' })).toEqual({ canceled: true });
    expect(fs.writeFileSync.mock.calls.length).toBe(writesBefore);
  });

  test('the dialog is titled "Export HTML" with an .html filter and the given name', async () => {
    electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
    await handler({}, { html: HTML, defaultName: 'My Note.html' });
    const [, opts] = electron.dialog.showSaveDialog.mock.calls.at(-1);
    expect(opts).toEqual({
      title: 'Export HTML',
      defaultPath: 'My Note.html',
      filters: [{ name: 'HTML Document', extensions: ['html'] }],
    });
    for (const defaultName of [undefined, '', 42]) {
      await handler({}, { html: HTML, defaultName });
      expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[1].defaultPath).toBe('document.html');
    }
  });

  test('success writes the document as UTF-8, temp file then rename, and reports ok', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.html' });
    expect(await handler({}, { html: HTML, defaultName: 'note.html' })).toEqual({ ok: true });
    const [tmpPath, data] = fs.writeFileSync.mock.calls.at(-1);
    expect(tmpPath).toMatch(/^\/out\/note\.html\.tmp-/);
    expect(Buffer.isBuffer(data)).toBe(true);
    expect(data.toString('utf8')).toBe(HTML);
    expect(fs.renameSync).toHaveBeenCalledWith(tmpPath, '/out/note.html');
  });

  test('a write failure → { error: "write-failed" }, never a false success', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.html' });
    fs.writeFileSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    });
    expect(await handler({}, { html: HTML, defaultName: 'note.html' })).toEqual({ error: 'write-failed' });
  });

  test('no window is opened and no export session is used', async () => {
    const windowsBefore = electron.BrowserWindow.mock.calls.length;
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.html' });
    await handler({}, { html: HTML, defaultName: 'note.html' });
    expect(electron.BrowserWindow.mock.calls.length).toBe(windowsBefore);
    expect(electron.session.fromPartition).not.toHaveBeenCalled();
  });
});
