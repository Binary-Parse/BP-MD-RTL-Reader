/**
 * main-own-write-suppression.test.js — H15 step 2, wired through the real ipc-controller.
 *
 * Requirement: a save made BY THE APP must not make the renderer re-read the vault, but an
 * EXTERNAL edit must always get through — even one made right after an own save, and even one
 * that touches the same file. The decision is "does the file's content hash equal the hash of
 * what we wrote", never a timestamp.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const getHandle = (el, name) => el.ipcMain.handle.mock.calls.find((c) => c[0] === name)?.[1];

describe('own-write suppression (H15 step 2)', () => {
  let el; let fsMock; let files; let sender; let writeFile; let documents;
  const sentChanges = () => sender.send.mock.calls.filter((c) => c[0] === 'vault:changed').map((c) => c[1]);
  const abs = (rel) => path.join('/vault', rel);

  async function openVaultWith(names) {
    for (const [name, content] of Object.entries(names)) files[abs(name)] = content;
    const openFolder = getHandle(el, 'dialog:openFolder');
    const readVault = getHandle(el, 'fs:readVault');
    const picked = await openFolder();
    fsMock.promises.readdir.mockResolvedValueOnce(
      Object.keys(names).map((name) => ({ name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false })),
    );
    fsMock.promises.lstat.mockImplementation(async (p) => ({
      isSymbolicLink: () => false, isFile: () => true, size: Buffer.byteLength(String(files[p] ?? '')),
    }));
    const read = await readVault({ sender }, picked.vault.id);
    documents = Object.fromEntries(read.entries.map((e) => [e.relPath, e]));
    return read;
  }
  const save = (rel, content) => writeFile({}, {
    documentId: documents[rel].documentId, content, baseHash: documents[rel].meta.hash, eol: '\n',
  });
  const fire = (name, type = 'change') => { fsMock._watchCb(type, name); vi.advanceTimersByTime(300); };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    el = buildMockElectron();
    const handlers = {};
    el.ipcMain.handle.mockImplementation((n, fn) => { handlers[n] = fn; });
    files = {};
    fsMock = buildMockFs({
      existsSync: (p) => p in files,
      readFileSync: (p) => files[p],
      writeFileSync: (p, c) => { files[p] = c; },
      renameSync: (a, b) => { files[b] = files[a]; delete files[a]; },
    });
    el.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/vault'] });
    sender = { send: vi.fn(), isDestroyed: () => false };
    bootstrap({ electron: el, fs: fsMock, proc: buildMockProc(['node', 'src/main/index.js']) });
    await vi.advanceTimersByTimeAsync(50);
    writeFile = getHandle(el, 'fs:writeFile');
  });
  afterEach(() => vi.useRealTimers());

  test('the watcher event caused by our own save is not forwarded', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    expect((await save('note.md', 'new text')).ok).toBe(true);
    fire('note.md');
    expect(sentChanges()).toEqual([]);
  });

  test('all raw events of one save are swallowed (rename + change + change)', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    await save('note.md', 'new text');
    fsMock._watchCb('rename', 'note.md');
    fsMock._watchCb('change', 'note.md');
    fsMock._watchCb('change', 'note.md');
    vi.advanceTimersByTime(300);
    expect(sentChanges()).toEqual([]);
  });

  test('an external edit of the SAME file right after our save is forwarded', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    await save('note.md', 'new text');
    files[abs('note.md')] = 'edited elsewhere\n';
    fire('note.md');
    expect(sentChanges()).toHaveLength(1);
    expect(sentChanges()[0].files).toEqual(['note.md']);
  });

  test('an external edit that lands in the same burst as our save wins (disk content differs)', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    await save('note.md', 'new text');
    fsMock._watchCb('change', 'note.md'); // our save
    files[abs('note.md')] = 'overwritten by another program\n';
    fsMock._watchCb('change', 'note.md'); // theirs, same debounce window
    vi.advanceTimersByTime(300);
    expect(sentChanges()).toHaveLength(1);
  });

  test('after an external edit was reported, changing the file BACK to our bytes is reported too', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    await save('note.md', 'new text');
    const ours = files[abs('note.md')];
    files[abs('note.md')] = 'external\n';
    fire('note.md');
    expect(sentChanges()).toHaveLength(1);
    files[abs('note.md')] = ours;
    fire('note.md');
    expect(sentChanges()).toHaveLength(2);
  });

  test('another file in the same burst is forwarded; only ours is dropped', async () => {
    await openVaultWith({ 'a.md': 'a\n', 'b.md': 'b\n' });
    await save('a.md', 'a changed by the app');
    fsMock._watchCb('change', 'a.md');
    fsMock._watchCb('change', 'b.md');
    vi.advanceTimersByTime(300);
    expect(sentChanges()).toHaveLength(1);
    expect(sentChanges()[0].files).toEqual(['b.md']);
  });

  test('a file we never saved is forwarded as before', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    files[abs('note.md')] = 'external\n';
    fire('note.md');
    expect(sentChanges()).toHaveLength(1);
  });

  test('after 10 s the record is forgotten: identical bytes are reported again', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    await save('note.md', 'new text');
    vi.advanceTimersByTime(10_001);
    fire('note.md');
    expect(sentChanges()).toHaveLength(1);
  });

  test('a REFUSED save (conflict) records nothing: its event is forwarded', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    const refused = await writeFile({}, { documentId: documents['note.md'].documentId, content: 'x', baseHash: 'stale' });
    expect(refused).toEqual({ error: 'conflict' });
    files[abs('note.md')] = 'old\n';
    fire('note.md');
    expect(sentChanges()).toHaveLength(1);
  });

  test('a write the store itself rejects returns that error (no crash) and records nothing', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    const rejected = await writeFile({}, {
      documentId: documents['note.md'].documentId,
      content: 'this cannot be encoded: 日本語',
      baseHash: documents['note.md'].meta.hash,
      eol: '\n',
      encoding: 'windows-1256',
    });
    expect(rejected.error).toBe('unmappable-character');
    expect(files[abs('note.md')]).toBe('old\n');
    fire('note.md'); // same bytes as before the failed save: nothing of ours is recorded
    expect(sentChanges()).toHaveLength(1);
  });

  test('directory events (non-note names) are never treated as our write', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    await save('note.md', 'new text');
    fsMock._watchCb('rename', 'sub');
    vi.advanceTimersByTime(300);
    expect(sentChanges()).toHaveLength(1);
    expect(sentChanges()[0].files).toEqual(['sub']);
  });

  test('an unreadable file (deleted after our save) is reported, not hidden', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    await save('note.md', 'new text');
    delete files[abs('note.md')];
    fire('note.md', 'rename');
    expect(sentChanges()).toHaveLength(1);
    expect(sentChanges()[0].files).toEqual(['note.md']);
  });

  test('forwarded file names use "/" like readVault relPaths, whatever the OS separator is', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    files[abs('sub/n.md')] = 'x';
    fire(['sub', 'n.md'].join(path.sep));
    expect(sentChanges()[0].files).toEqual(['sub/n.md']);
  });

  test('the forwarded event keeps its vault id and generation', async () => {
    const read = await openVaultWith({ 'note.md': 'old\n' });
    files[abs('note.md')] = 'external\n';
    fire('note.md');
    expect(sentChanges()[0]).toMatchObject({ vaultId: read.vault.id, generation: read.vault.generation, files: ['note.md'] });
  });

  test('a destroyed window receives nothing (and a suppressed event does not throw)', async () => {
    await openVaultWith({ 'note.md': 'old\n' });
    sender.isDestroyed = () => true;
    files[abs('note.md')] = 'external\n';
    expect(() => fire('note.md')).not.toThrow();
    expect(sentChanges()).toEqual([]);
  });
});
