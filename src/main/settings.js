/**
 * settings.js — versioned, fail-safe persistent settings (T-B5).
 * Pure migrate/clamp helpers + a tiny store factory (fs injected). Corrupt or
 * outdated settings degrade to defaults instead of crashing (EC-D1); restored
 * window bounds are clamped to a visible display (EC-D2).
 */

const SETTINGS_VERSION = 4;
const CAPABILITY_ID = /^cap-[A-Za-z0-9_-]{1,128}$/;

const DEFAULTS = Object.freeze({
  version: SETTINGS_VERSION,
  theme: 'paper',
  zoomFactor: 1,
  readerTextScale: 1,
  readerWidthCh: 72,
  editorMode: 'live',
  viewMode: 'reading', // T-F17: Reading (clean read-only render) vs 'edit' (CM6); reading-first default

  // Side panels start CLOSED out-of-the-box (clean editor-first view); a saved choice is
  // preserved by migrate() below, so opening a panel is remembered across launches.
  sidebarVisible: false,
  inspectorVisible: false,
  uiDirection: 'ltr',
  uiLocale: 'en',
  numerals: 'western',
  calendar: 'gregorian',
  arabicKashida: false,
  italicRecolor: true,
  cmEditor: false,

  // T-F19 chrome. windowTitleMode drives the OS window title (and therefore the
  // taskbar and Alt+Tab); 'file' shows the open document, 'app' pins the product
  // name. The two visibility flags default off so the familiar window is the
  // out-of-the-box one.
  windowTitleMode: 'file',
  autoHideTitlebar: false,
  hideStatusBar: false,
  // v1.2: Word-style auto-save of files opened from disk (untitled notes still need
  // Save As). Renderer-driven; main only persists and restores the flag.
  autosave: true,
  recents: [],
  window: { w: 1280, h: 820, maximized: false },
  lastSession: null,
});

const THEMES = ['paper', 'ink', 'sepia'];
const MODES = ['live', 'source', 'split'];

function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2.0, Math.max(0.6, n));
}

function clampReaderTextScale(scale) {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) return DEFAULTS.readerTextScale;
  return Math.round(Math.min(2, Math.max(0.8, scale)) * 10) / 10;
}

function clampReaderWidthCh(width) {
  if (typeof width !== 'number' || !Number.isFinite(width)) return DEFAULTS.readerWidthCh;
  return Math.round(Math.min(120, Math.max(48, width)) / 2) * 2;
}

function defaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

