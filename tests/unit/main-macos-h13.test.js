/**
 * main-macos-h13.test.js — H13: macOS launch, application menu and window chrome.
 *
 * UNVERIFIED on a real macOS machine: these tests drive src/main/index.js,
 * src/main/window-controller.js and src/preload/index.js through the plain-mock main
 * harness with `proc.platform = 'darwin'`. They prove the code asks Electron for the right
 * things; they cannot prove how macOS renders them. Windows behaviour (frame:false window,
 * no application menu) is pinned alongside so it cannot change by accident.
 */
import { describe, test, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap } from '../../src/main/index.js';
import { setupBridge } from '../../src/preload/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

const require = createRequire(import.meta.url);
const { createWindowController } = require('../../src/main/window-controller.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function drive({ argv = ['node', 'src/main/index.js'], platform = 'darwin', beforeReady } = {}) {
  const electron = buildMockElectron();
  const listeners = {};
  electron.app.on.mockImplementation((event, fn) => { listeners[event] = fn; });
  const fs = buildMockFs();
  const proc = buildMockProc(argv);
  proc.platform = platform;
  bootstrap({ electron, fs, proc });
  // Everything here runs synchronously, i.e. BEFORE the whenReady() continuation.
  if (beforeReady) beforeReady({ electron, fs, listeners });
  await new Promise((r) => setTimeout(r, 50));
  return { electron, fs, proc, listeners };
}

describe('H13.1 open-file before ready is not lost when the CLI argv is parsed', () => {
  test('a path queued by open-file before ready AND a CLI file are both delivered after load', async () => {
    const { electron, listeners } = await drive({
      argv: ['node', 'src/main/index.js', '/docs/cli.md'],
      beforeReady: ({ listeners: l }) => l['open-file']({ preventDefault: vi.fn() }, '/docs/from-finder.md'),
    });
    const win = electron._mockWin;
    expect(listeners['open-file']).toBeTypeOf('function');
    const finish = win.webContents.on.mock.calls.filter(([e]) => e === 'did-finish-load').map(([, fn]) => fn);
    expect(finish.length).toBeGreaterThan(0);
    win.webContents.send.mockClear();
    finish[0]();
    const names = win.webContents.send.mock.calls
      .filter(([channel]) => channel === 'open-external-file')
      .map(([, payload]) => payload.name);
    expect(names).toEqual(['from-finder.md', 'cli.md']);
  });

  test('the same file arriving by open-file and by argv is delivered once', async () => {
    const { electron } = await drive({
      argv: ['node', 'src/main/index.js', '/docs/same.md'],
      beforeReady: ({ listeners: l }) => l['open-file']({ preventDefault: vi.fn() }, '/docs/same.md'),
    });
    const win = electron._mockWin;
    const finish = win.webContents.on.mock.calls.find(([e]) => e === 'did-finish-load')[1];
    win.webContents.send.mockClear();
    finish();
    const sent = win.webContents.send.mock.calls.filter(([c]) => c === 'open-external-file');
    expect(sent).toHaveLength(1);
    expect(sent[0][1].name).toBe('same.md');
  });

  test('a CLI file alone is still delivered (no open-file event)', async () => {
    const { electron } = await drive({ argv: ['node', 'src/main/index.js', '/docs/cli.md'] });
    const win = electron._mockWin;
    const finish = win.webContents.on.mock.calls.find(([e]) => e === 'did-finish-load')[1];
    win.webContents.send.mockClear();
    finish();
    expect(win.webContents.send.mock.calls.filter(([c]) => c === 'open-external-file')).toHaveLength(1);
  });
});

