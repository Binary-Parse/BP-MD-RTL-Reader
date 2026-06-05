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

import { describe, test, expect, beforeAll, vi } from 'vitest';
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

  // ─ icon path (L438 StringLiteral) — assert the FULL "assets/icon.ico" tail ─
  test('icon is an absolute path ending with "assets/icon.ico"', () => {
    expect(typeof opts.icon).toBe('string');
    expect(opts.icon.length).toBeGreaterThan('assets/icon.ico'.length);
    // Tolerate either path separator; pin BOTH segments so the 'assets'→"" and
    // 'icon.ico'→"" StringLiteral mutants both die (a bare '/icon.ico' endsWith
    // check would miss the 'assets' mutant since path.join collapses the empty seg).
    const normalized = opts.icon.replace(/\\/g, '/');
    expect(normalized.endsWith('/assets/icon.ico')).toBe(true);
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

  // ─ NON-EDITABLE + EMPTY selection → menu shown, Copy disabled (T-B12) ─
  test('non-editable with empty selection → menu shown with [copy(disabled), selectAll]', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();

    ctxHandler({}, { isEditable: false, selectionText: '', editFlags: { canSelectAll: true } });

    expect(mockElectron.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    const byRole = Object.fromEntries(tpl.filter(i => i.role).map(i => [i.role, i.enabled]));
    expect(Object.keys(byRole)).toEqual(['copy', 'selectAll']);
    expect(byRole.copy).toBe(false);
    expect(byRole.selectAll).toBe(true);
    expect(mockElectron.Menu._popup).toHaveBeenCalledTimes(1);
  });

  // ─ NON-EDITABLE + WHITESPACE-ONLY selection → Copy disabled (kills .trim() mutant) ─
  test('non-editable with whitespace-only selection → Copy disabled', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.Menu._popup.mockClear();

    ctxHandler({}, { isEditable: false, selectionText: '   \t  ', editFlags: { canCopy: true, canSelectAll: true } });

    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    const byRole = Object.fromEntries(tpl.filter(i => i.role).map(i => [i.role, i.enabled]));
    expect(byRole.copy).toBe(false);
    expect(byRole.selectAll).toBe(true);
    expect(mockElectron.Menu._popup).toHaveBeenCalledTimes(1);
  });

  // ─ LINK right-click → Open/Copy link items (T-B12) ─
  test('link right-click → Open Link in Browser + Copy Link Address', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.shell.openExternal.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://example.com', editFlags: { canSelectAll: true } });
    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    const labels = tpl.filter(i => i.label).map(i => i.label);
    expect(labels).toContain('Open Link in Browser');
    expect(labels).toContain('Copy Link Address');
    tpl.find(i => i.label === 'Open Link in Browser').click();
    expect(mockElectron.shell.openExternal).toHaveBeenCalledWith('https://example.com');
    tpl.find(i => i.label === 'Copy Link Address').click();
    expect(mockElectron.clipboard.writeText).toHaveBeenCalledWith('https://example.com');
  });

  test('non-http link → Open does not call openExternal', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.shell.openExternal.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'javascript:alert(1)', editFlags: {} });
    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls[0][0];
    expect(tpl.some(i => i.label === 'Open Link in Browser')).toBe(false);
  });
});