/** Coerce an arbitrary (possibly corrupt/old) object into valid Settings. */
function migrate(raw) {
  const out = defaultSettings();
  if (!raw || typeof raw !== 'object') return out;
  if (THEMES.includes(raw.theme)) out.theme = raw.theme;
  if (MODES.includes(raw.editorMode)) out.editorMode = raw.editorMode;
  if (raw.viewMode === 'reading' || raw.viewMode === 'edit') out.viewMode = raw.viewMode; // T-F17
  out.zoomFactor = clampZoom(raw.zoomFactor);
  out.readerTextScale = clampReaderTextScale(raw.readerTextScale);
  out.readerWidthCh = clampReaderWidthCh(raw.readerWidthCh);
  if (typeof raw.sidebarVisible === 'boolean') out.sidebarVisible = raw.sidebarVisible;
  if (typeof raw.inspectorVisible === 'boolean') out.inspectorVisible = raw.inspectorVisible;
  if (raw.uiDirection === 'rtl' || raw.uiDirection === 'ltr') out.uiDirection = raw.uiDirection;
  if (raw.uiLocale === 'ar' || raw.uiLocale === 'en') out.uiLocale = raw.uiLocale;
  if (raw.numerals === 'arabic-indic' || raw.numerals === 'western') out.numerals = raw.numerals;
  if (raw.calendar === 'hijri' || raw.calendar === 'gregorian') out.calendar = raw.calendar;
  if (typeof raw.arabicKashida === 'boolean') out.arabicKashida = raw.arabicKashida;
  if (typeof raw.italicRecolor === 'boolean') out.italicRecolor = raw.italicRecolor;
  if (typeof raw.cmEditor === 'boolean') out.cmEditor = raw.cmEditor;
  if (raw.windowTitleMode === 'app' || raw.windowTitleMode === 'file') out.windowTitleMode = raw.windowTitleMode;
  if (typeof raw.autoHideTitlebar === 'boolean') out.autoHideTitlebar = raw.autoHideTitlebar;
  if (typeof raw.hideStatusBar === 'boolean') out.hideStatusBar = raw.hideStatusBar;
  if (typeof raw.autosave === 'boolean') out.autosave = raw.autosave;
  if (Array.isArray(raw.recents)) {
    out.recents = raw.recents
      .filter(r => r && typeof r.path === 'string'
        && (CAPABILITY_ID.test(r.vaultId || '') || CAPABILITY_ID.test(r.documentId || '')))
      .slice(0, 10)
      .map(r => ({
        name: String(r.name || ''),
        path: r.path,
        vaultId: CAPABILITY_ID.test(r.vaultId || '') ? r.vaultId : null,
        documentId: CAPABILITY_ID.test(r.documentId || '') ? r.documentId : null,
      }));
  }
  if (raw.window && typeof raw.window === 'object') {
    const w = raw.window;
    out.window = {
      x: Number.isFinite(w.x) ? w.x : undefined,
      y: Number.isFinite(w.y) ? w.y : undefined,
      w: Number.isFinite(w.w) ? w.w : DEFAULTS.window.w,
      h: Number.isFinite(w.h) ? w.h : DEFAULTS.window.h,
      maximized: !!w.maximized,
    };
  }
  // B2 (multi-folder workspaces): lastSession moved from a flat { vaultId, openPaths,
  // activePath } to a forest-ready { vaults: [{vaultId, openPaths}], activeVaultId,
  // activePath }. Both shapes are accepted here so an old settings.json still restores —
  // gating ONLY on the legacy vaultId field (as before B2) would silently drop a `vaults`
  // array and degrade restore to nothing on the very next launch.
  if (raw.lastSession && typeof raw.lastSession === 'object') {
    const s = raw.lastSession;
    if (Array.isArray(s.vaults)) {
      const vaults = s.vaults
        .filter(v => v && typeof v === 'object' && CAPABILITY_ID.test(v.vaultId || ''))
        .map(v => ({
          vaultId: v.vaultId,
          openPaths: Array.isArray(v.openPaths) ? v.openPaths.filter(p => typeof p === 'string') : [],
        }));
      if (vaults.length) {
        const activeVaultId = CAPABILITY_ID.test(s.activeVaultId || '')
          && vaults.some(v => v.vaultId === s.activeVaultId)
          ? s.activeVaultId
          : vaults[0].vaultId;
        out.lastSession = {
          vaults,
          activeVaultId,
          activePath: typeof s.activePath === 'string' ? s.activePath : undefined,
        };
      }
    } else if (CAPABILITY_ID.test(s.vaultId || '')) {
      out.lastSession = {
        vaultId: s.vaultId,
        openPaths: Array.isArray(s.openPaths) ? s.openPaths.filter(p => typeof p === 'string') : [],
        activePath: typeof s.activePath === 'string' ? s.activePath : undefined,
      };
    }
  }
  out.version = SETTINGS_VERSION;
  return out;
}

/** Clamp a window rect so it stays on a visible display (EC-D2). */
function clampWindowBounds(win, displays) {
  const def = { ...DEFAULTS.window };
  if (!win || !Array.isArray(displays) || displays.length === 0) return def;
  if (win.x == null || win.y == null) return { w: win.w || def.w, h: win.h || def.h, maximized: !!win.maximized };
  const onScreen = displays.some(d =>
    win.x < d.x + d.width && win.x + (win.w || def.w) > d.x &&
    win.y < d.y + d.height && win.y + (win.h || def.h) > d.y);
  if (onScreen) return { x: win.x, y: win.y, w: win.w || def.w, h: win.h || def.h, maximized: !!win.maximized };
  return { w: win.w || def.w, h: win.h || def.h, maximized: !!win.maximized }; // drop off-screen x/y
}

function createSettingsStore({ fs, path, userDataDir }) {
  const file = path.join(userDataDir, 'settings.json');
  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      return migrate(raw);
    } catch (_) {
      return defaultSettings(); // missing or corrupt → defaults (EC-D1)
    }
  }
  function save(settings) {
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(migrate(settings), null, 2), 'utf8');
      fs.renameSync(tmp, file);
      return { ok: true };
    } catch (_) {
      return { error: 'write-failed' };
    }
  }
  return { load, save, file };
}

/**
 * T-F19: clear the two chrome-visibility flags, leaving every other setting alone.
 *
 * Deliberately takes and returns a WHOLE settings object. save() runs its argument
 * through migrate(), which defaults every absent key — so saving a bare
 * `{ autoHideTitlebar: false, hideStatusBar: false }` would wipe recents, lastSession,
 * window bounds, theme and everything else. Callers must load(), pass the loaded object
 * through here, and save the result.
 *
 * @param {object} settings a full settings object, as returned by load()
 * @returns {object} a copy with both chrome flags cleared
 */
function resetChromeSettings(settings) {
  const base = (settings && typeof settings === 'object') ? settings : defaultSettings();
  return { ...base, autoHideTitlebar: false, hideStatusBar: false };
}

module.exports = {
  SETTINGS_VERSION, DEFAULTS, defaultSettings, migrate, clampZoom, clampReaderTextScale, clampReaderWidthCh, clampWindowBounds, createSettingsStore, resetChromeSettings,
};
