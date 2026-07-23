/**
 * context-actions.test.js — exercises runContextAction branches in src/main/index.js
 * by driving the registered context-menu handler and invoking item clicks.
 */
import { describe, test, expect, beforeAll, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bootstrap } from '../../src/main/index.js';
import { buildMockElectron, buildMockFs, buildMockProc } from './main-harness.js';

describe('runContextAction (T-B12 side-effects)', () => {
  let el, ctx, nav, wc;
  beforeAll(async () => {
    el = buildMockElectron();
    el._mockWin.webContents.on.mockImplementation((evt, fn) => {
      if (evt === 'context-menu') ctx = fn;
      if (evt === 'will-navigate') nav = fn;
    });
    bootstrap({ electron: el, fs: buildMockFs(), proc: buildMockProc(['node', 'src/main/index.js']) });
    await new Promise((r) => setTimeout(r, 30));
    wc = el._mockWin.webContents;
  });

  test('link: Open Link in Browser → shell.openExternal', () => {
    el.shell.openExternal.mockClear();
    el.Menu.buildFromTemplate.mockClear();
    ctx({}, { isEditable: false, linkURL: 'https://x', editFlags: {} });
    el.Menu.buildFromTemplate.mock.calls[0][0].find((i) => i.label === 'Open Link in Browser').click();
    expect(el.shell.openExternal).toHaveBeenCalledWith('https://x');
  });

  test('copy-image with no coords → copyImageAt not called', () => {
    wc.copyImageAt.mockClear();
    el.Menu.buildFromTemplate.mockClear();
    ctx({}, { isEditable: false, mediaType: 'image', editFlags: {} });
    el.Menu.buildFromTemplate.mock.calls[0][0].find((i) => i.label === 'Copy Image').click();
    expect(wc.copyImageAt).not.toHaveBeenCalled();
  });

  test('navigation guard allows the app index.html (no preventDefault)', () => {
    const appUrl = pathToFileURL(path.join(process.cwd(), 'src', 'renderer', 'index.html')).href;
    const e = { preventDefault: vi.fn() };
    nav(e, appUrl);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  function clickItem(params, label) {
    el.Menu.buildFromTemplate.mockClear();
    ctx({}, params);
    const tpl = el.Menu.buildFromTemplate.mock.calls[0][0];
    tpl.find((i) => i.label === label).click();
  }

  test('image: Copy Image → copyImageAt', () => {
    clickItem({ isEditable: false, mediaType: 'image', srcURL: 'bpmd://vault/p.png', x: 5, y: 9, editFlags: {} }, 'Copy Image');
    expect(wc.copyImageAt).toHaveBeenCalledWith(5, 9);
  });

  test('image: Copy Image Address → clipboard', () => {
    el.clipboard.writeText.mockClear();
    clickItem({ isEditable: false, mediaType: 'image', srcURL: 'bpmd://vault/p.png', editFlags: {} }, 'Copy Image Address');
    expect(el.clipboard.writeText).toHaveBeenCalledWith('bpmd://vault/p.png');
  });

  test('image: Save Image (https) → downloadURL; non-http ignored', () => {
    wc.downloadURL.mockClear();
    clickItem({ isEditable: false, mediaType: 'image', srcURL: 'https://x/p.png', editFlags: {} }, 'Save Image');
    expect(wc.downloadURL).toHaveBeenCalledWith('https://x/p.png');
    wc.downloadURL.mockClear();
    clickItem({ isEditable: false, mediaType: 'image', srcURL: 'bpmd://vault/p.png', editFlags: {} }, 'Save Image');
    expect(wc.downloadURL).not.toHaveBeenCalled();
  });

  test('spellcheck: replace + add to dictionary', () => {
    wc.replaceMisspelling.mockClear();
    clickItem({ isEditable: true, misspelledWord: 'helo', dictionarySuggestions: ['hello'], editFlags: {} }, 'hello');
    expect(wc.replaceMisspelling).toHaveBeenCalledWith('hello');
    clickItem({ isEditable: true, misspelledWord: 'helo', dictionarySuggestions: ['hello'], editFlags: {} }, 'Add to Dictionary');
    expect(wc.session.addWordToSpellCheckerDictionary).toHaveBeenCalledWith('helo');
  });

  test('link: Copy Link Address → clipboard', () => {
    el.clipboard.writeText.mockClear();
    clickItem({ isEditable: false, linkURL: 'https://x', editFlags: {} }, 'Copy Link Address');
    expect(el.clipboard.writeText).toHaveBeenCalledWith('https://x');
  });
});
