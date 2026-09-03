import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createSettingsController,
  PERSISTED_KEYS,
} from '../../src/renderer/components/settings-controller.js';

afterEach(() => vi.useRealTimers());

function state() {
  return {
    theme: 'paper', zoomFactor: 1, editorMode: 'live', viewMode: 'edit',
    sidebarVisible: true, inspectorVisible: true, recents: [], calendar: 'gregorian',
    arabicKashida: false, italicRecolor: true, cmEditor: false,
    uiLocale: 'en', uiDirection: 'ltr', readerTextScale: 1, readerWidthCh: 72,
    // T-F19 chrome settings
    windowTitleMode: 'file', autoHideTitlebar: false, hideStatusBar: false,
    // v1.2: Word-style auto-save toggle
    autosave: true,
    files: [], activeFile: null,
  };
}

function actions() {
  return {
    applyTheme: vi.fn(), setZoom: vi.fn(), setEditorMode: vi.fn(), setViewMode: vi.fn(),
    applyPanelLayout: vi.fn(), renderRecents: vi.fn(), applyKashida: vi.fn(),
    applyItalicRecolor: vi.fn(), setUiLocale: vi.fn(), setUiDirection: vi.fn(),
    setReaderTextScale: vi.fn(), setReaderWidthCh: vi.fn(),
    restoreLastSession: vi.fn(async () => {}),
  };
}

