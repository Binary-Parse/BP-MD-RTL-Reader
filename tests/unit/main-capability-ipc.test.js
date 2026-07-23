import { beforeEach, describe, expect, test, vi } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

function handler(electron, name) {
  return electron.ipcMain.handle.mock.calls.find(call => call[0] === name)?.[1];
}

describe('opaque filesystem IPC capabilities', () => {
  let electron;
  let fs;

  beforeEach(async () => {
    electron = buildMockElectron();
    fs = buildMockFs({
      realpathSync: vi.fn(p => p),
      statSync: vi.fn(p => p.endsWith('.md')
        ? { isFile: () => true, isDirectory: () => false, size: 12, mtimeMs: 10 }
        : { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 10 }),
      readFileSync: vi.fn(p => p.endsWith('a.md') ? 'a\r\n' : '# note'),
      existsSync: vi.fn(p => p.endsWith('.md')),
    });
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  test('picker returns only an opaque vault identity and forged paths cannot be read', async () => {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault'] });
    const picked = await handler(electron, 'dialog:openFolder')();
    expect(picked.canceled).toBe(false);
    expect(picked.vault).toMatchObject({ name: 'vault', generation: 1 });
    expect(picked.vault.id).toMatch(/^cap-/);
    expect(JSON.stringify(picked)).not.toContain('/vault');
    expect(await handler(electron, 'fs:readVault')({}, '/vault')).toEqual({ error: 'unauthorized-capability' });
  });

  test('vault read emits document IDs plus faithful metadata and writes only that exact document', async () => {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/vault'] });
    const picked = await handler(electron, 'dialog:openFolder')();
    fs.promises.readdir.mockResolvedValueOnce([{ name: 'a.md', isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false }]);
    fs.promises.lstat.mockResolvedValueOnce({ isSymbolicLink: () => false, isFile: () => true, size: 3 });
    const read = await handler(electron, 'fs:readVault')({ sender: electron._mockWin.webContents }, picked.vault.id);
    expect(read.entries).toHaveLength(1);
    expect(read.entries[0]).toMatchObject({ name: 'a.md', relPath: 'a.md', content: 'a\n' });
    expect(read.entries[0].documentId).toMatch(/^cap-/);
    expect(read.entries[0].meta).toMatchObject({ eol: '\r\n', finalNewline: true });

    const saved = await handler(electron, 'fs:writeFile')({}, {
      documentId: read.entries[0].documentId,
      content: 'changed',
      baseHash: read.entries[0].meta.hash,
      bom: false,
      eol: '\r\n',
      finalNewline: true,
      revision: 7,
    });
    expect(saved).toMatchObject({ ok: true, revision: 7 });
    expect(await handler(electron, 'fs:writeFile')({}, { documentId: '/vault/a.md', content: 'x' }))
      .toEqual({ error: 'unauthorized-capability' });
  });
});
