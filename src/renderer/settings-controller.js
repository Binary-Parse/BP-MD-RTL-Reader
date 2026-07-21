export const PERSISTED_KEYS = new Set([
  'theme', 'zoomFactor', 'editorMode', 'viewMode', 'sidebarVisible',
  'inspectorVisible', 'recents', 'calendar', 'arabicKashida',
  'italicRecolor', 'cmEditor', 'uiLocale', 'uiDirection',
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
} = {}) {
  if (!state) throw new TypeError('settings controller requires state');

  const apply = {
    applyTheme: actions.applyTheme || noop,
    setZoom: actions.setZoom || noop,
    setEditorMode: actions.setEditorMode || noop,
    setViewMode: actions.setViewMode || noop,
    applyPanelLayout: actions.applyPanelLayout || noop,
    renderRecents: actions.renderRecents || noop,
    applyKashida: actions.applyKashida || noop,
    applyItalicRecolor: actions.applyItalicRecolor || noop,
    setUiLocale: actions.setUiLocale || noop,
    setUiDirection: actions.setUiDirection || noop,
    restoreLastSession: actions.restoreLastSession || (async () => {}),
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
      cmEditor: state.cmEditor,
      uiLocale: state.uiLocale,
      uiDirection: state.uiDirection,
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
      if (themes.includes(saved.theme)) {
        state.theme = saved.theme;
        apply.applyTheme(saved.theme);
      }
      if (typeof saved.zoomFactor === 'number') apply.setZoom(saved.zoomFactor);
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
      if (typeof saved.cmEditor === 'boolean') state.cmEditor = saved.cmEditor;
      if (saved.uiLocale === 'ar' || saved.uiLocale === 'en') apply.setUiLocale(saved.uiLocale);
      if (saved.uiDirection === 'rtl' || saved.uiDirection === 'ltr') apply.setUiDirection(saved.uiDirection);
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
