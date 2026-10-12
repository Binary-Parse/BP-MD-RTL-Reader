/**
 * ipc-read-vault-changes-direct.test.js — H15 step 3 against the bare ipc-controller with a
 * stub capability registry and an INJECTED path module, so every platform rule is exercised on
 * any host: win32 separators and colons, POSIX backslashes, the registry's allowed-folder gate,
 * and the vault read's per-note failure lanes.
 */
import { describe, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createIpcController } = require('../../src/main/ipc-controller');
const { isAuthorizedPath, isSymlinkEscape, filterAndSortMdFiles, wouldExceedCumulative } = require('../../src/main/main-logic');

function boot({ pathModule, folder, registry, files = {}, readdirTop = [] }) {
  const handlers = {};
  const ipcMain = { handle(name, fn) { handlers[name] = fn; }, on() {} };
  const watch = vi.fn(() => ({ close() {} }));
  const fileStat = (p) => ({ isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: Buffer.byteLength(String(files[p])) });
  const controller = createIpcController({
    app: { getPath: () => '/tmp' },
    BrowserWindow: {},
    ipcMain,
    dialog: {},
    session: {},
    fs: {
      realpathSync: (p) => p,
      statSync: () => ({ isFile: () => false, isDirectory: () => true, size: 0 }),
      promises: {
        readdir: async () => readdirTop,
        lstat: async (p) => { if (!(p in files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return fileStat(p); },
        realpath: async (p) => p,
        stat: async (p) => fileStat(p),
        readFile: async (p) => Buffer.from(files[p]),
      },
      readdirSync: () => [],
    },
    path: pathModule,
    docStore: {
      read: () => ({ content: 'x', meta: {} }),
      readAsync: async (p) => ({ content: String(files[p]), meta: { hash: `h:${files[p]}` } }),
      watch,
    },
    atomicWriteFile: () => {},
    approvedCloseWindows: new WeakSet(),
    windowForEvent: () => null,
    writeLog: () => {},
    getCapabilityRegistry: () => registry(folder),
    getSettingsStore: () => ({}),
    getCurrentSettings: () => ({}),
    setCurrentSettings: () => {},
    isNetworkPath: () => false,
    isOversizedFile: () => false,
    isTooManyFiles: () => false,
    isAuthorizedPath,
    wouldExceedCumulative,
    isSymlinkEscape,
    filterAndSortMdFiles,
    migrate: (settings) => settings,
    compareVersions: () => 0,
    fetchFn: null,
  });
  controller.registerIpcHandlers();
  return { handlers, watch };
}

// A registry that can grant documents and resolve them again; listVaults is optional.
function fullRegistry(folder, { withListVaults = true, resolveDocumentNull = false } = {}) {
  const docs = new Map();
  const registry = {
    resolveVault: (id) => (id === 'cap-vault' ? { id, path: folder } : null),
    grantDocument: (p) => { const id = `cap-doc-${docs.size}`; docs.set(id, { id, path: p, vaultId: 'cap-vault' }); return { id }; },
    resolveDocument: (id) => (resolveDocumentNull ? null : docs.get(id) || null),
    listDocuments: () => [...docs.values()],
  };
  if (withListVaults) registry.listVaults = () => [{ id: 'cap-vault', path: folder }];
  return registry;
}

async function openForChanges(env) {
  const { handlers } = env;
  expect(await handlers['fs:reopenVault']({}, 'cap-vault')).toMatchObject({ ok: true });
  const first = await handlers['fs:readVault']({ sender: { send() {}, isDestroyed: () => false } }, 'cap-vault');
  expect(first.entries).toBeDefined();
  return first;
}

describe('fs:readVaultChanges — allowed-folder gate and registry shapes', () => {
  test('a vault the registry resolves but does not list is refused with unauthorized-path', async () => {
    const registry = () => ({ ...fullRegistry('/notes'), listVaults: () => [{ id: 'cap-vault', path: '/elsewhere' }] });
    const env = boot({ pathModule: path.posix, folder: '/notes', registry });
    await env.handlers['fs:reopenVault']({}, 'cap-vault');
    expect(await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['a.md'])).toEqual({ error: 'unauthorized-path' });
  });

  test('a registry without listVaults falls back to the resolved folder itself', async () => {
    const reg = fullRegistry('/notes', { withListVaults: false });
    const env = boot({ pathModule: path.posix, folder: '/notes', registry: () => reg, files: { '/notes/a.md': 'A' } });
    await env.handlers['fs:reopenVault']({}, 'cap-vault');
    // past the path gate, but nothing has been read yet
    expect(await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['a.md'])).toEqual({ error: 'vault-not-open' });
  });

  test('a registry that lists the folder lets the call through to the path checks', async () => {
    const reg = fullRegistry('/notes');
    const env = boot({ pathModule: path.posix, folder: '/notes', registry: () => reg, files: { '/notes/a.md': 'A' } });
    await openForChanges(env);
    const r = await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['a.md']);
    expect(r.entries.map((e) => e.relPath)).toEqual(['a.md']);
  });
});