describe('settings controller', () => {
  test('requires state and supports omitted optional actions', async () => {
    expect(() => createSettingsController()).toThrow('settings controller requires state');
    const activeState = state();
    const controller = createSettingsController({
      state: activeState,
      bridge: { getSettings: vi.fn(async () => ({ theme: 'ink' })) },
    });
    await expect(controller.restoreSettings()).resolves.toBe(true);
    expect(activeState.theme).toBe('ink');
    expect(controller.isRestoring()).toBe(false);
    expect([...PERSISTED_KEYS]).toEqual([
      'theme', 'zoomFactor', 'editorMode', 'viewMode', 'sidebarVisible',
      'inspectorVisible', 'recents', 'calendar', 'arabicKashida',
      'italicRecolor', 'cmEditor', 'uiLocale', 'uiDirection', 'readerTextScale', 'readerWidthCh',
      // T-F19 chrome settings
      'windowTitleMode', 'autoHideTitlebar', 'hideStatusBar',
      // v1.2: Word-style auto-save toggle
      'autosave',
    ]);
  });

  test('builds a narrow persisted payload and sanitized recent capabilities', () => {
    const activeState = state();
    activeState.recents = [{ name: 'a', path: 'a.md', vaultId: 'v', documentId: null, secret: 'drop' }];
    const controller = createSettingsController({
      state: activeState, bridge: null, actions: actions(), subscribe: vi.fn(),
      getLastSession: () => ({ vaultId: 'v', activePath: 'a.md' }),
    });
    expect(controller.settingsPayload()).toEqual(expect.objectContaining({
      theme: 'paper', lastSession: { vaultId: 'v', activePath: 'a.md' },
      recents: [{ name: 'a', path: 'a.md', vaultId: 'v', documentId: null }],
    }));
    expect(controller.settingsPayload().recents[0]).not.toHaveProperty('secret');
    expect(controller.settingsPayload()).toEqual({
      theme: 'paper',
      zoomFactor: 1,
      editorMode: 'live',
      viewMode: 'edit',
      sidebarVisible: true,
      inspectorVisible: true,
      recents: [{ name: 'a', path: 'a.md', vaultId: 'v', documentId: null }],
      calendar: 'gregorian',
      arabicKashida: false,
      italicRecolor: true,
      cmEditor: false,
      uiLocale: 'en',
      uiDirection: 'ltr',
      lastSession: { vaultId: 'v', activePath: 'a.md' },
      readerTextScale: 1,
      readerWidthCh: 72,
      // T-F19 chrome settings
      windowTitleMode: 'file',
      autoHideTitlebar: false,
      hideStatusBar: false,
      // v1.2: Word-style auto-save toggle
      autosave: true,
    });
  });

  test('debounces writes and flushes the latest payload exactly once', async () => {
    vi.useFakeTimers();
    const activeState = state();
    const setSettings = vi.fn(async () => ({ ok: true }));
    const controller = createSettingsController({
      state: activeState, bridge: { setSettings }, actions: actions(), subscribe: vi.fn(),
      getLastSession: () => null,
    });
    controller.persistSettings();
    activeState.theme = 'ink';
    controller.persistSettings();
    expect(setSettings).not.toHaveBeenCalled();
    await expect(controller.flushSettings()).resolves.toBe(true);
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0][0].theme).toBe('ink');
    await vi.runAllTimersAsync();
    expect(setSettings).toHaveBeenCalledTimes(1);
  });

  test('executes a debounced best-effort write and absorbs sync and async failures', async () => {
    vi.useFakeTimers();
    const setSettings = vi.fn(() => ({ ok: true }));
    const controller = createSettingsController({
      state: state(), bridge: { setSettings }, actions: actions(), delay: 25,
    });
    controller.persistSettings();
    await vi.advanceTimersByTimeAsync(24);
    expect(setSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(setSettings).toHaveBeenCalledTimes(1);

    setSettings.mockImplementationOnce(() => { throw new Error('sync'); });
    controller.persistSettings();
    await vi.runAllTimersAsync();
    expect(setSettings).toHaveBeenCalledTimes(2);

    setSettings.mockImplementationOnce(() => Promise.reject(new Error('async')));
    controller.persistSettings();
    await vi.runAllTimersAsync();
    expect(setSettings).toHaveBeenCalledTimes(3);
  });

  test('suppresses scheduled and flushed writes while restoration is active', async () => {
    let releaseRestore;
    const setSettings = vi.fn(async () => ({ ok: true }));
    const apply = actions();
    apply.restoreLastSession.mockImplementation(() => new Promise((resolve) => { releaseRestore = resolve; }));
    const controller = createSettingsController({
      state: state(),
      bridge: { getSettings: vi.fn(async () => ({})), setSettings },
      actions: apply,
    });
    const restore = controller.restoreSettings();
    await vi.waitFor(() => expect(controller.isRestoring()).toBe(true));
    controller.persistSettings();
    await expect(controller.flushSettings()).resolves.toBe(true);
    expect(setSettings).not.toHaveBeenCalled();
    releaseRestore();
    await restore;
  });

  test('returns exact flush outcomes and skips writes without a bridge', async () => {
    const failed = createSettingsController({
      state: state(), bridge: { setSettings: vi.fn(async () => ({ ok: false })) },
    });
    await expect(failed.flushSettings()).resolves.toBe(false);

    const missing = createSettingsController({ state: state(), bridge: null });
    await expect(missing.flushSettings()).resolves.toBe(true);

    const rejected = createSettingsController({
      state: state(), bridge: { setSettings: vi.fn(async () => { throw new Error('failed'); }) },
    });
    await expect(rejected.flushSettings()).resolves.toBe(false);
  });

  test('restores valid values quietly, filters recents, and always releases restore mode', async () => {
    const activeState = state();
    const apply = actions();
    const bridge = { getSettings: vi.fn(async () => ({
      theme: 'ink', zoomFactor: 1.2, editorMode: 'source', viewMode: 'reading',
      sidebarVisible: false, inspectorVisible: false,
      recents: [
        { name: 'valid', path: 'a.md', documentId: 'doc-1' },
        { name: 'invalid', path: 'b.md' },
      ],
      calendar: 'hijri', arabicKashida: true, italicRecolor: false,
      cmEditor: true, uiLocale: 'ar', uiDirection: 'rtl',
      readerTextScale: 1.2, readerWidthCh: 84,
      lastSession: { vaultId: 'v', activePath: 'a.md' },
    })) };
    const controller = createSettingsController({
      state: activeState, bridge, actions: apply, subscribe: vi.fn(), getLastSession: () => null,
    });
    apply.restoreLastSession.mockImplementation(async () => {
      expect(controller.isRestoring()).toBe(true);
    });
    await expect(controller.restoreSettings()).resolves.toBe(true);
    expect(controller.isRestoring()).toBe(false);
    expect(activeState.recents).toEqual([{ name: 'valid', path: 'a.md', vaultId: null, documentId: 'doc-1' }]);
    expect(activeState).toMatchObject({
      theme: 'ink',
      sidebarVisible: false,
      inspectorVisible: false,
      calendar: 'hijri',
      arabicKashida: true,
      italicRecolor: false,
      cmEditor: true,
    });
    expect(apply.applyTheme).toHaveBeenCalledWith('ink');
    expect(apply.setZoom).toHaveBeenCalledWith(1.2);
    expect(apply.setEditorMode).toHaveBeenCalledWith('live');
    expect(apply.setViewMode).toHaveBeenCalledWith('reading');
    expect(apply.applyPanelLayout).toHaveBeenCalledTimes(1);
    expect(apply.renderRecents).toHaveBeenCalledTimes(1);
    expect(apply.applyKashida).toHaveBeenCalledTimes(1);
    expect(apply.applyItalicRecolor).toHaveBeenCalledTimes(1);
    expect(apply.setUiLocale).toHaveBeenCalledWith('ar');
    expect(apply.setUiDirection).toHaveBeenCalledWith('rtl');
    expect(apply.restoreLastSession).toHaveBeenCalledWith({ vaultId: 'v', activePath: 'a.md' });
    expect(apply.setReaderTextScale).toHaveBeenCalledWith(1.2);
    expect(apply.setReaderWidthCh).toHaveBeenCalledWith(84);
  });

  test('rejects unavailable or malformed settings and ignores invalid optional values', async () => {
    const noBridge = createSettingsController({ state: state(), bridge: null });
    await expect(noBridge.restoreSettings()).resolves.toBe(false);
    const noGetter = createSettingsController({ state: state(), bridge: {} });
    await expect(noGetter.restoreSettings()).resolves.toBe(false);
    const failed = createSettingsController({
      state: state(), bridge: { getSettings: vi.fn(async () => { throw new Error('failed'); }) },
    });
    await expect(failed.restoreSettings()).resolves.toBe(false);
    const malformed = createSettingsController({
      state: state(), bridge: { getSettings: vi.fn(async () => 'bad') },
    });
    await expect(malformed.restoreSettings()).resolves.toBe(false);

    const activeState = state();
    const apply = actions();
    const invalid = createSettingsController({
      state: activeState,
      bridge: { getSettings: vi.fn(async () => ({
        theme: 'unknown', zoomFactor: 'large', viewMode: 'source',
        sidebarVisible: 'no', inspectorVisible: null, recents: {},
        calendar: 'lunar', arabicKashida: 'yes', italicRecolor: 1,
        cmEditor: 'yes', uiLocale: 'fr', uiDirection: 'auto',
      })) },
      actions: apply,
    });
    await expect(invalid.restoreSettings()).resolves.toBe(true);
    expect(activeState).toEqual(state());
    expect(apply.applyTheme).not.toHaveBeenCalled();
    expect(apply.setZoom).not.toHaveBeenCalled();
    expect(apply.setViewMode).not.toHaveBeenCalled();
    expect(apply.applyPanelLayout).toHaveBeenCalledTimes(1);
    expect(apply.setReaderTextScale).not.toHaveBeenCalled();
    expect(apply.setReaderWidthCh).not.toHaveBeenCalled();
    expect(apply.restoreLastSession).toHaveBeenCalledWith(undefined);
  });

  test('restores alternate valid values and all supported recent capability shapes', async () => {
    const activeState = state();
    activeState.theme = 'ink';
    activeState.calendar = 'hijri';
    const apply = actions();
    const controller = createSettingsController({
      state: activeState,
      bridge: { getSettings: vi.fn(async () => ({
        theme: 'sepia', viewMode: 'edit', calendar: 'gregorian',
        uiLocale: 'en', uiDirection: 'ltr',
        recents: [
          null,
          { name: null, path: 7, vaultId: 'v' },
          { name: null, path: 'vault.md', vaultId: 'v' },
          { name: 'doc', path: 'doc.md', documentId: 'd', vaultId: 9 },
        ],
      })) },
      actions: apply,
    });
    await expect(controller.restoreSettings()).resolves.toBe(true);
    expect(activeState.theme).toBe('sepia');
    expect(activeState.calendar).toBe('gregorian');
    expect(activeState.recents).toEqual([
      { name: '', path: 'vault.md', vaultId: 'v', documentId: null },
      { name: 'doc', path: 'doc.md', vaultId: null, documentId: 'd' },
    ]);
    expect(apply.applyTheme).toHaveBeenCalledWith('sepia');
    expect(apply.setViewMode).toHaveBeenCalledWith('edit');
    expect(apply.setUiLocale).toHaveBeenCalledWith('en');
    expect(apply.setUiDirection).toHaveBeenCalledWith('ltr');
  });

  test('always releases restore mode when an apply action rejects', async () => {
    const apply = actions();
    apply.restoreLastSession.mockRejectedValueOnce(new Error('restore failed'));
    const controller = createSettingsController({
      state: state(),
      bridge: { getSettings: vi.fn(async () => ({})) },
      actions: apply,
    });
    await expect(controller.restoreSettings()).rejects.toThrow('restore failed');
    expect(controller.isRestoring()).toBe(false);
  });

  test('binds only persisted state keys to the debounced writer', () => {
    let listener;
    const subscribe = vi.fn((fn) => { listener = fn; return vi.fn(); });
    const setSettings = vi.fn(() => ({ ok: true }));
    const controller = createSettingsController({
      state: state(), bridge: { setSettings }, actions: actions(), subscribe, getLastSession: () => null,
    });
    const persist = vi.spyOn(controller, 'persistSettings');
    controller.bind();
    listener('findHits');
    listener('theme');
    listener('readerWidthCh');
    expect(persist).toHaveBeenCalledTimes(2);
  });
});

