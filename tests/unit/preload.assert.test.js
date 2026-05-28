/**
 * Node.js native assert tests for preload.js.
 * Run: node tests/unit/preload.assert.test.js
 */

const assert = require('assert');
const Module = require('module');
const path = require('path');

// ==== MOCK ELECTRON via Module._resolveFilename hijack ====
const calls = { send: [], invoke: [], on: [], expose: [] };

const mockElectron = {
  contextBridge: {
    exposeInMainWorld: (name, api) => calls.expose.push({ name, api }),
  },
  ipcRenderer: {
    send: (...args) => calls.send.push(args),
    invoke: (...args) => calls.invoke.push(args),
    on: (...args) => calls.on.push(args),
  },
};

const originalResolve = Module._resolveFilename;
const mockElectronPath = path.join(__dirname, '__mock_electron.js');
Module._cache[mockElectronPath] = { id: 'electron', exports: mockElectron, loaded: true };

Module._resolveFilename = function(request, parent, isMain) {
  if (request === 'electron') return mockElectronPath;
  return originalResolve(request, parent, isMain);
};

// ==== LOAD PRELOAD.JS ====
require('../../preload.js');

// Restore
Module._resolveFilename = originalResolve;

// ==== ASSERTIONS ====
const api = calls.expose[0].api;

assert.strictEqual(calls.expose.length, 1, 'exposeInMainWorld called once');
assert.strictEqual(calls.expose[0].name, 'electronAPI', 'exposed as electronAPI');
assert.strictEqual(typeof api.closeWindow, 'function', 'has closeWindow');
assert.strictEqual(typeof api.minimizeWindow, 'function', 'has minimizeWindow');
assert.strictEqual(typeof api.maximizeWindow, 'function', 'has maximizeWindow');
assert.strictEqual(typeof api.openFolder, 'function', 'has openFolder');
assert.strictEqual(typeof api.readVault, 'function', 'has readVault');
assert.strictEqual(typeof api.editCommand, 'function', 'has editCommand');
assert.strictEqual(typeof api.onOpenFile, 'function', 'has onOpenFile');

api.closeWindow();
assert.deepStrictEqual(calls.send[0], ['window-close'], 'closeWindow sends window-close');

api.minimizeWindow();
assert.deepStrictEqual(calls.send[1], ['window-minimize'], 'minimizeWindow sends window-minimize');

api.maximizeWindow();
assert.deepStrictEqual(calls.send[2], ['window-maximize'], 'maximizeWindow sends window-maximize');

api.openFolder();
assert.deepStrictEqual(calls.invoke[0], ['dialog:openFolder'], 'openFolder invokes dialog:openFolder');

api.readVault('/vault');
assert.deepStrictEqual(calls.invoke[1], ['fs:readVault', '/vault'], 'readVault invokes fs:readVault');

api.editCommand('copy');
assert.deepStrictEqual(calls.send[3], ['edit:command', 'copy'], 'editCommand sends edit:command');

const cb = (data) => { cb.received = data; };
api.onOpenFile(cb);
assert.strictEqual(calls.on[0][0], 'open-external-file', 'onOpenFile listens to open-external-file');

calls.on[0][1]({}, { name: 'test.md', content: 'hello' });
assert.deepStrictEqual(cb.received, { name: 'test.md', content: 'hello' }, 'callback receives data');

console.log('✅ All preload.js assertions passed (12 tests)');
