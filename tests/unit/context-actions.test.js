/**
 * context-actions.test.js — exercises runContextAction branches in src/main/window-controller.js
 * by driving the registered 'context-menu' handler (which now stashes descriptors and sends
 * 'context-menu:show' instead of popping a native Menu) and the 'context-menu:action' IPC
 * handler that dispatches a { nonce, index } round-trip against that stash (D1/D1 addendum).
 */
import { describe, test, expect, beforeAll, vi } from 'vitest';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

describe('runContextAction (T-B12 side-effects, via the context-menu:action IPC round-trip)', () => {
  let el, ctx, nav, wc, actionHandler;
  beforeAll(async () => {
    el = buildMockElectron();
    el._mockWin.webContents.on.mockImplementation((evt, fn) => {
      if (evt === 'context-menu') ctx = fn;
      if (evt === 'will-navigate') nav = fn;
    });
    bootstrap({ electron: el, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 30));
    wc = el._mockWin.webContents;
    actionHandler = el.ipcMain.on.mock.calls.find(([evt]) => evt === 'context-menu:action')[1];
  });

  function lastShowPayload() {
    const call = wc.send.mock.calls.filter((c) => c[0] === 'context-menu:show').at(-1);
    return call && call[1];
  }

  function idOf(label, payload = lastShowPayload()) {
    return payload.descriptors.findIndex((d) => d.label === label);
  }

  function dispatch(index, sender = wc) {
    actionHandler({ sender }, { nonce: lastShowPayload().nonce, index });
  }

  test('link: Open Link in Browser → shell.openExternal', () => {
    el.shell.openExternal.mockClear();
    wc.send.mockClear();
    ctx({}, { isEditable: false, linkURL: 'https://x', editFlags: {} });
    dispatch(idOf('Open Link in Browser'));
    expect(el.shell.openExternal).toHaveBeenCalledWith('https://x');
  });

  test('copy-image with no coords → copyImageAt not called', () => {
    wc.copyImageAt.mockClear();
    wc.send.mockClear();
    ctx({}, { isEditable: false, mediaType: 'image', editFlags: {} });
    dispatch(idOf('Copy Image'));
    expect(wc.copyImageAt).not.toHaveBeenCalled();
  });

  test('navigation guard allows the app index.html (no preventDefault)', () => {
    const appUrl = 'app://ui/src/renderer/index.html';
    const e = { preventDefault: vi.fn() };
    nav(e, appUrl);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  function showAndDispatch(params, label) {
    wc.send.mockClear();
    ctx({}, params);
    dispatch(idOf(label));
  }

  test('image: Copy Image → copyImageAt', () => {
    showAndDispatch({ isEditable: false, mediaType: 'image', srcURL: 'bpmd://vault/p.png', x: 5, y: 9, editFlags: {} }, 'Copy Image');
    expect(wc.copyImageAt).toHaveBeenCalledWith(5, 9);
  });

  test('image: Copy Image Address → clipboard', () => {
    el.clipboard.writeText.mockClear();
    showAndDispatch({ isEditable: false, mediaType: 'image', srcURL: 'https://img.example/p.png', editFlags: {} }, 'Copy Image Address');
    expect(el.clipboard.writeText).toHaveBeenCalledWith('https://img.example/p.png');
  });

  test('image: Save Image (https) → downloadURL; non-http ignored', () => {
    wc.downloadURL.mockClear();
    showAndDispatch({ isEditable: false, mediaType: 'image', srcURL: 'https://x/p.png', editFlags: {} }, 'Save Image');
    expect(wc.downloadURL).toHaveBeenCalledWith('https://x/p.png');

    wc.downloadURL.mockClear();
    wc.send.mockClear();
    ctx({}, { isEditable: false, mediaType: 'image', srcURL: 'bpmd://vault/p.png', editFlags: {} });
    expect(idOf('Save Image')).toBe(-1);
    expect(wc.downloadURL).not.toHaveBeenCalled();
  });

  test('spellcheck: replace + add to dictionary', () => {
    wc.replaceMisspelling.mockClear();
    showAndDispatch({ isEditable: true, misspelledWord: 'helo', dictionarySuggestions: ['hello'], editFlags: {} }, 'hello');
    expect(wc.replaceMisspelling).toHaveBeenCalledWith('hello');

    wc.session.addWordToSpellCheckerDictionary.mockClear();
    showAndDispatch({ isEditable: true, misspelledWord: 'helo', dictionarySuggestions: ['hello'], editFlags: {} }, 'Add to Dictionary');
    expect(wc.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('helo');
  });

  test('link: Copy Link Address → clipboard', () => {
    el.clipboard.writeText.mockClear();
    showAndDispatch({ isEditable: false, linkURL: 'https://x', editFlags: {} }, 'Copy Link Address');
    expect(el.clipboard.writeText).toHaveBeenCalledWith('https://x');
  });

  test('an edit role (cut) dispatches webContents.cut() when enabled', () => {
    wc.cut.mockClear();
    wc.send.mockClear();
    ctx({}, { isEditable: true, editFlags: { canCut: true } });
    const payload = lastShowPayload();
    const idx = payload.descriptors.findIndex((d) => d.kind === 'role' && d.role === 'cut');
    dispatch(idx);
    expect(wc.cut).toHaveBeenCalledTimes(1);
  });

  test('a disabled role is not dispatched even if the renderer sends its index', () => {
    wc.redo.mockClear();
    wc.send.mockClear();
    ctx({}, { isEditable: true, editFlags: { canRedo: false } });
    const payload = lastShowPayload();
    const idx = payload.descriptors.findIndex((d) => d.kind === 'role' && d.role === 'redo');
    dispatch(idx);
    expect(wc.redo).not.toHaveBeenCalled();
  });

  // selectAll is never executed in main: webContents.selectAll() would select the entire
  // renderer DOM (titlebar/sidebar/statusbar), not just the document. Main relays it back
  // over the existing app:command channel for the renderer to scope itself.
  test('the selectAll role is relayed over app:command, never run on webContents', () => {
    wc.selectAll.mockClear();
    wc.send.mockClear();
    ctx({}, { isEditable: false, selectionText: '', editFlags: { canSelectAll: true } });
    const payload = lastShowPayload();
    const idx = payload.descriptors.findIndex((d) => d.kind === 'role' && d.role === 'selectAll');
    dispatch(idx);
    expect(wc.selectAll).not.toHaveBeenCalled();
    expect(wc.send).toHaveBeenCalledWith('app:command', 'selectAll');
  });

  test('a disabled selectAll role is not relayed', () => {
    wc.send.mockClear();
    ctx({}, { isEditable: false, selectionText: '', editFlags: { canSelectAll: false } });
    const payload = lastShowPayload();
    const idx = payload.descriptors.findIndex((d) => d.kind === 'role' && d.role === 'selectAll');
    dispatch(idx);
    expect(wc.send).not.toHaveBeenCalledWith('app:command', 'selectAll');
  });
});
