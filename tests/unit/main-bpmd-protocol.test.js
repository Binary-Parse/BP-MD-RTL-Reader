/**
 * main-bpmd-protocol.test.js — wiring tests for the bpmd:// asset scheme (T-AI2).
 *
 * The pure resolver (src/main/protocol.js) is unit-tested separately; THIS file
 * proves the previously-missing GLUE in src/main/index.js: the scheme is registered as
 * privileged before ready, a handler is attached on ready, the active vault root
 * is tracked from fs:readVault, and the handler serves bytes for an in-vault
 * asset while rejecting traversal / unauthorized roots.
 *
 * Drives the real bootstrap({ electron, fs, proc }) via the shared harness seam.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

function getHandle(mockElectron, name) {
  return mockElectron.ipcMain.handle.mock.calls.find(c => c[0] === name)?.[1];
}

describe('bpmd:// protocol wiring (T-AI2)', () => {
  let electron, fs, openFolder, readVault, handler;

  beforeAll(async () => {
    electron = buildMockElectron();
    fs = buildMockFs();
    bootstrap({ electron, fs, proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise(r => setTimeout(r, 50)); // let whenReady().then() run
    openFolder = getHandle(electron, 'dialog:openFolder');
    readVault = getHandle(electron, 'fs:readVault');
    handler = electron.protocol._handlers['bpmd'];
  });

  test('declares bpmd as a privileged, standard, secure, fetch-able scheme BEFORE ready', () => {
    expect(electron.protocol.registerSchemesAsPrivileged).toHaveBeenCalledTimes(1);
    const arg = electron.protocol.registerSchemesAsPrivileged.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
    const bpmd = arg.find(s => s.scheme === 'bpmd');
    expect(bpmd).toBeTruthy();
    expect(bpmd.privileges).toMatchObject({ standard: true, secure: true, supportFetchAPI: true });
  });

  test('attaches a bpmd handler on ready', () => {
    expect(electron.protocol.handle).toHaveBeenCalled();
    expect(typeof handler).toBe('function');
  });

  // Pick + read a vault so the main-owned capability becomes the active protocol root.
  async function openVault(root) {
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] });
    const picked = await openFolder();
    fs.promises.readdir.mockResolvedValueOnce([]);
    const read = await readVault({}, picked.vault.id);
    expect(read.entries).toEqual([]);
  }

  test('serves bytes for an in-vault asset with the right content-type', async () => {
    await openVault('/vault');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    fs.promises.readFile.mockResolvedValueOnce(png);

    const res = await handler({ url: 'bpmd://vault/img/pic.png' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    // It read the resolved absolute path under the active root (not the raw URL).
    // (Drive-agnostic: path.resolve prepends the CWD drive on win32.)
    const readArg = fs.promises.readFile.mock.calls.at(-1)[0];
    expect(readArg.replace(/\\/g, '/')).toMatch(/\/vault\/img\/pic\.png$/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test('decodes percent-encoded segments before resolving', async () => {
    await openVault('/vault');
    fs.promises.readFile.mockResolvedValueOnce(Buffer.from([1]));
    await handler({ url: 'bpmd://vault/a%20b/pic%20name.png' });
    const readArg = fs.promises.readFile.mock.calls.at(-1)[0];
    expect(readArg.replace(/\\/g, '/')).toMatch(/\/vault\/a b\/pic name\.png$/);
  });

  test('rejects path traversal with 404 and never touches the disk', async () => {
    await openVault('/vault');
    fs.promises.readFile.mockClear();
    const res = await handler({ url: 'bpmd://vault/../../etc/passwd' });
    expect(res.status).toBe(404);
    expect(fs.promises.readFile).not.toHaveBeenCalled();
  });

  test('a missing file resolves but yields 404 (read throws)', async () => {
    await openVault('/vault');
    fs.promises.readFile.mockRejectedValueOnce(new Error('ENOENT'));
    const res = await handler({ url: 'bpmd://vault/missing.png' });
    expect(res.status).toBe(404);
  });

  test('a non-bpmd / malformed URL is a 404', async () => {
    await openVault('/vault');
    const res = await handler({ url: 'bpmd://evil/x.png' });
    expect(res.status).toBe(404);
  });
});
