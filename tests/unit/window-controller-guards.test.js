import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createWindowController } = require('../../src/main/window-controller.js');

const EXPECTED_APP_COMMANDS = [
  'newNote', 'openFind', 'openPalette', 'toggleAutoHideTitlebar', 'toggleHideStatusBar', 'showSettings',
];

function harness(overrides = {}) {
  const ipcHandlers = new Map();
  const contentsHandlers = new Map();
  const windowHandlers = new Map();
  const screenHandlers = new Map();
  const ipcMain = { on: vi.fn((channel, fn) => ipcHandlers.set(channel, fn)) };
  const session = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setSpellCheckerEnabled: vi.fn(),
    setSpellCheckerLanguages: vi.fn(),
    addWordToSpellCheckerDictionary: vi.fn(),
  };
  const webContents = {
    send: vi.fn(),
    on: vi.fn((event, fn) => contentsHandlers.set(event, fn)),
    setWindowOpenHandler: vi.fn(),
    isDestroyed: vi.fn(() => false),
    session,
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    copyImageAt: vi.fn(),
    downloadURL: vi.fn(),
    replaceMisspelling: vi.fn(),
  };
  const win = {
    loadURL: vi.fn(),
    on: vi.fn((event, fn) => windowHandlers.set(event, fn)),
    close: vi.fn(),
    maximize: vi.fn(),
    center: vi.fn(),
    setBounds: vi.fn(),
    setFullScreen: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isMaximized: vi.fn(() => false),
    getBounds: vi.fn(() => ({ x: 10, y: 20, width: 1000, height: 700 })),
    webContents,
  };
  const BrowserWindow = vi.fn(function () { return win; });
  BrowserWindow.fromWebContents = vi.fn(() => win);
  BrowserWindow.getAllWindows = vi.fn(() => [win]);
  const screen = {
    getAllDisplays: vi.fn(() => [{ id: 1 }]),
    on: vi.fn((event, fn) => screenHandlers.set(event, fn)),
  };
  const deps = {
    BrowserWindow,
    Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn((template) => ({ template })) },
    clipboard: { writeText: vi.fn() },
    screen,
    shell: { openExternal: vi.fn() },
    path: require('node:path'),
    rootDir: '/root',
    appRendererUrl: 'file:///app/index.html',
    approvedCloseWindows: new Set(),
    getCurrentSettings: vi.fn(() => ({ window: { w: 1280, h: 820 } })),
    persistWindowState: vi.fn(),
    closeVaultWatcher: vi.fn(),
    deliverPendingFiles: vi.fn(),
    clampWindowBounds: vi.fn(() => ({ w: 1280, h: 820 })),
    isPackaged: false,
    classifyNavigation: vi.fn(() => ({ action: 'allow' })),
    isExternallyOpenable: vi.fn(() => true),
    buildContextMenuTemplate: vi.fn(() => [{ kind: 'role', role: 'copy', enabled: true }]),
    writeLog: vi.fn(),
    ipcMain,
    crypto: { randomUUID: vi.fn(() => 'nonce-1') },
    ...overrides,
  };
  const controller = createWindowController(deps);
  return { controller, deps, win, webContents, ipcHandlers, contentsHandlers, windowHandlers, screenHandlers, screen, session, BrowserWindow };
}

const sender = (h) => ({ sender: h.webContents });

