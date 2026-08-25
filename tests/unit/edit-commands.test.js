/**
 * Unit tests for src/renderer/editor/edit-commands.js
 *
 * Coverage goal: 100 % line on the module.
 * Mutation goal: ≥ 90 % via Stryker (already in mutate scope).
 *
 * The module takes ALL dependencies via a `deps` object so every branch is
 * exercised with a synthetic deps. No DOM, no real clipboard, no Electron.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { execEditCmd, _internal } from '../../src/renderer/editor/edit-commands.js';

// ── helpers ─────────────────────────────────────────────────────────────────
function makeTextarea(value = 'hello world', start = 0, end = 0) {
  const ta = {
    tagName: 'TEXTAREA',
    value,
    selectionStart: start,
    selectionEnd: end,
    isConnected: true,
    focus: vi.fn(),
    select: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  return ta;
}

function makeRange() {
  return { selectNodeContents: vi.fn() };
}

function makeSelection(text = '') {
  return {
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
    toString: () => text,
  };
}

function makeClipboard({ writeOk = true, readText = '' } = {}) {
  return {
    writeText: vi.fn(() => writeOk ? Promise.resolve() : Promise.reject(new Error('denied'))),
    readText: vi.fn(() => Promise.resolve(readText)),
  };
}

function makeDeps(overrides = {}) {
  const ta = overrides.srcTextarea || makeTextarea();
  return {
    electronAPI: null,
    getMode: () => 'source',
    getSrcTextarea: () => ta,
    getNoteContent: () => ({ tagName: 'DIV' }),
    getLastFocusedEditable: () => null,
    getActiveElement: () => ta,
    getSelection: () => makeSelection(),
    createRange: () => makeRange(),
    clipboard: makeClipboard(),
    showToast: vi.fn(),
    closeMenu: vi.fn(),
    ...overrides,
  };
}

// ── dispatcher contract ─────────────────────────────────────────────────────
describe('execEditCmd — dispatcher', () => {
  test('rejects unknown commands', () => {
    expect(execEditCmd('bogus', makeDeps())).toEqual({ ok: false, reason: 'unknown-cmd' });
    expect(execEditCmd('', makeDeps())).toEqual({ ok: false, reason: 'unknown-cmd' });
    expect(execEditCmd(null, makeDeps())).toEqual({ ok: false, reason: 'unknown-cmd' });
    expect(execEditCmd(undefined, makeDeps())).toEqual({ ok: false, reason: 'unknown-cmd' });
  });

  // L195 guard is NOT equivalent to the L117 forwardOrFallback fallthrough.
  // The L117 fallthrough is only reached AFTER the electronAPI branch (L95-99).
  // If the L195 guard were removed, an unknown cmd with a live electronAPI would
  // be forwarded as editCommand('bogus') → {ok:true,reason:'ipc'} instead of
  // being rejected. This test fixes the guard as load-bearing (kills the
  // "remove the guard" equivalent-mutant claim).
  test('L195 guard: unknown command is rejected BEFORE reaching electronAPI', () => {
    const electronAPI = { editCommand: vi.fn() };
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI, srcTextarea: ta });
    expect(execEditCmd('bogus', deps)).toEqual({ ok: false, reason: 'unknown-cmd' });
    // Must NOT have been forwarded to the native command (would select/IPC garbage).
    expect(electronAPI.editCommand).not.toHaveBeenCalled();
    expect(ta.focus).not.toHaveBeenCalled();
  });

  test('VALID_CMDS list is exactly the six expected commands', () => {
    expect(_internal.VALID_CMDS).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  });

  test('isField recognises TEXTAREA and INPUT only', () => {
    expect(_internal.isField({ tagName: 'TEXTAREA' })).toBe(true);
    expect(_internal.isField({ tagName: 'INPUT' })).toBe(true);
    expect(_internal.isField({ tagName: 'DIV' })).toBe(false);
    expect(_internal.isField(null)).toBe(false);
    expect(_internal.isField(undefined)).toBe(false);
  });

  test('resolveTarget prefers active element when it is a field', () => {
    const ae = makeTextarea();
    const last = makeTextarea();
    expect(_internal.resolveTarget({
      getActiveElement: () => ae,
      getLastFocusedEditable: () => last,
    })).toBe(ae);
  });

  test('resolveTarget falls back to lastFocusedEditable when active is not a field', () => {
    const last = makeTextarea();
    expect(_internal.resolveTarget({
      getActiveElement: () => ({ tagName: 'DIV' }),
      getLastFocusedEditable: () => last,
    })).toBe(last);
  });

  test('resolveTarget returns null when neither is a field', () => {
    expect(_internal.resolveTarget({
      getActiveElement: () => ({ tagName: 'DIV' }),
      getLastFocusedEditable: () => ({ tagName: 'DIV' }),
    })).toBe(null);
  });
});

// ── selectAll ───────────────────────────────────────────────────────────────
describe('selectAll', () => {
  test('source mode: focuses + selects srcTextarea', () => {
    const ta = makeTextarea('text');
    const deps = makeDeps({ getMode: () => 'source', srcTextarea: ta });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: true });
    expect(ta.focus).toHaveBeenCalled();
    expect(ta.select).toHaveBeenCalled();
    expect(deps.closeMenu).toHaveBeenCalled();
  });

  test('split mode: same as source — focuses srcTextarea', () => {
    const ta = makeTextarea();
    const deps = makeDeps({ getMode: () => 'split', srcTextarea: ta });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: true });
    expect(ta.select).toHaveBeenCalled();
  });

  test('live mode: scopes selection to noteContent via Range API', () => {
    const noteContent = { tagName: 'DIV' };
    const range = makeRange();
    const sel = makeSelection();
    const deps = makeDeps({
      getMode: () => 'live',
      getNoteContent: () => noteContent,
      getSelection: () => sel,
      createRange: () => range,
    });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: true });
    expect(sel.removeAllRanges).toHaveBeenCalled();
    expect(range.selectNodeContents).toHaveBeenCalledWith(noteContent);
    expect(sel.addRange).toHaveBeenCalledWith(range);
  });

  test('live mode: ok=false when noteContent is null', () => {
    const deps = makeDeps({ getMode: () => 'live', getNoteContent: () => null });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: false, reason: 'no-editor' });
  });

  test('live mode: ok=false when window.getSelection() returns null', () => {
    const deps = makeDeps({ getMode: () => 'live', getSelection: () => null });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: false, reason: 'no-editor' });
  });

  test('source mode: ok=false when srcTextarea is null', () => {
    const deps = makeDeps({ getMode: () => 'source', getSrcTextarea: () => null });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: false, reason: 'no-editor' });
  });

  test('CRITICAL: selectAll NEVER routes through electronAPI (would select whole DOM)', () => {
    const electronAPI = { editCommand: vi.fn() };
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI, srcTextarea: ta });
    execEditCmd('selectAll', deps);
    expect(electronAPI.editCommand).not.toHaveBeenCalled();
    expect(ta.select).toHaveBeenCalled();
  });

  test('selectAll uses default mode "source" when getMode is missing', () => {
    const ta = makeTextarea();
    const deps = makeDeps({ srcTextarea: ta });
    delete deps.getMode;
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: true });
    expect(ta.select).toHaveBeenCalled();
  });
});

// ── selectAll is routed by VIEW mode (reading/edit), not editor mode ────────
// Reading mode shows the rendered #noteContent and hides the CM6 surface (T-F17); CM6
// mounts unconditionally on launch, so a CM6 adapter can exist even while it is not the
// visible surface. selectAll must always check view mode BEFORE ever touching CM6.
describe('selectAll — routed by view mode, not editor mode (v10 redesign)', () => {
  test('reading mode selects noteContent even when a CM6 adapter exists', () => {
    const cm = makeCmAdapter();
    const noteContent = { tagName: 'DIV' };
    const range = makeRange();
    const sel = makeSelection();
    const deps = makeDeps({
      getViewMode: () => 'reading',
      hasDocument: () => true,
      getCmAdapter: () => cm,
      getNoteContent: () => noteContent,
      getSelection: () => sel,
      createRange: () => range,
    });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: true });
    expect(sel.removeAllRanges).toHaveBeenCalled();
    expect(range.selectNodeContents).toHaveBeenCalledWith(noteContent);
    expect(sel.addRange).toHaveBeenCalledWith(range);
  });

  test('reading mode never focuses the hidden CM6 surface', () => {
    const cm = makeCmAdapter();
    const deps = makeDeps({
      getViewMode: () => 'reading',
      hasDocument: () => true,
      getCmAdapter: () => cm,
      getNoteContent: () => ({ tagName: 'DIV' }),
    });
    execEditCmd('selectAll', deps);
    expect(cm.focus).not.toHaveBeenCalled();
    expect(cm.selectAll).not.toHaveBeenCalled();
  });

  test('no open document → ok:false, reason:no-editor, and no CM6 focus', () => {
    const cm = makeCmAdapter();
    const deps = makeDeps({ hasDocument: () => false, getCmAdapter: () => cm });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: false, reason: 'no-editor' });
    expect(cm.focus).not.toHaveBeenCalled();
  });

  test('no open document clears any stray selection instead of leaving it in place', () => {
    // Regression: right-clicking chrome text (e.g. the titlebar) makes Chromium natively
    // pre-select that word for its own context-menu "Copy" affordance, independent of
    // anything this app does. With no document open there is nothing to replace it WITH,
    // but selectAll must not leave that stray selection sitting in the chrome.
    const sel = makeSelection();
    const deps = makeDeps({ hasDocument: () => false, getSelection: () => sel });
    execEditCmd('selectAll', deps);
    expect(sel.removeAllRanges).toHaveBeenCalled();
  });

  test('edit mode still routes to CM6 when a document is open', () => {
    const cm = makeCmAdapter();
    const deps = makeDeps({ getViewMode: () => 'edit', hasDocument: () => true, getCmAdapter: () => cm });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: true });
    expect(cm.focus).toHaveBeenCalled();
    expect(cm.selectAll).toHaveBeenCalled();
  });
});

// ── undo / redo ─────────────────────────────────────────────────────────────
describe('undo / redo', () => {
  beforeEach(() => {
    // execEditCmd's fallback path for undo/redo calls document.execCommand.
    // jsdom doesn't have a usable execCommand; stub it.
    if (typeof document === 'undefined') {
      global.document = { execCommand: vi.fn() };
    } else {
      document.execCommand = vi.fn();
    }
  });

  test('forwards to electronAPI.editCommand("undo") AFTER focus restore', () => {
    const electronAPI = { editCommand: vi.fn() };
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI, srcTextarea: ta });
    const result = execEditCmd('undo', deps);
    expect(result).toEqual({ ok: true, reason: 'ipc' });
    expect(ta.focus).toHaveBeenCalled();
    expect(electronAPI.editCommand).toHaveBeenCalledWith('undo');
    // Focus restore MUST happen before the IPC, not after.
    const focusOrder = ta.focus.mock.invocationCallOrder[0];
    const ipcOrder = electronAPI.editCommand.mock.invocationCallOrder[0];
    expect(focusOrder).toBeLessThan(ipcOrder);
  });

  test('forwards to electronAPI.editCommand("redo")', () => {
    const electronAPI = { editCommand: vi.fn() };
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI, srcTextarea: ta });
    expect(execEditCmd('redo', deps)).toEqual({ ok: true, reason: 'ipc' });
    expect(electronAPI.editCommand).toHaveBeenCalledWith('redo');
  });

  test('electronAPI path: no target → still IPCs (focus restore skipped)', () => {
    const electronAPI = { editCommand: vi.fn() };
    const deps = makeDeps({
      electronAPI,
      getActiveElement: () => null,
      getLastFocusedEditable: () => null,
    });
    expect(execEditCmd('undo', deps)).toEqual({ ok: true, reason: 'ipc' });
    expect(electronAPI.editCommand).toHaveBeenCalledWith('undo');
  });

  test('fallback (no electronAPI): undo runs document.execCommand on target', () => {
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta });
    execEditCmd('undo', deps);
    expect(ta.focus).toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith('undo');
  });

  test('fallback: redo runs document.execCommand("redo")', () => {
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta });
    execEditCmd('redo', deps);
    expect(document.execCommand).toHaveBeenCalledWith('redo');
  });

  test('fallback + no target: ok=false reason=no-editor', () => {
    const deps = makeDeps({
      electronAPI: null,
      getActiveElement: () => null,
      getLastFocusedEditable: () => null,
    });
    expect(execEditCmd('undo', deps)).toEqual({ ok: false, reason: 'no-editor' });
    expect(execEditCmd('redo', deps)).toEqual({ ok: false, reason: 'no-editor' });
  });

  test('fallback: execCommand throw is silently swallowed', () => {
    const ta = makeTextarea();
    document.execCommand = vi.fn(() => { throw new Error('not-supported'); });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta });
    expect(() => execEditCmd('undo', deps)).not.toThrow();
  });
});

// ── copy ────────────────────────────────────────────────────────────────────
describe('copy', () => {
  test('IPC path: focuses target, calls editCommand("copy")', () => {
    const electronAPI = { editCommand: vi.fn() };
    const ta = makeTextarea('hello', 0, 5);
    const deps = makeDeps({ electronAPI, srcTextarea: ta });
    expect(execEditCmd('copy', deps)).toEqual({ ok: true, reason: 'ipc' });
    expect(ta.focus).toHaveBeenCalled();
    expect(electronAPI.editCommand).toHaveBeenCalledWith('copy');
  });

  test('fallback: copies selected text from textarea via clipboard.writeText', () => {
    const ta = makeTextarea('hello world', 6, 11);
    const clipboard = makeClipboard();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    expect(execEditCmd('copy', deps)).toEqual({ ok: true });
    expect(clipboard.writeText).toHaveBeenCalledWith('world');
  });

  test('fallback: empty selection → ok=false reason=no-selection', () => {
    const ta = makeTextarea('hello', 3, 3);
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta });
    expect(execEditCmd('copy', deps)).toEqual({ ok: false, reason: 'no-selection' });
  });

  test('fallback: no target + non-empty window.getSelection → copies that text', () => {
    const sel = makeSelection('selected text');
    const clipboard = makeClipboard();
    const deps = makeDeps({
      electronAPI: null,
      getActiveElement: () => null,
      getLastFocusedEditable: () => null,
      getSelection: () => sel,
      clipboard,
    });
    expect(execEditCmd('copy', deps)).toEqual({ ok: true });
    expect(clipboard.writeText).toHaveBeenCalledWith('selected text');
  });

  test('fallback: no target + empty window.getSelection → ok=false', () => {
    const deps = makeDeps({
      electronAPI: null,
      getActiveElement: () => null,
      getLastFocusedEditable: () => null,
      getSelection: () => makeSelection(''),
    });
    expect(execEditCmd('copy', deps)).toEqual({ ok: false, reason: 'no-selection' });
  });

  test('fallback: clipboard.writeText rejection triggers showToast', async () => {
    const ta = makeTextarea('hi', 0, 2);
    const clipboard = makeClipboard({ writeOk: false });
    const toast = vi.fn();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard, showToast: toast });
    execEditCmd('copy', deps);
    await new Promise(r => setTimeout(r, 5));
    expect(toast).toHaveBeenCalledWith('Copy failed', 'error');
  });

  test('fallback: no clipboard at all → still returns ok=true (no write)', () => {
    const ta = makeTextarea('hi', 0, 2);
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard: null });
    expect(execEditCmd('copy', deps)).toEqual({ ok: true });
  });
});

// ── cut ─────────────────────────────────────────────────────────────────────
describe('cut', () => {
  test('IPC path: focuses + IPCs', () => {
    const electronAPI = { editCommand: vi.fn() };
    const ta = makeTextarea('text', 0, 4);
    const deps = makeDeps({ electronAPI, srcTextarea: ta });
    execEditCmd('cut', deps);
    expect(electronAPI.editCommand).toHaveBeenCalledWith('cut');
  });

  test('fallback: removes selection from textarea + writes to clipboard + fires input', () => {
    const ta = makeTextarea('hello world', 5, 11);
    const clipboard = makeClipboard();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    expect(execEditCmd('cut', deps)).toEqual({ ok: true });
    expect(clipboard.writeText).toHaveBeenCalledWith(' world');
    expect(ta.value).toBe('hello');
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
    expect(ta.dispatchEvent).toHaveBeenCalled();
  });

  test('fallback: empty selection → ok=false reason=no-selection, value unchanged', () => {
    const ta = makeTextarea('hello', 2, 2);
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta });
    expect(execEditCmd('cut', deps)).toEqual({ ok: false, reason: 'no-selection' });
    expect(ta.value).toBe('hello');
  });

  test('fallback: live mode → preview-readonly + toast', () => {
    const ta = makeTextarea('x', 0, 1);
    const toast = vi.fn();
    const deps = makeDeps({
      electronAPI: null,
      getMode: () => 'live',
      srcTextarea: ta,
      showToast: toast,
    });
    expect(execEditCmd('cut', deps)).toEqual({ ok: false, reason: 'preview-readonly' });
    expect(toast).toHaveBeenCalledWith('Cut not supported in preview', 'info');
  });

  test('fallback: no target → ok=false', () => {
    const deps = makeDeps({
      electronAPI: null,
      getActiveElement: () => null,
      getLastFocusedEditable: () => null,
    });
    expect(execEditCmd('cut', deps)).toEqual({ ok: false, reason: 'no-editor' });
  });

  test('fallback: clipboard write failure still mutates textarea (best-effort)', async () => {
    const ta = makeTextarea('abc', 0, 3);
    const clipboard = makeClipboard({ writeOk: false });
    const toast = vi.fn();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard, showToast: toast });
    execEditCmd('cut', deps);
    await new Promise(r => setTimeout(r, 5));
    expect(toast).toHaveBeenCalledWith('Cut failed', 'error');
    expect(ta.value).toBe(''); // textarea was still mutated
  });

  // L144: cut with getMode ABSENT defaults to 'source' (NOT 'live'), so the cut
  // proceeds (mutates the textarea) instead of returning preview-readonly.
  // Kills the no-coverage mutants on `deps.getMode ? deps.getMode() : 'source'`.
  test('fallback: getMode ABSENT → defaults to "source", cut proceeds', () => {
    const ta = makeTextarea('hello world', 5, 11);
    const clipboard = makeClipboard();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    delete deps.getMode;
    expect(execEditCmd('cut', deps)).toEqual({ ok: true });
    expect(clipboard.writeText).toHaveBeenCalledWith(' world');
    expect(ta.value).toBe('hello'); // proved it did NOT short-circuit as preview-readonly
  });
});

// ── paste ───────────────────────────────────────────────────────────────────
describe('paste', () => {
  test('IPC path: focuses + IPCs', () => {
    const electronAPI = { editCommand: vi.fn() };
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI, srcTextarea: ta });
    execEditCmd('paste', deps);
    expect(electronAPI.editCommand).toHaveBeenCalledWith('paste');
  });

  test('fallback: inserts clipboard text at cursor + fires input', async () => {
    const ta = makeTextarea('hello world', 5, 5);
    const clipboard = makeClipboard({ readText: ',cruel,' });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    execEditCmd('paste', deps);
    await new Promise(r => setTimeout(r, 5));
    expect(ta.value).toBe('hello,cruel, world');
    expect(ta.selectionStart).toBe(12);
    expect(ta.selectionEnd).toBe(12);
    expect(ta.dispatchEvent).toHaveBeenCalled();
  });

  test('fallback: REPLACES the selected range', async () => {
    const ta = makeTextarea('hello world', 6, 11);
    const clipboard = makeClipboard({ readText: 'CRUEL' });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    execEditCmd('paste', deps);
    await new Promise(r => setTimeout(r, 5));
    expect(ta.value).toBe('hello CRUEL');
  });

  test('fallback: live mode → preview-readonly + toast', () => {
    const ta = makeTextarea();
    const toast = vi.fn();
    const deps = makeDeps({
      electronAPI: null,
      getMode: () => 'live',
      srcTextarea: ta,
      showToast: toast,
    });
    expect(execEditCmd('paste', deps)).toEqual({ ok: false, reason: 'preview-readonly' });
    expect(toast).toHaveBeenCalledWith('Paste not supported in preview', 'info');
  });

  test('fallback: no clipboard → ok=false + toast', () => {
    const ta = makeTextarea();
    const toast = vi.fn();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard: null, showToast: toast });
    expect(execEditCmd('paste', deps)).toEqual({ ok: false, reason: 'no-clipboard' });
    expect(toast).toHaveBeenCalledWith('Paste not supported in this context', 'info');
  });

  test('fallback: clipboard without readText → ok=false', () => {
    const ta = makeTextarea();
    const deps = makeDeps({
      electronAPI: null,
      srcTextarea: ta,
      clipboard: { writeText: vi.fn() },
    });
    expect(execEditCmd('paste', deps)).toEqual({ ok: false, reason: 'no-clipboard' });
  });

  test('fallback: readText rejection → toast "Paste failed"', async () => {
    const ta = makeTextarea();
    const clipboard = {
      writeText: vi.fn(),
      readText: vi.fn(() => Promise.reject(new Error('denied'))),
    };
    const toast = vi.fn();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard, showToast: toast });
    execEditCmd('paste', deps);
    await new Promise(r => setTimeout(r, 5));
    expect(toast).toHaveBeenCalledWith('Paste failed', 'error');
  });

  test('fallback: target detached between request and resolve → silent no-op', async () => {
    const ta = makeTextarea('keep', 0, 0);
    ta.isConnected = false; // detached
    const clipboard = makeClipboard({ readText: 'X' });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    execEditCmd('paste', deps);
    await new Promise(r => setTimeout(r, 5));
    expect(ta.value).toBe('keep'); // not mutated
    expect(ta.focus).not.toHaveBeenCalled();
  });

  test('fallback: no target → ok=false', () => {
    const deps = makeDeps({
      electronAPI: null,
      getActiveElement: () => null,
      getLastFocusedEditable: () => null,
    });
    expect(execEditCmd('paste', deps)).toEqual({ ok: false, reason: 'no-editor' });
  });

  // L166: paste with getMode ABSENT defaults to 'source' (NOT 'live'), so the
  // paste proceeds (inserts clipboard text) instead of returning preview-readonly.
  // Kills the no-coverage mutants on `deps.getMode ? deps.getMode() : 'source'`.
  test('fallback: getMode ABSENT → defaults to "source", paste proceeds', async () => {
    const ta = makeTextarea('hello world', 5, 5);
    const clipboard = makeClipboard({ readText: ',cruel,' });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    delete deps.getMode;
    expect(execEditCmd('paste', deps)).toEqual({ ok: true });
    await new Promise(r => setTimeout(r, 5));
    expect(clipboard.readText).toHaveBeenCalled();
    expect(ta.value).toBe('hello,cruel, world'); // proved it did NOT short-circuit as preview-readonly
  });
});

// ── mutation killers (targeted) ─────────────────────────────────────────────
// Each test names the exact mutant it kills.
describe('mutation killers — return-value invariants', () => {
  test('L111: undo fallback returns exactly { ok: true } (not {} or ok:false)', () => {
    document.execCommand = vi.fn();
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta });
    expect(execEditCmd('undo', deps)).toEqual({ ok: true });
  });

  test('L111: redo fallback returns exactly { ok: true }', () => {
    document.execCommand = vi.fn();
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta });
    expect(execEditCmd('redo', deps)).toEqual({ ok: true });
  });

  test('L191: paste fallback returns exactly { ok: true } (not {} or ok:false)', () => {
    const ta = makeTextarea();
    const clipboard = makeClipboard({ readText: 'x' });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    expect(execEditCmd('paste', deps)).toEqual({ ok: true });
  });

  test('L162/L191: cut fallback returns exactly { ok: true }', () => {
    const ta = makeTextarea('hello', 0, 5);
    const clipboard = makeClipboard();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    expect(execEditCmd('cut', deps)).toEqual({ ok: true });
  });

  test('L161: cut dispatches Event with bubbles:true (kills boolean+object mutants)', () => {
    const ta = makeTextarea('hello', 0, 5);
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta });
    execEditCmd('cut', deps);
    const ev = ta.dispatchEvent.mock.calls[0][0];
    expect(ev.type).toBe('input');
    expect(ev.bubbles).toBe(true);
  });

  test('L187: paste dispatches Event with bubbles:true', async () => {
    const ta = makeTextarea('abc', 0, 0);
    const clipboard = makeClipboard({ readText: 'X' });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    execEditCmd('paste', deps);
    await new Promise(r => setTimeout(r, 30));
    const ev = ta.dispatchEvent.mock.calls[0][0];
    expect(ev.type).toBe('input');
    expect(ev.bubbles).toBe(true);
  });
});

describe('mutation killers — clipboard-absence branches', () => {
  test('L124: copyFromSelection with NO clipboard does not crash and returns ok=true', () => {
    const sel = makeSelection('grabbed');
    const deps = makeDeps({
      electronAPI: null,
      getActiveElement: () => null,
      getLastFocusedEditable: () => null,
      getSelection: () => sel,
      clipboard: null,
    });
    expect(execEditCmd('copy', deps)).toEqual({ ok: true });
  });

  test('L124: copyFromSelection with clipboard but NO writeText fn', () => {
    const sel = makeSelection('x');
    const deps = makeDeps({
      electronAPI: null,
      getActiveElement: () => null,
      getLastFocusedEditable: () => null,
      getSelection: () => sel,
      clipboard: { readText: () => Promise.resolve('') },
    });
    expect(execEditCmd('copy', deps)).toEqual({ ok: true });
  });

  test('L137: copyField with clipboard but NO writeText fn', () => {
    const ta = makeTextarea('hi', 0, 2);
    const deps = makeDeps({
      electronAPI: null,
      srcTextarea: ta,
      clipboard: { readText: () => Promise.resolve('') },
    });
    expect(execEditCmd('copy', deps)).toEqual({ ok: true });
  });

  test('L153: cutField with clipboard but NO writeText still mutates textarea', () => {
    const ta = makeTextarea('hello', 0, 5);
    const deps = makeDeps({
      electronAPI: null,
      srcTextarea: ta,
      clipboard: { readText: () => Promise.resolve('') },
    });
    expect(execEditCmd('cut', deps)).toEqual({ ok: true });
    expect(ta.value).toBe('');
  });

  test('L172: pasteField with clipboard but NO readText fn', () => {
    const ta = makeTextarea();
    const toast = vi.fn();
    const deps = makeDeps({
      electronAPI: null,
      srcTextarea: ta,
      clipboard: { writeText: vi.fn() },
      showToast: toast,
    });
    expect(execEditCmd('paste', deps)).toEqual({ ok: false, reason: 'no-clipboard' });
    expect(toast).toHaveBeenCalledWith('Paste not supported in this context', 'info');
  });
});

describe('mutation killers — showToast-absence branches', () => {
  test('L146: cut in live mode does NOT crash when showToast is missing', () => {
    const ta = makeTextarea('x', 0, 1);
    const deps = makeDeps({ electronAPI: null, getMode: () => 'live', srcTextarea: ta });
    delete deps.showToast;
    expect(() => execEditCmd('cut', deps)).not.toThrow();
    expect(execEditCmd('cut', deps)).toEqual({ ok: false, reason: 'preview-readonly' });
  });

  test('L168: paste in live mode does NOT crash when showToast is missing', () => {
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI: null, getMode: () => 'live', srcTextarea: ta });
    delete deps.showToast;
    expect(execEditCmd('paste', deps)).toEqual({ ok: false, reason: 'preview-readonly' });
  });

  test('L172: paste with no clipboard + no showToast does NOT crash', () => {
    const ta = makeTextarea();
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard: null });
    delete deps.showToast;
    expect(execEditCmd('paste', deps)).toEqual({ ok: false, reason: 'no-clipboard' });
  });

  test('L155: cut clipboard.writeText rejection without showToast does NOT crash', async () => {
    const ta = makeTextarea('abc', 0, 3);
    const clipboard = makeClipboard({ writeOk: false });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    delete deps.showToast;
    expect(() => execEditCmd('cut', deps)).not.toThrow();
    await new Promise(r => setTimeout(r, 30));
    // No assertion on toast; just confirms no crash.
    expect(ta.value).toBe('');
  });

  test('L189: paste readText rejection without showToast does NOT crash', async () => {
    const ta = makeTextarea();
    const clipboard = {
      writeText: vi.fn(),
      readText: vi.fn(() => Promise.reject(new Error('denied'))),
    };
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    delete deps.showToast;
    expect(() => execEditCmd('paste', deps)).not.toThrow();
    await new Promise(r => setTimeout(r, 30));
  });

  test('L137: copy clipboard.writeText rejection without showToast does NOT crash', async () => {
    const ta = makeTextarea('hi', 0, 2);
    const clipboard = makeClipboard({ writeOk: false });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    delete deps.showToast;
    expect(() => execEditCmd('copy', deps)).not.toThrow();
    await new Promise(r => setTimeout(r, 30));
  });

  test('L126: copyFromSelection rejection without showToast does NOT crash', async () => {
    const sel = makeSelection('text');
    const clipboard = makeClipboard({ writeOk: false });
    const deps = makeDeps({
      electronAPI: null,
      getActiveElement: () => null,
      getLastFocusedEditable: () => null,
      getSelection: () => sel,
      clipboard,
    });
    delete deps.showToast;
    expect(() => execEditCmd('copy', deps)).not.toThrow();
    await new Promise(r => setTimeout(r, 30));
  });
});

describe('mutation killers — async path / isConnected guard', () => {
  test('L195: paste DOES mutate when target.isConnected is true (default)', async () => {
    const ta = makeTextarea('keep', 0, 0);
    // ta.isConnected defaults to true in makeTextarea
    const clipboard = makeClipboard({ readText: 'X' });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    execEditCmd('paste', deps);
    await new Promise(r => setTimeout(r, 50));
    expect(ta.value).toBe('Xkeep');
    expect(ta.focus).toHaveBeenCalled();
  });

  test('L195: paste does NOT mutate when target.isConnected is false', async () => {
    const ta = makeTextarea('keep', 0, 0);
    ta.isConnected = false;
    const clipboard = makeClipboard({ readText: 'X' });
    const deps = makeDeps({ electronAPI: null, srcTextarea: ta, clipboard });
    execEditCmd('paste', deps);
    await new Promise(r => setTimeout(r, 50));
    expect(ta.value).toBe('keep');
    expect(ta.focus).not.toHaveBeenCalled();
    expect(ta.dispatchEvent).not.toHaveBeenCalled();
  });
});

// ── menu lifecycle ──────────────────────────────────────────────────────────
describe('menu lifecycle', () => {
  test('every command calls closeMenu() before doing work', () => {
    for (const cmd of _internal.VALID_CMDS) {
      const closeMenu = vi.fn();
      const deps = makeDeps({ closeMenu });
      execEditCmd(cmd, deps);
      expect(closeMenu, `cmd: ${cmd}`).toHaveBeenCalled();
    }
  });

  test('missing closeMenu in deps does NOT crash any command', () => {
    for (const cmd of _internal.VALID_CMDS) {
      const deps = makeDeps();
      delete deps.closeMenu;
      expect(() => execEditCmd(cmd, deps), `cmd: ${cmd}`).not.toThrow();
    }
  });
});

// ── CM6 path (T-F13): when getCmAdapter() returns an adapter, all commands act on CM6. ──
function makeCmAdapter({ value = 'hello world', start = 0, end = 0 } = {}) {
  const state = { value, start, end };
  return {
    _state: state,
    focus: vi.fn(),
    selectAll: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    getSelection: vi.fn(() => ({ start: state.start, end: state.end })),
    getValue: vi.fn(() => state.value),
    setSelection: vi.fn(({ start, end }) => { state.start = start; state.end = end == null ? start : end; }),
    replaceSelection: vi.fn((text) => {
      state.value = state.value.slice(0, state.start) + text + state.value.slice(state.end);
      state.start = state.end = state.start + text.length;
    }),
  };
}
function cmDeps(cm, overrides = {}) {
  return makeDeps({ getCmAdapter: () => cm, ...overrides });
}

describe('cmEdit — CM6 is the active editor (T-F13)', () => {
  test('no adapter → returns null path → falls through to legacy textarea handler', () => {
    // getCmAdapter absent/null: selectAll still works via the legacy textarea branch.
    const ta = makeTextarea('abc', 0, 0);
    const deps = makeDeps({ getCmAdapter: () => null, getMode: () => 'source', srcTextarea: ta });
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: true });
    expect(ta.select).toHaveBeenCalled(); // proves legacy path ran, not CM6
  });

  test('selectAll routes to cm.selectAll(), closes menu, focuses', () => {
    const cm = makeCmAdapter();
    const deps = cmDeps(cm);
    expect(execEditCmd('selectAll', deps)).toEqual({ ok: true });
    expect(cm.focus).toHaveBeenCalled();
    expect(cm.selectAll).toHaveBeenCalled();
    expect(deps.closeMenu).toHaveBeenCalled();
  });

  test('undo/redo in Electron forward to native editCommand (CM6 handles historyUndo/Redo)', () => {
    for (const cmd of ['undo', 'redo']) {
      const cm = makeCmAdapter();
      const editCommand = vi.fn();
      const deps = cmDeps(cm, { electronAPI: { editCommand } });
      expect(execEditCmd(cmd, deps)).toEqual({ ok: true, reason: 'ipc' });
      expect(editCommand).toHaveBeenCalledWith(cmd);
      expect(cm.undo).not.toHaveBeenCalled(); // native path, not the adapter command
      expect(cm.redo).not.toHaveBeenCalled();
    }
  });

  test('undo/redo without Electron fall back to the CM6 history commands', () => {
    const cmU = makeCmAdapter();
    expect(execEditCmd('undo', cmDeps(cmU, { electronAPI: null }))).toEqual({ ok: true });
    expect(cmU.undo).toHaveBeenCalled();
    const cmR = makeCmAdapter();
    expect(execEditCmd('redo', cmDeps(cmR, { electronAPI: null }))).toEqual({ ok: true });
    expect(cmR.redo).toHaveBeenCalled();
  });

  test('copy/cut/paste in Electron forward to native editCommand', () => {
    for (const cmd of ['copy', 'cut', 'paste']) {
      const cm = makeCmAdapter();
      const editCommand = vi.fn();
      expect(execEditCmd(cmd, cmDeps(cm, { electronAPI: { editCommand } }))).toEqual({ ok: true, reason: 'ipc' });
      expect(editCommand).toHaveBeenCalledWith(cmd);
      expect(cm.replaceSelection).not.toHaveBeenCalled();
    }
  });

  test('copy (no Electron) writes the CM6 selection to the clipboard', () => {
    const cm = makeCmAdapter({ value: 'copy me text', start: 0, end: 7 }); // "copy me"
    const clipboard = makeClipboard();
    expect(execEditCmd('copy', cmDeps(cm, { clipboard }))).toEqual({ ok: true });
    expect(clipboard.writeText).toHaveBeenCalledWith('copy me');
    expect(cm.replaceSelection).not.toHaveBeenCalled(); // copy must NOT mutate
  });

  test('copy/cut with empty selection → no-selection, nothing written', () => {
    for (const cmd of ['copy', 'cut']) {
      const cm = makeCmAdapter({ value: 'abc', start: 2, end: 2 });
      const clipboard = makeClipboard();
      expect(execEditCmd(cmd, cmDeps(cm, { clipboard }))).toEqual({ ok: false, reason: 'no-selection' });
      expect(clipboard.writeText).not.toHaveBeenCalled();
    }
  });

  test('cut (no Electron) copies the selection AND removes it from the doc', () => {
    const cm = makeCmAdapter({ value: 'cut THIS text', start: 4, end: 8 }); // "THIS"
    const clipboard = makeClipboard();
    expect(execEditCmd('cut', cmDeps(cm, { clipboard }))).toEqual({ ok: true });
    expect(clipboard.writeText).toHaveBeenCalledWith('THIS');
    expect(cm.replaceSelection).toHaveBeenCalledWith('');
    expect(cm._state.value).toBe('cut  text');
  });

  test('copy/cut clipboard rejection surfaces an error toast (no throw)', async () => {
    const cm = makeCmAdapter({ value: 'abcdef', start: 0, end: 3 });
    const clipboard = makeClipboard({ writeOk: false });
    const showToast = vi.fn();
    expect(execEditCmd('copy', cmDeps(cm, { clipboard, showToast }))).toEqual({ ok: true });
    await Promise.resolve(); await Promise.resolve();
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/copy failed/i), 'error');
  });

  test('paste (no Electron) inserts clipboard text at the CM6 selection', async () => {
    const cm = makeCmAdapter({ value: 'beforeafter', start: 6, end: 6 });
    const clipboard = makeClipboard({ readText: 'MIDDLE' });
    expect(execEditCmd('paste', cmDeps(cm, { clipboard }))).toEqual({ ok: true });
    await Promise.resolve(); await Promise.resolve();
    expect(cm.replaceSelection).toHaveBeenCalledWith('MIDDLE');
    expect(cm._state.value).toBe('beforeMIDDLEafter');
  });

  test('paste with no clipboard.readText → no-clipboard + info toast', () => {
    const cm = makeCmAdapter();
    const showToast = vi.fn();
    const r = execEditCmd('paste', cmDeps(cm, { clipboard: { writeText: vi.fn() }, showToast }));
    expect(r).toEqual({ ok: false, reason: 'no-clipboard' });
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/paste/i), 'info');
  });

  test('cmEdit closes the menu for every command', () => {
    for (const cmd of _internal.VALID_CMDS) {
      const cm = makeCmAdapter({ value: 'abc', start: 0, end: 3 });
      const deps = cmDeps(cm, { electronAPI: null });
      execEditCmd(cmd, deps);
      expect(deps.closeMenu, `cmd ${cmd}`).toHaveBeenCalled();
    }
  });

  test('_internal.cmEdit is exported and returns null when no adapter', () => {
    expect(typeof _internal.cmEdit).toBe('function');
    expect(_internal.cmEdit('copy', makeDeps({ getCmAdapter: () => null }))).toBeNull();
  });
});
