/**
 * main-window-contextmenu.test.js — MUTATION-STRENGTHENING tests for src/main/index.js.
 *
 * Cluster: createWindow() BrowserWindow options (src/main/index.js ~215-230) and the
 * webContents `context-menu` handler (~249-268).
 *
 * These tests do NOT just execute the code — they pin the EXACT observable
 * values so that any value/operator/flag/string/object mutation flips a branch
 * or a literal and makes an assertion FAIL. They drive the REAL code via the
 * injectable `bootstrap({ electron, fs, proc })` seam (audit #3) using the
 * shared harness mocks (no Module hijack).
 *
 * Surviving mutants targeted (current src/main/index.js line numbers):
 *   - L221 icon (StringLiteral)            → assert icon ENDS WITH "icon.ico"
 *   - L222 backgroundColor (StringLiteral) → assert === "#1A1713"
 *   - L224 transparent (BooleanLiteral)    → assert === false
 *   - L228 preload path (StringLiteral)    → assert ENDS WITH "src/preload/index.js"
 *   - L253-L264 context-menu enabled flags + role objects
 *     (BooleanLiteral / ObjectLiteral / StringLiteral) → assert exact role
 *     order, separators, popup, and each item.enabled === its editFlag.
 */

import { describe, test, expect, beforeAll, vi } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import {
  buildMockElectron,
  buildMockFs,
  buildMockProc,
} from './main-harness.js';

