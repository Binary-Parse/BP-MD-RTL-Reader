import { describe, expect, test, vi } from 'vitest';
import { defaultSettings, migrate } from '../../src/main/settings.js';
import { createSettingsController, PERSISTED_KEYS } from '../../src/renderer/components/settings-controller.js';

describe('marginNotesCollapsed (main settings)', () => {
  test('defaults to expanded (false) for a new install and for an old file without the key', () => {
    expect(defaultSettings().marginNotesCollapsed).toBe(false);
    expect(migrate({}).marginNotesCollapsed).toBe(false);
    expect(migrate({ theme: 'ink' }).marginNotesCollapsed).toBe(false);
  });

  test('a saved boolean is kept either way', () => {
    expect(migrate({ marginNotesCollapsed: true }).marginNotesCollapsed).toBe(true);
    expect(migrate({ marginNotesCollapsed: false }).marginNotesCollapsed).toBe(false);
  });

  test('non-boolean values fall back to expanded', () => {
    for (const bad of ['yes', 1, 0, null, {}]) {
      expect(migrate({ marginNotesCollapsed: bad }).marginNotesCollapsed).toBe(false);
    }
  });
});

describe('marginNotesCollapsed (renderer settings controller)', () => {
  function makeState(extra = {}) {
    return {
      theme: 'paper', zoomFactor: 1, editorMode: 'live', viewMode: 'edit',
      sidebarVisible: true, inspectorVisible: true, recents: [], calendar: 'gregorian',
      arabicKashida: false, italicRecolor: true, uiLocale: 'en', uiDirection: 'ltr',
      readerTextScale: 1, readerWidthCh: 72, windowTitleMode: 'file', autoHideTitlebar: false,
      hideStatusBar: false, autosave: true, readingProgress: [], themeFollowSystem: false,
      updateCheck: 'manual', readingGoalMin: 10, marginNotesCollapsed: false, files: [], activeFile: null,
      ...extra,
    };
  }
  const actions = () => ({
    applyTheme: vi.fn(), setZoom: vi.fn(), setEditorMode: vi.fn(), setViewMode: vi.fn(),
    applyPanelLayout: vi.fn(), renderRecents: vi.fn(), renderContinue: vi.fn(), applyKashida: vi.fn(),
    applyItalicRecolor: vi.fn(), setUiLocale: vi.fn(), setUiDirection: vi.fn(),
    setReaderTextScale: vi.fn(), setReaderWidthCh: vi.fn(), restoreLastSession: vi.fn(async () => {}),
  });
  const make = (state, saved) => createSettingsController({
    state, bridge: { getSettings: vi.fn(async () => saved) }, actions: actions(), subscribe: vi.fn(), getLastSession: () => null,
  });

  test('is a persisted key, so toggling it saves the settings', () => {
    expect(PERSISTED_KEYS.has('marginNotesCollapsed')).toBe(true);
  });

  test('is part of the saved payload', () => {
    expect(make(makeState({ marginNotesCollapsed: true }), {}).settingsPayload().marginNotesCollapsed).toBe(true);
    expect(make(makeState(), {}).settingsPayload().marginNotesCollapsed).toBe(false);
  });

  test('restore applies a saved true and a saved false', async () => {
    const s = makeState();
    await make(s, { marginNotesCollapsed: true }).restoreSettings();
    expect(s.marginNotesCollapsed).toBe(true);
    await make(s, { marginNotesCollapsed: false }).restoreSettings();
    expect(s.marginNotesCollapsed).toBe(false);
  });

  test('restore ignores a non-boolean and keeps the current value', async () => {
    const s = makeState({ marginNotesCollapsed: true });
    await make(s, { marginNotesCollapsed: 'yes' }).restoreSettings();
    expect(s.marginNotesCollapsed).toBe(true);
  });
});