// T-F19: three chrome settings ride the existing persistence pipeline. The trap this
// covers is `apply` (settings-controller.js): it is a HAND-ENUMERATED literal, not a
// passthrough, so a hook name missing from it is `undefined` rather than `noop` — and
// restoreSettings() would throw TypeError and abandon theme, zoom, panels and session
// restore along with it. Assert the wiring, not just the values.
describe('T-F19 chrome settings persistence', () => {
  const chromeState = () => ({
    ...state(),
    windowTitleMode: 'file', autoHideTitlebar: false, hideStatusBar: false,
  });
  const chromeActions = () => ({
    ...actions(),
    applyChromeLayout: vi.fn(), syncWindowTitle: vi.fn(),
  });

  test('all three keys are persisted', () => {
    for (const k of ['windowTitleMode', 'autoHideTitlebar', 'hideStatusBar']) {
      expect(PERSISTED_KEYS.has(k), `${k} must be in PERSISTED_KEYS or writes never persist`).toBe(true);
    }
  });

  test('all three keys appear in the payload sent to the bridge', async () => {
    const setSettings = vi.fn(async () => ({ ok: true }));
    const activeState = chromeState();
    activeState.autoHideTitlebar = true;
    activeState.windowTitleMode = 'app';
    const controller = createSettingsController({
      state: activeState,
      bridge: { getSettings: vi.fn(async () => ({})), setSettings },
      actions: chromeActions(),
    });
    await controller.flushSettings();
    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0][0]).toMatchObject({
      windowTitleMode: 'app', autoHideTitlebar: true, hideStatusBar: false,
    });
  });

  test('restoreSettings applies saved chrome values and calls both new hooks', async () => {
    const activeState = chromeState();
    const acts = chromeActions();
    const controller = createSettingsController({
      state: activeState,
      bridge: {
        getSettings: vi.fn(async () => ({
          windowTitleMode: 'app', autoHideTitlebar: true, hideStatusBar: true,
        })),
      },
      actions: acts,
    });
    await expect(controller.restoreSettings()).resolves.toBe(true);
    expect(activeState.windowTitleMode).toBe('app');
    expect(activeState.autoHideTitlebar).toBe(true);
    expect(activeState.hideStatusBar).toBe(true);
    expect(acts.applyChromeLayout).toHaveBeenCalled();
    expect(acts.syncWindowTitle).toHaveBeenCalled();
  });

  test('restoreSettings rejects malformed chrome values and still runs the hooks', async () => {
    const activeState = chromeState();
    const acts = chromeActions();
    const controller = createSettingsController({
      state: activeState,
      bridge: {
        getSettings: vi.fn(async () => ({
          windowTitleMode: 'bogus', autoHideTitlebar: 'yes', hideStatusBar: 1,
        })),
      },
      actions: acts,
    });
    await controller.restoreSettings();
    expect(activeState.windowTitleMode).toBe('file');
    expect(activeState.autoHideTitlebar).toBe(false);
    expect(activeState.hideStatusBar).toBe(false);
    expect(acts.applyChromeLayout).toHaveBeenCalled();
  });

  test('the new hooks are optional — omitting them must not throw', async () => {
    const controller = createSettingsController({
      state: chromeState(),
      bridge: { getSettings: vi.fn(async () => ({ autoHideTitlebar: true })) },
      // no actions at all: `apply` must fall back to noop for every name it exposes
    });
    await expect(controller.restoreSettings()).resolves.toBe(true);
  });
});