// ── WINDOW OPTIONS ──────────────────────────────────────────────────────────
describe('src/main/index.js — createWindow() BrowserWindow options', () => {
  let mockElectron;
  let opts;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    bootstrap({
      electron: mockElectron,
      fs: buildMockFs(),
      proc: buildMockProc(['node', 'src/main/index.js']),
    });
    await new Promise((r) => setTimeout(r, 50));
    opts = mockElectron.BrowserWindow.mock.calls[0][0];
  });

  test('BrowserWindow constructed exactly once with an options object', () => {
    expect(mockElectron.BrowserWindow).toHaveBeenCalledTimes(1);
    expect(opts).toBeTypeOf('object');
    expect(opts).not.toBeNull();
  });

  // ─ numeric dimensions (kills ArithmeticOperator / number-literal mutants) ─
  test('width === 1280 (exact, not ±1 / not a different literal)', () => {
    expect(opts.width).toBe(1280);
    expect(opts.width).not.toBe(0);
  });

  test('height === 820', () => {
    expect(opts.height).toBe(820);
    expect(opts.height).not.toBe(0);
  });

  test('minWidth === 800', () => {
    expect(opts.minWidth).toBe(800);
    expect(opts.minWidth).not.toBe(0);
  });

  test('minHeight === 600', () => {
    expect(opts.minHeight).toBe(600);
    expect(opts.minHeight).not.toBe(0);
  });

  // ─ string + boolean literals (kills StringLiteral / BooleanLiteral) ─
  test('title === "BP MD RTL Reader" (exact string)', () => {
    expect(opts.title).toBe('BP MD RTL Reader');
  });

  test('frame === false (boolean, not undefined / not true)', () => {
    expect(opts.frame).toBe(false);
    // BooleanLiteral mutant flips false → true; pin both shape and value.
    expect(opts.frame).not.toBe(true);
    expect(typeof opts.frame).toBe('boolean');
  });

  test('transparent === false (L224 BooleanLiteral)', () => {
    expect(opts.transparent).toBe(false);
    expect(opts.transparent).not.toBe(true);
    expect(typeof opts.transparent).toBe('boolean');
  });

  test('backgroundColor === "#1A1713" (L222 StringLiteral, exact hex)', () => {
    expect(opts.backgroundColor).toBe('#1A1713');
    expect(opts.backgroundColor).not.toBe('');
  });

  // ─ icon path (L438 StringLiteral) — assert the FULL "build/icons/icon.ico" tail ─
  test('icon is an absolute path ending with "build/icons/icon.ico"', () => {
    expect(typeof opts.icon).toBe('string');
    expect(opts.icon.length).toBeGreaterThan('build/icons/icon.ico'.length);
    // Tolerate either path separator; pin BOTH segments so the 'assets'→"" and
    // 'icon.ico'→"" StringLiteral mutants both die (a bare '/icon.ico' endsWith
    // check would miss the 'assets' mutant since path.join collapses the empty seg).
    const normalized = opts.icon.replace(/\\/g, '/');
    expect(normalized.endsWith('/build/icons/icon.ico')).toBe(true);
    expect(opts.icon).not.toBe('');
  });

  // ─ webPreferences (kills BooleanLiteral + StringLiteral + ObjectLiteral) ─
  test('webPreferences is present as an object', () => {
    expect(opts.webPreferences).toBeTypeOf('object');
    expect(opts.webPreferences).not.toBeNull();
  });

  test('webPreferences.nodeIntegration === false (security flag)', () => {
    expect(opts.webPreferences.nodeIntegration).toBe(false);
    expect(opts.webPreferences.nodeIntegration).not.toBe(true);
    expect(typeof opts.webPreferences.nodeIntegration).toBe('boolean');
  });

  test('webPreferences.contextIsolation === true (security flag)', () => {
    expect(opts.webPreferences.contextIsolation).toBe(true);
    expect(opts.webPreferences.contextIsolation).not.toBe(false);
    expect(typeof opts.webPreferences.contextIsolation).toBe('boolean');
  });

  test('webPreferences.preload is an absolute path ending with "src/preload/index.js"', () => {
    expect(typeof opts.webPreferences.preload).toBe('string');
    expect(opts.webPreferences.preload.length).toBeGreaterThan('src/preload/index.js'.length);
    const normalized = opts.webPreferences.preload.replace(/\\/g, '/');
    expect(normalized.endsWith('/src/preload/index.js')).toBe(true);
    expect(opts.webPreferences.preload).not.toBe('');
  });

  test('webPreferences.webviewTag is false and extra file privileges are not implied', () => {
    expect(opts.webPreferences.webviewTag).toBe(false);
    expect(opts.webPreferences.webSecurity).toBe(true);
    expect(opts.webPreferences.allowRunningInsecureContent).toBe(false);
  });

  test('session permission handlers deny all requests except fullscreen', () => {
    // v10 redesign (2026-08-25): the title bar gains a fullscreen toggle, which calls
    // the DOM requestFullscreen() API. That call is intercepted by these same
    // deny-all handlers, so 'fullscreen' must be the one permission allowed through -
    // every other permission stays denied.
    expect(mockElectron._mockWin.webContents.session.setPermissionRequestHandler).toHaveBeenCalled();
    const requestHandler = mockElectron._mockWin.webContents.session.setPermissionRequestHandler.mock.calls[0][0];
    let granted;
    requestHandler({}, 'media', (ok) => { granted = ok; });
    expect(granted).toBe(false);
    requestHandler({}, 'geolocation', (ok) => { granted = ok; });
    expect(granted).toBe(false);
    requestHandler({}, 'fullscreen', (ok) => { granted = ok; });
    expect(granted).toBe(true);

    const checkHandler = mockElectron._mockWin.webContents.session.setPermissionCheckHandler.mock.calls[0][0];
    expect(checkHandler({}, 'media')).toBe(false);
    expect(checkHandler({}, 'fullscreen')).toBe(true);
  });
});

