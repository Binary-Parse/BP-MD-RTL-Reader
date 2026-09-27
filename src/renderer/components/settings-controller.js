// T4.1: the stored reading positions are validated with the same rules the shelf uses.
import { sanitizeProgress } from '../reading-progress.js';

export const PERSISTED_KEYS = new Set([
  'theme', 'zoomFactor', 'editorMode', 'viewMode', 'sidebarVisible',
  'inspectorVisible', 'recents', 'calendar', 'arabicKashida',
  'italicRecolor', 'uiLocale', 'uiDirection', 'readerTextScale', 'readerWidthCh',
  // T-F19 chrome settings
  'windowTitleMode', 'autoHideTitlebar', 'hideStatusBar',
  // v1.2: Word-style auto-save toggle
  'autosave',
  // v5 (T0.1): reading positions, system-colour follow, update-check mode, daily goal
  'readingProgress', 'themeFollowSystem', 'updateCheck', 'readingGoalMin',
]);

const noop = () => {};

export function createSettingsController({
  state,
  bridge,
  actions = {},
  subscribe = noop,
  getLastSession = () => null,
  themes = ['paper', 'ink', 'sepia'],
  delay = 200,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  // T2.1: injected so unit tests can drive both branches; the renderer's real default reads
  // the live media query.
  prefersDarkScheme = () => (typeof globalThis.matchMedia === 'function'
    ? !!globalThis.matchMedia('(prefers-color-scheme: dark)').matches
    : false),
} = {}) {
  if (!state) throw new TypeError('settings controller requires state');

  const apply = {
    applyTheme: actions.applyTheme || noop,
    setZoom: actions.setZoom || noop,
    setEditorMode: actions.setEditorMode || noop,
    setViewMode: actions.setViewMode || noop,
    applyPanelLayout: actions.applyPanelLayout || noop,
    renderRecents: actions.renderRecents || noop,
    renderContinue: actions.renderContinue || noop, // T4.1: the Continue-reading shelf
    applyKashida: actions.applyKashida || noop,
    applyItalicRecolor: actions.applyItalicRecolor || noop,
    setUiLocale: actions.setUiLocale || noop,
    setUiDirection: actions.setUiDirection || noop,
    setReaderTextScale: actions.setReaderTextScale || noop,
    setReaderWidthCh: actions.setReaderWidthCh || noop,
    restoreLastSession: actions.restoreLastSession || (async () => {}),
    // T-F19. NOTE: this map is a hand-enumerated allow-list, not a passthrough — a hook
    // omitted here resolves to `undefined`, not noop, and the restore below would throw
    // and abandon theme, zoom, panels and session restore with it.
    applyChromeLayout: actions.applyChromeLayout || noop,
    syncWindowTitle: actions.syncWindowTitle || noop,
  };
  let restoring = false;
  let persistTimer = null;

  function settingsPayload() {
    return {
      theme: state.theme,
      zoomFactor: state.zoomFactor,
      editorMode: state.editorMode,
      viewMode: state.viewMode,
      sidebarVisible: state.sidebarVisible,
      inspectorVisible: state.inspectorVisible,
      recents: state.recents.map((recent) => ({
        name: recent.name,
        path: recent.path,
        vaultId: recent.vaultId || null,
        documentId: recent.documentId || null,
      })),
      calendar: state.calendar,
      arabicKashida: state.arabicKashida,
      italicRecolor: state.italicRecolor,
      uiLocale: state.uiLocale,
      uiDirection: state.uiDirection,
      readerTextScale: state.readerTextScale,
      readerWidthCh: state.readerWidthCh,
      windowTitleMode: state.windowTitleMode,
      autoHideTitlebar: state.autoHideTitlebar,
      hideStatusBar: state.hideStatusBar,
      autosave: state.autosave,
      // v5 (T0.1)
      readingProgress: state.readingProgress.map((entry) => ({
        key: entry.key || '',
        name: entry.name || '',
        path: entry.path,
        vaultId: entry.vaultId || null,
        documentId: entry.documentId || null,
        ratio: entry.ratio,
        at: entry.at,
      })),
      themeFollowSystem: state.themeFollowSystem,
      updateCheck: state.updateCheck,
      readingGoalMin: state.readingGoalMin,
      lastSession: getLastSession(),
    };
  }

  async function flushSettings() {
    clearTimer(persistTimer);
    persistTimer = null;
    if (!bridge || restoring) return true;
    try {
      const result = await Promise.resolve(bridge.setSettings(settingsPayload()));
      return !!(result && result.ok);
    } catch (_) {
      return false;
    }
  }

  function persistSettings() {
    if (!bridge || restoring) return;
    clearTimer(persistTimer);
    persistTimer = setTimer(() => {
      persistTimer = null;
      try {
        Promise.resolve(bridge.setSettings(settingsPayload())).catch(() => { /* best effort */ });
      } catch (_) { /* persistence is best-effort; never break the UI */ }
    }, delay);
  }

  async function restoreSettings() {
    if (!bridge || typeof bridge.getSettings !== 'function') return false;
    let saved;
    try {
      saved = await bridge.getSettings();
    } catch (_) {
      return false;
    }
    if (!saved || typeof saved !== 'object') return false;

    restoring = true;
    try {
      // T2.1: a profile that never chose a theme (themeFollowSystem true — the first-run
      // default) derives it from the OS scheme instead of the saved literal. Nothing is
      // written back: this stays a DERIVED preference until the user picks a theme.
      if (saved.themeFollowSystem === true) {
        const systemTheme = prefersDarkScheme() ? 'ink' : 'paper';
        state.theme = systemTheme;
        apply.applyTheme(systemTheme);
      } else if (themes.includes(saved.theme)) {
        state.theme = saved.theme;
        apply.applyTheme(saved.theme);
      }
      if (typeof saved.zoomFactor === 'number') apply.setZoom(saved.zoomFactor);
      if (typeof saved.readerTextScale === 'number') apply.setReaderTextScale(saved.readerTextScale);
      if (typeof saved.readerWidthCh === 'number') apply.setReaderWidthCh(saved.readerWidthCh);
      // CM6 is the sole editor. Old split/source values must not resurrect a second surface.
      apply.setEditorMode('live');
      if (saved.viewMode === 'reading' || saved.viewMode === 'edit') apply.setViewMode(saved.viewMode);
      if (typeof saved.sidebarVisible === 'boolean') state.sidebarVisible = saved.sidebarVisible;
      if (typeof saved.inspectorVisible === 'boolean') state.inspectorVisible = saved.inspectorVisible;
      apply.applyPanelLayout();
      if (Array.isArray(saved.recents)) {
        state.recents = saved.recents
          .filter((recent) => recent && typeof recent.path === 'string'
            && (typeof recent.vaultId === 'string' || typeof recent.documentId === 'string'))
          .map((recent) => ({
            name: String(recent.name || ''),
            path: recent.path,
            vaultId: typeof recent.vaultId === 'string' ? recent.vaultId : null,
            documentId: typeof recent.documentId === 'string' ? recent.documentId : null,
          }));
        apply.renderRecents();
      }
      if (saved.calendar === 'hijri' || saved.calendar === 'gregorian') state.calendar = saved.calendar;
      if (typeof saved.arabicKashida === 'boolean') {
        state.arabicKashida = saved.arabicKashida;
        apply.applyKashida();
      }
      if (typeof saved.italicRecolor === 'boolean') {
        state.italicRecolor = saved.italicRecolor;
        apply.applyItalicRecolor();
      }
      if (saved.uiLocale === 'ar' || saved.uiLocale === 'en') apply.setUiLocale(saved.uiLocale);
      if (saved.uiDirection === 'rtl' || saved.uiDirection === 'ltr') apply.setUiDirection(saved.uiDirection);
      // T-F19: coerce here as well as in main/settings.js migrate() — restoreSettings
      // reads whatever the bridge returns, which in dev/tests is not always migrated.
      state.windowTitleMode = (saved.windowTitleMode === 'app' || saved.windowTitleMode === 'file')
        ? saved.windowTitleMode : 'file';
      state.autoHideTitlebar = typeof saved.autoHideTitlebar === 'boolean' ? saved.autoHideTitlebar : false;
      state.hideStatusBar = typeof saved.hideStatusBar === 'boolean' ? saved.hideStatusBar : false;
      state.autosave = typeof saved.autosave === 'boolean' ? saved.autosave : true;
      // v5 (T0.1): coerce like the chrome keys above — the bridge payload is not always
      // migrated (dev/tests). readingProgress is stored shape-checked here; T4.1c swaps in
      // the renderer's sanitizeProgress + re-renders the Continue shelf.
      state.themeFollowSystem = typeof saved.themeFollowSystem === 'boolean' ? saved.themeFollowSystem : false;
      state.updateCheck = (saved.updateCheck === 'manual' || saved.updateCheck === 'auto') ? saved.updateCheck : 'manual';
      state.readingGoalMin = [0, 10, 20, 30].includes(saved.readingGoalMin) ? saved.readingGoalMin : 10;
      state.readingProgress = sanitizeProgress(saved.readingProgress);
      apply.renderContinue();
      apply.applyChromeLayout();
      apply.syncWindowTitle();
      await apply.restoreLastSession(saved.lastSession);
    } finally {
      restoring = false;
    }
    return true;
  }

  const controller = {
    settingsPayload,
    flushSettings,
    persistSettings,
    restoreSettings,
    isRestoring: () => restoring,
    bind: () => subscribe((key) => {
      if (PERSISTED_KEYS.has(key)) controller.persistSettings();
    }),
  };
  return controller;
}