describe('installApplicationMenu', () => {
  test('non-darwin platforms clear the application menu', () => {
    const h = harness();
    h.controller.installApplicationMenu('win32');
    expect(h.deps.Menu.setApplicationMenu).toHaveBeenCalledWith(null);
    expect(h.deps.Menu.buildFromTemplate).not.toHaveBeenCalled();
  });

  test('a missing Menu does not throw on any platform', () => {
    const h = harness({ Menu: null });
    expect(() => h.controller.installApplicationMenu('win32')).not.toThrow();
    expect(() => h.controller.installApplicationMenu('darwin')).not.toThrow();
  });

  test('darwin without buildFromTemplate installs nothing', () => {
    const h = harness({ Menu: { setApplicationMenu: vi.fn() } });
    h.controller.installApplicationMenu('darwin');
    expect(h.deps.Menu.setApplicationMenu).not.toHaveBeenCalled();
  });

  test('darwin installs an Edit menu whose Select All relays to the renderer', () => {
    const h = harness();
    h.controller.installApplicationMenu('darwin');
    const [template] = h.deps.Menu.buildFromTemplate.mock.calls[0];
    // H13: the standard app / File / Window menus now surround Edit (see main-macos-h13.test.js).
    expect(template).toHaveLength(4);
    const edit = template.find((m) => m.label === 'Edit');
    expect(edit).toBeTruthy();
    const items = edit.submenu;
    expect(items.slice(0, 7)).toEqual([
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' },
    ]);
    const selectAll = items[7];
    expect(selectAll.label).toBe('Select All');
    expect(selectAll.accelerator).toBe('CmdOrCtrl+A');
    const win = { webContents: { send: vi.fn() } };
    selectAll.click({}, win);
    expect(win.webContents.send).toHaveBeenCalledWith('app:command', 'selectAll');
    expect(() => selectAll.click({}, null)).not.toThrow();
    expect(() => selectAll.click({}, {})).not.toThrow();
    expect(h.deps.Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
  });
});

describe('close failsafe', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function armed(h, dirty) {
    h.controller.createWindow();
    if (dirty !== undefined) h.ipcHandlers.get('doc:dirty-state')(sender(h), dirty);
    h.contentsHandlers.get('did-finish-load')();
    const event = { preventDefault: vi.fn() };
    h.windowHandlers.get('close')(event);
    return event;
  }

  test('a loaded renderer is asked to close and the window is held back', () => {
    const h = harness();
    const event = armed(h);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(h.webContents.send).toHaveBeenCalledWith('app:request-close');
    expect(h.win.close).not.toHaveBeenCalled();
  });

  test('after 20 seconds of silence the window force-closes and logs the dirty count', () => {
    const h = harness();
    armed(h, 3);
    vi.advanceTimersByTime(19999);
    expect(h.win.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.win.close).toHaveBeenCalledTimes(1);
    expect(h.deps.approvedCloseWindows.has(h.win)).toBe(true);
    expect(h.deps.persistWindowState).toHaveBeenCalledWith(h.win);
    expect(h.deps.closeVaultWatcher).toHaveBeenCalledTimes(1);
    const [level, tag, message] = h.deps.writeLog.mock.calls.find((c) => c[1] === 'window:close-failsafe');
    expect(level).toBe('warn');
    expect(message).toContain('within 20000ms');
    expect(message).toContain('(3 unsaved file(s)');
  });

  test('a window with no report logs zero unsaved files', () => {
    const h = harness();
    armed(h);
    vi.advanceTimersByTime(20000);
    expect(h.deps.writeLog.mock.calls.find((c) => c[1] === 'window:close-failsafe')[2]).toContain('(0 unsaved file(s)');
  });

  test.each([[0, 0], [10000, 10000]])('a dirty count of %s is recorded', (count, shown) => {
    const h = harness();
    armed(h, count);
    vi.advanceTimersByTime(20000);
    expect(h.deps.writeLog.mock.calls.find((c) => c[1] === 'window:close-failsafe')[2]).toContain(`(${shown} unsaved file(s)`);
  });

  test.each([[-1], [10001], [1.5], ['3'], [null], [undefined]])('a dirty count of %j is ignored', (count) => {
    const h = harness();
    armed(h, count);
    vi.advanceTimersByTime(20000);
    expect(h.deps.writeLog.mock.calls.find((c) => c[1] === 'window:close-failsafe')[2]).toContain('(0 unsaved file(s)');
  });

  test('the user cancelling the close clears the failsafe', () => {
    const h = harness();
    armed(h);
    h.ipcHandlers.get('window-close-aborted')(sender(h));
    vi.advanceTimersByTime(60000);
    expect(h.win.close).not.toHaveBeenCalled();
  });

  test('the renderer heartbeat re-arms the failsafe from zero', () => {
    const h = harness();
    armed(h);
    vi.advanceTimersByTime(19000);
    h.ipcHandlers.get('window-close-extend')(sender(h));
    vi.advanceTimersByTime(19999);
    expect(h.win.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.win.close).toHaveBeenCalledTimes(1);
  });

  test('a heartbeat without an armed failsafe does not arm one', () => {
    const h = harness();
    h.controller.createWindow();
    h.ipcHandlers.get('window-close-extend')(sender(h));
    vi.advanceTimersByTime(60000);
    expect(h.win.close).not.toHaveBeenCalled();
  });

  test('a heartbeat for a destroyed window does not re-arm', () => {
    const h = harness();
    armed(h);
    h.win.isDestroyed.mockReturnValue(true);
    h.ipcHandlers.get('window-close-extend')(sender(h));
    vi.advanceTimersByTime(60000);
    expect(h.win.close).not.toHaveBeenCalled();
  });

  test('a heartbeat that finds no window does not re-arm and does not throw', () => {
    const h = harness();
    armed(h);
    h.BrowserWindow.fromWebContents.mockReturnValue(null);
    expect(() => h.ipcHandlers.get('window-close-extend')(sender(h))).not.toThrow();
  });

  test('a heartbeat when BrowserWindow cannot resolve a sender does nothing', () => {
    const h = harness();
    armed(h);
    h.BrowserWindow.fromWebContents = undefined;
    expect(() => h.ipcHandlers.get('window-close-extend')(sender(h))).not.toThrow();
  });

  test('the failsafe does nothing when the window was destroyed meanwhile', () => {
    const h = harness();
    armed(h);
    h.win.isDestroyed.mockReturnValue(true);
    vi.advanceTimersByTime(20000);
    expect(h.win.close).not.toHaveBeenCalled();
    expect(h.deps.persistWindowState).not.toHaveBeenCalled();
  });

  test('the failsafe does nothing when the close was approved meanwhile', () => {
    const h = harness();
    armed(h);
    h.deps.approvedCloseWindows.add(h.win);
    vi.advanceTimersByTime(20000);
    expect(h.win.close).not.toHaveBeenCalled();
  });

  test('re-arming replaces the earlier timer instead of stacking', () => {
    const h = harness();
    armed(h);
    h.windowHandlers.get('close')({ preventDefault: vi.fn() });
    vi.advanceTimersByTime(20000);
    expect(h.win.close).toHaveBeenCalledTimes(1);
  });
});