// ── RIGHT-CLICK CONTEXT MENU (D1: drawn by the renderer over an IPC bridge) ──────────────
// The 'context-menu' handler no longer builds an Electron Menu or calls popup(); it stashes
// the descriptor array under a single-use nonce and sends 'context-menu:show' so the renderer
// can draw it. These tests pin that hand-off, plus the { nonce, index } round-trip a click
// makes back through the 'context-menu:action' IPC handler.
describe('src/main/index.js — webContents "context-menu" handler (renderer-drawn menu)', () => {
  let mockElectron;
  let ctxHandler;
  let actionHandler;
  let wc;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    // Capture the context-menu listener registered in createWindow().
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'context-menu') ctxHandler = fn;
    });
    bootstrap({
      electron: mockElectron,
      fs: buildMockFs(),
      proc: buildMockProc(['node', 'src/main/index.js']),
    });
    await new Promise((r) => setTimeout(r, 50));
    wc = mockElectron._mockWin.webContents;
    actionHandler = mockElectron.ipcMain.on.mock.calls.find(([evt]) => evt === 'context-menu:action')[1];
  });

  function lastShowPayload() {
    const call = wc.send.mock.calls.filter((c) => c[0] === 'context-menu:show').at(-1);
    return call && call[1];
  }

  test('a "context-menu" listener is registered on webContents', () => {
    expect(typeof ctxHandler).toBe('function');
  });

  test('a "context-menu:action" listener is registered on ipcMain', () => {
    expect(typeof actionHandler).toBe('function');
  });

  test('never calls Menu.buildFromTemplate or Menu.popup — the menu is drawn by the renderer', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: 'x', editFlags: { canCopy: true } });
    expect(mockElectron.Menu.buildFromTemplate).not.toHaveBeenCalled();
    expect(mockElectron.Menu._popup).not.toHaveBeenCalled();
  });

  // ─ EDITABLE: full role menu with per-flag enabled state ─
  // Uses a MIX of true/false editFlags so the !!f.canX coercion mutants
  // (e.g. !!f.canRedo flipped to true, or the object literal mutated) flip an
  // asserted enabled value and FAIL.
  test('editable field → exact role order [undo,redo,cut,copy,paste,selectAll] with 2 separators, sent over context-menu:show, enabled matches each editFlag', () => {
    wc.send.mockClear();

    ctxHandler(
      {},
      {
        isEditable: true,
        selectionText: 'whatever',
        editFlags: {
          canUndo: true,
          canRedo: false,
          canCut: true,
          canCopy: false,
          canPaste: true,
          canSelectAll: false,
        },
      }
    );

    expect(wc.send).toHaveBeenCalledWith('context-menu:show', expect.objectContaining({ nonce: expect.any(String) }));
    const { descriptors } = lastShowPayload();
    expect(Array.isArray(descriptors)).toBe(true);

    // Exact role order (kills any role StringLiteral / reordering / ObjectLiteral).
    const roles = descriptors.filter((i) => i.kind === 'role').map((i) => i.role);
    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);

    // Exactly two separators, no more no less.
    expect(descriptors.filter((i) => i.kind === 'separator')).toHaveLength(2);

    // Total descriptor length: 6 role items + 2 separators.
    expect(descriptors).toHaveLength(8);

    // Each role's enabled flag EQUALS the corresponding editFlag — this is the
    // core kill for the !!f.canX BooleanLiteral / ObjectLiteral mutants.
    const byRole = Object.fromEntries(
      descriptors.filter((i) => i.kind === 'role').map((i) => [i.role, i.enabled])
    );
    expect(byRole.undo).toBe(true);       // canUndo:true
    expect(byRole.redo).toBe(false);      // canRedo:false
    expect(byRole.cut).toBe(true);        // canCut:true
    expect(byRole.copy).toBe(false);      // canCopy:false
    expect(byRole.paste).toBe(true);      // canPaste:true
    expect(byRole.selectAll).toBe(false); // canSelectAll:false

    // enabled values must be real booleans (kills !!  → truthy-string mutants).
    for (const item of descriptors.filter((i) => i.kind === 'role')) {
      expect(typeof item.enabled).toBe('boolean');
    }
  });

  // ─ EDITABLE with the INVERSE flag mix — guards against a hard-coded answer ─
  test('editable field → enabled tracks the inverse flag mix too', () => {
    wc.send.mockClear();

    ctxHandler(
      {},
      {
        isEditable: true,
        selectionText: '',
        editFlags: {
          canUndo: false,
          canRedo: true,
          canCut: false,
          canCopy: true,
          canPaste: false,
          canSelectAll: true,
        },
      }
    );

    const { descriptors } = lastShowPayload();
    const byRole = Object.fromEntries(
      descriptors.filter((i) => i.kind === 'role').map((i) => [i.role, i.enabled])
    );
    expect(byRole.undo).toBe(false);
    expect(byRole.redo).toBe(true);
    expect(byRole.cut).toBe(false);
    expect(byRole.copy).toBe(true);
    expect(byRole.paste).toBe(false);
    expect(byRole.selectAll).toBe(true);
  });

  // ─ EDITABLE with missing editFlags → all coerced to false (kills !! drop) ─
  test('editable field with empty editFlags → every role disabled (false)', () => {
    wc.send.mockClear();
    ctxHandler({}, { isEditable: true, selectionText: '', editFlags: {} });

    const { descriptors } = lastShowPayload();
    const roles = descriptors.filter((i) => i.kind === 'role').map((i) => i.role);
    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
    for (const item of descriptors.filter((i) => i.kind === 'role')) {
      expect(item.enabled).toBe(false); // undefined → !! → false
      expect(typeof item.enabled).toBe('boolean');
    }
  });

  // ─ NON-EDITABLE + selection → exactly [copy, selectAll], sent over context-menu:show ─
  test('non-editable WITH selection text → descriptors are exactly [copy, selectAll]', () => {
    wc.send.mockClear();

    ctxHandler(
      {},
      {
        isEditable: false,
        selectionText: 'x',
        editFlags: { canCopy: true, canSelectAll: false },
      }
    );

    const { descriptors } = lastShowPayload();
    const roles = descriptors.filter((i) => i.kind === 'role').map((i) => i.role);
    expect(roles).toEqual(['copy', 'selectAll']);

    // No separators in the non-editable branch.
    expect(descriptors.filter((i) => i.kind === 'separator')).toHaveLength(0);
    expect(descriptors).toHaveLength(2);

    // enabled still tracks the flags here (kills the !! mutants in this branch).
    const byRole = Object.fromEntries(
      descriptors.filter((i) => i.kind === 'role').map((i) => [i.role, i.enabled])
    );
    expect(byRole.copy).toBe(true);        // canCopy:true
    expect(byRole.selectAll).toBe(false);  // canSelectAll:false
    expect(typeof byRole.copy).toBe('boolean');
    expect(typeof byRole.selectAll).toBe('boolean');
  });

  // ─ NON-EDITABLE + EMPTY selection → menu shown, Copy disabled (T-B12) ─
  test('non-editable with empty selection → shown with [copy(disabled), selectAll]', () => {
    wc.send.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', editFlags: { canSelectAll: true } });

    const { descriptors } = lastShowPayload();
    const byRole = Object.fromEntries(descriptors.filter(i => i.kind === 'role').map(i => [i.role, i.enabled]));
    expect(Object.keys(byRole)).toEqual(['copy', 'selectAll']);
    expect(byRole.copy).toBe(false);
    expect(byRole.selectAll).toBe(true);
  });

  // ─ NON-EDITABLE + WHITESPACE-ONLY selection → Copy disabled (kills .trim() mutant) ─
  test('non-editable with whitespace-only selection → Copy disabled', () => {
    wc.send.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '   \t  ', editFlags: { canCopy: true, canSelectAll: true } });

    const { descriptors } = lastShowPayload();
    const byRole = Object.fromEntries(descriptors.filter(i => i.kind === 'role').map(i => [i.role, i.enabled]));
    expect(byRole.copy).toBe(false);
    expect(byRole.selectAll).toBe(true);
  });

  // ─ LINK right-click → Open/Copy link descriptors, dispatched via the IPC round-trip ─
  test('link right-click → Open Link in Browser + Copy Link Address, and each dispatches correctly', () => {
    wc.send.mockClear();
    mockElectron.shell.openExternal.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://example.com', editFlags: { canSelectAll: true } });
    const { nonce, descriptors } = lastShowPayload();
    const labels = descriptors.map(i => i.label).filter(Boolean);
    expect(labels).toContain('Open Link in Browser');
    expect(labels).toContain('Copy Link Address');

    actionHandler({ sender: wc }, { nonce, index: descriptors.findIndex(i => i.label === 'Open Link in Browser') });
    expect(mockElectron.shell.openExternal).toHaveBeenCalledWith('https://example.com');
  });

  test('non-http link → no Open/Copy Link descriptors at all', () => {
    wc.send.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'javascript:alert(1)', editFlags: {} });
    const { descriptors } = lastShowPayload();
    expect(descriptors.some(i => i.label === 'Open Link in Browser')).toBe(false);
    expect(descriptors.some(i => i.label === 'Copy Link Address')).toBe(false);
  });

  // ── The safety properties D1's addendum and audit finding C-2/E-2 require ──
  test('a reused nonce dispatches nothing the second time (single-use)', () => {
    wc.send.mockClear();
    mockElectron.shell.openExternal.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://reuse.example', editFlags: {} });
    const { nonce, descriptors } = lastShowPayload();
    const idx = descriptors.findIndex(i => i.label === 'Open Link in Browser');

    actionHandler({ sender: wc }, { nonce, index: idx });
    expect(mockElectron.shell.openExternal).toHaveBeenCalledTimes(1);

    mockElectron.shell.openExternal.mockClear();
    actionHandler({ sender: wc }, { nonce, index: idx }); // same nonce again
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
  });

  test('a non-integer or out-of-range index dispatches nothing', () => {
    wc.send.mockClear();
    mockElectron.shell.openExternal.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://range.example', editFlags: {} });
    const { descriptors } = lastShowPayload();

    actionHandler({ sender: wc }, { nonce: lastShowPayload().nonce, index: 1.5 });
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();

    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://range.example', editFlags: {} });
    actionHandler({ sender: wc }, { nonce: lastShowPayload().nonce, index: descriptors.length + 5 });
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();

    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://range.example', editFlags: {} });
    actionHandler({ sender: wc }, { nonce: lastShowPayload().nonce, index: -1 });
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
  });

  test('an event from a foreign sender dispatches nothing', () => {
    wc.send.mockClear();
    mockElectron.shell.openExternal.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://foreign.example', editFlags: {} });
    const { nonce, descriptors } = lastShowPayload();
    const idx = descriptors.findIndex(i => i.label === 'Open Link in Browser');

    const foreignSender = { isDestroyed: () => false };
    actionHandler({ sender: foreignSender }, { nonce, index: idx });
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
  });

  test('a suggestion index calls replaceMisspelling with that suggestion', () => {
    wc.send.mockClear();
    wc.replaceMisspelling.mockClear();
    ctxHandler({}, {
      isEditable: true, selectionText: '', misspelledWord: 'teh',
      dictionarySuggestions: ['the', 'tea'], editFlags: {},
    });
    const { nonce, descriptors } = lastShowPayload();
    actionHandler({ sender: wc }, { nonce, index: descriptors.findIndex(i => i.label === 'tea') });
    expect(wc.replaceMisspelling).toHaveBeenCalledWith('tea');
  });

  // ── App commands (D1 addendum / M17): six renderer-local commands appended past the
  // end of the context-menu descriptors, dispatched through the same nonce+index round-trip
  // but relayed back to the renderer over 'app:command' instead of executed in main.
  test('context-menu:show carries the six app commands alongside the descriptors', () => {
    wc.send.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', editFlags: {} });
    const { appCommands } = lastShowPayload();
    expect(appCommands.map(c => c.id)).toEqual([
      'newNote', 'openFind', 'openPalette', 'toggleAutoHideTitlebar', 'toggleHideStatusBar', 'showSettings',
    ]);
  });

  // v10 redesign follow-up: main has no access to State or the locale catalog, so its own
  // hard-coded English labels made the right-click menu the sixth hand-maintained copy of
  // these strings AND left it untranslated even with the UI in Arabic. Main now sends ids
  // only; the renderer resolves display text through its own locale-aware APP_COMMAND_DISPLAY.
  test('app commands carry only { kind, id } — no label or shortcut from main', () => {
    wc.send.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', editFlags: {} });
    const { appCommands } = lastShowPayload();
    for (const command of appCommands) {
      expect(command).not.toHaveProperty('label');
      expect(command).not.toHaveProperty('shortcut');
      expect(Object.keys(command).sort()).toEqual(['id', 'kind']);
    }
  });

  test('an index past the descriptors selects an app command and relays it over app:command', () => {
    wc.send.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', editFlags: {} });
    const { nonce, descriptors, appCommands } = lastShowPayload();
    const wantIdx = appCommands.findIndex(c => c.id === 'openPalette');
    actionHandler({ sender: wc }, { nonce, index: descriptors.length + wantIdx });
    expect(wc.send).toHaveBeenCalledWith('app:command', 'openPalette');
  });

  test('an index past descriptors AND app commands dispatches nothing', () => {
    wc.send.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', editFlags: {} });
    const { nonce, descriptors, appCommands } = lastShowPayload();
    wc.send.mockClear();
    actionHandler({ sender: wc }, { nonce, index: descriptors.length + appCommands.length });
    expect(wc.send).not.toHaveBeenCalledWith('app:command', expect.anything());
  });
});

