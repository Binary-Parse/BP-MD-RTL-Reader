// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bootstrap } = require('../../src/main/index.js');

function createHarness(tempRoot) {
  const handlers = new Map();
  const appListeners = new Map();
  let pickerResult = { canceled: true, filePaths: [] };
  const webContents = {
    send() {}, on() {}, setWindowOpenHandler() {}, isDestroyed: () => false,
  };
  const win = {
    webContents,
    loadFile() {},
    on() {},
    isDestroyed: () => false,
    isMaximized: () => false,
    getNormalBounds: () => ({ x: 0, y: 0, width: 1280, height: 820 }),
  };
  function BrowserWindow() { return win; }
  BrowserWindow.getAllWindows = () => [];
  BrowserWindow.getFocusedWindow = () => win;
  BrowserWindow.fromWebContents = () => win;

  const electron = {
    app: {
      requestSingleInstanceLock: () => true,
      whenReady: () => Promise.resolve(),
      on: (name, callback) => appListeners.set(name, callback),
      quit() {},
      getPath: () => tempRoot,
      getVersion: () => '1.0.0',
    },
    BrowserWindow,
    ipcMain: {
      handle: (name, callback) => handlers.set(name, callback),
      on() {},
    },
    shell: { openExternal() {} },
    dialog: {
      showOpenDialog: async () => pickerResult,
      showSaveDialog: async () => ({ canceled: true }),
    },
    crashReporter: { start() {} },
    Menu: { buildFromTemplate: () => ({ popup() {} }) },
    clipboard: { writeText() {} },
    screen: { getAllDisplays: () => [{ x: 0, y: 0, width: 1920, height: 1080 }] },
    session: { fromPartition: () => ({ webRequest: { onBeforeRequest() {} } }) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  };
  const injectedFs = Object.create(fs);
  injectedFs.watch = () => ({ close() {} });
  const proc = { argv: ['electron', 'src/main/index.js'], platform: process.platform, on() {} };
  bootstrap({ electron, fs: injectedFs, proc });
  return {
    handlers,
    setPickerResult(value) { pickerResult = value; },
  };
}

test.describe('production fs:readVault IPC security boundary', () => {
  let tempRoot;
  let vaultRoot;
  let harness;

  test.beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmd-ipc-test-'));
    vaultRoot = path.join(tempRoot, 'vault');
    fs.mkdirSync(path.join(vaultRoot, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(vaultRoot, 'nested', 'note.md'), '# production handler', 'utf8');
    harness = createHarness(tempRoot);
    await expect.poll(() => harness.handlers.has('fs:readVault')).toBe(true);
  });

  test.afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('rejects raw paths and forged capability IDs before traversal', async () => {
    const readVault = harness.handlers.get('fs:readVault');
    await expect(readVault({}, vaultRoot)).resolves.toEqual({ error: 'unauthorized-capability' });
    await expect(readVault({}, 'cap-forged')).resolves.toEqual({ error: 'unauthorized-capability' });
  });

  test('authorizes only a native-picker result and recursively reads through the captured production handler', async () => {
    harness.setPickerResult({ canceled: false, filePaths: [vaultRoot] });
    const opened = await harness.handlers.get('dialog:openFolder')();
    expect(opened.vault.id).toMatch(/^cap-/);
    expect(JSON.stringify(opened)).not.toContain(vaultRoot);

    const result = await harness.handlers.get('fs:readVault')({ sender: {} }, opened.vault.id);
    expect(result.truncated).toBe(false);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      name: 'note.md',
      relPath: 'nested/note.md',
      content: '# production handler',
    });
  });

  test('rejects a network picker result without issuing a capability', async () => {
    harness.setPickerResult({ canceled: false, filePaths: ['\\\\server\\share'] });
    await expect(harness.handlers.get('dialog:openFolder')()).resolves.toEqual({
      error: 'network-path-not-allowed',
    });
  });
});