describe('fs:readVaultChanges — platform path rules (path module injected)', () => {
  const posixEnv = () => {
    const reg = fullRegistry('/notes');
    return boot({ pathModule: path.posix, folder: '/notes', registry: () => reg, files: { '/notes/a.md': 'A', '/notes/x:y.md': 'colon' } });
  };
  const winEnv = () => {
    const reg = fullRegistry('C:\\notes');
    return boot({
      pathModule: path.win32,
      folder: 'C:\\notes',
      registry: () => reg,
      files: { 'C:\\notes\\a.md': 'A', 'C:\\notes\\sub\\n.md': 'N' },
    });
  };

  test('POSIX: a backslash is a legal file-name character, so the call is refused (full read instead)', async () => {
    const env = posixEnv(); await openForChanges(env);
    expect(await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['sub\\n.md'])).toEqual({ error: 'invalid-paths' });
  });

  test('POSIX: a colon is an ordinary character and is allowed', async () => {
    const env = posixEnv(); await openForChanges(env);
    const r = await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['x:y.md']);
    expect(r.entries.map((e) => e.relPath)).toEqual(['x:y.md']);
  });

  test('POSIX: forward-slash nested notes work', async () => {
    const reg = fullRegistry('/notes');
    const env = boot({ pathModule: path.posix, folder: '/notes', registry: () => reg, files: { '/notes/sub/n.md': 'N' } });
    await openForChanges(env);
    const r = await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['sub/n.md']);
    expect(r.entries.map((e) => e.relPath)).toEqual(['sub/n.md']);
  });

  test('Windows: backslashes separate segments and the answer uses "/" like the full read', async () => {
    const env = winEnv(); await openForChanges(env);
    const r = await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['sub\\n.md']);
    expect(r.entries.map((e) => e.relPath)).toEqual(['sub/n.md']);
  });

  test('Windows: a colon (drive letter, alternate data stream) is refused', async () => {
    const env = winEnv(); await openForChanges(env);
    expect(await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['C:\\notes\\a.md'])).toEqual({ error: 'invalid-paths' });
    expect(await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['a.md:hidden'])).toEqual({ error: 'invalid-paths' });
  });

  test('Windows: a traversal written with backslashes is refused', async () => {
    const env = winEnv(); await openForChanges(env);
    expect(await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['..\\secret.md'])).toEqual({ error: 'invalid-paths' });
  });

  test('NUL anywhere refuses the call on both platforms', async () => {
    for (const env of [posixEnv(), winEnv()]) {
      await openForChanges(env);
      expect(await env.handlers['fs:readVaultChanges']({}, 'cap-vault', ['a\0.md'])).toEqual({ error: 'invalid-paths' });
    }
  });
});

describe('vault reads — per-note failure lanes', () => {
  const dirent = (name) => ({ name, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false });

  test('fs:readVault: a document the registry cannot resolve right after granting is skipped as unreadable', async () => {
    const reg = fullRegistry('/notes', { resolveDocumentNull: true });
    const env = boot({ pathModule: path.posix, folder: '/notes', registry: () => reg, files: { '/notes/a.md': 'A' }, readdirTop: [dirent('a.md')] });
    await env.handlers['fs:reopenVault']({}, 'cap-vault');
    const r = await env.handlers['fs:readVault']({ sender: { send() {}, isDestroyed: () => false } }, 'cap-vault');
    expect(r.entries).toEqual([]);
    expect(r.skipped).toMatchObject({ unreadable: 1 });
  });

  test('fs:readVault: a note whose grant throws is skipped as unreadable and the walk continues', async () => {
    const reg = fullRegistry('/notes');
    let calls = 0;
    const grant = reg.grantDocument;
    reg.grantDocument = (...a) => { calls += 1; if (calls === 1) throw new Error('registry write failed'); return grant(...a); };
    const env = boot({
      pathModule: path.posix, folder: '/notes', registry: () => reg,
      files: { '/notes/a.md': 'A', '/notes/b.md': 'B' }, readdirTop: [dirent('a.md'), dirent('b.md')],
    });
    await env.handlers['fs:reopenVault']({}, 'cap-vault');
    const r = await env.handlers['fs:readVault']({ sender: { send() {}, isDestroyed: () => false } }, 'cap-vault');
    expect(r.entries.map((e) => e.relPath)).toEqual(['b.md']);
    expect(r.skipped.unreadable).toBe(1);
  });
});