// ── runContextAction side-effects, via the context-menu:action IPC round-trip ──
// These dispatch { nonce, index } through the real ipcMain.on('context-menu:action', …)
// handler and pin the EXACT side-effect, so the per-case guards can't be forced-true or
// have their && weakened without an assertion failing.
describe('src/main/index.js — runContextAction (context-menu:action dispatch)', () => {
  let mockElectron;
  let ctxHandler;
  let actionHandler;
  let wc;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'context-menu') ctxHandler = fn;
    });
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 50));
    wc = mockElectron._mockWin.webContents;
    actionHandler = mockElectron.ipcMain.on.mock.calls.find(([evt]) => evt === 'context-menu:action')[1];
  });

  function lastShowPayload() {
    const call = wc.send.mock.calls.filter((c) => c[0] === 'context-menu:show').at(-1);
    return call && call[1];
  }

  const clickLabel = (label) => {
    const { nonce, descriptors } = lastShowPayload();
    const index = descriptors.findIndex((i) => i.label === label);
    expect(index, `menu item "${label}" should exist`).toBeGreaterThanOrEqual(0);
    actionHandler({ sender: wc }, { nonce, index });
  };

  // open-link only opens an EXTERNALLY-OPENABLE url.
  test('open-link with an http url → shell.openExternal(url)', () => {
    wc.send.mockClear();
    mockElectron.shell.openExternal.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://ok.example/p', editFlags: {} });
    clickLabel('Open Link in Browser');
    expect(mockElectron.shell.openExternal).toHaveBeenCalledTimes(1);
    expect(mockElectron.shell.openExternal).toHaveBeenCalledWith('https://ok.example/p');
  });

  // copy-link only writes when d.url is present (it always is for a link item).
  test('copy-link → clipboard.writeText(url) exactly once', () => {
    wc.send.mockClear();
    mockElectron.clipboard.writeText.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://copy.example', editFlags: {} });
    clickLabel('Copy Link Address');
    expect(mockElectron.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(mockElectron.clipboard.writeText).toHaveBeenCalledWith('https://copy.example');
  });

  // copy-image-address shares the case: writes the srcURL.
  test('copy-image-address → clipboard.writeText(srcURL)', () => {
    wc.send.mockClear();
    mockElectron.clipboard.writeText.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', srcURL: 'https://img.example/a.png', editFlags: {} });
    clickLabel('Copy Image Address');
    expect(mockElectron.clipboard.writeText).toHaveBeenCalledWith('https://img.example/a.png');
  });

  // copy-image requires BOTH params.x AND params.y to be non-null.
  test('copy-image with both x AND y → webContents.copyImageAt(x, y)', () => {
    wc.send.mockClear();
    wc.copyImageAt.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', x: 12, y: 34, editFlags: {} });
    clickLabel('Copy Image');
    expect(wc.copyImageAt).toHaveBeenCalledTimes(1);
    expect(wc.copyImageAt).toHaveBeenCalledWith(12, 34);
  });

  test('copy-image with x present but y MISSING → copyImageAt NOT called (kills && → ||)', () => {
    wc.send.mockClear();
    wc.copyImageAt.mockClear();
    // y is null → the && guard is false; an || mutant (or forced-true) would still call.
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', x: 12, y: null, editFlags: {} });
    clickLabel('Copy Image');
    expect(wc.copyImageAt).not.toHaveBeenCalled();
  });

  test('copy-image with y present but x MISSING → copyImageAt NOT called', () => {
    wc.send.mockClear();
    wc.copyImageAt.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', x: null, y: 34, editFlags: {} });
    clickLabel('Copy Image');
    expect(wc.copyImageAt).not.toHaveBeenCalled();
  });

  test('copy-image with x=0 and y=0 → copyImageAt(0,0) (0 is != null, not falsy-rejected)', () => {
    wc.send.mockClear();
    wc.copyImageAt.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', x: 0, y: 0, editFlags: {} });
    clickLabel('Copy Image');
    expect(wc.copyImageAt).toHaveBeenCalledWith(0, 0);
  });

  // save-image: external-openable srcURL → downloadURL.
  test('save-image with an http srcURL → webContents.downloadURL(srcURL)', () => {
    wc.send.mockClear();
    wc.downloadURL.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', srcURL: 'https://img.example/b.png', editFlags: {} });
    clickLabel('Save Image');
    expect(wc.downloadURL).toHaveBeenCalledWith('https://img.example/b.png');
  });

  // replace-misspelling: clicking a suggestion calls replaceMisspelling(s).
  test('replace-misspelling → webContents.replaceMisspelling(suggestion)', () => {
    wc.send.mockClear();
    wc.replaceMisspelling.mockClear();
    ctxHandler({}, {
      isEditable: true, selectionText: '', misspelledWord: 'teh',
      dictionarySuggestions: ['the'], editFlags: {},
    });
    clickLabel('the');
    expect(wc.replaceMisspelling).toHaveBeenCalledWith('the');
  });

  // add-to-dictionary only runs when session.addWordToSpellCheckerDictionary exists.
  test('add-to-dictionary → session.addWordToSpellCheckerDictionary(word) when available', () => {
    wc.send.mockClear();
    wc.session.addWordToSpellCheckerDictionary.mockClear();
    ctxHandler({}, {
      isEditable: true, selectionText: '', misspelledWord: 'recieve',
      dictionarySuggestions: [], editFlags: {},
    });
    clickLabel('Add to Dictionary');
    expect(wc.session.addWordToSpellCheckerDictionary)
      .toHaveBeenCalledWith('recieve');
  });

  test('add-to-dictionary is a no-op (no throw) when the spellchecker API is absent', () => {
    wc.send.mockClear();
    const realSession = wc.session;
    wc.session = {}; // no addWordToSpellCheckerDictionary
    try {
      ctxHandler({}, {
        isEditable: true, selectionText: '', misspelledWord: 'wierd',
        dictionarySuggestions: [], editFlags: {},
      });
      expect(() => clickLabel('Add to Dictionary')).not.toThrow();
    } finally {
      wc.session = realSession;
    }
  });
});

