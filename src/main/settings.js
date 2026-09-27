/**
 * settings.js — versioned, fail-safe persistent settings (T-B5).
 * Pure migrate/clamp helpers + a tiny store factory (fs injected). Corrupt or
 * outdated settings degrade to defaults instead of crashing (EC-D1); restored
 * window bounds are clamped to a visible display (EC-D2).
 */

// v5 adds four keys (T0.1): readingProgress (per-file scroll position, LRU-capped),
// themeFollowSystem (first-run system colour-scheme follow), updateCheck ('manual'|'auto'),
// readingGoalMin (0|10|20|30). A key migrate() does not handle explicitly is DROPPED on the
// next save, which is why all four land here in one go.
const SETTINGS_VERSION = 5;
const CAPABILITY_ID = /^cap-[A-Za-z0-9_-]{1,128}$/;
const READING_PROGRESS_CAP = 30;
const { atomicWriteJson } = require('./json-store');

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
  calendar: 'gregorian',
  arabicKashida: false,
  italicRecolor: true,

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
  // v5 (T0.1). readingProgress is the only array-of-objects key besides recents; the other
  // three are small scalars. themeFollowSystem defaults TRUE here but migrates to FALSE for
  // an existing file, so a saved theme is never overridden by the system on upgrade.
  readingProgress: [],
  themeFollowSystem: true,
  updateCheck: 'manual',
  readingGoalMin: 10,
  window: { w: 1280, h: 820, maximized: false },
  lastSession: null,
});

const THEMES = ['paper', 'ink', 'sepia', 'oasis'];
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

// v5 (T0.1): the reading-position shelf. An entry is only usable if it can be REOPENED, so
// one of the two opaque capability ids must be present and well-formed — a loose/untitled
// file is rejected here exactly as it is in the renderer's progressEntryFor().
function sanitizeReadingProgress(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === 'object'
      && typeof entry.path === 'string' && entry.path !== ''
      && typeof entry.ratio === 'number' && Number.isFinite(entry.ratio)
      && entry.ratio >= 0 && entry.ratio <= 1
      && typeof entry.at === 'number' && Number.isFinite(entry.at) && entry.at > 0
      && (CAPABILITY_ID.test(entry.vaultId || '') || CAPABILITY_ID.test(entry.documentId || '')))
    .map((entry) => {
      const vaultId = CAPABILITY_ID.test(entry.vaultId || '') ? entry.vaultId : null;
      const documentId = CAPABILITY_ID.test(entry.documentId || '') ? entry.documentId : null;
      return {
        key: typeof entry.key === 'string' ? entry.key.slice(0, 1024) : '',
        name: String(entry.name || '').slice(0, 1024),
        path: typeof entry.path === 'string' ? entry.path.slice(0, 1024) : entry.path,
        vaultId,
        documentId,
        ratio: entry.ratio,
        at: entry.at,
      };
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, READING_PROGRESS_CAP);
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
  if (raw.calendar === 'hijri' || raw.calendar === 'gregorian') out.calendar = raw.calendar;
  if (typeof raw.arabicKashida === 'boolean') out.arabicKashida = raw.arabicKashida;
  if (typeof raw.italicRecolor === 'boolean') out.italicRecolor = raw.italicRecolor;
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
        name: String(r.name || '').slice(0, 1024),
        path: r.path.slice(0, 1024),
        vaultId: CAPABILITY_ID.test(r.vaultId || '') ? r.vaultId : null,
        documentId: CAPABILITY_ID.test(r.documentId || '') ? r.documentId : null,
      }));
  }
  // v5 (T0.1). themeFollowSystem is deliberately FALSE for any file that exists — an
  // upgrade must never let the system scheme override the theme the user already saved;
  // only defaultSettings() (no file at all) is true.
  out.themeFollowSystem = typeof raw.themeFollowSystem === 'boolean' ? raw.themeFollowSystem : false;
  if (raw.updateCheck === 'manual' || raw.updateCheck === 'auto') out.updateCheck = raw.updateCheck;
  if (raw.readingGoalMin === 0 || raw.readingGoalMin === 10
    || raw.readingGoalMin === 20 || raw.readingGoalMin === 30) out.readingGoalMin = raw.readingGoalMin;
  out.readingProgress = sanitizeReadingProgress(raw.readingProgress);
  if (raw.window && typeof raw.window === 'object') {
    const w = raw.window;
    // VAL-02: magnitudes are clamped to sane integers — a corrupt hand-edited settings
    // file used to pass w:1e9/h:-1e9 straight through to BrowserWindow (position is
    // sanitized separately by clampWindowBounds; magnitude never was).
    const clampDim = (v, fallback) => {
      if (!Number.isFinite(v)) return fallback;
      return Math.min(20000, Math.max(200, Math.round(v)));
    };
    out.window = {
      x: Number.isFinite(w.x) ? Math.round(w.x) : undefined,
      y: Number.isFinite(w.y) ? Math.round(w.y) : undefined,
      w: clampDim(w.w, DEFAULTS.window.w),
      h: clampDim(w.h, DEFAULTS.window.h),
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
      // VAL-01: every other persisted array is count-capped; lastSession.vaults was the
      // one unbounded hole — a runaway writer (or a compromised renderer) could balloon
      // settings.json and tax every subsequent save with re-serializing it.
      const vaults = s.vaults
        .filter(v => v && typeof v === 'object' && CAPABILITY_ID.test(v.vaultId || ''))
        .slice(0, 8)
        .map(v => ({
          vaultId: v.vaultId,
          openPaths: Array.isArray(v.openPaths)
            ? v.openPaths.filter(p => typeof p === 'string' && p.length <= 1024).slice(0, 200)
            : [],
        }));
      if (vaults.length) {
        const activeVaultId = CAPABILITY_ID.test(s.activeVaultId || '')
          && vaults.some(v => v.vaultId === s.activeVaultId)
          ? s.activeVaultId
          : vaults[0].vaultId;
        out.lastSession = {
          vaults,
          activeVaultId,
          activePath: typeof s.activePath === 'string' ? s.activePath.slice(0, 1024) : undefined,
        };
      }
    } else if (CAPABILITY_ID.test(s.vaultId || '')) {
      out.lastSession = {
        vaultId: s.vaultId,
        openPaths: Array.isArray(s.openPaths)
          ? s.openPaths.filter(p => typeof p === 'string' && p.length <= 1024).slice(0, 200)
          : [],
        activePath: typeof s.activePath === 'string' ? s.activePath.slice(0, 1024) : undefined,
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
    return atomicWriteJson(fs, file, JSON.stringify(migrate(settings), null, 2));
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
  sanitizeReadingProgress, READING_PROGRESS_CAP,
};
