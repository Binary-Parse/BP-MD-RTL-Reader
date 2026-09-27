/**
 * main-export-pdf.test.js — T-B6 `export:pdf` IPC handler.
 *
 * Renders the caller-supplied standalone note HTML in a HIDDEN, sandboxed, JS-disabled
 * window on an ISOLATED OFFLINE session (every request blocked except data:, about:, and
 * the export's OWN temp document — SC2, tightened by T14: file: used to be allowed
 * wholesale), via a temp file (no data:-URL size cliff), prints to PDF, writes the bytes
 * to a chosen path, and always cleans up the temp + window.
 *
 * Drives the real bootstrap({ electron, fs, proc }) via the shared harness seam.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { pathToFileURL } from 'node:url';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const getHandle = (electron, name) => electron.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];
const HTML = '<!DOCTYPE html><html><body><h1>Note</h1></body></html>';

describe('export:pdf (T-B6)', () => {
  let electron, fs, handler;
  beforeEach(async () => {
    electron = buildMockElectron();
    fs = buildMockFs();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
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

  test('oversized html → { error: "file-too-large" }, no dialog, no temp file (SEC-04)', async () => {
    electron.dialog.showSaveDialog.mockClear();
    const res = await handler({}, { html: 'x'.repeat(10 * 1024 * 1024 + 1) });
    expect(res).toEqual({ error: 'file-too-large' });
    expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
    expect(fs.promises.open).not.toHaveBeenCalled();
  });

  test('sweeps hour-old bpmd-export temp orphans on every export (HYG-01)', async () => {
    const tempDir = '/mock/userData/temp';
    const now = Date.now();
    const onDisk = new Map([
      [`${tempDir}/bpmd-export-11111111-1111-1111-1111-111111111111.html`, now - 2 * 60 * 60 * 1000],
      [`${tempDir}/bpmd-export-22222222-2222-2222-2222-222222222222.html`, now],
      [`${tempDir}/unrelated.txt`, 1],
    ]);
    const unlinked = [];
    const seeded = buildMockFs({
      readdirSync: vi.fn(() => [...onDisk.keys()].map((k) => k.split('/').pop())),
      statSync: vi.fn((p) => ({ mtimeMs: onDisk.get(String(p).replace(/\\/g, '/')) || 0 })),
      unlinkSync: vi.fn((p) => unlinked.push(String(p).replace(/\\/g, '/'))),
    });
    const el = buildMockElectron();
    bootstrap({ electron: el, fs: seeded, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 50));
    el.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true });
    const res = await getHandle(el, 'export:pdf')({}, { html: HTML });
    expect(res).toEqual({ canceled: true });
    expect(unlinked).toEqual([`${tempDir}/bpmd-export-11111111-1111-1111-1111-111111111111.html`]);
  });

  test('canceled save dialog → { canceled: true }; nothing printed or written', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined });
    const res = await handler({}, { html: HTML, defaultName: 'note.pdf' });
    expect(res).toEqual({ canceled: true });
    expect(electron._mockWin.webContents.printToPDF).not.toHaveBeenCalled();
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
    expect(fs.promises.open).not.toHaveBeenCalled();
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

    // The html is written to a temp .html through an EXCLUSIVE handle and loaded from
    // there (no data: URL). audit SEC-04: random name + O_EXCL, never a predictable path.
    const [tmpPath, tmpFlags] = fs.promises.open.mock.calls[0];
    expect(tmpPath).toMatch(/bpmd-export-.*\.html$/);
    expect(tmpFlags).toBe('wx');
    const handle = await fs.promises.open.mock.results[0].value;
    expect(handle.writeFile).toHaveBeenCalledWith(HTML, 'utf8');
    expect(handle.close).toHaveBeenCalled();
    expect(electron._mockWin.loadFile).toHaveBeenCalledWith(tmpPath);
    expect(electron._mockWin.loadURL).toHaveBeenCalledWith('app://ui/src/renderer/index.html');

    // The exact PDF bytes are written to the chosen path; temp + window cleaned up.
    expect(electron._mockWin.webContents.printToPDF).toHaveBeenCalledTimes(1);
    const [tmpPdfPath, data] = fs.writeFileSync.mock.calls.at(-1);
    expect(tmpPdfPath).toMatch(/^\/out\/note\.pdf\.tmp-/);
    expect(data).toBe(pdf);
    expect(fs.renameSync).toHaveBeenCalledWith(tmpPdfPath, '/out/note.pdf');
    expect(res).toEqual({ ok: true });
    expect(electron._mockWin.close).toHaveBeenCalled();
    expect(fs.promises.unlink).toHaveBeenCalledWith(tmpPath);
  });

  test('SC2: the export session blocks everything except data:, about:, and its own temp document', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    // Hold the export mid-flight (loadFile gated) so the transient allowlist still holds
    // this run's temp URL — T14 narrowed `file:` from wholesale to exactly that URL.
    let releaseLoad;
    electron._mockWin.loadFile.mockReturnValueOnce(new Promise((resolve) => { releaseLoad = resolve; }));
    const pending = handler({}, { html: HTML, defaultName: 'note.pdf' });
    await vi.waitFor(() => expect(electron._pdfSession.webRequest.onBeforeRequest).toHaveBeenCalled());

    const filter = electron._pdfSession.webRequest.onBeforeRequest.mock.calls.at(-1)[0];
    const cancels = (url) => { let out; filter({ url }, (x) => { out = x; }); return out.cancel; };
    expect(electron.session.fromPartition).toHaveBeenCalledWith('pdf-export');
    const tmpUrl = pathToFileURL(fs.promises.open.mock.calls.at(-1)[0]).href;
    expect(cancels('https://evil.example/beacon.png?leak=1')).toBe(true); // remote beacon blocked
    expect(cancels('http://tracker.test/x')).toBe(true);
    expect(cancels('file:///etc/passwd')).toBe(true);                     // other local files blocked
    expect(cancels(tmpUrl)).toBe(false);                                  // only THIS export's doc loads
    expect(cancels('data:image/png;base64,AAAA')).toBe(false);            // inline data allowed
    expect(cancels('about:blank')).toBe(false);

    releaseLoad();
    await pending;
    // The allowance is transient: once the export ends, its temp URL is no longer loadable.
    expect(cancels(tmpUrl)).toBe(true);
  });

  test('printToPDF failure → { error: "export-failed" }; window closed; PDF not written', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    electron._mockWin.webContents.printToPDF.mockRejectedValueOnce(new Error('boom'));
    const res = await handler({}, { html: HTML, defaultName: 'note.pdf' });
    expect(res).toEqual({ error: 'export-failed' });
    expect(electron._mockWin.close).toHaveBeenCalled();
    // The temp html handle was opened, but the PDF write to the chosen path never happened.
    expect(fs.promises.open).toHaveBeenCalledTimes(1);
    expect(fs.promises.open.mock.calls.some((c) => c[0] === '/out/note.pdf')).toBe(false);
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
    expect(res).toEqual({ ok: true });
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

  // L341: the temp html is written with the 'utf8' encoding — now through the exclusive
  // file handle (audit SEC-04) rather than fs.promises.writeFile.
  test('temp html is written with utf8 encoding through the exclusive handle', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    await handler({}, { html: HTML, defaultName: 'n.pdf' });
    const handle = await fs.promises.open.mock.results[0].value;
    expect(handle.writeFile.mock.calls[0][1]).toBe('utf8');
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

  // L338 / audit SEC-04: the temp filename is now a random UUID, so the old
  // Date.now()+counter sequence is gone. Two exports must still draw DIFFERENT
  // unguessable names, and every create must be exclusive ('wx').
  test('each export uses a distinct random temp filename, always created with wx', async () => {
    electron.dialog.showSaveDialog
      .mockResolvedValueOnce({ canceled: false, filePath: '/out/a.pdf' })
      .mockResolvedValueOnce({ canceled: false, filePath: '/out/b.pdf' });
    await handler({}, { html: HTML, defaultName: 'a.pdf' });
    const tmp1 = fs.promises.open.mock.calls[0][0];
    expect(fs.promises.open.mock.calls[0][1]).toBe('wx');
    fs.promises.open.mockClear();
    await handler({}, { html: HTML, defaultName: 'b.pdf' });
    const tmp2 = fs.promises.open.mock.calls[0][0];
    expect(fs.promises.open.mock.calls[0][1]).toBe('wx');

    expect(tmp1).toMatch(/bpmd-export-.*\.html$/);
    expect(tmp2).toMatch(/bpmd-export-.*\.html$/);
    expect(tmp1).not.toBe(tmp2);
    // A random UUID (RFC 4122 v4 shape) — not a timestamp/counter an attacker could guess.
    const uuid = /bpmd-export-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.html$/;
    expect(tmp1).toMatch(uuid);
    expect(tmp2).toMatch(uuid);
    expect(electron._pdfSession.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
  });

  // audit SEC-04: a pre-planted temp name must not be openable — the 'wx' (O_EXCL) create
  // fails and the export reports export-failed instead of writing through the squatter.
  test('an unwritable/pre-planted temp path → export-failed, nothing rendered', async () => {
    electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: '/out/note.pdf' });
    fs.promises.open.mockRejectedValueOnce(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }));
    electron._mockWin.webContents.printToPDF.mockClear();
    const res = await handler({}, { html: HTML, defaultName: 'n.pdf' });
    expect(res).toEqual({ error: 'export-failed' });
    expect(electron._mockWin.webContents.printToPDF).not.toHaveBeenCalled();
  });
});