// ── NAVIGATION GUARD (T-B11) ───────────────────────────────────────────────
describe('src/main/index.js — navigation guard', () => {
  let mockElectron;
  let navHandler;
  let redirectHandler;
  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'will-navigate') navHandler = fn;
      if (event === 'will-redirect') redirectHandler = fn;
    });
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 50));
  });
  test('will-navigate and will-redirect registered', () => {
    expect(typeof navHandler).toBe('function');
    expect(typeof redirectHandler).toBe('function');
  });
  test('external http → preventDefault + openExternal', () => {
    mockElectron.shell.openExternal.mockClear();
    const e = { preventDefault: vi.fn() };
    navHandler(e, 'https://example.com');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockElectron.shell.openExternal).toHaveBeenCalledWith('https://example.com');
  });
  test('non-http navigation → prevented, not opened', () => {
    mockElectron.shell.openExternal.mockClear();
    const e = { preventDefault: vi.fn() };
    navHandler(e, 'file:///etc/passwd');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
  });

  // L480: an 'external' classification that is ALSO externally-openable opens; a
  // mailto: is external+openable → opens (kills the &&→|| weakening + forced-true,
  // since a non-openable external would NOT open).
  test('mailto: link → preventDefault + openExternal(mailto)', () => {
    mockElectron.shell.openExternal.mockClear();
    const e = { preventDefault: vi.fn() };
    navHandler(e, 'mailto:a@b.com');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockElectron.shell.openExternal).toHaveBeenCalledWith('mailto:a@b.com');
  });

  // L478: an 'allow' classification (same-page hash nav to the app URL) returns BEFORE
  // preventDefault — proving the guard is not forced to always-prevent.
  test('same-document navigation is allowed (no preventDefault, no openExternal)', () => {
    mockElectron.shell.openExternal.mockClear();
    const e = { preventDefault: vi.fn() };
    // index.html in the app dir → classifyNavigation returns 'allow'.
    const appHref = 'app://ui/src/renderer/index.html';
    navHandler(e, appHref);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(mockElectron.shell.openExternal).not.toHaveBeenCalled();
  });

  // will-redirect shares the same guard — an external redirect opens too.
  test('will-redirect to external http → preventDefault + openExternal', () => {
    mockElectron.shell.openExternal.mockClear();
    const e = { preventDefault: vi.fn() };
    redirectHandler(e, 'https://redir.example');
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockElectron.shell.openExternal).toHaveBeenCalledWith('https://redir.example');
  });
});