describe('H13.2 macOS application menu', () => {
  test('darwin template is [appMenu, fileMenu, Edit, windowMenu] in that order', async () => {
    const { electron } = await drive({ platform: 'darwin' });
    const template = electron.Menu.buildFromTemplate.mock.calls[0][0];
    expect(template).toHaveLength(4);
    expect(template[0]).toEqual({ role: 'appMenu' });
    expect(template[1]).toEqual({ role: 'fileMenu' });
    expect(template[2].label).toBe('Edit');
    expect(template[3]).toEqual({ role: 'windowMenu' });
  });

  test('the Edit menu keeps its roles and the relayed Select All', async () => {
    const { electron } = await drive({ platform: 'darwin' });
    const edit = electron.Menu.buildFromTemplate.mock.calls[0][0][2];
    expect(edit.submenu.filter((i) => i.role).map((i) => i.role)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste']);
    const selectAll = edit.submenu.find((i) => i.label === 'Select All');
    expect(selectAll.accelerator).toBe('CmdOrCtrl+A');
    expect(selectAll.role).toBeUndefined();
  });

  test.each(['win32', 'linux'])('%s still has NO application menu', async (platform) => {
    const { electron } = await drive({ platform });
    expect(electron.Menu.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(electron.Menu.buildFromTemplate).not.toHaveBeenCalled();
  });
});

describe('H13.3 macOS window chrome', () => {
  test('darwin: hidden title bar with native traffic lights, no frame:false', async () => {
    const { electron } = await drive({ platform: 'darwin' });
    const opts = electron._mockWin._options;
    expect(opts.titleBarStyle).toBe('hidden');
    expect(opts.trafficLightPosition).toEqual({ x: 16, y: 16 });
    expect(opts.frame).not.toBe(false);
  });

  test.each(['win32', 'linux'])('%s: window options are unchanged (frameless, no title-bar style)', async (platform) => {
    const { electron } = await drive({ platform });
    const opts = electron._mockWin._options;
    expect(opts.frame).toBe(false);
    expect(opts).not.toHaveProperty('titleBarStyle');
    expect(opts).not.toHaveProperty('trafficLightPosition');
    expect(opts.minWidth).toBe(800);
    expect(opts.minHeight).toBe(600);
  });

  test('darwin keeps the secure webPreferences', async () => {
    const { electron } = await drive({ platform: 'darwin' });
    const prefs = electron._mockWin._options.webPreferences;
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
  });

  test('the window controller defaults to the host platform when none is injected', () => {
    const BrowserWindow = vi.fn(function (opts) { this._opts = opts; return { ...fakeWin(), _opts: opts }; });
    const controller = createWindowController({
      BrowserWindow, Menu: null, clipboard: {}, screen: null, shell: {}, path: require('node:path'),
      rootDir: '/root', appRendererUrl: 'app://x', approvedCloseWindows: new Set(),
      getCurrentSettings: () => ({}), persistWindowState: vi.fn(), closeVaultWatcher: vi.fn(),
      deliverPendingFiles: vi.fn(), clampWindowBounds: () => ({ w: 1, h: 1 }), isPackaged: false,
      classifyNavigation: vi.fn(), isExternallyOpenable: vi.fn(), buildContextMenuTemplate: vi.fn(),
      writeLog: vi.fn(), ipcMain: { on: vi.fn() }, crypto: {},
    });
    controller.createWindow();
    const opts = BrowserWindow.mock.calls[0][0];
    if (process.platform === 'darwin') expect(opts.titleBarStyle).toBe('hidden');
    else expect(opts.frame).toBe(false);
  });
});

function fakeWin() {
  return {
    loadURL: vi.fn(), on: vi.fn(), maximize: vi.fn(), isDestroyed: () => false,
    webContents: { on: vi.fn(), send: vi.fn(), setWindowOpenHandler: vi.fn(), session: {} },
  };
}

describe('H13.3 stylesheet hides the custom window buttons only under html.platform-darwin', () => {
  const css = readFileSync(path.join(root, 'src/renderer/styles/responsive.css'), 'utf8');
  test('the .win-controls cluster is display:none on macOS and nowhere else', () => {
    expect(css).toMatch(/html\.platform-darwin \.win-controls\s*\{\s*display:\s*none;\s*\}/);
    const hiders = css.match(/[^{}]*\.win-controls\s*\{[^}]*display:\s*none[^}]*\}/g) || [];
    expect(hiders).toHaveLength(1);
  });
  test('the title bar leaves room on the physical left for the traffic lights', () => {
    expect(css).toMatch(/html\.platform-darwin \.titlebar \.tb-row\s*\{\s*padding-left:\s*5rem;\s*\}/);
  });
});

describe('H13.3 platform class for the renderer (hides the custom window buttons on macOS)', () => {
  function bridge(platform) {
    const handlers = {};
    const classList = { add: vi.fn() };
    const doc = {
      documentElement: { classList },
      addEventListener: vi.fn((event, fn, opts) => { handlers[event] = { fn, opts }; }),
    };
    setupBridge({
      contextBridge: { exposeInMainWorld: vi.fn() },
      ipcRenderer: { send: vi.fn(), invoke: vi.fn(), on: vi.fn() },
      doc,
      platform,
    });
    return { classList, handlers, doc };
  }

  test('adds html.platform-darwin once the DOM is ready', () => {
    const { classList, handlers } = bridge('darwin');
    expect(classList.add).not.toHaveBeenCalled();
    expect(handlers.DOMContentLoaded.opts).toEqual({ once: true });
    handlers.DOMContentLoaded.fn();
    expect(classList.add).toHaveBeenCalledWith('platform-darwin');
  });

  test('other platforms get their own class (win32 -> platform-win32)', () => {
    const { classList, handlers } = bridge('win32');
    handlers.DOMContentLoaded.fn();
    expect(classList.add).toHaveBeenCalledWith('platform-win32');
  });

  test('without a document or platform nothing is registered and nothing throws', () => {
    const exposeInMainWorld = vi.fn();
    expect(() => setupBridge({ contextBridge: { exposeInMainWorld }, ipcRenderer: {} })).not.toThrow();
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const doc = { addEventListener: vi.fn() };
    setupBridge({ contextBridge: { exposeInMainWorld }, ipcRenderer: {}, doc });
    expect(doc.addEventListener).not.toHaveBeenCalled();
  });
});
