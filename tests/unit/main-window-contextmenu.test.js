/**
 * main-window-contextmenu.test.js — MUTATION-STRENGTHENING tests for main.js.
 *
 * Cluster: createWindow() BrowserWindow options (main.js ~215-230) and the
 * webContents `context-menu` handler (~249-268).
 *
 * These tests do NOT just execute the code — they pin the EXACT observable
 * values so that any value/operator/flag/string/object mutation flips a branch
 * or a literal and makes an assertion FAIL. They drive the REAL code via the
 * injectable `bootstrap({ electron, fs, proc })` seam (audit #3) using the
 * shared harness mocks (no Module hijack).
 *
 * Surviving mutants targeted (current main.js line numbers):
 *   - L221 icon (StringLiteral)            → assert icon ENDS WITH "icon.ico"
 *   - L222 backgroundColor (StringLiteral) → assert === "#1A1713"
 *   - L224 transparent (BooleanLiteral)    → assert === false
 *   - L228 preload path (StringLiteral)    → assert ENDS WITH "preload.js"
 *   - L253-L264 context-menu enabled flags + role objects
 *     (BooleanLiteral / ObjectLiteral / StringLiteral) → assert exact role
 *     order, separators, popup, and each item.enabled === its editFlag.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { bootstrap } from '../../main.js';
import {
  buildMockElectron,
  buildMockFs,
  buildMockProc,
} from './main-harness.js';

// ── WINDOW OPTIONS ──────────────────────────────────────────────────────────
describe('main.js — createWindow() BrowserWindow options', () => {
  let mockElectron;
  let opts;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    bootstrap({
      electron: mockElectron,
      fs: buildMockFs(),
      proc: buildMockProc(['node', 'main.js']),
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

  // ─ icon path (L221 StringLiteral) — assert it ENDS WITH "icon.ico" ─
  test('icon is an absolute path ending with "icon.ico"', () => {
    expect(typeof opts.icon).toBe('string');
    expect(opts.icon.length).toBeGreaterThan('icon.ico'.length);
    // Tolerate either path separator; the StringLiteral mutant (e.g. "" or a
    // different filename) breaks the endsWith check.
    const normalized = opts.icon.replace(/\\/g, '/');
    expect(normalized.endsWith('/icon.ico')).toBe(true);
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

  test('webPreferences.preload is an absolute path ending with "preload.js"', () => {
    expect(typeof opts.webPreferences.preload).toBe('string');
    expect(opts.webPreferences.preload.length).toBeGreaterThan('preload.js'.length);
    const normalized = opts.webPreferences.preload.replace(/\\/g, '/');
    expect(normalized.endsWith('/preload.js')).toBe(true);
    expect(opts.webPreferences.preload).not.toBe('');
  });
});

// ── RIGHT-CLICK CONTEXT MENU ─────────────────────────────────────────────────
describe('main.js — webContents "context-menu" handler', () => {
  let mockElectron;
  let ctxHandler;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    // Capture the context-menu listener registered in createWindow().
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'context-menu') ctxHandler = fn;
    });
    bootstrap({
      electron: mockElectron,
      fs: buildMockFs(),
      proc: buildMockProc(['node', 'main.js']),
    });
    await new Promise((r) => setTimeout(r, 50));
  });

  test('a "context-menu" listener is registered on webContents', () => {
    expect(typeof ctxHandler).toBe('function');
  });

  // ─ EDITABLE: full role menu with per-flag enabled state ─
  // Uses a MIX of true/false editFlags so the !!f.canX coercion mutants
  // (e.g. !!f.canRedo flipped to true, or the object literal mutated) flip an
  // asserted enabled value and FAIL.
  test('editable field → exact role order [undo,redo,cut,copy,paste,selectAll] with 2 separators, and enabled matches each editFlag', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();

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

    expect(mockElectron.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    expect(Array.isArray(tpl)).toBe(true);

    // Exact role order (kills any role StringLiteral / reordering / ObjectLiteral).
    const roles = tpl.filter((i) => i.role).map((i) => i.role);
    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);

    // Exactly two separators, no more no less.
    const separators = tpl.filter((i) => i.type === 'separator');
    expect(separators).toHaveLength(2);

    // Total template length: 6 role items + 2 separators.
    expect(tpl).toHaveLength(8);

    // Each role's enabled flag EQUALS the corresponding editFlag — this is the
    // core kill for the !!f.canX BooleanLiteral / ObjectLiteral mutants.
    const byRole = Object.fromEntries(
      tpl.filter((i) => i.role).map((i) => [i.role, i.enabled])
    );
    expect(byRole.undo).toBe(true);       // canUndo:true
    expect(byRole.redo).toBe(false);      // canRedo:false
    expect(byRole.cut).toBe(true);        // canCut:true
    expect(byRole.copy).toBe(false);      // canCopy:false
    expect(byRole.paste).toBe(true);      // canPaste:true
    expect(byRole.selectAll).toBe(false); // canSelectAll:false

    // enabled values must be real booleans (kills !!  → truthy-string mutants).
    for (const item of tpl.filter((i) => i.role)) {
      expect(typeof item.enabled).toBe('boolean');
    }

    // Menu popped up exactly once, anchored to the window.
    expect(mockElectron.Menu._popup).toHaveBeenCalledTimes(1);
    expect(mockElectron.Menu._popup.mock.calls[0][0]).toMatchObject({
      window: mockElectron._mockWin,
    });
  });

  // ─ EDITABLE with the INVERSE flag mix — guards against a hard-coded answer ─
  test('editable field → enabled tracks the inverse flag mix too', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();

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

    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    const byRole = Object.fromEntries(
      tpl.filter((i) => i.role).map((i) => [i.role, i.enabled])
    );
    expect(byRole.undo).toBe(false);
    expect(byRole.redo).toBe(true);
    expect(byRole.cut).toBe(false);
    expect(byRole.copy).toBe(true);
    expect(byRole.paste).toBe(false);
    expect(byRole.selectAll).toBe(true);
    expect(mockElectron.Menu._popup).toHaveBeenCalledTimes(1);
  });

  // ─ EDITABLE with missing editFlags → all coerced to false (kills !! drop) ─
  test('editable field with empty editFlags → every role disabled (false)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();

    ctxHandler({}, { isEditable: true, selectionText: '', editFlags: {} });

    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    const roles = tpl.filter((i) => i.role).map((i) => i.role);
    expect(roles).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
    for (const item of tpl.filter((i) => i.role)) {
      expect(item.enabled).toBe(false); // undefined → !! → false
      expect(typeof item.enabled).toBe('boolean');
    }
    // Menu still shows (template non-empty) because editable always adds roles.
    expect(mockElectron.Menu._popup).toHaveBeenCalledTimes(1);
  });

  // ─ NON-EDITABLE + selection → exactly [copy, selectAll] and popup ─
  test('non-editable WITH selection text → template is exactly [copy, selectAll], popup called', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();

    ctxHandler(
      {},
      {
        isEditable: false,
        selectionText: 'x',
        editFlags: { canCopy: true, canSelectAll: false },
      }
    );

    expect(mockElectron.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    const roles = tpl.filter((i) => i.role).map((i) => i.role);
    expect(roles).toEqual(['copy', 'selectAll']);

    // No separators in the non-editable branch.
    expect(tpl.filter((i) => i.type === 'separator')).toHaveLength(0);
    expect(tpl).toHaveLength(2);

    // enabled still tracks the flags here (kills the !! mutants in this branch).
    const byRole = Object.fromEntries(
      tpl.filter((i) => i.role).map((i) => [i.role, i.enabled])
    );
    expect(byRole.copy).toBe(true);        // canCopy:true
    expect(byRole.selectAll).toBe(false);  // canSelectAll:false
    expect(typeof byRole.copy).toBe('boolean');
    expect(typeof byRole.selectAll).toBe('boolean');

    expect(mockElectron.Menu._popup).toHaveBeenCalledTimes(1);
    expect(mockElectron.Menu._popup.mock.calls[0][0]).toMatchObject({
      window: mockElectron._mockWin,
    });
  });

  // ─ NON-EDITABLE + EMPTY selection → no menu, no popup ─
  test('non-editable with empty selection → buildFromTemplate NOT called, popup NOT called', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();

    ctxHandler({}, { isEditable: false, selectionText: '', editFlags: {} });

    expect(mockElectron.Menu.buildFromTemplate).not.toHaveBeenCalled();
    expect(mockElectron.Menu._popup).not.toHaveBeenCalled();
  });

  // ─ NON-EDITABLE + WHITESPACE-ONLY selection → still no menu (trim() branch) ─
  test('non-editable with whitespace-only selection → no menu (kills the .trim() guard mutant)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();

    ctxHandler({}, { isEditable: false, selectionText: '   \t  ', editFlags: {} });

    expect(mockElectron.Menu.buildFromTemplate).not.toHaveBeenCalled();
    expect(mockElectron.Menu._popup).not.toHaveBeenCalled();
  });
});
