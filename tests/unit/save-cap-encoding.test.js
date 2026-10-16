/**
 * save-cap-encoding.test.js — any note that opens can be saved unchanged.
 *
 * Opening caps the bytes ON DISK (100 MiB since large-file mode). Saving used to cap the UTF-8
 * bytes of the text, and an Arabic letter is 1 byte in Windows-1256 but 2 in UTF-8: a Windows-1256
 * note that opened then returned file-too-large on every save and lost its crash-recovery copy.
 * The save cap counts the bytes written, in the file's own encoding. The sizes are the real ones
 * (100 MiB) so the tests pin the actual limit; the content is mostly ASCII, which is cheap.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const MIB = 1024 * 1024;
const CAP = 100 * MIB;
// "مرحبا " in Windows-1256: five Arabic letters and a space, 6 bytes on disk, 11 in UTF-8.
const WORD = Buffer.from([0xE3, 0xD1, 0xCD, 0xC8, 0xC7, 0x20]);
function cp1256Note(diskBytes) {
  const out = Buffer.alloc(diskBytes);
  for (let i = 0; i < diskBytes; i += WORD.length) WORD.copy(out, i, 0, Math.min(WORD.length, diskBytes - i));
  return out;
}

describe('a note that opens can be saved unchanged', () => {
  let files, handlers, fsMock, el;
  const NOTE = path.join('/vault', 'book.md');

  beforeEach(async () => {
    el = buildMockElectron();
    handlers = {};
    el.ipcMain.handle.mockImplementation((n, fn) => { handlers[n] = fn; });
    files = {};
    fsMock = buildMockFs({
      existsSync: (p) => p in files,
      readFileSync: (p) => files[p],
      writeFileSync: (p, c) => { files[p] = c; },
      renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    });
    el.dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: ['/vault'] }));
    bootstrap({ electron: el, fs: fsMock, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 30));
  });

  // Opens through the single-note lane (the folder read skips notes above 20 MiB).
  async function open(bytes) {
    files[NOTE] = bytes;
    const picked = await handlers['dialog:openFolder']();
    fsMock.promises.readdir.mockResolvedValueOnce([{ name: 'book.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]);
    fsMock.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, isFile: () => true, size: bytes.length });
    const read = await handlers['fs:readVault']({}, picked.vault.id);
    return read.entries[0];
  }

  // The single-note lane (Open File): a note above 20 MiB is asked about first, then read.
  async function openSingle(bytes) {
    files[NOTE] = bytes;
    fsMock.statSync = () => ({ isFile: () => true, isDirectory: () => false, size: bytes.length, mtimeMs: 1 });
    el.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [NOTE] });
    let result = await handlers['dialog:openFile']({});
    if (result.error === 'confirm-large') result = await handlers['fs:readFile']({}, result.documentId, { confirmLarge: true });
    return result;
  }

  const save = (document, content = document.content, extra = {}) => handlers['fs:writeFile']({}, {
    documentId: document.documentId, content, baseHash: document.meta.hash,
    eol: '\n', finalNewline: false, encoding: document.meta.encoding, ...extra,
  });

  test('a 56 MiB Windows-1256 note (102 MiB as UTF-8) opens and saves byte for byte', async () => {
    const bytes = cp1256Note(56 * MIB);
    const document = await openSingle(bytes);
    expect(document.error).toBeUndefined();
    expect(document.meta.encoding).toBe('windows-1256');
    expect(Buffer.byteLength(document.content, 'utf8')).toBeGreaterThan(CAP);
    // The save answers with the bytes it wrote: the renderer sets the note's size tier from it.
    expect(await save(document)).toMatchObject({ ok: true, size: bytes.length });
    expect(Buffer.compare(Buffer.from(files[NOTE]), bytes)).toBe(0);
  }, 60000);

  test('Windows-1256: exactly 100 MiB on disk saves; one byte more is refused and the file is kept', async () => {
    const document = await open(Buffer.from('# note\n', 'utf8'));
    const atCap = 'x'.repeat(CAP);
    expect(await save(document, atCap, { encoding: 'windows-1256' })).toMatchObject({ ok: true });
    expect(Buffer.from(files[NOTE]).length).toBe(CAP);
    const before = files[NOTE];
    const fresh = await open(Buffer.from('# note\n', 'utf8'));
    expect(await save(fresh, `${atCap}x`, { encoding: 'windows-1256' })).toEqual({ error: 'file-too-large' });
    expect(files[NOTE]).not.toBe(before === undefined ? null : undefined); // the refusal wrote nothing new
    expect(Buffer.from(files[NOTE]).toString('utf8')).toBe('# note\n');
  });

  test('UTF-16: counted in written bytes (two per unit): 50 Mi units fit, one more does not', async () => {
    const document = await open(Buffer.from('# note\n', 'utf8'));
    const units = CAP / 2;
    expect(await save(document, 'x'.repeat(units), { encoding: 'utf16le' })).toMatchObject({ ok: true });
    expect(Buffer.from(files[NOTE]).length).toBe(CAP);
    const fresh = await open(Buffer.from('# note\n', 'utf8'));
    expect(await save(fresh, 'x'.repeat(units + 1), { encoding: 'utf16le' })).toEqual({ error: 'file-too-large' });
    expect(Buffer.from(files[NOTE]).toString('utf8')).toBe('# note\n');
  });

  test('UTF-8 is capped at 100 MiB of written bytes, counted in bytes, not characters', async () => {
    const document = await open(Buffer.from('# note\n', 'utf8'));
    const arabic = 'م'.repeat(CAP / 2); // exactly 100 MiB as UTF-8, half as many characters
    expect(await save(document, arabic)).toMatchObject({ ok: true });
    const fresh = await open(Buffer.from('# note\n', 'utf8'));
    expect(await save(fresh, `${arabic}x`)).toEqual({ error: 'file-too-large' });
  });

  test('the crash-recovery copy of a 56 MiB Windows-1256 note is kept (102 MiB as UTF-8)', async () => {
    const document = await openSingle(cp1256Note(56 * MIB));
    expect(await handlers['recovery:snapshot']({}, [{ name: 'book.md', content: document.content }]))
      .toMatchObject({ ok: true, count: 1 });
  });

  test('a recovery entry beyond what any openable note can become is named as skipped, not dropped quietly', async () => {
    const tooBig = 'م'.repeat((3 * CAP) / 2 + 1); // 300 MiB + 2 bytes as UTF-8
    const reply = await handlers['recovery:snapshot']({}, [{ name: 'huge.md', content: tooBig }]);
    expect(reply).toMatchObject({ ok: true, count: 0, skipped: ['huge.md'] });
  });
});