describe('window close handler', () => {
  test('an approved close persists and releases without blocking', () => {
    const h = harness();
    h.controller.createWindow();
    h.deps.approvedCloseWindows.add(h.win);
    const event = { preventDefault: vi.fn() };
    h.windowHandlers.get('close')(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(h.deps.approvedCloseWindows.has(h.win)).toBe(false);
    expect(h.deps.persistWindowState).toHaveBeenCalledWith(h.win);
    expect(h.deps.closeVaultWatcher).toHaveBeenCalledTimes(1);
    expect(h.win.close).not.toHaveBeenCalled();
  });

  test('before the renderer finished loading the window closes straight away', () => {
    const h = harness();
    h.controller.createWindow();
    const event = { preventDefault: vi.fn() };
    h.windowHandlers.get('close')(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(h.deps.approvedCloseWindows.has(h.win)).toBe(true);
    expect(h.deps.persistWindowState).toHaveBeenCalledWith(h.win);
    expect(h.deps.closeVaultWatcher).toHaveBeenCalledTimes(1);
    expect(h.win.close).toHaveBeenCalledTimes(1);
    expect(h.webContents.send).not.toHaveBeenCalledWith('app:request-close');
  });

  test('a destroyed webContents also closes straight away', () => {
    const h = harness();
    h.controller.createWindow();
    h.contentsHandlers.get('did-finish-load')();
    h.webContents.isDestroyed.mockReturnValue(true);
    h.windowHandlers.get('close')({ preventDefault: vi.fn() });
    expect(h.win.close).toHaveBeenCalledTimes(1);
  });

  test('a destroyed window is not asked to close again', () => {
    const h = harness();
    h.controller.createWindow();
    h.win.isDestroyed.mockReturnValue(true);
    h.windowHandlers.get('close')({ preventDefault: vi.fn() });
    expect(h.win.close).not.toHaveBeenCalled();
  });

  test('an event without preventDefault is tolerated', () => {
    const h = harness();
    h.controller.createWindow();
    expect(() => h.windowHandlers.get('close')({})).not.toThrow();
    expect(() => h.windowHandlers.get('close')(undefined)).not.toThrow();
  });

  test('a crashed renderer is treated as not loaded', () => {
    const h = harness();
    h.controller.createWindow();
    h.contentsHandlers.get('did-finish-load')();
    h.contentsHandlers.get('render-process-gone')({}, { reason: 'crashed' });
    h.windowHandlers.get('close')({ preventDefault: vi.fn() });
    expect(h.win.close).toHaveBeenCalledTimes(1);
    expect(h.webContents.send).not.toHaveBeenCalledWith('app:request-close');
  });

  test('did-finish-load hands pending files to the window', () => {
    const h = harness();
    h.controller.createWindow();
    h.contentsHandlers.get('did-finish-load')();
    expect(h.deps.deliverPendingFiles).toHaveBeenCalledWith(h.win);
  });

  test('a window without an on() method still builds', () => {
    const h = harness();
    h.win.on = undefined;
    expect(() => h.controller.createWindow()).not.toThrow();
  });

  test('native fullscreen changes are mirrored to the renderer', () => {
    const h = harness();
    h.controller.createWindow();
    h.windowHandlers.get('enter-full-screen')();
    h.windowHandlers.get('leave-full-screen')();
    expect(h.webContents.send).toHaveBeenCalledWith('window-fullscreen-changed', true);
    expect(h.webContents.send).toHaveBeenCalledWith('window-fullscreen-changed', false);
  });

  test('fullscreen changes on a destroyed window are not sent', () => {
    const h = harness();
    h.controller.createWindow();
    h.win.isDestroyed.mockReturnValue(true);
    h.windowHandlers.get('enter-full-screen')();
    h.windowHandlers.get('leave-full-screen')();
    expect(h.webContents.send).not.toHaveBeenCalled();
  });
});

describe('window-set-fullscreen', () => {
  test.each([[true, true], [false, false], ['yes', false], [1, false], [undefined, false]])('flag %j sets fullscreen to %s', (flag, expected) => {
    const h = harness();
    h.controller.createWindow();
    h.ipcHandlers.get('window-set-fullscreen')(sender(h), flag);
    expect(h.win.setFullScreen).toHaveBeenCalledWith(expected);
  });

  test('a destroyed window is left alone', () => {
    const h = harness();
    h.controller.createWindow();
    h.win.isDestroyed.mockReturnValue(true);
    h.ipcHandlers.get('window-set-fullscreen')(sender(h), true);
    expect(h.win.setFullScreen).not.toHaveBeenCalled();
  });

  test('a window without setFullScreen is left alone', () => {
    const h = harness();
    h.controller.createWindow();
    h.win.setFullScreen = undefined;
    expect(() => h.ipcHandlers.get('window-set-fullscreen')(sender(h), true)).not.toThrow();
  });

  test('no resolvable window is tolerated', () => {
    const h = harness();
    h.controller.createWindow();
    h.BrowserWindow.fromWebContents.mockReturnValue(null);
    expect(() => h.ipcHandlers.get('window-set-fullscreen')(sender(h), true)).not.toThrow();
    h.BrowserWindow.fromWebContents = undefined;
    expect(() => h.ipcHandlers.get('window-set-fullscreen')(sender(h), true)).not.toThrow();
    expect(h.win.setFullScreen).not.toHaveBeenCalled();
  });

  test('handlers register once however many windows are created', () => {
    const h = harness();
    h.controller.createWindow();
    h.controller.createWindow();
    expect(h.deps.ipcMain.on.mock.calls.filter((c) => c[0] === 'doc:dirty-state')).toHaveLength(1);
    expect(h.deps.ipcMain.on.mock.calls.filter((c) => c[0] === 'context-menu:action')).toHaveLength(1);
  });

  test('without an ipcMain nothing registers and nothing throws', () => {
    const h = harness({ ipcMain: null });
    expect(() => h.controller.createWindow()).not.toThrow();
    expect(() => harness({ ipcMain: {} }).controller.createWindow()).not.toThrow();
  });
});

describe('context menu stash and dispatch', () => {
  function shown(h, descriptors, params = { x: 5, y: 6 }) {
    h.deps.buildContextMenuTemplate.mockReturnValue(descriptors);
    h.controller.createWindow();
    h.contentsHandlers.get('context-menu')({}, params);
  }

  test('main sends the descriptors, the six app commands and the position under a nonce', () => {
    const h = harness();
    const descriptors = [{ kind: 'role', role: 'copy', enabled: true }];
    shown(h, descriptors, { x: 5, y: 6 });
    const [channel, payload] = h.webContents.send.mock.calls.find((c) => c[0] === 'context-menu:show');
    expect(channel).toBe('context-menu:show');
    expect(payload.nonce).toBe('nonce-1');
    expect(payload.descriptors).toEqual(descriptors);
    expect(payload.appCommands.map((c) => c.id)).toEqual(EXPECTED_APP_COMMANDS);
    expect(payload.appCommands.every((c) => c.kind === 'app-command')).toBe(true);
    expect(payload.x).toBe(5);
    expect(payload.y).toBe(6);
  });

  test('nothing is sent or stashed when there are no descriptors', () => {
    const h = harness();
    shown(h, []);
    expect(h.webContents.send).not.toHaveBeenCalled();
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents.copy).not.toHaveBeenCalled();
  });

  test('labels come from the resolver when one is injected and are undefined otherwise', () => {
    const resolver = vi.fn(() => ({ copy: 'Kopieren' }));
    const withResolver = harness({ buildContextMenuLabels: resolver });
    shown(withResolver, [{ kind: 'role', role: 'copy', enabled: true }]);
    expect(withResolver.deps.buildContextMenuTemplate).toHaveBeenCalledWith(
      { x: 5, y: 6 },
      { isExternallyOpenable: withResolver.deps.isExternallyOpenable, labels: { copy: 'Kopieren' } },
    );
    const without = harness();
    shown(without, [{ kind: 'role', role: 'copy', enabled: true }]);
    expect(without.deps.buildContextMenuTemplate.mock.calls[0][1].labels).toBeUndefined();
  });

  test.each([
    ['cut', 'cut'], ['copy', 'copy'], ['paste', 'paste'], ['undo', 'undo'], ['redo', 'redo'],
  ])('an enabled %s role runs the matching webContents method', (role, method) => {
    const h = harness();
    shown(h, [{ kind: 'role', role, enabled: true }]);
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents[method]).toHaveBeenCalledTimes(1);
  });

  test('a disabled role does nothing', () => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: false }]);
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents.copy).not.toHaveBeenCalled();
  });

  test('selectAll relays to the renderer and never runs in main', () => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'selectAll', enabled: true }]);
    h.webContents.send.mockClear();
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents.send).toHaveBeenCalledWith('app:command', 'selectAll');
  });

  test('an unknown role is ignored', () => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'mystery', enabled: true }]);
    expect(() => h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 })).not.toThrow();
  });

  test('a role whose method is missing is ignored', () => {
    const h = harness();
    h.webContents.copy = undefined;
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    expect(() => h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 })).not.toThrow();
  });

  test('indexes past the descriptors dispatch the six app commands in order', () => {
    EXPECTED_APP_COMMANDS.forEach((id, offset) => {
      const h = harness();
      shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
      h.webContents.send.mockClear();
      h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 1 + offset });
      expect(h.webContents.send).toHaveBeenCalledWith('app:command', id);
    });
  });

  test.each([[-1], [7], [1.5], ['0'], [null], [undefined]])('index %j is rejected', (index) => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    h.webContents.send.mockClear();
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index });
    expect(h.webContents.send).not.toHaveBeenCalled();
    expect(h.webContents.copy).not.toHaveBeenCalled();
  });

  test('the last valid index is accepted', () => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    h.webContents.send.mockClear();
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 6 });
    expect(h.webContents.send).toHaveBeenCalledWith('app:command', 'showSettings');
  });

  test.each([[null], [undefined], ['x'], [42]])('payload %j is ignored', (payload) => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    h.ipcHandlers.get('context-menu:action')(sender(h), payload);
    expect(h.webContents.copy).not.toHaveBeenCalled();
  });

  test('a non-string nonce is ignored and an unknown nonce does nothing', () => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 1, index: 0 });
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'other', index: 0 });
    expect(h.webContents.copy).not.toHaveBeenCalled();
  });

  test('a nonce is single-use', () => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents.copy).toHaveBeenCalledTimes(1);
  });

  test('a foreign sender cannot use the nonce and burns it', () => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    h.ipcHandlers.get('context-menu:action')({ sender: { id: 'other' } }, { nonce: 'nonce-1', index: 0 });
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents.copy).not.toHaveBeenCalled();
  });

  test('a destroyed or missing window ignores the click', () => {
    const destroyed = harness();
    shown(destroyed, [{ kind: 'role', role: 'copy', enabled: true }]);
    destroyed.win.isDestroyed.mockReturnValue(true);
    destroyed.ipcHandlers.get('context-menu:action')(sender(destroyed), { nonce: 'nonce-1', index: 0 });
    expect(destroyed.webContents.copy).not.toHaveBeenCalled();

    const missing = harness();
    shown(missing, [{ kind: 'role', role: 'copy', enabled: true }]);
    missing.BrowserWindow.fromWebContents.mockReturnValue(null);
    missing.ipcHandlers.get('context-menu:action')(sender(missing), { nonce: 'nonce-1', index: 0 });
    expect(missing.webContents.copy).not.toHaveBeenCalled();

    const unresolvable = harness();
    shown(unresolvable, [{ kind: 'role', role: 'copy', enabled: true }]);
    unresolvable.BrowserWindow.fromWebContents = undefined;
    unresolvable.ipcHandlers.get('context-menu:action')(sender(unresolvable), { nonce: 'nonce-1', index: 0 });
    expect(unresolvable.webContents.copy).not.toHaveBeenCalled();
  });

  test('closing the menu drops its stash entry for the owning sender only', () => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    h.ipcHandlers.get('context-menu:closed')({ sender: { id: 'other' } }, { nonce: 'nonce-1' });
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents.copy).toHaveBeenCalledTimes(1);

    const again = harness();
    shown(again, [{ kind: 'role', role: 'copy', enabled: true }]);
    again.ipcHandlers.get('context-menu:closed')(sender(again), { nonce: 'nonce-1' });
    again.ipcHandlers.get('context-menu:action')(sender(again), { nonce: 'nonce-1', index: 0 });
    expect(again.webContents.copy).not.toHaveBeenCalled();
  });

  test.each([[null], [undefined], [{}], [{ nonce: 5 }], [{ nonce: 'unknown' }]])('closed payload %j is harmless', (payload) => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    expect(() => h.ipcHandlers.get('context-menu:closed')(sender(h), payload)).not.toThrow();
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents.copy).toHaveBeenCalledTimes(1);
  });

  test('destroying the webContents drops only its own entries', () => {
    const h = harness();
    shown(h, [{ kind: 'role', role: 'copy', enabled: true }]);
    h.contentsHandlers.get('destroyed')();
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents.copy).not.toHaveBeenCalled();
  });

  test('registering the action handler with no ipcMain is a no-op', () => {
    const h = harness({ ipcMain: null });
    expect(() => h.controller.registerContextMenuActionHandler()).not.toThrow();
  });
});