// ── runContextAction side-effects (L51-79) — kill the per-action guard mutants ─
// These click the action items the template wires (click → runContextAction(d, params, win))
// and pin the EXACT side-effect, so the per-case guards (L55/L59/L62/L71) can't be
// forced-true or have their && weakened without an assertion failing.
describe('main.js — runContextAction (context-menu clicks)', () => {
  let mockElectron;
  let ctxHandler;

  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'context-menu') ctxHandler = fn;
    });
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'main.js']) });
    await new Promise((r) => setTimeout(r, 50));
  });

  const clickLabel = (label) => {
    const tpl = mockElectron.Menu.buildFromTemplate.mock.calls.at(-1)[0];
    const item = tpl.find((i) => i.label === label);
    expect(item, `menu item "${label}" should exist`).toBeTruthy();
    item.click();
    return item;
  };

  // L55: open-link only opens an EXTERNALLY-OPENABLE url.
  test('open-link with an http url → shell.openExternal(url)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.shell.openExternal.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://ok.example/p', editFlags: {} });
    clickLabel('Open Link in Browser');
    expect(mockElectron.shell.openExternal).toHaveBeenCalledTimes(1);
    expect(mockElectron.shell.openExternal).toHaveBeenCalledWith('https://ok.example/p');
  });

  // L59: copy-link only writes when d.url is present (it always is for a link item).
  test('copy-link → clipboard.writeText(url) exactly once', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.clipboard.writeText.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', linkURL: 'https://copy.example', editFlags: {} });
    clickLabel('Copy Link Address');
    expect(mockElectron.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(mockElectron.clipboard.writeText).toHaveBeenCalledWith('https://copy.example');
  });

  // L59 (copy-image-address shares the case): writes the srcURL.
  test('copy-image-address → clipboard.writeText(srcURL)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron.clipboard.writeText.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', srcURL: 'https://img.example/a.png', editFlags: {} });
    clickLabel('Copy Image Address');
    expect(mockElectron.clipboard.writeText).toHaveBeenCalledWith('https://img.example/a.png');
  });

  // L62: copy-image requires BOTH params.x AND params.y to be non-null.
  test('copy-image with both x AND y → webContents.copyImageAt(x, y)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron._mockWin.webContents.copyImageAt.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', x: 12, y: 34, editFlags: {} });
    clickLabel('Copy Image');
    expect(mockElectron._mockWin.webContents.copyImageAt).toHaveBeenCalledTimes(1);
    expect(mockElectron._mockWin.webContents.copyImageAt).toHaveBeenCalledWith(12, 34);
  });

  test('copy-image with x present but y MISSING → copyImageAt NOT called (kills && → ||)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron._mockWin.webContents.copyImageAt.mockClear();
    // y is null → the && guard is false; an || mutant (or forced-true) would still call.
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', x: 12, y: null, editFlags: {} });
    clickLabel('Copy Image');
    expect(mockElectron._mockWin.webContents.copyImageAt).not.toHaveBeenCalled();
  });

  test('copy-image with y present but x MISSING → copyImageAt NOT called', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron._mockWin.webContents.copyImageAt.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', x: null, y: 34, editFlags: {} });
    clickLabel('Copy Image');
    expect(mockElectron._mockWin.webContents.copyImageAt).not.toHaveBeenCalled();
  });

  test('copy-image with x=0 and y=0 → copyImageAt(0,0) (0 is != null, not falsy-rejected)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron._mockWin.webContents.copyImageAt.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', x: 0, y: 0, editFlags: {} });
    clickLabel('Copy Image');
    expect(mockElectron._mockWin.webContents.copyImageAt).toHaveBeenCalledWith(0, 0);
  });

  // save-image: external-openable srcURL → downloadURL.
  test('save-image with an http srcURL → webContents.downloadURL(srcURL)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron._mockWin.webContents.downloadURL.mockClear();
    ctxHandler({}, { isEditable: false, selectionText: '', mediaType: 'image', srcURL: 'https://img.example/b.png', editFlags: {} });
    clickLabel('Save Image');
    expect(mockElectron._mockWin.webContents.downloadURL).toHaveBeenCalledWith('https://img.example/b.png');
  });

  // replace-misspelling: clicking a suggestion calls replaceMisspelling(s).
  test('replace-misspelling → webContents.replaceMisspelling(suggestion)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron._mockWin.webContents.replaceMisspelling.mockClear();
    ctxHandler({}, {
      isEditable: true, selectionText: '', misspelledWord: 'teh',
      dictionarySuggestions: ['the'], editFlags: {},
    });
    clickLabel('the');
    expect(mockElectron._mockWin.webContents.replaceMisspelling).toHaveBeenCalledWith('the');
  });

  // L71: add-to-dictionary only runs when session.addWordToSpellCheckerDictionary exists.
  test('add-to-dictionary → session.addWordToSpellCheckerDictionary(word) when available', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    mockElectron._mockWin.webContents.session.addWordToSpellCheckerDictionary.mockClear();
    ctxHandler({}, {
      isEditable: true, selectionText: '', misspelledWord: 'recieve',
      dictionarySuggestions: [], editFlags: {},
    });
    clickLabel('Add to Dictionary');
    expect(mockElectron._mockWin.webContents.session.addWordToSpellCheckerDictionary)
      .toHaveBeenCalledWith('recieve');
  });

  test('add-to-dictionary is a no-op (no throw) when the spellchecker API is absent (L71 guard)', () => {
    mockElectron.Menu.buildFromTemplate.mockClear();
    const realSession = mockElectron._mockWin.webContents.session;
    mockElectron._mockWin.webContents.session = {}; // no addWordToSpellCheckerDictionary
    try {
      ctxHandler({}, {
        isEditable: true, selectionText: '', misspelledWord: 'wierd',
        dictionarySuggestions: [], editFlags: {},
      });
      expect(() => clickLabel('Add to Dictionary')).not.toThrow();
    } finally {
      mockElectron._mockWin.webContents.session = realSession;
    }
  });
});

// ── NAVIGATION GUARD (T-B11) ───────────────────────────────────────────────
describe('main.js — navigation guard', () => {
  let mockElectron;
  let navHandler;
  let redirectHandler;
  beforeAll(async () => {
    mockElectron = buildMockElectron();
    mockElectron._mockWin.webContents.on.mockImplementation((event, fn) => {
      if (event === 'will-navigate') navHandler = fn;
      if (event === 'will-redirect') redirectHandler = fn;
    });
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'main.js']) });
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
    const appHref = require('url').pathToFileURL(require('path').join(process.cwd(), 'index.html')).href;
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
describe('main.js — createWindow display fallback (L427)', () => {
  test('no screen.getAllDisplays → falls back to [] displays and DEFAULT bounds (no x/y, no crash)', async () => {
    const mockElectron = buildMockElectron();
    mockElectron.screen = {}; // screen present but getAllDisplays NOT a function
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'main.js']) });
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
describe('main.js — renderer sandbox', () => {
  test('sandbox:true on BrowserWindow', async () => {
    const mockElectron = buildMockElectron();
    bootstrap({ electron: mockElectron, fs: buildMockFs(), proc: buildMockProc(['node', 'main.js']) });
    await new Promise((r) => setTimeout(r, 50));
    const opts = mockElectron.BrowserWindow.mock.calls[0][0];
    expect(opts.webPreferences.sandbox).toBe(true);
    expect(opts.webPreferences.contextIsolation).toBe(true);
    expect(opts.webPreferences.nodeIntegration).toBe(false);
  });
});