// ── createWindow: screen-absent fallback (L427) ──────────────────────────────
describe('src/main/index.js — createWindow display fallback (L427)', () => {
  test('no screen.getAllDisplays → falls back to [] displays and DEFAULT bounds (no x/y, no crash)', async () => {
    const mockElectron = buildMockElectron();
    mockElectron.screen = {}; // screen present but getAllDisplays NOT a function
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 50));
    const opts = mockElectron.BrowserWindow.mock.calls[0][0];
    // With [] displays and no saved window, clampWindowBounds returns default size
    // and NO x/y. A `["Stryker"]`/forced-getAllDisplays mutant would crash or change this.
    expect(opts.width).toBe(1280);
    expect(opts.height).toBe(820);
    expect('x' in opts).toBe(false);
    expect('y' in opts).toBe(false);
  });
});

// ── SANDBOX (T-B13) ────────────────────────────────────────────────────────
describe('src/main/index.js — renderer sandbox', () => {
  test('sandbox:true on BrowserWindow', async () => {
    const mockElectron = buildMockElectron();
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 50));
    const opts = mockElectron.BrowserWindow.mock.calls[0][0];
    expect(opts.webPreferences.sandbox).toBe(true);
    expect(opts.webPreferences.contextIsolation).toBe(true);
    expect(opts.webPreferences.nodeIntegration).toBe(false);
  });
});