describe('context actions', () => {
  function fire(h, descriptor, params = { x: 1, y: 2 }) {
    h.deps.buildContextMenuTemplate.mockReturnValue([descriptor]);
    h.controller.createWindow();
    h.contentsHandlers.get('context-menu')({}, params);
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
  }

  test('open-link opens only externally-openable urls', () => {
    const yes = harness();
    fire(yes, { kind: 'action', id: 'open-link', url: 'https://a.example/' });
    expect(yes.deps.shell.openExternal).toHaveBeenCalledWith('https://a.example/');
    const no = harness({ isExternallyOpenable: vi.fn(() => false) });
    fire(no, { kind: 'action', id: 'open-link', url: 'file:///x' });
    expect(no.deps.shell.openExternal).not.toHaveBeenCalled();
  });

  test.each(['copy-link', 'copy-image-address'])('%s copies an openable url and skips missing or blocked ones', (id) => {
    const yes = harness();
    fire(yes, { kind: 'action', id, url: 'https://a.example/' });
    expect(yes.deps.clipboard.writeText).toHaveBeenCalledWith('https://a.example/');
    const missing = harness();
    fire(missing, { kind: 'action', id });
    expect(missing.deps.clipboard.writeText).not.toHaveBeenCalled();
    const blocked = harness({ isExternallyOpenable: vi.fn(() => false) });
    fire(blocked, { kind: 'action', id, url: 'file:///x' });
    expect(blocked.deps.clipboard.writeText).not.toHaveBeenCalled();
  });

  test('copy-image copies at the click point, including 0,0, and skips a missing point', () => {
    const origin = harness();
    fire(origin, { kind: 'action', id: 'copy-image' }, { x: 0, y: 0 });
    expect(origin.webContents.copyImageAt).toHaveBeenCalledWith(0, 0);
    const noX = harness();
    fire(noX, { kind: 'action', id: 'copy-image' }, { y: 4 });
    expect(noX.webContents.copyImageAt).not.toHaveBeenCalled();
    const noY = harness();
    fire(noY, { kind: 'action', id: 'copy-image' }, { x: 4 });
    expect(noY.webContents.copyImageAt).not.toHaveBeenCalled();
  });

  test('save-image downloads only openable urls', () => {
    const yes = harness();
    fire(yes, { kind: 'action', id: 'save-image', url: 'https://a.example/i.png' });
    expect(yes.webContents.downloadURL).toHaveBeenCalledWith('https://a.example/i.png');
    const missing = harness();
    fire(missing, { kind: 'action', id: 'save-image' });
    expect(missing.webContents.downloadURL).not.toHaveBeenCalled();
    const blocked = harness({ isExternallyOpenable: vi.fn(() => false) });
    fire(blocked, { kind: 'action', id: 'save-image', url: 'file:///x' });
    expect(blocked.webContents.downloadURL).not.toHaveBeenCalled();
  });

  // audit M38: the spellchecker is off; its two old action ids reach nothing.
  test('replace-misspelling and add-to-dictionary do nothing', () => {
    const h = harness();
    fire(h, { kind: 'action', id: 'replace-misspelling', replacement: 'their' });
    fire(h, { kind: 'action', id: 'add-to-dictionary', word: 'bidi' });
    expect(h.webContents.replaceMisspelling).not.toHaveBeenCalled();
    expect(h.session.addWordToSpellCheckerDictionary).not.toHaveBeenCalled();
  });

  test('an unknown action id does nothing and a throwing action never crashes main', () => {
    const unknown = harness();
    expect(() => fire(unknown, { kind: 'action', id: 'mystery' })).not.toThrow();
    const throwing = harness();
    throwing.deps.shell.openExternal.mockImplementation(() => { throw new Error('boom'); });
    expect(() => fire(throwing, { kind: 'action', id: 'open-link', url: 'https://a.example/' })).not.toThrow();
  });

  test('a descriptor of an unknown kind is ignored', () => {
    const h = harness();
    expect(() => fire(h, { kind: 'mystery' })).not.toThrow();
  });
});

