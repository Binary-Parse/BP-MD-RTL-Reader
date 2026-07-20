/**
 * main-export-pdf.test.js — T-B6 `export:pdf` IPC handler.
 *
 * Renders the caller-supplied standalone note HTML in a HIDDEN, sandboxed, JS-disabled
 * window on an ISOLATED OFFLINE session (every non-local request hard-blocked — SC2),
 * via a temp file (no data:-URL size cliff), prints to PDF, writes the bytes to a chosen
 * path, and always cleans up the temp + window.
 *
 * Drives the real bootstrap({ electron, fs, proc }) via the shared harness seam.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { bootstrap } from '../../main.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const getHandle = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const HTML = '<!DOCTYPE html><html><body><h1>Note</h1></body></html>';

describe('export:pdf (T-B6)', () => {
  let electron, fs, handler;
  beforeEach(async () => {
    electron = buildMockElectron();
    fs = buildMockFs();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'main.js']) });
    await new Promise((r) => setTimeout(r, 50));
    handler = getHandle(electron, 'export:pdf');
  });

  test('the handler is registered', () => {
    expect(typeof handler).toBe('function');
  });

  test('invalid payload (missing/!string html) → { error: "invalid" }, no dialog', async () => {
    electron.dialog.showSaveDialog.mockClear();
    expect(await handler({}, {})).toEqual({ error: 'invalid' });
    expect(await handler({}, { html: 123 })).toEqual({ error: 'invalid' });
    expect(await handler({}, null)).toEqual({ error: 'invalid' });
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
  });

  test('canceled save dialog → { canceled: true }; nothing printed or written', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    const res = await handler({}, { html: HTML, defaultName: 'note.pdf' });
    expect(res).toEqual({ canceled: true });
    expect(electron._mockWin.webContents.printToPDF).not.toHaveBeenCalled();
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  test('passes defaultName + a PDF filter to the save dialog', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    await handler({}, { html: HTML, defaultName: 'note.pdf' });
    const [, opts] = electron.dialog.showSaveDialog.mock.calls[0];
    expect(opts.defaultPath).toBe('note.pdf');
    expect(opts.filters).toEqual([{ name: 'PDF Document', extensions: ['pdf'] }]);
  });

  test('success: hidden, hardened, partitioned window renders the temp html, prints, writes bytes, cleans up', async () => {
    const pdf = Buffer.from('%PDF-1.4 real-bytes');
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    electron._mockWin.webContents.printToPDF.mockResolvedValueOnce(pdf);

    const res = await handler({}, { html: HTML, defaultName: 'note.pdf' });

    // Offscreen window is hidden + hardened + on the isolated pdf-export partition.
    const opts = electron.BrowserWindow.mock.calls.at(-1)[0];
    expect(opts.show).toBe(false);
    expect(opts.webPreferences.partition).toBe('pdf-export');
    expect(opts.webPreferences.sandbox).toBe(true);
    expect(opts.webPreferences.nodeIntegration).toBe(false);
    expect(opts.webPreferences.javascript).toBe(false);
    expect(electron._mockWin.webContents.setWindowOpenHandler).toHaveBeenCalled();

    // The html is written to a temp .html and loaded from there (no data: URL).
    const [tmpPath, tmpHtml] = fs.promises.writeFile.mock.calls[0];
    expect(tmpPath).toMatch(/bpmd-export-.*\.html$/);
    expect(tmpHtml).toBe(HTML);
    expect(electron._mockWin.loadFile).toHaveBeenCalledWith(tmpPath);
    expect(electron._mockWin.loadURL).not.toHaveBeenCalled();

    // The exact PDF bytes are written to the chosen path; temp + window cleaned up.
    expect(electron._mockWin.webContents.printToPDF).toHaveBeenCalledTimes(1);
    const [tmpPdfPath, data] = fs.writeFileSync.mock.calls.at(-1);
    expect(tmpPdfPath).toMatch(/^\/out\/note\.pdf\.tmp-/);
    expect(data).toBe(pdf);
    expect(fs.renameSync).toHaveBeenCalledWith(tmpPdfPath, '/out/note.pdf');
    expect(res).toEqual({ ok: true, path: '/out/note.pdf' });
    expect(electron._mockWin.close).toHaveBeenCalled();
    expect(fs.promises.unlink).toHaveBeenCalledWith(tmpPath);
  });

  test('SC2: renders on an isolated session whose webRequest blocks every non-local request', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    await handler({}, { html: HTML, defaultName: 'note.pdf' });

    expect(electron.session.fromPartition).toHaveBeenCalledWith('pdf-export');
    const filter = electron._pdfSession.webRequest.onBeforeRequest.mock.calls.at(-1)[0];
    const cancels = (url) => { let out; filter({ url }, (x) => { out = x; }); return out.cancel; };
    expect(cancels('https://evil.example/beacon.png?leak=1')).toBe(true); // remote beacon blocked
    expect(cancels('http://tracker.test/x')).toBe(true);
    expect(cancels('file:///tmp/bpmd-export.html')).toBe(false);          // the local doc loads
    expect(cancels('data:image/png;base64,AAAA')).toBe(false);            // inline data allowed
  });

  test('printToPDF failure → { error: "export-failed" }; window closed; PDF not written', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    electron._mockWin.webContents.printToPDF.mockRejectedValueOnce(new Error('boom'));
    const res = await handler({}, { html: HTML, defaultName: 'note.pdf' });
    expect(res).toEqual({ error: 'export-failed' });
    expect(electron._mockWin.close).toHaveBeenCalled();
    // Only the temp html write happened — the PDF write to the chosen path did not.
    expect(fs.promises.writeFile.mock.calls.some((c) => c[0] === '/out/note.pdf')).toBe(false);
  });

  test('writeFile(PDF) failure (e.g. ENOSPC) → { error: "export-failed" }; window STILL closed', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    fs.writeFileSync.mockImplementationOnce(() => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); });
    const res = await handler({}, { html: HTML, defaultName: 'note.pdf' });
    expect(res).toEqual({ error: 'export-failed' });
    expect(electron._mockWin.close).toHaveBeenCalled(); // finally cleans up even on write failure
  });

  test('printBackground is enabled (callout/code backgrounds appear in the PDF)', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    await handler({}, { html: HTML, defaultName: 'note.pdf' });
    const printOpts = electron._mockWin.webContents.printToPDF.mock.calls.at(-1)[0] || {};
    expect(printOpts.printBackground).toBe(true);
  });

  test('no focused window → still exports (dialog tolerates a null parent)', async () => {
    electron.BrowserWindow.getFocusedWindow.mockReturnValueOnce(null);
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    const res = await handler({}, { html: HTML, defaultName: 'note.pdf' });
    expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[0]).toBeNull(); // parent passed through as null
    expect(res).toEqual({ ok: true, path: '/out/note.pdf' });
  });

  // L326: defaultName fallback — a missing/non-string defaultName → 'document.pdf'.
  test('missing defaultName → save dialog defaultPath is "document.pdf"', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    await handler({}, { html: HTML }); // no defaultName
    expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[1].defaultPath).toBe('document.pdf');
  });
  test('empty-string defaultName → falls back to "document.pdf" (kills the && short-circuit mutant)', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    await handler({}, { html: HTML, defaultName: '' });
    expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[1].defaultPath).toBe('document.pdf');
  });
  test('non-string defaultName → "document.pdf"', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    await handler({}, { html: HTML, defaultName: 123 });
    expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[1].defaultPath).toBe('document.pdf');
  });

  // L328: the save-dialog title literal.
  test('save dialog title is exactly "Export PDF"', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    await handler({}, { html: HTML, defaultName: 'n.pdf' });
    expect(electron.dialog.showSaveDialog.mock.calls.at(-1)[1].title).toBe('Export PDF');
  });

  // L332: `result.canceled || !result.filePath` — NOT canceled but an empty filePath
  // must STILL be treated as cancel (kills the || → && mutant).
  test('not canceled but empty filePath → { canceled: true }, nothing rendered', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '' });
    electron._mockWin.webContents.printToPDF.mockClear();
    const res = await handler({}, { html: HTML, defaultName: 'n.pdf' });
    expect(res).toEqual({ canceled: true });
    expect(electron._mockWin.webContents.printToPDF).not.toHaveBeenCalled();
  });

  // L341: the temp html is written with the 'utf8' encoding.
  test('temp html is written with utf8 encoding', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    await handler({}, { html: HTML, defaultName: 'n.pdf' });
    const tmpWrite = fs.promises.writeFile.mock.calls[0];
    expect(tmpWrite[2]).toBe('utf8');
  });

  // L344: contextIsolation:true on the offscreen window (not asserted elsewhere here).
  test('offscreen window has contextIsolation:true', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    await handler({}, { html: HTML, defaultName: 'n.pdf' });
    const opts = electron.BrowserWindow.mock.calls.at(-1)[0];
    expect(opts.webPreferences.contextIsolation).toBe(true);
  });

  // L346: setWindowOpenHandler returns exactly { action: 'deny' } (kills ()=>undefined).
  test('offscreen window-open handler denies all popups ({ action: "deny" })', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    await handler({}, { html: HTML, defaultName: 'n.pdf' });
    const denyHandler = electron._mockWin.webContents.setWindowOpenHandler.mock.calls.at(-1)[0];
    expect(typeof denyHandler).toBe('function');
    expect(denyHandler()).toEqual({ action: 'deny' });
  });

  // L354: `if (pdfWin && !pdfWin.isDestroyed()) pdfWin.close()` — when the offscreen
  // window is ALREADY destroyed, close() must NOT be called again (kills &&→|| and
  // the forced-true mutant, which would call close on a destroyed window).
  test('a destroyed offscreen window is not close()d again in the finally', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    electron._mockWin.webContents.printToPDF.mockRejectedValueOnce(new Error('boom'));
    electron._mockWin.isDestroyed.mockReturnValue(true); // window reports destroyed
    electron._mockWin.close.mockClear();
    const res = await handler({}, { html: HTML, defaultName: 'n.pdf' });
    expect(res).toEqual({ error: 'export-failed' });
    expect(electron._mockWin.close).not.toHaveBeenCalled();
    electron._mockWin.isDestroyed.mockReturnValue(false); // restore for other tests
  });

  // L43-44 (withTimeout): a loadFile that NEVER resolves must be rejected by the
  // 30s timeout → { error: "export-failed" }, and the window is still cleaned up.
  // Kills the setTimeout(()=>reject) ArrowFunction/BlockStatement mutants (without
  // the reject the race would hang forever, timing the test out).
  test('a hung loadFile is bounded by the 30s timeout → export-failed', async () => {
    vi.useFakeTimers();
    try {
      electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
      // loadFile never resolves → only the timeout can settle the race.
      electron._mockWin.loadFile.mockReturnValueOnce(new Promise(() => {}));
      const p = handler({}, { html: HTML, defaultName: 'n.pdf' });
      // Let the temp-html writeFile microtask flush, then trip the 30s timer.
      await vi.advanceTimersByTimeAsync(30000);
      const res = await p;
      expect(res).toEqual({ error: 'export-failed' });
      expect(electron._mockWin.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // L338: the temp filename embeds a monotonically-INCREASING export sequence
  // (pdfExportSeq++). Two exports → two distinct temp paths whose seq suffix grows.
  test('each export uses a distinct temp filename (sequence increments, not decrements)', async () => {
    electron.dialog.showSaveDialog
      .mockResolvedValueOnce({ canceled: false, filePath: '/out/a.pdf' })
      .mockResolvedValueOnce({ canceled: false, filePath: '/out/b.pdf' });
    await handler({}, { html: HTML, defaultName: 'a.pdf' });
    const tmp1 = fs.promises.writeFile.mock.calls.find((c) => /bpmd-export-.*\.html$/.test(String(c[0])))[0];
    fs.promises.writeFile.mockClear();
    await handler({}, { html: HTML, defaultName: 'b.pdf' });
    const tmp2 = fs.promises.writeFile.mock.calls.find((c) => /bpmd-export-.*\.html$/.test(String(c[0])))[0];
    expect(tmp1).not.toBe(tmp2);
    // Capture the SIGNED trailing sequence (a `--` mutant would make it negative).
    const seqOf = (p) => Number(String(p).match(/-(-?\d+)\.html$/)[1]);
    expect(seqOf(tmp1)).toBeGreaterThanOrEqual(0);
    // pdfExportSeq++ → the 2nd seq is strictly greater AND non-negative;
    // a `--` mutant yields a negative 2nd seq → this fails.
    expect(seqOf(tmp2)).toBeGreaterThan(seqOf(tmp1));
    expect(seqOf(tmp2)).toBeGreaterThanOrEqual(0);
  });
});
