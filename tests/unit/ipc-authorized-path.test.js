import { describe, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createIpcController } = require('../../src/main/ipc-controller');
const { isAuthorizedPath } = require('../../src/main/main-logic');

function boot(registry, fsOverrides = {}) {
  const handlers = {};
  const ipcMain = {
    handle(name, fn) { handlers[name] = fn; },
    on() {},
  };
  const controller = createIpcController({
    app: { getPath: () => '/tmp' },
    BrowserWindow: {},
    ipcMain,
    dialog: {},
    session: {},
    fs: {
      statSync: () => ({ isFile: () => true, size: 12 }),
      promises: { readdir: async () => { throw new Error('should not scan unauthorised vault'); } },
      ...fsOverrides,
    },
    path,
    docStore: { read: () => ({ content: 'ok', meta: {} }) },
    atomicWriteFile: () => {},
    approvedCloseWindows: new WeakSet(),
    windowForEvent: () => null,
    writeLog: () => {},
    getCapabilityRegistry: () => registry,
    getSettingsStore: () => ({}),
    getCurrentSettings: () => ({}),
    setCurrentSettings: () => {},
    isNetworkPath: () => false,
    isOversizedFile: () => false,
    isTooManyFiles: () => false,
    isAuthorizedPath,
    wouldExceedCumulative: () => false,
    isSymlinkEscape: () => false,
    filterAndSortMdFiles: () => [],
    migrate: (settings) => settings,
    compareVersions: () => 0,
    fetchFn: null,
  });
  controller.registerIpcHandlers();
  return handlers;
}

describe('IPC isAuthorizedPath defence-in-depth', () => {
  test('readVault rejects a resolved vault whose path is absent from listVaults', async () => {
    const handlers = boot({
      resolveVault: (id) => (id === 'cap-vault' ? { id, path: '/notes' } : null),
      listVaults: () => [{ id: 'cap-vault', path: '/other' }],
    });
    expect(await handlers['fs:readVault']({}, 'cap-vault')).toEqual({ error: 'unauthorized-path' });
  });

  test('readVault proceeds past the path gate when listVaults includes the resolved path', async () => {
    const readdir = vi.fn(async () => { throw new Error('EIO'); });
    const handlers = boot({
      resolveVault: (id) => (id === 'cap-vault' ? { id, path: '/notes' } : null),
      listVaults: () => [{ id: 'cap-vault', path: '/notes' }],
    }, { promises: { readdir } });
    expect(await handlers['fs:readVault']({}, 'cap-vault')).toEqual({ error: 'read-failed' });
    expect(readdir).toHaveBeenCalledWith('/notes', { withFileTypes: true });
  });

  test('readFile rejects a resolved document whose path is absent from listDocuments', async () => {
    const handlers = boot({
      resolveDocument: (id) => (id === 'cap-doc' ? { id, path: '/notes/a.md', vaultId: null } : null),
      listDocuments: () => [{ id: 'cap-doc', path: '/other/a.md' }],
    });
    expect(await handlers['fs:readFile']({}, 'cap-doc')).toEqual({ error: 'unauthorized-path' });
  });
});