describe('navigation and window options', () => {
  test('permissions: only fullscreen is granted', () => {
    const h = harness();
    h.controller.createWindow();
    const request = h.session.setPermissionRequestHandler.mock.calls[0][0];
    const check = h.session.setPermissionCheckHandler.mock.calls[0][0];
    const callback = vi.fn();
    request(null, 'fullscreen', callback);
    request(null, 'media', callback);
    expect(callback.mock.calls).toEqual([[true], [false]]);
    expect(check(null, 'fullscreen')).toBe(true);
    expect(check(null, 'geolocation')).toBe(false);
  });

  test('a session without permission setters is tolerated', () => {
    const h = harness();
    h.webContents.session = {};
    expect(() => h.controller.createWindow()).not.toThrow();
    const none = harness();
    none.webContents.session = undefined;
    expect(() => none.controller.createWindow()).not.toThrow();
  });

  test('webviews are always blocked, even for an event without preventDefault', () => {
    const h = harness();
    h.controller.createWindow();
    const event = { preventDefault: vi.fn() };
    h.contentsHandlers.get('will-attach-webview')(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(() => h.contentsHandlers.get('will-attach-webview')({})).not.toThrow();
    expect(() => h.contentsHandlers.get('will-attach-webview')(undefined)).not.toThrow();
  });

  test('window.open is always denied and opens openable urls externally', () => {
    const yes = harness();
    yes.controller.createWindow();
    const open = yes.webContents.setWindowOpenHandler.mock.calls[0][0];
    expect(open({ url: 'https://a.example/' })).toEqual({ action: 'deny' });
    expect(yes.deps.shell.openExternal).toHaveBeenCalledWith('https://a.example/');
    const no = harness({ isExternallyOpenable: vi.fn(() => false) });
    no.controller.createWindow();
    expect(no.webContents.setWindowOpenHandler.mock.calls[0][0]({ url: 'file:///x' })).toEqual({ action: 'deny' });
    expect(no.deps.shell.openExternal).not.toHaveBeenCalled();
  });

  test.each([['will-navigate'], ['will-redirect']])('%s always prevents; hands off only what is classified external', (eventName) => {
    // B5: no classification lets a navigation through, not even a stale 'allow'.
    const allow = harness();
    allow.controller.createWindow();
    const allowEvent = { preventDefault: vi.fn() };
    allow.contentsHandlers.get(eventName)(allowEvent, 'file:///app/index.html');
    expect(allowEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(allow.deps.shell.openExternal).not.toHaveBeenCalled();
    expect(allow.deps.classifyNavigation).toHaveBeenCalledWith('file:///app/index.html');

    const deny = harness({ classifyNavigation: vi.fn(() => ({ action: 'deny' })) });
    deny.controller.createWindow();
    const denyEvent = { preventDefault: vi.fn() };
    deny.contentsHandlers.get(eventName)(denyEvent, 'https://evil.example/');
    expect(denyEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(deny.deps.shell.openExternal).not.toHaveBeenCalled();

    const external = harness({ classifyNavigation: vi.fn(() => ({ action: 'external' })) });
    external.controller.createWindow();
    external.contentsHandlers.get(eventName)({ preventDefault: vi.fn() }, 'https://a.example/');
    expect(external.deps.shell.openExternal).toHaveBeenCalledWith('https://a.example/');

    const blocked = harness({ classifyNavigation: vi.fn(() => ({ action: 'external' })), isExternallyOpenable: vi.fn(() => false) });
    blocked.controller.createWindow();
    blocked.contentsHandlers.get(eventName)({ preventDefault: vi.fn() }, 'javascript:1');
    expect(blocked.deps.shell.openExternal).not.toHaveBeenCalled();
  });

  test('load failures and renderer crashes are logged with their details', () => {
    const h = harness();
    h.controller.createWindow();
    h.contentsHandlers.get('did-fail-load')({}, -6, 'FILE_NOT_FOUND', 'file:///x', true);
    h.contentsHandlers.get('did-fail-provisional-load')({}, -3, 'ABORTED', 'file:///y', false);
    h.contentsHandlers.get('render-process-gone')({}, { reason: 'oom' });
    h.contentsHandlers.get('render-process-gone')({}, {});
    h.contentsHandlers.get('render-process-gone')({}, null);
    expect(h.deps.writeLog.mock.calls).toEqual([
      ['error', 'window:did-fail-load', '-6 FILE_NOT_FOUND file:///x main=true'],
      ['error', 'window:did-fail-provisional-load', '-3 ABORTED file:///y main=false'],
      ['error', 'window:render-process-gone', 'oom'],
      ['error', 'window:render-process-gone', 'gone'],
      ['error', 'window:render-process-gone', 'gone'],
    ]);
  });

  test('without a log function the controller still works', () => {
    const h = harness({ writeLog: undefined });
    h.controller.createWindow();
    expect(() => h.contentsHandlers.get('did-fail-load')({}, 1, 'x', 'y', true)).not.toThrow();
  });

  test('the renderer URL is loaded and a maximized setting maximizes the window', () => {
    const plain = harness();
    plain.controller.createWindow();
    expect(plain.win.loadURL).toHaveBeenCalledWith('file:///app/index.html');
    expect(plain.win.maximize).not.toHaveBeenCalled();
    const maximized = harness({ clampWindowBounds: vi.fn(() => ({ w: 1280, h: 820, maximized: true })) });
    maximized.controller.createWindow();
    expect(maximized.win.maximize).toHaveBeenCalledTimes(1);
  });

  test('x and y are passed to the window only when known', () => {
    const none = harness();
    none.controller.createWindow();
    const bare = none.BrowserWindow.mock.calls[0][0];
    expect('x' in bare).toBe(false);
    expect('y' in bare).toBe(false);
    expect(bare.width).toBe(1280);
    expect(bare.height).toBe(820);
    const placed = harness({ clampWindowBounds: vi.fn(() => ({ w: 900, h: 700, x: 0, y: 0 })) });
    placed.controller.createWindow();
    const options = placed.BrowserWindow.mock.calls[0][0];
    expect(options.x).toBe(0);
    expect(options.y).toBe(0);
    expect(options.width).toBe(900);
    expect(options.height).toBe(700);
  });

  test('a missing screen or settings object still builds a window', () => {
    const h = harness({ screen: null, getCurrentSettings: vi.fn(() => null) });
    expect(() => h.controller.createWindow()).not.toThrow();
    expect(h.deps.clampWindowBounds).toHaveBeenCalledWith(null, []);
  });

  test('sandbox, isolation and devtools flags are pinned', () => {
    const dev = harness();
    dev.controller.createWindow();
    const prefs = dev.BrowserWindow.mock.calls[0][0].webPreferences;
    expect(prefs).toMatchObject({
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false, nodeIntegrationInSubFrames: false, devTools: true,
    });
    const packaged = harness({ isPackaged: true });
    packaged.controller.createWindow();
    expect(packaged.BrowserWindow.mock.calls[0][0].webPreferences.devTools).toBe(false);
  });

  // audit M38: Chromium's spellchecker downloads dictionaries from a Google CDN.
  test('the spellchecker is off in the window and in its session', () => {
    const h = harness();
    h.controller.createWindow();
    expect(h.BrowserWindow.mock.calls[0][0].webPreferences.spellcheck).toBe(false);
    expect(h.session.setSpellCheckerEnabled.mock.calls).toEqual([[false]]);
  });

  // Seen on the packaged Linux build: with the checker disabled but "en-US" still in the
  // language list, en-US-10-1.bdic was downloaded. The empty list stops it and comes first.
  test('the language list is emptied before the checker is disabled', () => {
    const h = harness();
    h.controller.createWindow();
    expect(h.session.setSpellCheckerLanguages.mock.calls).toEqual([[[]]]);
    expect(h.session.setSpellCheckerLanguages.mock.invocationCallOrder[0])
      .toBeLessThan(h.session.setSpellCheckerEnabled.mock.invocationCallOrder[0]);
  });

  test('a session without setSpellCheckerEnabled, or no session, does not stop the window', () => {
    const old = harness();
    old.session.setSpellCheckerEnabled = undefined;
    old.session.setSpellCheckerLanguages = undefined;
    expect(() => old.controller.createWindow()).not.toThrow();
    const none = harness();
    none.webContents.session = undefined;
    expect(() => none.controller.createWindow()).not.toThrow();
  });
});

describe('watchDisplays', () => {
  function watch(h) {
    h.controller.watchDisplays();
    return h.screenHandlers;
  }

  test('both display events are watched', () => {
    const h = harness();
    const handlers = watch(h);
    expect([...handlers.keys()].sort()).toEqual(['display-metrics-changed', 'display-removed']);
  });

  test('no screen, or a screen without on(), is tolerated', () => {
    expect(() => harness({ screen: null }).controller.watchDisplays()).not.toThrow();
    expect(() => harness({ screen: {} }).controller.watchDisplays()).not.toThrow();
  });

  test('a window that moved is clamped back with its size preserved', () => {
    const h = harness({ clampWindowBounds: vi.fn(() => ({ x: 0, y: 5 })) });
    watch(h).get('display-removed')();
    expect(h.deps.clampWindowBounds).toHaveBeenCalledWith({ x: 10, y: 20, w: 1000, h: 700 }, [{ id: 1 }]);
    expect(h.win.setBounds).toHaveBeenCalledWith({ x: 0, y: 5, width: 1000, height: 700 });
  });

  test('only one changed coordinate still re-places the window', () => {
    const onlyX = harness({ clampWindowBounds: vi.fn(() => ({ x: 11, y: 20 })) });
    watch(onlyX).get('display-metrics-changed')();
    expect(onlyX.win.setBounds).toHaveBeenCalledTimes(1);
    const onlyY = harness({ clampWindowBounds: vi.fn(() => ({ x: 10, y: 21 })) });
    watch(onlyY).get('display-metrics-changed')();
    expect(onlyY.win.setBounds).toHaveBeenCalledTimes(1);
  });

  test('an already visible window is left alone', () => {
    const h = harness({ clampWindowBounds: vi.fn(() => ({ x: 10, y: 20 })) });
    watch(h).get('display-removed')();
    expect(h.win.setBounds).not.toHaveBeenCalled();
    expect(h.win.center).not.toHaveBeenCalled();
  });

  test.each([['x'], ['y']])('a window off every display is recentred when %s is dropped', (dropped) => {
    const bounds = { x: 1, y: 1 };
    delete bounds[dropped];
    const h = harness({ clampWindowBounds: vi.fn(() => bounds) });
    watch(h).get('display-removed')();
    expect(h.win.center).toHaveBeenCalledTimes(1);
    expect(h.win.setBounds).not.toHaveBeenCalled();
    expect(h.deps.writeLog).toHaveBeenCalledWith('info', 'main:display-change', 'window was off every display — recentred');
  });

  test('a window at x=0,y=0 counts as placed, not dropped', () => {
    const h = harness({ clampWindowBounds: vi.fn(() => ({ x: 0, y: 0 })) });
    watch(h).get('display-removed')();
    expect(h.win.center).not.toHaveBeenCalled();
    expect(h.win.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1000, height: 700 });
  });

  test.each([
    ['destroyed', 'isDestroyed'], ['minimized', 'isMinimized'], ['maximized', 'isMaximized'],
  ])('a %s window is skipped', (_label, method) => {
    const h = harness({ clampWindowBounds: vi.fn(() => ({ x: 0, y: 0 })) });
    h.win[method].mockReturnValue(true);
    watch(h).get('display-removed')();
    expect(h.deps.clampWindowBounds).not.toHaveBeenCalled();
    expect(h.win.setBounds).not.toHaveBeenCalled();
  });

  test('no window at all is tolerated', () => {
    const h = harness();
    h.BrowserWindow.getAllWindows.mockReturnValue([]);
    expect(() => watch(h).get('display-removed')()).not.toThrow();
    expect(h.deps.clampWindowBounds).not.toHaveBeenCalled();
  });
});

describe('M11: a crashed or hung page, and the end of the Windows session', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function live(answer = { response: 0 }) {
    const dialog = { showMessageBox: vi.fn(() => Promise.resolve(answer)) };
    const h = harness({ dialog, resetRecovery: vi.fn() });
    h.webContents.reload = vi.fn();
    h.webContents.forcefullyCrashRenderer = vi.fn();
    h.controller.createWindow();
    h.contentsHandlers.get('did-finish-load')();
    return { ...h, dialog, gone: (reason = 'crashed') => h.contentsHandlers.get('render-process-gone')({}, { reason }) };
  }

  test('a crash reloads the page, after the recovery memo is reset', () => {
    const h = live();
    h.gone();
    expect(h.deps.resetRecovery).toHaveBeenCalledTimes(1);
    expect(h.webContents.reload).toHaveBeenCalledTimes(1);
    expect(h.deps.resetRecovery.mock.invocationCallOrder[0]).toBeLessThan(h.webContents.reload.mock.invocationCallOrder[0]);
    expect(h.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  test('the third crash within a minute asks instead of reloading; Reload starts over', async () => {
    const h = live({ response: 0 });
    h.gone(); h.gone(); h.gone();
    expect(h.webContents.reload).toHaveBeenCalledTimes(2);
    expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(h.dialog.showMessageBox.mock.calls[0][1]).toMatchObject({ buttons: ['Reload', 'Quit'], cancelId: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.webContents.reload).toHaveBeenCalledTimes(3);
    expect(h.win.close).not.toHaveBeenCalled();
  });

  test('Quit closes the window and leaves the recovery files alone', async () => {
    const h = live({ response: 1 });
    h.gone(); h.gone(); h.gone();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.win.close).toHaveBeenCalledTimes(1);
    expect(h.webContents.reload).toHaveBeenCalledTimes(2);
  });

  test('crashes more than a minute apart keep reloading without a question', () => {
    const h = live();
    h.gone(); h.gone();
    vi.advanceTimersByTime(61000);
    h.gone();
    expect(h.webContents.reload).toHaveBeenCalledTimes(3);
    expect(h.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  test('a clean exit, a destroyed window and an approved close are left alone', () => {
    const clean = live();
    clean.gone('clean-exit');
    expect(clean.webContents.reload).not.toHaveBeenCalled();
    const closing = live();
    closing.deps.approvedCloseWindows.add(closing.win);
    closing.gone();
    expect(closing.webContents.reload).not.toHaveBeenCalled();
    const dead = live();
    dead.win.isDestroyed.mockReturnValue(true);
    dead.gone();
    expect(dead.webContents.reload).not.toHaveBeenCalled();
  });

  test('a crash cancels the pending close failsafe and drops the menus of the dead page', () => {
    const h = live();
    h.contentsHandlers.get('context-menu')({}, { x: 1, y: 2 });
    h.windowHandlers.get('close')({ preventDefault: vi.fn() });
    h.gone();
    vi.advanceTimersByTime(30000);
    expect(h.win.close).not.toHaveBeenCalled();
    h.webContents.copy.mockClear();
    h.ipcHandlers.get('context-menu:action')(sender(h), { nonce: 'nonce-1', index: 0 });
    expect(h.webContents.copy).not.toHaveBeenCalled();
  });

  test('a page hung for 10 s asks Wait / Reload; Reload kills the page', async () => {
    const h = live({ response: 1 });
    h.windowHandlers.get('unresponsive')();
    vi.advanceTimersByTime(9999);
    expect(h.dialog.showMessageBox).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.dialog.showMessageBox.mock.calls[0][1]).toMatchObject({ buttons: ['Wait', 'Reload'], defaultId: 0, cancelId: 0 });
    expect(h.webContents.forcefullyCrashRenderer).toHaveBeenCalledTimes(1);
  });

  test('a page that answers within the grace period is not asked about', () => {
    const h = live();
    h.windowHandlers.get('unresponsive')();
    vi.advanceTimersByTime(5000);
    h.windowHandlers.get('responsive')();
    vi.advanceTimersByTime(20000);
    expect(h.dialog.showMessageBox).not.toHaveBeenCalled();
  });

  test('Wait asks again after another 10 s; a page that answers closes the open question', async () => {
    const h = live({ response: 0 });
    h.windowHandlers.get('unresponsive')();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.dialog.showMessageBox).toHaveBeenCalledTimes(2);
    expect(h.webContents.forcefullyCrashRenderer).not.toHaveBeenCalled();

    let signal = null;
    const open = live();
    open.dialog.showMessageBox.mockImplementation((_win, options) => { signal = options.signal; return new Promise(() => {}); });
    open.windowHandlers.get('unresponsive')();
    await vi.advanceTimersByTimeAsync(10000);
    expect(signal.aborted).toBe(false);
    open.windowHandlers.get('responsive')();
    expect(signal.aborted).toBe(true);
  });

  test('the questions follow the UI language', async () => {
    const h = live({ response: 1 });
    h.deps.getCurrentSettings.mockReturnValue({ uiLocale: 'ar' });
    h.windowHandlers.get('unresponsive')();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.dialog.showMessageBox.mock.calls[0][1].buttons).toEqual(['انتظار', 'إعادة التحميل']);
  });

  test('logoff and shutdown tell a loaded page to mirror its notes now', () => {
    const h = live();
    h.windowHandlers.get('query-session-end')();
    h.windowHandlers.get('session-end')();
    expect(h.webContents.send.mock.calls.filter(([channel]) => channel === 'app:flush-recovery')).toHaveLength(2);
    const early = harness();
    early.controller.createWindow();
    early.windowHandlers.get('session-end')();
    expect(early.webContents.send).not.toHaveBeenCalledWith('app:flush-recovery');
  });
});
