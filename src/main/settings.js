/**
 * settings.js — versioned, fail-safe persistent settings (T-B5).
 * Pure migrate/clamp helpers + a tiny store factory (fs injected). Corrupt or
 * outdated settings degrade to defaults instead of crashing (EC-D1); restored
 * window bounds are clamped to a visible display (EC-D2).
 */

const SETTINGS_VERSION = 1;

const DEFAULTS = Object.freeze({
  version: SETTINGS_VERSION,
  theme: 'paper',
  zoomFactor: 1,
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
  if (typeof raw.sidebarVisible === 'boolean') out.sidebarVisible = raw.sidebarVisible;
  if (typeof raw.inspectorVisible === 'boolean') out.inspectorVisible = raw.inspectorVisible;
  if (raw.uiDirection === 'rtl' || raw.uiDirection === 'ltr') out.uiDirection = raw.uiDirection;
  if (raw.uiLocale === 'ar' || raw.uiLocale === 'en') out.uiLocale = raw.uiLocale;
  if (raw.numerals === 'arabic-indic' || raw.numerals === 'western') out.numerals = raw.numerals;
  if (raw.calendar === 'hijri' || raw.calendar === 'gregorian') out.calendar = raw.calendar;
  if (typeof raw.arabicKashida === 'boolean') out.arabicKashida = raw.arabicKashida;
  if (typeof raw.italicRecolor === 'boolean') out.italicRecolor = raw.italicRecolor;
  if (typeof raw.cmEditor === 'boolean') out.cmEditor = raw.cmEditor;
  if (Array.isArray(raw.recents)) {
    out.recents = raw.recents
      .filter(r => r && typeof r.path === 'string')
      .slice(0, 10)
      .map(r => ({ name: String(r.name || ''), path: r.path, vaultRoot: typeof r.vaultRoot === 'string' ? r.vaultRoot : null, abs: typeof r.abs === 'string' ? r.abs : null }));
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
  if (raw.lastSession && typeof raw.lastSession === 'object') {
    const s = raw.lastSession;
    out.lastSession = {
      vaultPath: typeof s.vaultPath === 'string' ? s.vaultPath : undefined,
      openPaths: Array.isArray(s.openPaths) ? s.openPaths.filter(p => typeof p === 'string') : [],
      activePath: typeof s.activePath === 'string' ? s.activePath : undefined,
    };
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

module.exports = {
  SETTINGS_VERSION, DEFAULTS, defaultSettings, migrate, clampZoom, clampWindowBounds, createSettingsStore,
};
