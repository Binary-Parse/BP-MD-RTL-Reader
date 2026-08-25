'use strict';

import { isArabicHeavy, escapeHtml, escapeReg } from './i18n.js';
import { THEMES, getNextTheme, clampZoom } from './theme.js';
import { createState } from './state.js';
import { vaultSearch as _vaultSearch } from './components/search.js';
import { configureMarked, parseMarkdown as _parseMarkdown, parseCalloutHeader } from './markdown/markdown.js';
import { execEditCmd as _execEditCmdImpl } from './editor/edit-commands.js';
import { applyBidi } from './bidi-dom.js';
import { resolveDirection, resolveBlockDirection, slugify, resolveDocDirection, nextCellIndex } from './bidi.js';
import { transformCallouts } from './markdown/callouts.js';
import { activeHeading, sourceHeadingPositions } from './components/outline.js';
import { parseFrontMatter, frontMatterDirection } from './markdown/frontmatter.js';
import { dailyNoteName } from './dates.js';
import { highlightCode } from './markdown/highlight.js';
import { mathExtension, restoreMath, renderTex } from './markdown/math.js';
import { sanitizeHtml, sanitizeSvg } from './markdown/trusted.js';
import { renderMermaid } from './markdown/mermaid.js';
import { tableEdit } from './components/table-edit.js';
import { wrapTablesInFrames } from './components/table-frame.js';
import { getFocusable, trapTab, rovingNext } from './components/focus.js';
import { t as tr, localeDirection } from './locale.js';
import { buildExportDocAsync as buildExportDocImpl } from './markdown/export.js';
import { createCodeMirrorAdapter } from './editor/codemirror-adapter.js';
import { isDroppableFile } from './file-predicates.js';
import { buildFileTree, flattenTree, buildForest, prefixTreePaths } from './components/tree.js';
import { fileKey } from './session.js';
import { extractTagsFromFiles } from './components/tags.js';
import { createWorkspaceController } from './components/workspace-controller.js';
import { createSettingsController } from './components/settings-controller.js';

// =====================================================================
// OBSERVABILITY — renderer-side error capture (audit #25)
// Forwards window.onerror + unhandledrejection to main process, which
// writes them to <userData>/logs/bpmdrtlreader.log. Local-only. Optional-chain
// against electronAPI so the page still works when opened outside
// Electron (e.g. during Playwright file:// tests).
// =====================================================================
window.addEventListener('error', (e) => {
  try {
    window.electronAPI?.logError?.({
      message: e.message,
      stack: e.error?.stack,
      source: e.filename,
      line: e.lineno,
      col: e.colno,
    });
  } catch (_) { /* never crash inside the crash handler */ }
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    const reason = e.reason;
    window.electronAPI?.logError?.({
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      kind: 'unhandledrejection',
    });
  } catch (_) { /* never crash inside the crash handler */ }
});

// =====================================================================
// PROXY-BASED OBSERVABLE STATE
// =====================================================================
const { state: State, subscribe } = createState({
  files: [],
  activeFile: 0,
  theme: 'paper',
  direction: 'ltr',
  // forcedDir: the user's explicit content-direction choice from the top-bar toggle.
  // null = AUTO (smart per-block detection, the default); 'rtl'/'ltr' = force every block.
  // Ephemeral by design — not persisted; resets to AUTO on each launch (front-matter
  // `direction:` is the durable per-note mechanism).
  forcedDir: null,
  editorMode: 'live',
  // viewMode (T-F17): 'reading' = clean read-only rendered view (#noteContent shown, CM6 hidden,
  // copy yields clean prose, no markdown-on-click); 'edit' = the CM6 live-preview editor.
  // In-memory dev/test default is 'edit' (browser/dev with no settings bridge); the PACKAGED app
  // opens READING-first, driven by the persisted-settings default (src/main/settings.js viewMode:
  // 'reading') — same split as sidebarVisible above. Persisted globally once the user toggles.
  viewMode: 'edit',
  // In-memory defaults (used in browser/dev with no settings bridge). The PACKAGED app opens
  // with both panels CLOSED — driven by the persisted-settings default (src/main/settings.js)
  // + the static `no-sidebar no-inspector` classes on #appBody, so the first paint is the clean
  // editor-only view with no flash. A user's toggle is persisted and restored.
  sidebarVisible: true,
  inspectorVisible: true,
  vaultName: null,
  recents: [],
  findHits: [],
  findIdx: 0,
  zoomFactor: 1,
  readerTextScale: 1,
  readerWidthCh: 72,
  calendar: 'gregorian',
  arabicKashida: false,
  italicRecolor: true,
  cmEditor: false,
  uiLocale: 'en',
  uiDirection: 'ltr',
  // T-F19 chrome visibility. Both default OFF so the out-of-the-box window is the
  // familiar one and nobody meets a missing title bar without asking for it.
  autoHideTitlebar: false,
  hideStatusBar: false,
  // T-F19: 'file' shows the open document in the OS window title (and therefore the
  // Windows taskbar and Alt+Tab); 'app' pins the product name.
  windowTitleMode: 'file'
});

// Export for testing via window (smoke tests only)
window._appState = State;
window._appSubscribe = subscribe;

// Created after the renderer actions it injects have been declared. Toasts consult
// the controller during restore so applying persisted values stays quiet.
let settingsController = null;

// =====================================================================
// CONSTANTS & DOM REFS
// =====================================================================
const $ = id => document.getElementById(id);
const appEl = $('app');
const appBody = $('appBody');
const tabsEl = $('tabList');
const tabsWrapEl = $('tabs');
const treeEl = $('tree');
const sbEmptyEl = $('sbEmpty');
const noteContent = $('noteContent');
const welcomeEl = $('welcome');
const toolbarStrip = $('toolbarStrip');
const tocList = $('tocList');
const palOverlay = $('palOverlay');
const palInput = $('palInput');
const palResults = $('palResults');
const dropdown = $('dropdown');
const ctxMenu = $('ctxMenu');
const toastEl = $('toast');
const fileInput = $('fileInput');
const modalOverlay = $('modalOverlay');
const modalTitle = $('modalTitle');
const modalBody = $('modalBody');
const editorArea = $('editorArea');
const srcTextarea = $('srcTextarea');
const readerControlsEl = $('readerControls');
const readerControlsButton = $('readerControlsButton');
const readerControlsPopover = $('readerControlsPopover');
const readerTextScaleDecrease = $('readerTextScaleDecrease');
const readerTextScaleReset = $('readerTextScaleReset');
const readerTextScaleIncrease = $('readerTextScaleIncrease');
const readerWidthSlider = $('readerWidthSlider');
const readerWidthValue = $('readerWidthValue');

configureMarked(marked);
// T-F9: tokenize math BEFORE markdown so the LaTeX source is never corrupted by
// markdown's escape/emphasis rules (restored from placeholders after sanitize).
marked.use(mathExtension());

function parseMarkdown(md) {
  return _parseMarkdown(md, { marked, DOMPurify, escapeHtml });
}

// ── Vault image resolution (R10) ────────────────────────────────────────────
// A note-relative image `![](pic.png)` must load from the note's neighbour on
// disk, not from the app's index.html origin. We rewrite such srcs to
// `bpmd://vault/<vaultId>/<relPath>`, served by the registered bpmd:// protocol
// (src/main/protocol-controller.js) against that SPECIFIC vault's root — B1
// (multi-folder workspaces): the id makes the URL resolve against the note's own
// folder even while another folder is open, instead of "whichever folder was read
// last". No-op for absolute/scheme/data: srcs and for non-vault notes (browser/dev,
// new notes — they have no on-disk neighbour).
// Collapse a path to a clean vault-relative form; null if it escapes the vault.
function normalizeRel(p) {
  const parts = [];
  for (const seg of String(p || '').split(/[\\/]+/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}
// Resolve a raw <img> src against the note's directory → vault-relative path, or
// null when it should be left untouched (already a scheme/absolute/anchor).
function vaultRelImage(src, noteDir) {
  src = String(src || '');
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('/') || src.startsWith('#')) return null;
  const rel = normalizeRel((noteDir ? noteDir + '/' : '') + src);
  return rel || null;
}
// Rewrite every note-relative <img> in `container` to a bpmd:// URL. Uses the
// active file's vault capability/path; a no-op when the note isn't an on-disk vault file.
function rewriteVaultImages(container) {
  if (!container) return;
  const file = State.activeFile != null ? State.files[State.activeFile] : null;
  if (!file || !file.vaultId) return;
  const noteDir = normalizeRel(String(file.path || '').replace(/[^\\/]*$/, ''));
  // Decode each segment first (so an already-percent-encoded author path isn't
  // double-encoded), then encode once — the protocol handler decodes once to the
  // literal filename. A no-op for plain names.
  const enc = (seg) => { let d = seg; try { d = decodeURIComponent(seg); } catch (_) { /* keep raw */ } return encodeURIComponent(d); };
  container.querySelectorAll('img[src]').forEach(img => {
    const rel = vaultRelImage(img.getAttribute('src'), noteDir);
    if (rel) img.setAttribute('src', 'bpmd://vault/' + encodeURIComponent(file.vaultId) + '/' + rel.split('/').map(enc).join('/'));
  });
}
window.rewriteVaultImages = rewriteVaultImages;

// Apply per-block direction + inline bidi isolation to the rendered note
// (T-R1/R2). baseDir is the inherited direction for neutral-only blocks: the
// manual ⇄ toggle forces rtl, otherwise the document's first-strong char decides
// — no whole-document flip; each block resolves its own direction.
function applyBidiToNote(content) {
  const { data, body } = parseFrontMatter(content || '');
  const fmDir = frontMatterDirection(data); // T-R6: `direction:` declaration, or null
  // The EXPLICIT direction — the top-bar toggle first, then the note's front-matter — FORCES
  // every block of the note to that direction; null = AUTO (smart per-block detection).
  const forcedDir = State.forcedDir || fmDir || null;
  // Precedence for the container/indicator: manual ⇄ override > front-matter > content dominance.
  const docDir = resolveDocDirection({
    manual: State.forcedDir,
    frontMatter: fmDir,
    content: resolveBlockDirection(body, 'ltr'), // dominant-script: an Arabic-majority note reads RTL even if it opens with English
  });
  applyBidi(noteContent, { baseDir: docDir, escape: escapeHtml, forceDir: forcedDir });
  if (cmAdapter) cmAdapter.setDirection(docDir, forcedDir); // keep the CM6 editor in sync (also closes the front-matter gap)
  wrapTablesInFrames(noteContent, { locale: State.uiLocale });
  wireTableNav(noteContent); // T-R9: logical (EC-C2) arrow-key cell traversal in rendered tables
  // An explicit choice (toggle or front matter) flips the whole note's container direction;
  // otherwise the container stays neutral and each block resolves its own (R1/R2).
  const editorEl = $('editor');
  if (editorEl) {
    if (State.forcedDir === 'rtl') {
      // Forced RTL: explicit container dir to override the ltr default (blocks already forced).
      editorEl.setAttribute('dir', 'rtl');
      if (State.direction !== 'rtl') State.direction = 'rtl';
      updateDirUI();
    } else if (State.forcedDir === 'ltr') {
      // Forced LTR: container stays neutral (ltr is the default); blocks are forced via forceDir.
      editorEl.removeAttribute('dir');
      if (State.direction !== 'ltr') State.direction = 'ltr';
      updateDirUI();
    } else if (fmDir) {
      // Front matter governs: keep the indicator/inspector in sync with it.
      editorEl.setAttribute('dir', docDir);
      if (State.direction !== docDir) State.direction = docDir;
      updateDirUI();
    } else {
      // Neutral container (per-block); the document's overall direction is ltr.
      editorEl.removeAttribute('dir');
      if (State.direction !== 'ltr') State.direction = 'ltr';
      updateDirUI();
    }
  }
}
window.applyBidiToNote = applyBidiToNote;

// T-R9: make rendered table cells keyboard-navigable with LOGICAL arrow keys (EC-C2).
// Roving tabindex (one focusable cell) + a per-table keydown handler; all the
// direction-aware index math lives in the pure nextCellIndex (bidi.js). Re-run on every
// render (noteContent is rebuilt, so prior handlers die with the old DOM).
function wireTableNav(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('table').forEach((table) => {
    const cells = [...table.querySelectorAll('th, td')];
    if (!cells.length) return;
    cells.forEach((c, i) => c.setAttribute('tabindex', i === 0 ? '0' : '-1'));
    table.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const cell = e.target.closest && e.target.closest('th, td');
      if (!cell || !table.contains(cell)) return;
      const rowCells = [...cell.parentElement.children].filter((c) => c.matches('th, td'));
      const idx = rowCells.indexOf(cell);
      const next = nextCellIndex(idx, rowCells.length, e.key, table.getAttribute('dir') || 'ltr');
      if (next === idx) return;
      e.preventDefault();
      cells.forEach((c) => c.setAttribute('tabindex', '-1'));
      rowCells[next].setAttribute('tabindex', '0');
      rowCells[next].focus();
    });
  });
}

// Code highlighting + KaTeX math (T-F9). Runs on the rendered DOM BEFORE the bidi
// pass so code blocks (forced dir=ltr) and KaTeX spans (dir=ltr, ltr-isolated)
// compose with R1/R2. Both libraries are vendored locally and sanitized.
// Highlight code + restore KaTeX math placeholders inside a freshly-rendered element. Shared
// by the preview pane (decorateCodeAndMath) and the CM6 block widgets (renderCmBlock) so math/
// code render consistently in BOTH — previously a `$…$` inside a callout/table widget showed a
// raw placeholder hash because only the preview ran restoreMath. Mermaid is handled separately
// (async, per-surface) by the callers.
function decorateBlockContent(el) {
  if (!el) return;
  if (typeof hljs !== 'undefined') {
    highlightCode(el, { hljs, sanitize: (h) => sanitizeHtml(h, DOMPurify) });
  }
  if (typeof katex !== 'undefined') {
    restoreMath(el, { katex, DOMPurify });
  }
}
function decorateCodeAndMath() {
  decorateBlockContent(noteContent);
  // Mermaid (T-F16): heavy, so lazy-load the vendored engine only when a diagram
  // is present, then render asynchronously (SVG sanitized; dir=ltr; failures fall
  // back to the code block).
  if (noteContent.querySelector('pre > code.language-mermaid')) {
    loadMermaid()
      .then((mermaid) => renderMermaid(noteContent, {
        mermaid,
        sanitize: (svg) => sanitizeSvg(svg, DOMPurify),
        idPrefix: `mmd-${_mmdSeq++}`,
      }))
      .catch(() => { /* engine failed to load — code-block fallback remains */ });
  }
}
window.decorateCodeAndMath = decorateCodeAndMath;

// Lazy-load the vendored Mermaid engine once (3 MB — never on the critical path).
// securityLevel:'strict' + htmlLabels:false → SVG-native text (no <foreignObject>),
// so the SVG profile sanitizer keeps the labels.
let _mmdSeq = 0;
let _mermaidPromise = null;
function loadMermaid() {
  if (_mermaidPromise) return _mermaidPromise;
  _mermaidPromise = new Promise((resolve, reject) => {
    const init = (ns) => {
      const m = (ns && (ns.default || ns));
      if (!m || typeof m.render !== 'function') return reject(new Error('mermaid unavailable'));
      m.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false } });
      resolve(m);
    };
    // Mermaid's official UMD distribution exposes `window.mermaid`.  Older
    // vendored builds used `window.mermaidNS`; retain that alias so existing
    // sessions/tests that inject the legacy namespace continue to work.
    const existing = window.mermaidNS || window.mermaid;
    if (existing) return init(existing);
    const s = document.createElement('script');
    s.src = '../../resources/vendor/mermaid/mermaid.min.js';
    s.onload = () => init(window.mermaidNS || window.mermaid);
    s.onerror = () => { s.remove(); reject(new Error('mermaid script failed to load')); };
    document.head.appendChild(s);
  });
  // A transient first-load failure must not disable mermaid for the whole session:
  // drop the cached rejection so a later diagram retries.
  _mermaidPromise.catch(() => { _mermaidPromise = null; });
  return _mermaidPromise;
}
window.loadMermaid = loadMermaid;

window.isArabicHeavy = isArabicHeavy;

// =====================================================================
// TOAST
// =====================================================================
function showToast(msg, kind) {
  if (settingsController?.isRestoring()) return;
  toastEl.textContent = msg;
  toastEl.classList.remove('error', 'info');
  if (kind === 'error') toastEl.classList.add('error');
  else if (kind === 'info') toastEl.classList.add('info');
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2200);
}
window.showToast = showToast;

// =====================================================================
// THEME
// =====================================================================
function cycleTheme() {
  const next = getNextTheme(State.theme);
  State.theme = next;
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('bpmdrtlreader-theme', next);
  $('themeBtn').classList.toggle('active', next !== 'paper'); updateThemeIcon(next);
  if ($('themeLabel')) $('themeLabel').textContent = next;
  showToast(`Theme: ${next.charAt(0).toUpperCase() + next.slice(1)}`, 'info');
}
window.cycleTheme = cycleTheme;

function setTheme(t) {
  State.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('bpmdrtlreader-theme', t);
  $('themeBtn').classList.toggle('active', t !== 'paper'); updateThemeIcon(t);
  if ($('themeLabel')) $('themeLabel').textContent = t;
  closeMenu();
  showToast(`Theme: ${t.charAt(0).toUpperCase() + t.slice(1)}`, 'info');
}

// =====================================================================
// RTL
// =====================================================================
function toggleRTL() {
  // Cycle the EXPLICIT content-direction choice: AUTO → RTL → LTR → AUTO.
  // AUTO = smart per-block detection (default). RTL/LTR force EVERY block of the note.
  State.forcedDir = State.forcedDir === null ? 'rtl' : State.forcedDir === 'rtl' ? 'ltr' : null;
  appBody._manualRTL = State.forcedDir === 'rtl'; // back-compat mirror for existing RTL tests/export
  const editorEl = $('editor');
  // #srcTextarea must be dir=auto for RTL and NEVER literal rtl (spec §Constraints); cleared otherwise.
  if (State.forcedDir === 'rtl') srcTextarea.setAttribute('dir', 'auto');
  else srcTextarea.removeAttribute('dir');
  // #editor container: explicit 'rtl' ONLY for forced RTL (to override the ltr default). Forced
  // LTR and AUTO leave the container neutral — ltr is the default and blocks are forced per-block
  // (forceDir) regardless, so an explicit dir='ltr' here is unnecessary.
  if (State.forcedDir === 'rtl') { if (editorEl) editorEl.setAttribute('dir', 'rtl'); }
  else if (editorEl) editorEl.removeAttribute('dir');
  State.direction = State.forcedDir || 'ltr'; // forced sets it; AUTO defaults to ltr (refined by applyBidiToNote for a file)
  if (cmAdapter) cmAdapter.setDirection(State.forcedDir || State.direction, State.forcedDir); // T-F13: flip CM6 too
  // Re-resolve per-block direction + inline isolation under the new choice (also recomputes
  // State.direction + the indicator for AUTO/front-matter, where direction follows the content).
  const af = State.files[State.activeFile];
  if (af) af.forcedDir = State.forcedDir; // per-note durable choice (PARTIAL-01) — restored on tab switch in renderFile
  if (af) applyBidiToNote(af.content || '');
  updateDirUI();
  showToast(`Direction: ${State.forcedDir ? State.forcedDir.toUpperCase() : 'Auto'}`);
}
window.toggleRTL = toggleRTL;

function updateDirUI() {
  // The indicator + the lit state reflect the EFFECTIVE direction (forced choice, else the
  // auto/front-matter-resolved one) so a front-matter `direction: rtl` also lights the button.
  const isRTL = (State.forcedDir || State.direction) === 'rtl';
  $('dirIndicator').textContent = isRTL ? 'RTL' : 'LTR';
  $('propDir').textContent = isRTL ? 'RTL' : 'LTR';
  const btn = $('rtlBtn');
  if (btn) {
    btn.classList.toggle('active', isRTL);
    btn.setAttribute('aria-pressed', State.forcedDir !== null ? 'true' : 'false'); // pressed = the USER forced a direction
  }
}

// =====================================================================
// SIDEBAR / INSPECTOR TOGGLE
// =====================================================================
// Reflect the current panel-visibility State onto the layout grid. Single source of truth so
// the default (panels closed) shows correctly even with no settings bridge (browser/dev), and
// so toggles + restore stay in sync.
function applyPanelLayout() {
  appBody.classList.toggle('no-sidebar', !State.sidebarVisible);
  appBody.classList.toggle('no-inspector', !State.inspectorVisible);
  // T-F18: the titlebar toggles are disclosures — keep aria-expanded on the live state.
  // Done here (not in toggleSidebar/toggleInspector) so the shortcut, menu, palette and
  // settings-restore paths all stay in sync, mirroring setReaderControlsOpen().
  $('sidebarToggleBtn')?.setAttribute('aria-expanded', String(State.sidebarVisible));
  $('inspectorToggleBtn')?.setAttribute('aria-expanded', String(State.inspectorVisible));
}
window.applyPanelLayout = applyPanelLayout;

// =====================================================================
// T-F19: CHROME VISIBILITY (auto-hide title bar / hide status bar)
// =====================================================================
// Single source of truth, mirroring applyPanelLayout(): every path (toggle, shortcut,
// menu, palette, settings dialog, settings restore) lands here, so the DOM, the
// pre-paint cache and the pointer listener can never disagree.
const CHROME_PEEK_ATTR = 'data-chrome-peek';
// Distance below .app's top edge that counts as "at the top edge". Windows keeps a
// resize border over roughly the top 4 rows of a resizable frameless window
// (measured 2026-08-23: rows 0-4 answer HTTOP), so the DOM never sees a pointer
// there no matter what we do. 24px gives a band the cursor actually crosses on its way
// to the top edge, without reaching into the reading area.
const CHROME_REVEAL_BAND = 24;
let chromeMoveHandler = null;
let chromeLeaveHandler = null;
let chromePeekThreshold = 0;
let chromeRevealThreshold = 0;

function setChromePeek(on) {
  if (on) document.documentElement.setAttribute(CHROME_PEEK_ATTR, '');
  else document.documentElement.removeAttribute(CHROME_PEEK_ATTR);
}

// Both thresholds are measured from .app's top edge, not the viewport's. In Electron
// `html.electron .app { inset: 0 }` makes them identical; under file:// they differ, and
// anchoring to .app keeps the two lanes honest about the same pixels. Computed on first
// use and cached, because this runs from a pointer handler.
function ensureChromeThresholds() {
  const bar = $('titlebar') || document.querySelector('.titlebar');
  if (!chromeRevealThreshold && bar) {
    const appEl = $('app') || document.querySelector('.app');
    const appTop = appEl ? appEl.getBoundingClientRect().top : 0;
    chromeRevealThreshold = appTop + CHROME_REVEAL_BAND;
    chromePeekThreshold = appTop + bar.getBoundingClientRect().height + 8;
  }
  return bar;
}

function applyChromeLayout() {
  const flags = [];
  if (State.autoHideTitlebar) flags.push('autohide');
  if (State.hideStatusBar) flags.push('nostatus');
  const value = flags.join(' ');
  document.documentElement.setAttribute('data-chrome', value);
  if (!State.autoHideTitlebar) setChromePeek(false);
  // Pre-paint cache for theme-boot.js. settings.json stays authoritative; this only
  // avoids a frame of wrong chrome on launch, exactly as the theme mirror does.
  try { localStorage.setItem('bpmdrtlreader-chrome', value); } catch (_) { /* storage off */ }

  // The retract listener EXISTS only while auto-hide is on, so the ~100% of users who
  // never enable it pay nothing. Passive, and it re-reads layout only when the cached
  // threshold is stale — this fires during text selection over a CodeMirror surface
  // that holds a 16ms keystroke budget.
  if (State.autoHideTitlebar && !chromeMoveHandler) {
    chromePeekThreshold = 0;
    chromeRevealThreshold = 0;
    chromeMoveHandler = (e) => {
      // Never retract mid-gesture: the user may be dragging the window by the very bar
      // we would yank away. Electron delivers no pointer events over a drag region, but
      // a button press elsewhere in the bar still reaches us.
      if (e.buttons !== 0) return;
      const bar = ensureChromeThresholds();
      // REVEAL must come before the peek guard below: that guard returns early whenever
      // the bar is hidden, which is precisely when a reveal is the only thing that
      // matters. Writing the attribute only on entry keeps this to one write per
      // approach rather than one per pointer sample, on a document that also hosts CM6.
      if (e.clientY <= chromeRevealThreshold) {
        if (!document.documentElement.hasAttribute(CHROME_PEEK_ATTR)) setChromePeek(true);
        return;
      }
      if (!document.documentElement.hasAttribute(CHROME_PEEK_ATTR)) return;
      if (dropdown.classList.contains('open')) return;      // a menu owns the bar
      if (bar && bar.contains(document.activeElement)) return; // keyboard is inside it
      if (e.clientY > chromePeekThreshold) setChromePeek(false);
    };
    // Windows owns the top ~4 rows of a restored frameless window as a resize border and
    // sends the DOM nothing there. Move the pointer up FAST and the last mousemove the
    // renderer sees can be far below the reveal band -- measured 2026-08-23, a two-jump
    // flick delivered a single sample at clientY 272 and then silence. But leaving the
    // client area does fire mouseleave, carrying clientY 1, so that is the signal for
    // "went up and off the top". Below the band it means the pointer left sideways or
    // downward, which must not reveal anything.
    chromeLeaveHandler = (e) => {
      if (e.buttons !== 0) return;
      ensureChromeThresholds();   // a flick can be the very first pointer event we see
      if (e.clientY > chromeRevealThreshold) return;
      if (!document.documentElement.hasAttribute(CHROME_PEEK_ATTR)) setChromePeek(true);
    };
    document.addEventListener('mousemove', chromeMoveHandler, { passive: true });
    document.addEventListener('mouseleave', chromeLeaveHandler, { passive: true });
  } else if (!State.autoHideTitlebar && chromeMoveHandler) {
    document.removeEventListener('mousemove', chromeMoveHandler);
    document.removeEventListener('mouseleave', chromeLeaveHandler);
    chromeMoveHandler = null;
    chromeLeaveHandler = null;
  }
}
window.applyChromeLayout = applyChromeLayout;

function setAutoHideTitlebar(on) {
  State.autoHideTitlebar = !!on;
  applyChromeLayout();
  if (!settingsController?.isRestoring()) {
    showToast(on ? 'Top bar hidden — touch the top edge, or press Ctrl+Shift+T' : 'Top bar shown', 'info');
  }
}
function toggleAutoHideTitlebar() { setAutoHideTitlebar(!State.autoHideTitlebar); }
window.toggleAutoHideTitlebar = toggleAutoHideTitlebar;

function setHideStatusBar(on) {
  State.hideStatusBar = !!on;
  applyChromeLayout();
  if (!settingsController?.isRestoring()) {
    showToast(on ? 'Status bar hidden' : 'Status bar shown', 'info');
  }
}
function toggleHideStatusBar() { setHideStatusBar(!State.hideStatusBar); }
window.toggleHideStatusBar = toggleHideStatusBar;

// =====================================================================
// T-F19: OS WINDOW TITLE
// =====================================================================
// Electron mirrors document.title onto the native window unless a page-title-updated
// handler calls preventDefault(); this app registers none, so writing document.title
// here is what reaches the Windows taskbar and Alt+Tab. No IPC, no main-process change.
const PRODUCT_NAME = 'BP MD RTL Reader';
// U+2068 FIRST STRONG ISOLATE ... U+2069 POP DIRECTIONAL ISOLATE wrap the filename.
// FIRST STRONG, not LRI: the direction must come from the filename's own first strong
// character, so an Arabic name reads RTL and a Latin one LTR. A neutral "• " sitting directly against a
// strong-RTL name is resolved by the bidi algorithm from surrounding context, which is
// undefined for a bare window title — and unlike the DOM there is no <bdi> to reach for.
// Written as escapes on purpose: literal bidi control characters in source are the
// Trojan Source hazard (CVE-2021-42574) that security/detect-bidi-characters flags.
const FSI = '\u2068'; // FIRST STRONG ISOLATE
const PDI = '\u2069'; // POP DIRECTIONAL ISOLATE

function syncWindowTitle() {
  const file = State.activeFile !== null && State.activeFile !== undefined
    ? State.files[State.activeFile]
    : null;
  document.title = (State.windowTitleMode === 'app' || !file || !file.name)
    ? PRODUCT_NAME
    : `${file.dirty ? '\u2022 ' : ''}${FSI}${file.name}${PDI}`;
}
window.syncWindowTitle = syncWindowTitle;

function setWindowTitleMode(mode) {
  if (mode !== 'app' && mode !== 'file') return;
  State.windowTitleMode = mode; // persisted via the PERSISTED_KEYS subscribe hook
  syncWindowTitle();
}
window.setWindowTitleMode = setWindowTitleMode;

function toggleSidebar() {
  State.sidebarVisible = !State.sidebarVisible;
  applyPanelLayout();
  showToast(`Sidebar: ${State.sidebarVisible ? 'shown' : 'hidden'}`, 'info');
}

function toggleInspector() {
  State.inspectorVisible = !State.inspectorVisible;
  applyPanelLayout();
  closeMenu();
  showToast(`Inspector: ${State.inspectorVisible ? 'shown' : 'hidden'}`, 'info');
}
window.toggleInspector = toggleInspector;

// =====================================================================
// FULLSCREEN (v10 redesign, 2026-08-25)
// =====================================================================
// The label swaps with state (Full screen <-> Exit full screen), unlike the other
// titlebar toggles (rtlBtn, viewModeBtn), which keep a static title describing the
// action rather than the current state. A swapping label still has to survive a
// later locale switch, so this rewrites the data-i18n-* cache applyLocale() reads
// from, not just the live title/aria-label — otherwise the next applyLocale() call
// would silently revert the label to whatever was cached at boot.
function updateFullscreenUi() {
  const btn = $('fullscreenBtn');
  if (!btn) return;
  const isFull = !!document.fullscreenElement;
  const key = isFull ? 'titlebar.exitFullscreen' : 'titlebar.fullscreen';
  const enText = isFull ? 'Exit full screen' : 'Full screen';
  btn.setAttribute('aria-pressed', String(isFull));
  btn.querySelector('use')?.setAttribute('href', isFull ? '#ic-shrink' : '#ic-expand');
  btn.dataset.i18nTip = key;
  btn.dataset.i18nAriaLabel = key;
  btn.dataset.i18nTipOrig = enText;
  btn.dataset.i18nAriaLabelOrig = enText;
  const locale = State.uiLocale || 'en';
  const label = locale === 'en' ? enText : tr(key, locale);
  btn.setAttribute('data-tip', label);
  btn.setAttribute('aria-label', label);
}
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    $('app')?.requestFullscreen();
  }
}
window.toggleFullscreen = toggleFullscreen;
document.addEventListener('fullscreenchange', updateFullscreenUi);

// =====================================================================
// MODAL
// =====================================================================
// ---- Focus management (T-F4) -------------------------------------------------
// A stack of the elements that had focus before each overlay opened, so closing
// an overlay restores focus to whatever opened it. The stack (not a single field)
// is what makes nesting work: palette-over-modal restores into the modal first,
// then the modal restores to the original trigger.
const _focusStack = [];
function pushFocus() { _focusStack.push(document.activeElement); }
function restoreFocus() {
  const el = _focusStack.pop();
  if (el && typeof el.focus === 'function' && document.contains(el)) {
    try { el.focus(); } catch (_) { /* element no longer focusable */ }
  }
}

function openModal(title, html) {
  if (dropdown.classList.contains('open')) closeMenu(); // dismiss any open menu (returns focus to its button → captured as the restore target)
  modalTitle.textContent = title;
  modalBody.innerHTML = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(html) : '';
  // Only capture the opener on a fresh open — re-opening (e.g. Shortcuts→About swaps
  // the body while the overlay stays open) must not push a second, unpaired entry.
  if (!modalOverlay.classList.contains('open')) pushFocus();
  modalOverlay.classList.add('open');
  // Move focus into the dialog so Tab is trapped and SR users land inside it.
  setTimeout(() => { (getFocusable($('modalOverlay'))[0] || $('modalCloseBtn'))?.focus(); }, 0);
}
function closeModal() {
  if (!modalOverlay.classList.contains('open')) return;
  modalOverlay.classList.remove('open');
  restoreFocus();
}

function showShortcuts() {
  closeMenu();
  const groups = [
    ['File', [
      ['Open Folder…','Ctrl+Shift+O'],
      ['Open File…','Ctrl+O'],
      ['New Note','Ctrl+N'],
      ['New Daily Note','Ctrl+Shift+N'],
      ['Save','Ctrl+S'],
      ['Save As…','Ctrl+Shift+S'],
      ['Close Tab','Ctrl+W']
    ]],
    ['Edit', [
      ['Undo','Ctrl+Z'],
      ['Redo','Ctrl+Y'],
      ['Cut','Ctrl+X'],
      ['Copy','Ctrl+C'],
      ['Paste','Ctrl+V'],
      ['Select All','Ctrl+A'],
      ['Find','Ctrl+F'],
      ['Bold','Ctrl+B'],
      ['Italic','Ctrl+I'],
      ['Link','Ctrl+L'],
      ['Wikilink','Ctrl+K Ctrl+W']
    ]],
    ['View', [
      ['Toggle Sidebar','Ctrl+\\'],
      ['Toggle Inspector','Ctrl+Shift+I'],
      ['Cycle Theme','Ctrl+Shift+D'],
      ['Flip Direction','Ctrl+Shift+L'],
      ['Zoom In','Ctrl+='],
      ['Zoom Out','Ctrl+-'],
      ['Reset Zoom','Ctrl+0'],
      ['Command Palette','Ctrl+K'],
      [toggleFallback('autoHideTitlebar'), CHROME_TOGGLES.autoHideTitlebar.menuShortcut],
      [toggleFallback('hideStatusBar'), CHROME_TOGGLES.hideStatusBar.menuShortcut],
      ['Settings','Ctrl+,']
    ]],
    ['Help', [['Keyboard Shortcuts','Ctrl+/']]]
  ];
  let html = '';
  groups.forEach(([heading, rows]) => {
    html += `<h3>${heading}</h3>`;
    rows.forEach(([n, k]) => {
      const keys = k.split('+').map(p => `<span class="kbd">${p}</span>`).join('');
      html += `<div class="shortcut-row"><span class="shortcut-name">${n}</span><span class="shortcut-keys">${keys}</span></div>`;
    });
  });
  openModal('Keyboard Shortcuts', html);
}

function showAbout() {
  closeMenu();
  const html = `
    <div class="about-logo">BP</div>
    <div class="about-name">BP MD RTL Reader</div>
    <div class="about-version">version 1.1.0 · ${new Date().getFullYear()}</div>
    <p class="about-tagline">A markdown reader that treats prose like a literary object.</p>
    <p style="text-align: center; color: var(--ink-soft); font-size: 13px; line-height: 1.6;">
      Bilingual to its core — first-class English and Arabic.<br>
      Plain <code style="font-family: var(--mono); font-size: 12px; background: var(--paper-deep); padding: 1px 5px; border-radius: 3px;">.md</code> files on disk. No proprietary format.
    </p>
    <p style="text-align: center; color: var(--ink-soft); font-size: 12px; margin-top: 16px;">
      <strong>Binary Parse</strong> &middot; MIT License
    </p>
  `;
  openModal('About', html);
}

// T-Q6: opt-in update CHECK (user-initiated only; never auto-checks/downloads). Asks the
// main process to compare the running version against the public releases manifest, and
// reports the result via a toast. Degrades gracefully outside the desktop app.
async function checkForUpdate() {
  if (!window.electronAPI || typeof window.electronAPI.checkForUpdate !== 'function') {
    showToast('Update check needs the desktop app', 'error'); return;
  }
  showToast('Checking for updates…', 'info');
  let res;
  try { res = await window.electronAPI.checkForUpdate(); } catch (_) { res = { error: 'ipc' }; }
  if (res && res.updateAvailable) showToast(`Update available: ${res.latest} (you have ${res.current})`);
  else if (res && res.latest) showToast(`You're up to date (${res.current})`, 'info');
  else showToast('Could not check for updates', 'error');
  return res;
}
window.checkForUpdate = checkForUpdate;

// v10 redesign: a single source of truth for the two chrome-visibility toggles' on/off
// display text, so the four surfaces that show them (View menu, palette, right-click
// menu, shortcut sheet) can't drift apart the way five independent hand-copies of the
// same string inevitably do. The Settings dialog's switch is deliberately NOT one of the
// four — see showSettings()'s own comment on why its label must stay static.
const CHROME_TOGGLES = {
  autoHideTitlebar: {
    isOn: () => State.autoHideTitlebar,
    menuOnKey: 'menu.alwaysShowTitlebar', menuOffKey: 'menu.autoHideTitlebar',
    paletteOnKey: 'palette.alwaysShowTitlebar', paletteOffKey: 'palette.autoHideTitlebar',
    onFallback: 'Always Show Top Bar', offFallback: 'Auto-hide Top Bar',
    menuShortcut: 'Ctrl+Shift+T', paletteShortcut: 'Ctrl+⇧+T',
  },
  hideStatusBar: {
    isOn: () => State.hideStatusBar,
    menuOnKey: 'menu.showStatusBar', menuOffKey: 'menu.hideStatusBar',
    paletteOnKey: 'palette.showStatusBar', paletteOffKey: 'palette.hideStatusBar',
    onFallback: 'Show Bottom Status Bar', offFallback: 'Hide Bottom Status Bar',
    menuShortcut: 'Ctrl+Shift+B', paletteShortcut: 'Ctrl+⇧+B',
  },
};
function toggleMenuKey(id) { const t = CHROME_TOGGLES[id]; return t.isOn() ? t.menuOnKey : t.menuOffKey; }
function togglePaletteKey(id) { const t = CHROME_TOGGLES[id]; return t.isOn() ? t.paletteOnKey : t.paletteOffKey; }
function toggleFallback(id) { const t = CHROME_TOGGLES[id]; return t.isOn() ? t.onFallback : t.offFallback; }
window.CHROME_TOGGLES = CHROME_TOGGLES;

// =====================================================================
// DROPDOWN MENUS
// =====================================================================
const MENU_DEFS = {
  file: {
    x: 76,
    items: [
      { kind: 'label', text: 'Open', key: 'menu.open' },
      { kind: 'item', icon: 'folder', name: 'Open Folder…', key: 'menu.openFolder', shortcut: 'Ctrl+Shift+O', action: () => openVault() },
      { kind: 'item', icon: 'file', name: 'Open File…', key: 'menu.openFile', shortcut: 'Ctrl+O', action: () => openSingleFile() },
      { kind: 'divider' },
      { kind: 'label', text: 'New', key: 'menu.new' },
      { kind: 'item', icon: 'file-plus', name: 'New Note', key: 'menu.newNote', shortcut: 'Ctrl+N', action: () => newNote() },
      { kind: 'item', icon: 'calendar-plus', name: 'New Daily Note', key: 'menu.newDaily', shortcut: 'Ctrl+Shift+N', action: () => newDailyNote() },
      { kind: 'divider' },
      { kind: 'item', icon: 'save', name: 'Save', key: 'menu.save', shortcut: 'Ctrl+S', action: () => saveCurrent() },
      { kind: 'item', icon: 'save', name: 'Save As…', key: 'menu.saveAs', shortcut: 'Ctrl+Shift+S', action: () => saveAs() },
      { kind: 'divider' },
      { kind: 'item', icon: 'file-code', name: 'Export HTML', key: 'menu.exportHtml', action: () => exportHTML() },
      { kind: 'item', icon: 'printer', name: 'Export PDF', key: 'menu.exportPdf', action: () => exportPDF() },
      { kind: 'divider' },
      { kind: 'item', icon: 'sparkles', name: 'Load Demo Notes', key: 'menu.loadDemo', action: () => loadDemo() },
      { kind: 'divider' },
      { kind: 'item', icon: 'x', name: 'Close Tab', key: 'menu.closeTab', shortcut: 'Ctrl+W', action: () => { if (State.activeFile !== null) closeTab(State.activeFile); closeMenu(); } },
      { kind: 'item', icon: 'x', name: 'Close Window', key: 'menu.closeWindow', shortcut: 'Alt+F4', action: () => winClose() }
    ]
  },
  edit: {
    x: 110,
    items: [
      { kind: 'item', icon: 'undo-2', name: 'Undo', key: 'menu.undo', shortcut: 'Ctrl+Z', action: () => execEditCmd('undo') },
      { kind: 'item', icon: 'redo-2', name: 'Redo', key: 'menu.redo', shortcut: 'Ctrl+Y', action: () => execEditCmd('redo') },
      { kind: 'divider' },
      { kind: 'item', icon: 'scissors', name: 'Cut', key: 'menu.cut', shortcut: 'Ctrl+X', action: () => execEditCmd('cut') },
      { kind: 'item', icon: 'copy', name: 'Copy', key: 'menu.copy', shortcut: 'Ctrl+C', action: () => execEditCmd('copy') },
      { kind: 'item', icon: 'clipboard-paste', name: 'Paste', key: 'menu.paste', shortcut: 'Ctrl+V', action: () => execEditCmd('paste') },
      { kind: 'item', icon: 'text-select', name: 'Select All', key: 'menu.selectAll', shortcut: 'Ctrl+A', action: () => execEditCmd('selectAll') },
      { kind: 'divider' },
      { kind: 'item', icon: 'search', name: 'Find…', key: 'menu.find', shortcut: 'Ctrl+F', action: () => { closeMenu(); openFind(); } },
      { kind: 'divider' },
      { kind: 'item', icon: 'bold', name: 'Bold', key: 'menu.bold', shortcut: 'Ctrl+B', action: () => { closeMenu(); wrapSelection('**', '**'); } },
      { kind: 'item', icon: 'italic', name: 'Italic', key: 'menu.italic', shortcut: 'Ctrl+I', action: () => { closeMenu(); wrapSelection('*', '*'); } },
      { kind: 'item', icon: 'link', name: 'Insert Link', key: 'menu.insertLink', shortcut: 'Ctrl+L', action: () => { closeMenu(); insertText('[', '](url)'); } },
      { kind: 'item', icon: 'wikilink', name: 'Insert Wikilink', key: 'menu.insertWikilink', action: () => { closeMenu(); insertText('[[', ']]'); } }
    ]
  },
  view: {
    x: 145,
    items: [
      { kind: 'label', text: 'Panels', key: 'menu.panels' },
      { kind: 'check', name: 'Show Sidebar', key: 'menu.showSidebar', shortcut: 'Ctrl+\\', checked: () => State.sidebarVisible, action: () => { toggleSidebar(); closeMenu(); } },
      { kind: 'check', name: 'Show Inspector', key: 'menu.showInspector', shortcut: 'Ctrl+Shift+I', checked: () => State.inspectorVisible, action: toggleInspector },
      { kind: 'divider' },
      { kind: 'label', text: 'Theme', key: 'menu.theme' },
      { kind: 'check', name: 'Paper (light)', key: 'menu.themePaper', checked: () => State.theme === 'paper', action: () => setTheme('paper') },
      { kind: 'check', name: 'Ink (dark)', key: 'menu.themeInk', checked: () => State.theme === 'ink', action: () => setTheme('ink') },
      { kind: 'check', name: 'Sepia', key: 'menu.themeSepia', checked: () => State.theme === 'sepia', action: () => setTheme('sepia') },
      { kind: 'divider' },
      { kind: 'item', icon: 'flip', name: 'Flip Direction (RTL/LTR)', key: 'menu.flipDirection', shortcut: 'Ctrl+Shift+L', action: () => { toggleRTL(); closeMenu(); } },
      { kind: 'divider' },
      { kind: 'label', text: 'Calendar', key: 'menu.calendar' },
      { kind: 'check', name: 'Gregorian', key: 'menu.gregorian', checked: () => State.calendar === 'gregorian', action: () => setCalendar('gregorian') },
      { kind: 'check', name: 'Hijri (Umm al-Qura)', key: 'menu.hijri', checked: () => State.calendar === 'hijri', action: () => setCalendar('hijri') },
      { kind: 'divider' },
      { kind: 'label', text: 'Arabic', key: 'menu.arabic' },
      { kind: 'check', name: 'Arabic Interface (العربية)', key: 'menu.arabicInterface', checked: () => State.uiDirection === 'rtl', action: () => toggleArabicUI() },
      { kind: 'check', name: 'Kashida Justification', key: 'menu.kashida', checked: () => State.arabicKashida, action: () => toggleKashida() },
      { kind: 'divider' },
      { kind: 'label', text: 'Typography', key: 'menu.typography' },
      { kind: 'check', name: 'Recolour Italics', key: 'menu.recolourItalics', checked: () => State.italicRecolor, action: () => toggleItalicRecolor() },
      { kind: 'divider' },
      { kind: 'label', text: 'Chrome', key: 'menu.chrome' },
      // v10 redesign: these were kind:'check' items (a checkmark in the menu gutter) —
      // invisible for the top-bar item exactly when it matters, since hiding the bar also
      // hides the menu that would show the check. Now plain items whose label names the
      // direction a click will go, via CHROME_TOGGLES (shared with the palette, the
      // right-click menu, and the shortcut sheet).
      { kind: 'item', get key() { return toggleMenuKey('autoHideTitlebar'); }, get name() { return toggleFallback('autoHideTitlebar'); }, shortcut: 'Ctrl+Shift+T', action: () => { toggleAutoHideTitlebar(); closeMenu(); } },
      { kind: 'item', get key() { return toggleMenuKey('hideStatusBar'); }, get name() { return toggleFallback('hideStatusBar'); }, shortcut: 'Ctrl+Shift+B', action: () => { toggleHideStatusBar(); closeMenu(); } },
      { kind: 'divider' },
      { kind: 'item', icon: 'align-justify', name: 'Settings…', key: 'menu.settings', shortcut: 'Ctrl+,', action: () => { closeMenu(); showSettings(); } },
      { kind: 'divider' },
      { kind: 'label', text: 'Zoom', key: 'menu.zoom' },
      { kind: 'item', icon: 'zoom-in', name: 'Zoom In', key: 'menu.zoomIn',    shortcut: 'Ctrl+=', action: () => { zoomIn();    closeMenu(); } },
      { kind: 'item', icon: 'zoom-out', name: 'Zoom Out', key: 'menu.zoomOut',   shortcut: 'Ctrl+-', action: () => { zoomOut();   closeMenu(); } },
      { kind: 'item', icon: 'rotate-ccw', name: 'Reset Zoom', key: 'menu.resetZoom', shortcut: 'Ctrl+0', action: () => { zoomReset(); closeMenu(); } },
      { kind: 'divider' },
      { kind: 'item', icon: 'command', name: 'Command Palette', key: 'menu.commandPalette', shortcut: 'Ctrl+K', action: () => { closeMenu(); openPalette(); } }
    ]
  },
  help: {
    x: 184,
    items: [
      { kind: 'item', icon: 'keyboard', name: 'Keyboard Shortcuts', key: 'menu.shortcuts', shortcut: 'Ctrl+/', action: showShortcuts },
      { kind: 'item', icon: 'refresh-cw', name: 'Check for Updates…', key: 'menu.checkUpdates', action: () => { closeMenu(); checkForUpdate(); } },
      { kind: 'item', icon: 'info', name: 'About BP MD RTL Reader', key: 'menu.about', action: showAbout }
    ]
  }
};

// The element that opened the current menu — focus returns to it on close (T-F5).
let _menuOpener = null;
function openMenu(e, name) {
  e.stopPropagation();
  if (dropdown.classList.contains('open') && dropdown.dataset.menu === name) {
    closeMenu(); return;
  }
  closeMenu();
  buildMenu(name);
  document.querySelectorAll('.tb-menu-item').forEach(m => m.classList.remove('open-menu'));
  if (e.currentTarget.classList.contains('tb-menu-item')) e.currentTarget.classList.add('open-menu');
  dropdown.classList.add('open');
  dropdown.dataset.menu = name;
  // T-R7: align the dropdown's inline-start to the button's inline-start using LIVE
  // geometry — correct under both LTR and RTL UI (and robust to localized label widths),
  // unlike the old hard-coded LTR x offsets. Falls back to MENU_DEFS.x if geometry is absent.
  const btnEl = e.currentTarget;
  const parent = dropdown.offsetParent;
  if (btnEl && typeof btnEl.getBoundingClientRect === 'function' && parent) {
    const br = btnEl.getBoundingClientRect();
    const pr = parent.getBoundingClientRect();
    const rtl = getComputedStyle(parent).direction === 'rtl';
    dropdown.style.insetInlineStart = Math.max(0, rtl ? (pr.right - br.right) : (br.left - pr.left)) + 'px';
  } else {
    dropdown.style.insetInlineStart = MENU_DEFS[name].x + 'px';
  }
  _menuOpener = btnEl;
  // Keyboard-opened (Enter/Space → click with detail 0): move focus into the menu
  // for roving navigation. Mouse-opened: leave focus on the editor so Copy/Cut from
  // the Edit menu still reads the live selection (the items preventDefault mousedown).
  if (e.detail === 0) {
    const first = dropdown.querySelector('.dd-item:not(.disabled)');
    if (first) setTimeout(() => first.focus(), 0);
  }
}

function buildMenu(name) {
  const def = MENU_DEFS[name];
  let html = '';
  // Resolve the display string via the locale catalog when the item carries a key
  // (T-R7), falling back to the literal name/text so any un-keyed item still renders.
  // buildMenu runs on every open, so it reads State.uiLocale live — no applyLocale hook.
  const label = (it) => (it.key ? tr(it.key, State.uiLocale) : (it.name ?? it.text));
  def.items.forEach((it, i) => {
    if (it.kind === 'label') html += `<div class="dd-section-label">${escapeHtml(label(it))}</div>`;
    else if (it.kind === 'divider') html += `<div class="dd-divider"></div>`;
    else if (it.kind === 'check') {
      const checked = it.checked ? it.checked() : false;
      html += `<div class="dd-item${checked ? ' checked' : ''}" data-i="${i}" role="menuitemcheckbox" aria-checked="${checked}" tabindex="0">
        <span class="dd-check">✓</span><span class="dd-icon"></span>
        <span class="dd-name">${escapeHtml(label(it))}</span>
        ${it.shortcut ? `<span class="dd-shortcut">${escapeHtml(it.shortcut)}</span>` : ''}
      </div>`;
    } else {
      html += `<div class="dd-item${it.disabled ? ' disabled' : ''}" data-i="${i}" role="menuitem"${it.disabled ? ' aria-disabled="true"' : ' tabindex="0"'}>
        <span class="dd-icon">${it.icon ? `<svg class="ic"><use href="#ic-${escapeHtml(it.icon)}"/></svg>` : ''}</span>
        <span class="dd-name">${escapeHtml(label(it))}</span>
        ${it.shortcut ? `<span class="dd-shortcut">${escapeHtml(it.shortcut)}</span>` : ''}
      </div>`;
    }
  });
  dropdown.innerHTML = html;
  dropdown.setAttribute('role', 'menu');
  dropdown.querySelectorAll('.dd-item:not(.disabled)').forEach(el => {
    const i = parseInt(el.dataset.i);
    const activate = () => { try { def.items[i].action(); } catch(err) { console.error(err); } };
    // Don't let mousedown blur the editor before the action runs — Copy/Cut/Undo
    // need the textarea to stay focused with its selection intact.
    el.addEventListener('mousedown', e => e.preventDefault());
    el.onclick = activate;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } };
  });
}

function closeMenu() {
  const hadFocusInside = dropdown.contains(document.activeElement);
  dropdown.classList.remove('open');
  document.querySelectorAll('.tb-menu-item').forEach(m => m.classList.remove('open-menu'));
  // If a menu item held focus (keyboard use), return focus to the opener button so
  // it isn't stranded on a now-hidden item. Mouse use (focus on the editor) is left
  // alone. This also lets a menu action that opens a dialog capture the button as the
  // restore target. (T-F5)
  if (hadFocusInside && _menuOpener && document.contains(_menuOpener)) {
    try { _menuOpener.focus(); } catch (_) { /* opener gone */ }
  }
  _menuOpener = null;
}

// =====================================================================
// FIND IN PAGE (Ctrl+F)
// =====================================================================
function openFind() {
  const findBar = $('findBar');
  findBar.classList.add('open');
  setTimeout(() => $('findInput').focus(), 50);
}
function closeFind() {
  const findBar = $('findBar');
  findBar.classList.remove('open');
  if (cmAdapter) cmAdapter.setSearchHighlight(''); // F13: clear the .cm-searchMatch highlights
  noteContent.querySelectorAll('mark.find-hit').forEach(m => {
    const text = document.createTextNode(m.textContent);
    m.parentNode.replaceChild(text, m);
  });
  noteContent.normalize();
  State.findHits = [];
  $('findInfo').textContent = '0/0';
}
function runFind(q) {
  noteContent.querySelectorAll('mark.find-hit').forEach(m => {
    const t = document.createTextNode(m.textContent);
    m.parentNode.replaceChild(t, m);
  });
  noteContent.normalize();
  State.findHits = [];
  State.findSourceMatches = [];  // positions for source mode

  // Source mode: search inside the source editor, since the preview is hidden. Re-homed
  // onto the active EditorPort (T-F13) so it works for both the textarea and CodeMirror.
  // `|| cmAdapter`: in single CM6 mode the editor stays 'live' but the searchable surface
  // is the CM6 source (the markdown preview pane is hidden). cmAdapter is null without ?cm=1,
  // so the default textarea path is unchanged.
  if (State.viewMode !== 'reading' && (State.editorMode === 'source' || cmAdapter)) {
    // F13: highlight EVERY match in the CM6 editor (.cm-searchMatch), not just the selected
    // one. Cleared when the query is empty / on closeFind. No-op for the textarea fallback.
    if (cmAdapter) cmAdapter.setSearchHighlight(q);
    if (!q) { $('findInfo').textContent = '0/0'; return; }
    let matches;
    if (cmAdapter) {
      matches = cmAdapter.find(q);
    } else {
      const re = new RegExp(escapeReg(q), 'gi');
      const val = srcTextarea.value;
      let m; matches = [];
      while ((m = re.exec(val)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length });
        if (m.index === re.lastIndex) re.lastIndex++; // safety
      }
    }
    State.findSourceMatches = matches;
    State.findIdx = 0;
    if (matches.length) {
      if (cmAdapter) { cmAdapter.focus(); cmAdapter.setSelection(matches[0]); }
      else { srcTextarea.focus(); srcTextarea.setSelectionRange(matches[0].start, matches[0].end); }
    }
    $('findInfo').textContent = `${matches.length ? 1 : 0}/${matches.length}`;
    return;
  }

  if (!q) { $('findInfo').textContent = '0/0'; return; }
  const re = new RegExp(escapeReg(q), 'gi');
  const walker = document.createTreeWalker(noteContent, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let n; while ((n = walker.nextNode())) textNodes.push(n);
  textNodes.forEach(node => {
    const txt = node.nodeValue;
    if (!re.test(txt)) return;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(txt)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(txt.slice(last, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      mark.textContent = m[0];
      frag.appendChild(mark);
      State.findHits.push(mark);
      last = m.index + m[0].length;
    }
    if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });
  State.findIdx = 0;
  State.findHits.forEach((mark, idx) => {
    mark.addEventListener('click', () => {
      State.findHits.forEach(m => m.classList.remove('current'));
      State.findIdx = idx;
      mark.classList.add('current');
      $('findInfo').textContent = `${idx + 1}/${State.findHits.length}`;
      // Bug 6 fix: scroll only within the preview-pane container so statusbar never shifts
      scrollMarkIntoPane(mark);
    });
  });
  if (State.findHits.length) {
    State.findHits[0].classList.add('current');
    scrollMarkIntoPane(State.findHits[0]);
  }
  $('findInfo').textContent = `${State.findHits.length ? 1 : 0}/${State.findHits.length}`;
}

// Bug 6 fix: manual scrollTop arithmetic confined to the .preview-pane scroll container.
// This prevents document-level scrollIntoView from shifting the statusbar.
function scrollMarkIntoPane(mark) {
  const scrollEl = document.querySelector('.preview-pane');
  if (!scrollEl) {
    // .preview-pane always exists when find-marks are rendered; this branch
    // is unreachable in practice. Return silently rather than calling
    // mark.scrollIntoView() which would re-trigger the document-shift bug.
    return;
  }
  const markRect = mark.getBoundingClientRect();
  const paneRect = scrollEl.getBoundingClientRect();
  const markTop = markRect.top - paneRect.top + scrollEl.scrollTop;
  scrollEl.scrollTop = markTop - scrollEl.clientHeight / 2;
}

function findStep(d) {
  // Source mode (or single CM6 mode): navigate source/EditorPort match positions.
  if (State.viewMode !== 'reading' && (State.editorMode === 'source' || cmAdapter)) {
    const matches = State.findSourceMatches || [];
    if (!matches.length) return;
    State.findIdx = (State.findIdx + d + matches.length) % matches.length;
    const m = matches[State.findIdx];
    if (cmAdapter) { cmAdapter.focus(); cmAdapter.setSelection(m); }      // T-F13
    else { srcTextarea.focus(); srcTextarea.setSelectionRange(m.start, m.end); }
    $('findInfo').textContent = `${State.findIdx + 1}/${matches.length}`;
    return;
  }
  if (!State.findHits.length) return;
  State.findHits[State.findIdx].classList.remove('current');
  State.findIdx = (State.findIdx + d + State.findHits.length) % State.findHits.length;
  State.findHits[State.findIdx].classList.add('current');
  // Bug 6 fix: use contained scroll instead of scrollIntoView
  scrollMarkIntoPane(State.findHits[State.findIdx]);
  $('findInfo').textContent = `${State.findIdx + 1}/${State.findHits.length}`;
}

// =====================================================================
// EXPORT HTML
// =====================================================================
// Thin renderer wrapper around the extracted, import-testable export module (T-F12):
// injects the app's configured parseMarkdown + the manual-direction state + math globals.
function buildExportDoc(f) {
  return buildExportDocImpl(f, {
    direction: State.forcedDir || 'auto',
    parseMarkdown,
    katex: (typeof katex !== 'undefined') ? katex : null,
    DOMPurify: (typeof DOMPurify !== 'undefined') ? DOMPurify : null,
    hljs: (typeof hljs !== 'undefined') ? hljs : null,
    sanitizeHighlight: (html) => sanitizeHtml(html, DOMPurify),
    loadMermaid,
  });
}

async function exportHTML() {
  closeMenu();
  if (State.activeFile === null || !State.files[State.activeFile]) {
    showToast('No file to export', 'error'); return;
  }
  const { fullHtml, baseName } = await buildExportDoc(State.files[State.activeFile]);
  const blob = new Blob([fullHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName + '.html';
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${a.download}`);
  return fullHtml; // also returned so the export markup is unit/e2e-testable
}
window.exportHTML = exportHTML;

// Export the current note to PDF (T-F6). Reuses the standalone export document and
// hands it to the main process (T-B6), which renders it offscreen and printToPDFs it.
// PDF export is a desktop-only capability (needs the Electron bridge).
async function exportPDF() {
  closeMenu();
  if (State.activeFile === null || !State.files[State.activeFile]) {
    showToast('No file to export', 'error'); return;
  }
  if (!window.electronAPI || typeof window.electronAPI.exportPDF !== 'function') {
    showToast('PDF export needs the desktop app', 'error'); return;
  }
  const { fullHtml, baseName } = await buildExportDoc(State.files[State.activeFile]);
  showToast('Exporting PDF…');
  let res;
  try {
    res = await window.electronAPI.exportPDF({ html: fullHtml, defaultName: baseName + '.pdf' });
  } catch (_) {
    res = { error: 'ipc-failed' };
  }
  if (res && res.ok) showToast(`Exported ${baseName}.pdf`);
  else if (res && res.canceled) { /* user cancelled — stay quiet */ }
  else showToast('PDF export failed', 'error');
  return res;
}
window.exportPDF = exportPDF;
window.buildExportDoc = buildExportDoc;

// =====================================================================
// NEW DAILY NOTE
// =====================================================================
function newDailyNote() {
  closeMenu();
  const d = new Date();
  // T-R8: filename + heading follow the chosen calendar (Gregorian or Hijri Umm al-Qura).
  const name = dailyNoteName(d, State.calendar);
  const existing = State.files.findIndex(f => f.name === name);
  if (existing >= 0) { renderFile(existing); return; }
  const title = name.replace(/\.md$/, '');
  addFile({ name, path: name, handle: null, content: `# ${title}\n\n`, dirty: true });
}

// T-R8: daily-note calendar (Gregorian | Hijri). Persisted via settings:set (F8).
function setCalendar(cal) {
  if (cal !== 'gregorian' && cal !== 'hijri') return;
  State.calendar = cal; // triggers persistSettings via the subscribe hook
  closeMenu();
  showToast(`Calendar: ${cal === 'hijri' ? 'Hijri (Umm al-Qura)' : 'Gregorian'}`, 'info');
}
window.setCalendar = setCalendar;

// T-R10: Arabic justification. Default OFF = ragged (the typographically safe default for
// Arabic). When ON, RTL blocks fill the measure via inter-character distribution (the
// closest CSS gets to OpenType kashida in Chromium) — see the `.kashida` rule. Persisted (F8).
function applyKashida() { appBody.classList.toggle('kashida', !!State.arabicKashida); }
function setKashida(on) {
  State.arabicKashida = !!on; // triggers persistSettings via the subscribe hook
  applyKashida();
  closeMenu();
  if (!settingsController?.isRestoring()) showToast(`Arabic justification: ${State.arabicKashida ? 'kashida' : 'ragged'}`, 'info');
}
function toggleKashida() { setKashida(!State.arabicKashida); }
window.setKashida = setKashida;
window.toggleKashida = toggleKashida;

// T-F11: italic recolor is ON by default (rendered <em> picks up the plum accent). This is an
// OPT-OUT — when disabled, emphasis keeps the body ink colour (only the slant distinguishes it).
// Persisted (F8). The `.no-italic-recolor` class neutralizes the accent in #noteContent.
function applyItalicRecolor() { appBody.classList.toggle('no-italic-recolor', !State.italicRecolor); }
function setItalicRecolor(on) {
  State.italicRecolor = !!on; // triggers persistSettings via the subscribe hook
  applyItalicRecolor();
  closeMenu();
  if (!settingsController?.isRestoring()) showToast(`Italic recolour: ${State.italicRecolor ? 'on' : 'off'}`, 'info');
}
function toggleItalicRecolor() { setItalicRecolor(!State.italicRecolor); }
window.setItalicRecolor = setItalicRecolor;
window.toggleItalicRecolor = toggleItalicRecolor;

// ── T-R7: full RTL/Arabic UI (mirror + localize), persisted via F8 ──────────────
// Localize chrome strings tagged with data-i18n. The original (English) innerHTML is
// captured once into data-i18nOrig and restored for 'en' — so the default UI (incl. the
// File/Edit/View/Help accelerator <u> underlines) is untouched, and 'ar' shows translations.
function applyLocale(locale) {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    if (el.dataset.i18nOrig === undefined) el.dataset.i18nOrig = el.innerHTML;
    if (locale === 'en') el.innerHTML = el.dataset.i18nOrig;
    else el.textContent = tr(el.dataset.i18n, locale);
  });
  // Elements whose localized string carries trusted inline markup (welcome title/lede
  // with <em>/<code>) — set via innerHTML from the static catalog (T-R7).
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    if (el.dataset.i18nHtmlOrig === undefined) el.dataset.i18nHtmlOrig = el.innerHTML;
    el.innerHTML = locale === 'en' ? el.dataset.i18nHtmlOrig : tr(el.dataset.i18nHtml, locale);
  });
  // <input> placeholders — textContent/innerHTML don't apply (find/search bars, T-R7).
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    if (el.dataset.i18nPhOrig === undefined) el.dataset.i18nPhOrig = el.getAttribute('placeholder') || '';
    el.setAttribute('placeholder', locale === 'en' ? el.dataset.i18nPhOrig : tr(el.dataset.i18nPlaceholder, locale));
  });
  // v10 redesign (2026-08-25): data-tip tooltips (find prev/next/close buttons, T-R7)
  // - was title=.
  document.querySelectorAll('[data-i18n-tip]').forEach(el => {
    if (el.dataset.i18nTipOrig === undefined) el.dataset.i18nTipOrig = el.getAttribute('data-tip') || '';
    el.setAttribute('data-tip', locale === 'en' ? el.dataset.i18nTipOrig : tr(el.dataset.i18nTip, locale));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    if (el.dataset.i18nAriaLabelOrig === undefined) el.dataset.i18nAriaLabelOrig = el.getAttribute('aria-label') || '';
    el.setAttribute('aria-label', locale === 'en' ? el.dataset.i18nAriaLabelOrig : tr(el.dataset.i18nAriaLabel, locale));
  });

  wrapTablesInFrames(noteContent, { locale });
  wrapTablesInFrames(document.querySelector('.cm-mount'), { locale });
}
function setUiLocale(locale) {
  if (locale !== 'en' && locale !== 'ar') return;
  State.uiLocale = locale;
  document.documentElement.setAttribute('lang', locale);
  applyLocale(locale);
}
// Mirror the whole chrome by setting the document direction; the grid/flex layout and
// logical CSS reverse, and the F11 chevrons flip. Content/code/math keep their own dir.
function setUiDirection(dir) {
  if (dir !== 'ltr' && dir !== 'rtl') return;
  State.uiDirection = dir;
  document.documentElement.setAttribute('dir', dir);
}
// One switch for the Arabic interface: ar+rtl together (locale implies direction).
function setArabicUI(on) {
  setUiLocale(on ? 'ar' : 'en');
  setUiDirection(on ? localeDirection('ar') : localeDirection('en'));
  closeMenu();
  if (!settingsController?.isRestoring()) showToast(on ? 'الواجهة بالعربية' : 'English interface', 'info');
}
function toggleArabicUI() { setArabicUI(State.uiDirection !== 'rtl'); }
window.setUiLocale = setUiLocale;
window.setUiDirection = setUiDirection;
window.setArabicUI = setArabicUI;
window.toggleArabicUI = toggleArabicUI;

// =====================================================================
// EDIT MENU COMMANDS
// =====================================================================
async function clipboardCopy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch(e) { showToast('Clipboard write failed', 'error'); }
}

// Track the last-focused editable element (textarea or input). This is needed
// because clicking the Edit menu blurs the textarea — by the time execEditCmd
// runs, document.activeElement is the menu DIV, not the textarea.
let _lastFocusedEditable = null;
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
    _lastFocusedEditable = t;
  }
}, true);

function execEditCmd(cmd) {
  // All logic lives in src/renderer/editor/edit-commands.js (testable + mutatable).
  // This shim builds the deps object and forwards. Critically: selectAll is
  // NEVER routed through electronAPI.editCommand because webContents.selectAll
  // would select the entire renderer DOM (titlebar/sidebar/statusbar).
  const deps = {
    electronAPI: cmd === 'selectAll' ? null : (window.electronAPI || null),
    getMode: () => State.editorMode,
    // v10 redesign: selectAll is routed by VIEW mode (reading vs edit), never by editor
    // mode above — CM6 mounts unconditionally at launch, so it can exist while Reading
    // mode has it hidden behind #noteContent. See edit-commands.js's selectAll().
    getViewMode: () => State.viewMode,
    hasDocument: () => State.activeFile !== null && !!State.files[State.activeFile],
    getCmAdapter: () => cmAdapter, // T-F13: CM6 is the live editor — Edit menu acts on it
    getSrcTextarea: () => srcTextarea,
    getNoteContent: () => noteContent,
    getLastFocusedEditable: () => _lastFocusedEditable,
    getActiveElement: () => document.activeElement,
    getSelection: () => window.getSelection(),
    createRange: () => document.createRange(),
    clipboard: (navigator && navigator.clipboard) || null,
    showToast: (m, l) => showToast(m, l),
    closeMenu: () => closeMenu(),
  };
  return _execEditCmdImpl(cmd, deps);
}
window.execEditCmd = execEditCmd;

// =====================================================================
// CONTEXT MENU (v10 redesign, D1) — themed HTML menu drawn from main's descriptors over
// an IPC bridge, replacing Electron's native Menu.popup(). Main is the sole authority on
// what the menu contains and what each action does; the renderer only draws it and echoes
// back { nonce, index } — never a label, url or role — so main can safely re-derive and
// dispatch the real action itself (see window-controller.js's contextMenuStash).
// =====================================================================
let _ctxItems = null;   // flat combined list this draw represents: descriptors then appCommands
let _ctxNonce = null;
let _ctxRestoreTarget = null; // focus target to restore before dispatching (keyboard nav moves focus into the menu)

function clearCtxMenu() {
  while (ctxMenu.firstChild) ctxMenu.removeChild(ctxMenu.firstChild);
}

// Pure UI teardown, shared by both close paths below — never touches the main-side stash.
function hideCtxMenuUI() {
  ctxMenu.hidden = true;
  clearCtxMenu();
  _ctxNonce = null;
  _ctxItems = null;
  if (_ctxRestoreTarget && document.contains(_ctxRestoreTarget)) {
    try { _ctxRestoreTarget.focus(); } catch (_) { /* target gone */ }
  }
  _ctxRestoreTarget = null;
}

// Dismissal WITHOUT a selection (Escape, click-away, a second right-click elsewhere): tells
// main to drop its stash entry, since it will otherwise sit there until the nonce is reused
// or the window closes.
function closeCtxMenu() {
  if (ctxMenu.hidden) return;
  const nonce = _ctxNonce;
  hideCtxMenuUI();
  if (nonce && window.electronAPI && typeof window.electronAPI.contextMenuClosed === 'function') {
    window.electronAPI.contextMenuClosed(nonce);
  }
}

function dispatchCtxItem(index) {
  if (ctxMenu.hidden) return;
  const nonce = _ctxNonce;
  // Restore focus to whatever held it before the menu opened BEFORE sending the IPC:
  // main's role dispatch (webContents.cut/copy/paste) acts on whatever the renderer's
  // page currently has focused, and keyboard navigation moves focus onto the menu itself.
  if (_ctxRestoreTarget && document.contains(_ctxRestoreTarget)) {
    try { _ctxRestoreTarget.focus(); } catch (_) { /* target gone */ }
  }
  // Tear down the UI WITHOUT sending context-menu:closed — that would delete main's stash
  // entry for this nonce before the contextAction below ever reaches it (single-use nonce).
  hideCtxMenuUI();
  if (window.electronAPI && typeof window.electronAPI.contextAction === 'function') {
    window.electronAPI.contextAction({ nonce, index });
  }
}

// Same display strings and accelerators as the Edit menu (MENU_DEFS) for the same roles —
// buildContextMenuTemplate's descriptors carry only the bare Chromium role id (e.g. 'copy'),
// not a human label.
const CTX_ROLE_DISPLAY = {
  undo: ['Undo', 'Ctrl+Z'], redo: ['Redo', 'Ctrl+Y'], cut: ['Cut', 'Ctrl+X'],
  copy: ['Copy', 'Ctrl+C'], paste: ['Paste', 'Ctrl+V'], selectAll: ['Select All', 'Ctrl+A'],
};

// Main's context-menu APP_COMMANDS carry only { kind, id } — no label or shortcut, since
// main has no access to State or the locale catalog. Resolved here, locale-aware, reusing
// the same menu.* keys the View/File menus already declare (no new locale strings).
const APP_COMMAND_DISPLAY = {
  newNote: ['menu.newNote', 'Ctrl+N'],
  openFind: ['menu.find', 'Ctrl+F'],
  openPalette: ['menu.commandPalette', 'Ctrl+K'],
  // Dynamic, via CHROME_TOGGLES (shared with the View menu, the palette and the shortcut
  // sheet) — a getter so re-opening the menu after toggling re-resolves the direction.
  get toggleAutoHideTitlebar() { return [toggleMenuKey('autoHideTitlebar'), 'Ctrl+Shift+T']; },
  get toggleHideStatusBar() { return [toggleMenuKey('hideStatusBar'), 'Ctrl+Shift+B']; },
  showSettings: ['menu.settings', 'Ctrl+,'],
};

function renderCtxItem(item, index) {
  const isSeparator = item.kind === 'separator';
  if (isSeparator) {
    const div = document.createElement('div');
    div.className = 'dd-divider';
    return div;
  }
  const isRole = item.kind === 'role';
  const [roleLabel, roleShortcut] = isRole ? (CTX_ROLE_DISPLAY[item.role] || [item.role, '']) : [null, null];
  const isAppCommand = item.kind === 'app-command';
  let appLabel = null, appShortcut = null;
  if (isAppCommand) {
    const entry = APP_COMMAND_DISPLAY[item.id];
    [appLabel, appShortcut] = entry ? [tr(entry[0], State.uiLocale), entry[1]] : [item.id, ''];
  }
  const disabled = isRole && !item.enabled;
  const el = document.createElement('div');
  el.className = 'dd-item' + (disabled ? ' disabled' : '');
  el.setAttribute('role', 'menuitem');
  if (disabled) el.setAttribute('aria-disabled', 'true');
  else el.tabIndex = 0;
  const icon = document.createElement('span');
  icon.className = 'dd-icon';
  el.appendChild(icon);
  const name = document.createElement('span');
  name.className = 'dd-name';
  // textContent, never innerHTML: a link/image/spellcheck label carries attacker-influenced
  // text (a page's own link text, a filename, a Chromium spellcheck suggestion) that must
  // never be parsed as markup, Trusted Types default policy or not.
  name.textContent = item.label || roleLabel || appLabel || '';
  el.appendChild(name);
  const shortcutText = item.shortcut || roleShortcut || appShortcut;
  if (shortcutText) {
    const shortcut = document.createElement('span');
    shortcut.className = 'dd-shortcut';
    shortcut.textContent = shortcutText;
    el.appendChild(shortcut);
  }
  if (!disabled) {
    el.addEventListener('mousedown', (e) => e.preventDefault()); // don't steal focus from the target on click
    el.addEventListener('click', () => dispatchCtxItem(index));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatchCtxItem(index); }
    });
  }
  return el;
}

function openCtxMenu({ nonce, descriptors, appCommands, x, y }) {
  closeCtxMenu();
  _ctxNonce = nonce;
  _ctxItems = [...descriptors, ...(descriptors.length && appCommands.length ? [{ kind: 'separator' }] : []), ...appCommands];
  _ctxRestoreTarget = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  clearCtxMenu();
  // The separator inserted above is display-only and must not consume an action index —
  // reconstruct the wire index (descriptors.length + k) for each appCommands entry.
  let wireIndex = 0;
  for (const item of descriptors) { ctxMenu.appendChild(renderCtxItem(item, wireIndex)); wireIndex++; }
  if (descriptors.length && appCommands.length) ctxMenu.appendChild(renderCtxItem({ kind: 'separator' }, -1));
  appCommands.forEach((item, k) => ctxMenu.appendChild(renderCtxItem(item, descriptors.length + k)));

  ctxMenu.hidden = false;
  // Clamp to the viewport (T-T4-alike: a menu opened near an edge must stay fully visible).
  const rect = ctxMenu.getBoundingClientRect();
  const left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4));
  ctxMenu.style.left = `${left}px`;
  ctxMenu.style.top = `${top}px`;

  const first = ctxMenu.querySelector('.dd-item:not(.disabled)');
  if (first) first.focus();
}

function ctxMenuItems() {
  return Array.from(ctxMenu.querySelectorAll('.dd-item:not(.disabled)'));
}

ctxMenu.addEventListener('keydown', (e) => {
  const items = ctxMenuItems();
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next = items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next.focus();
  } else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeCtxMenu(); }
});
document.addEventListener('click', (e) => {
  if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) closeCtxMenu();
});
document.addEventListener('contextmenu', () => {
  // A second right-click elsewhere replaces the menu; main sends a fresh context-menu:show
  // for it, but the old one (if any) must not linger visually until that arrives.
  if (!ctxMenu.hidden) closeCtxMenu();
}, true);

if (window.electronAPI && typeof window.electronAPI.onContextMenu === 'function') {
  window.electronAPI.onContextMenu((payload) => openCtxMenu(payload));
}
if (window.electronAPI && typeof window.electronAPI.onAppCommand === 'function') {
  window.electronAPI.onAppCommand((command) => {
    // selectAll never crosses into main as an executed action — see window-controller.js's
    // ROLE_METHODS comment. It relays the id back here so the same view-aware, chrome-safe
    // selectAll the keyboard shortcut uses handles the context menu's Select All too.
    const handlers = {
      newNote, openFind, openPalette, toggleAutoHideTitlebar, toggleHideStatusBar, showSettings,
      selectAll: () => execEditCmd('selectAll'),
    };
    const handler = handlers[command];
    if (typeof handler === 'function') handler();
  });
}

// =====================================================================
// SIDEBAR PANE SWITCHING
// =====================================================================
function switchSbPane(name) {
  document.querySelectorAll('.sb-tab').forEach(t => t.classList.toggle('active', t.dataset.pane === name));
  document.querySelectorAll('.sb-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === name));
  if (name === 'tags') renderTags();
  if (name === 'search') setTimeout(() => $('sbSearchInput').focus(), 50);
}

// =====================================================================
// SIDEBAR SEARCH
// =====================================================================

// ==== VAULT SEARCH ====
// Pure search function — extracted for unit testing.
// Returns [{name, fileIdx, hits:[{before, match, after, ellipsisBefore, ellipsisAfter}]}],
// max 5 hits per file. Raw text segments — no HTML; rendering is done by runSidebarSearch
// via DOM API to eliminate innerHTML injection risk.
function vaultSearch(query) {
  return _vaultSearch(query, State.files);
}
window.vaultSearch = vaultSearch;

// ==== SIDEBAR SEARCH RENDERER ====
// Builds result DOM entirely via createElement + textContent (no innerHTML injection).
function runSidebarSearch(q) {
  const out = $('searchResults');
  q = q.trim();
  if (q.length < 2) {
    out.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = 'Type to search.';
    out.appendChild(empty);
    return;
  }
  const results = vaultSearch(q);
  out.textContent = ''; // clear previous results without innerHTML
  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = `No matches for "${q}".`;
    out.appendChild(empty);
    return;
  }
  results.forEach(r => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'search-result';
    card.addEventListener('click', () => { renderFile(r.fileIdx); switchSbPane('files'); });

    const nameEl = document.createElement('div');
    nameEl.className = 'sr-name';
    nameEl.textContent = r.name;
    card.appendChild(nameEl);

    if (r.hits.length > 0) {
      r.hits.forEach(h => {
        const snip = document.createElement('div');
        snip.className = 'sr-snip';
        if (h.ellipsisBefore) snip.appendChild(document.createTextNode('… '));
        snip.appendChild(document.createTextNode(h.before));
        const markEl = document.createElement('mark');
        markEl.textContent = h.match;
        snip.appendChild(markEl);
        snip.appendChild(document.createTextNode(h.after));
        if (h.ellipsisAfter) snip.appendChild(document.createTextNode(' …'));
        card.appendChild(snip);
      });
    } else {
      const snip = document.createElement('div');
      snip.className = 'sr-snip';
      const em = document.createElement('em');
      em.textContent = 'name match';
      snip.appendChild(em);
      card.appendChild(snip);
    }

    out.appendChild(card);
  });
}

let _sidebarSearchTimer = null;
let _sidebarSearchGeneration = 0;
function scheduleSidebarSearch(q) {
  const generation = ++_sidebarSearchGeneration;
  clearTimeout(_sidebarSearchTimer);
  _sidebarSearchTimer = setTimeout(() => {
    if (generation === _sidebarSearchGeneration) runSidebarSearch(q);
  }, 150);
}

// =====================================================================
// EDITOR MODE
// =====================================================================
function setEditorMode(mode) {
  if (!mode || typeof mode !== 'string') return;
  State.editorMode = mode;
  editorArea.classList.remove('split', 'source');
  if (mode === 'split') editorArea.classList.add('split');
  else if (mode === 'source') editorArea.classList.add('source');
  // The 3 mode buttons were removed when CM6 became the sole editor (T-F13); guard the
  // toggles so the dead textarea-fallback path (ensureSourceFocus) can't throw on null.
  $('modeLive')?.classList.toggle('active', mode === 'live');
  $('modeSplit')?.classList.toggle('active', mode === 'split');
  $('modeSource')?.classList.toggle('active', mode === 'source');
  $('propMode').textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
}
window.setEditorMode = setEditorMode;

// =====================================================================
// ZOOM (T-T4) — app-wide: scale the rem BASE on :root. All chrome + content is sized
// in rem, so the whole UI scales together, while the .app frame stays viewport-sized
// (height: calc(100vh - …)) so nothing is pushed off-screen — the grid re-lays-out
// inside the viewport instead of being scaled past it (the failure mode of zooming a
// fixed-height, overflow:hidden container). The T-T5 11px floor keeps the smallest
// labels legible at zoom 1. 16 = the rem base in px. (Was Issue #5, content-only zoom.)
// =====================================================================
const ZOOM_BASE_PX = 16;
function setZoom(factor) {
  if (typeof factor !== 'number' || isNaN(factor)) return;
  const clamped = clampZoom(factor);
  let nativeZoom = null;
  try {
    if (typeof window.electronAPI?.setAppZoom === 'function') nativeZoom = window.electronAPI.setAppZoom(clamped);
  } catch (_) { /* browser/dev fall back to the rem base */ }
  if (typeof nativeZoom === 'number' && Number.isFinite(nativeZoom)) {
    State.zoomFactor = clampZoom(nativeZoom);
    document.documentElement.style.fontSize = '';
  } else {
    State.zoomFactor = clamped;
    document.documentElement.style.fontSize = (ZOOM_BASE_PX * clamped) + 'px';
  }
  editorArea.style.zoom = ''; // clear legacy content-only scaling in both paths
}
function zoomIn()    { setZoom(State.zoomFactor * 1.1); }
function zoomOut()   { setZoom(State.zoomFactor / 1.1); }
function zoomReset() { setZoom(1); }
window.setZoom   = setZoom;
window.zoomIn    = zoomIn;
window.zoomOut   = zoomOut;
window.zoomReset = zoomReset;

// =====================================================================
// READER CONTROLS — document text scale/measure only (separate from app zoom)
// =====================================================================
function clampReaderTextScale(scale) {
  return Math.round(Math.min(2, Math.max(0.8, scale)) * 10) / 10;
}
function clampReaderWidthCh(width) {
  return Math.round(Math.min(120, Math.max(48, width)) / 2) * 2;
}
function updateReaderControlValues() {
  if (!readerTextScaleReset || !readerWidthSlider || !readerWidthValue) return;
  readerTextScaleReset.textContent = `${Math.round(State.readerTextScale * 100)}%`;
  readerWidthSlider.value = String(State.readerWidthCh);
  readerWidthValue.textContent = `${State.readerWidthCh}ch`;
}
function setReaderTextScale(scale) {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) return State.readerTextScale;
  const applied = clampReaderTextScale(scale);
  State.readerTextScale = applied;
  document.documentElement.style.setProperty('--reader-text-scale', String(applied));
  updateReaderControlValues();
  return applied;
}
function setReaderWidthCh(width) {
  if (typeof width !== 'number' || !Number.isFinite(width)) return State.readerWidthCh;
  const applied = clampReaderWidthCh(width);
  State.readerWidthCh = applied;
  document.documentElement.style.setProperty('--reader-width', `${applied}ch`);
  updateReaderControlValues();
  return applied;
}
function setReaderControlsOpen(open, restoreFocus = false) {
  if (!readerControlsButton || !readerControlsPopover) return;
  const next = !readerControlsEl.hidden && !!open;
  readerControlsPopover.hidden = !next;
  readerControlsButton.setAttribute('aria-expanded', String(next));
  if (!next && restoreFocus) readerControlsButton.focus();
}
function syncReaderControls() {
  if (!readerControlsEl) return;
  const hasDocument = State.activeFile !== null && !!State.files[State.activeFile];
  if (!hasDocument) setReaderControlsOpen(false);
  readerControlsEl.hidden = !hasDocument;
  readerControlsEl.classList.toggle('with-toolbar', hasDocument && State.viewMode !== 'reading');
  updateReaderControlValues();
}
window.setReaderTextScale = setReaderTextScale;
window.setReaderWidthCh = setReaderWidthCh;

// =====================================================================
// TABS
// =====================================================================
function renderTabs() {
  tabsEl.querySelectorAll('.tab').forEach(t => t.remove());
  State.files.forEach((f, i) => {
    if (f.open === false) return;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab' + (i === State.activeFile ? ' active' : '') + (f.dirty ? ' dirty' : '') + (f.conflict ? ' conflict' : '');
    tab.dataset.fileIdx = String(i);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(i === State.activeFile));
    tab.setAttribute('aria-controls', 'noteContent');
    tab.tabIndex = i === State.activeFile ? 0 : -1;
    tab.dataset.tip = f.conflict ? `${f.name} — changed on disk (unresolved)` : f.name;
    const closeIcon = f.dirty ? '●' : '×';
    // T-B9/EC-A2: a ⚠ marks a background tab whose file diverged on disk (surfaces the
    // conflict even when the tab isn't active; the resolve banner shows on switching to it).
    if (f.conflict) {
      const conflictMark = document.createElement('span');
      conflictMark.className = 'tab-conflict';
      conflictMark.setAttribute('aria-label', 'changed on disk');
      conflictMark.textContent = '⚠';
      tab.appendChild(conflictMark);
    }
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = f.name;
    const close = document.createElement('span');
    close.className = 'close';
    close.setAttribute('aria-hidden', 'true');
    close.textContent = closeIcon;
    tab.append(name, close);
    tab.querySelector('.close').addEventListener('click', e => { e.stopPropagation(); closeTab(i); });
    tab.addEventListener('click', () => renderFile(i));
    tab.addEventListener('keydown', e => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); closeTab(i); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const openTabs = [...tabsEl.querySelectorAll('.tab')];
      const at = openTabs.indexOf(tab);
      const next = openTabs[(at + (e.key === 'ArrowRight' ? 1 : -1) + openTabs.length) % openTabs.length];
      next?.focus();
      next?.click();
    });
    tabsEl.appendChild(tab);
  });
  syncWindowTitle(); // T-F19: tab set or dirty flags changed
}

function updateTabState(idx) {
  const f = State.files[idx];
  const tab = tabsEl.querySelector(`.tab[data-file-idx="${idx}"]`);
  if (!f || !tab) return;
  tab.classList.toggle('dirty', Boolean(f.dirty));
  tab.classList.toggle('conflict', Boolean(f.conflict));
  tab.dataset.tip = f.conflict ? `${f.name} — changed on disk (unresolved)` : f.name;
  const close = tab.querySelector('.close');
  if (close) close.textContent = f.dirty ? '●' : '×';
  if (idx === State.activeFile) syncWindowTitle(); // T-F19: dirty flag flipped
}

function closeTab(idx) {
  const f = State.files[idx];
  if (f.dirty) {
    if (!confirm(`"${f.name}" has unsaved changes. Close anyway?`)) return;
  }
  if (f.inventory) {
    f.open = false;
    const next = State.files.findIndex((file, i) => i !== idx && file.open !== false);
    if (next < 0) { State.activeFile = null; showWelcome(); return; }
    renderFile(next);
    return;
  }
  State.files.splice(idx, 1);
  // B4: a loose (non-inventory) file is tree-visible under @loose, so removing it here
  // must refresh the tree too -- every remaining file's fileIdx shifted by the splice.
  renderTree(State.files);
  if (State.files.length === 0) { State.activeFile = null; showWelcome(); return; }
  if (State.activeFile === idx) renderFile(Math.max(0, idx - 1));
  else { if (State.activeFile > idx) State.activeFile--; renderTabs(); }
}

// v10 redesign: .tabs clips vertically (overflow-y: hidden), so a [data-tip]::after tooltip
// on a .tab or #tabAddBtn would render fully outside the visible box (see index.html's
// #floatingTip comment). This shared, JS-positioned element stands in for both.
const floatingTipEl = $('floatingTip');
let floatingTipTimer = null;

function positionFloatingTip(target) {
  const tip = target.dataset.tip;
  if (!tip || !floatingTipEl) return;
  floatingTipEl.textContent = tip;
  floatingTipEl.hidden = false;
  const targetRect = target.getBoundingClientRect();
  const tipRect = floatingTipEl.getBoundingClientRect();
  const gap = 8;
  let left = targetRect.left + targetRect.width / 2 - tipRect.width / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - tipRect.width - 4));
  floatingTipEl.style.left = `${left}px`;
  floatingTipEl.style.top = `${targetRect.bottom + gap}px`;
  floatingTipEl.classList.add('show');
}

function hideFloatingTip() {
  clearTimeout(floatingTipTimer);
  floatingTipTimer = null;
  if (!floatingTipEl) return;
  floatingTipEl.classList.remove('show');
  floatingTipEl.hidden = true;
}

if (floatingTipEl && tabsWrapEl) {
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const scheduleShow = (target) => {
    clearTimeout(floatingTipTimer);
    floatingTipTimer = setTimeout(() => positionFloatingTip(target), reduceMotion() ? 0 : 350);
  };
  // mouseover/mouseout (not mouseenter/mouseleave) so a move between a tab's own children
  // (name span, close button) does not spuriously hide/reshow the tooltip: relatedTarget
  // still lands inside the same closest('[data-tip]') element, so it's ignored below.
  tabsWrapEl.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target || target.contains(e.relatedTarget)) return;
    scheduleShow(target);
  });
  tabsWrapEl.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target || target.contains(e.relatedTarget)) return;
    hideFloatingTip();
  });
  tabsWrapEl.addEventListener('focusin', (e) => {
    const target = e.target.closest('[data-tip]');
    if (target) scheduleShow(target);
  });
  tabsWrapEl.addEventListener('focusout', (e) => {
    if (e.target.closest?.('[data-tip]')) hideFloatingTip();
  });
}

function showWelcome() {
  welcomeEl.style.display = 'grid';
  noteContent.style.display = 'none';
  toolbarStrip.style.display = 'none';
  editorArea.classList.add('welcome'); // T-F13: reveal the welcome (preview pane) over the CM6 surface
  editorArea.classList.remove('reading'); // the welcome screen never carries a stale reading class (T-F17)
  syncReaderControls();
  $('conflictBar') && ($('conflictBar').innerHTML = ''); // no open file → no conflict banner
  renderTabs();
  $('propFile').textContent = '—';
  $('propWords').textContent = '0';
  $('propRead').textContent = '—';
  $('readTime').textContent = '— min read';
  $('wordCount').textContent = '0 words';
  $('cursorPos').textContent = '— · —';
  tocList.className = 'toc-empty';
  tocList.textContent = 'No document opened.';
  renderRecents();
}

// =====================================================================
// VIEW MODE — Reading (clean read-only render) vs Edit (CM6) — T-F17
// =====================================================================
// Rebuild the rendered #noteContent from the active file's CURRENT content, so entering
// reading mode reflects unsaved edits even within the live-edit debounce window. Mirrors the
// renderFile/applyEditorInput preview pipeline but does NOT touch the CM6 editor.
function renderReadingContent() {
  const f = State.files[State.activeFile];
  if (!f) return;
  const { body } = parseFrontMatter(f.content || '');
  const html = parseMarkdown(body);
  const wordCount = (body.match(/\S+/g) || []).length;
  noteContent.innerHTML = `
    <div class="doc-meta" aria-hidden="true">
      <span>note</span><span>·</span>
      <span>${wordCount} words</span><span>·</span>
      <span>${escapeHtml(f.path)}</span>${f.dirty ? '<span>·</span><span style="color: var(--accent);">● unsaved</span>' : ''}
    </div>
    ${html}
  `;
  rewriteVaultImages(noteContent);                                            // R10
  transformCallouts(noteContent, { parseCalloutHeader, resolveDirection: resolveBlockDirection }); // F14
  decorateCodeAndMath();                                                      // F9
  applyBidiToNote(f.content || '');                                           // R1/R2
  buildTOC();
  noteContent.querySelectorAll('a.wikilink').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); navWikilink(a.dataset.target); });
  });
}

// Apply a view mode: 'reading' shows the clean rendered note (#noteContent) and hides the CM6
// editor + writing toolbar; 'edit' shows the CM6 surface. Persisted via the PERSISTED_KEYS hook.
function setViewMode(mode) {
  if (mode !== 'reading' && mode !== 'edit') return;
  State.viewMode = mode;
  editorArea.classList.toggle('reading', mode === 'reading');
  const open = State.activeFile !== null && State.files[State.activeFile];
  toolbarStrip.style.display = (mode === 'reading') ? 'none' : (open ? 'flex' : 'none');
  syncReaderControls();
  const btn = $('viewModeBtn');
  if (btn) {
    btn.setAttribute('aria-pressed', String(mode === 'reading'));
    btn.classList.toggle('active', mode === 'reading');
  }
  if (mode === 'reading') {
    if (open) { renderReadingContent(); noteContent.focus(); } // focusable scroll region (a11y)
  } else if (cmAdapter && typeof cmAdapter.focus === 'function') {
    cmAdapter.focus();
    // Reading wires the preview listener; rebuild after returning to Edit so CM6 owns sync.
    if (open) buildTOC();
  }
}
window.setViewMode = setViewMode;
function toggleViewMode() { setViewMode(State.viewMode === 'reading' ? 'edit' : 'reading'); }
window.toggleViewMode = toggleViewMode;

// =====================================================================
// RENDER FILE
// =====================================================================
function renderFile(idx) {
  const file = State.files[idx];
  if (!file) return;
  file.open = true;
  State.activeFile = idx;

  // Per-note toolbar direction (PARTIAL-01): restore this tab's own forced choice.
  // A note with no stored choice resolves to AUTO. applyBidiToNote (below) sets the
  // #editor dir, syncs the CM6 adapter, and calls updateDirUI(); here we only sync the
  // bits it doesn't cover — the #srcTextarea dir and the appBody._manualRTL mirror.
  State.forcedDir = file.forcedDir ?? null;
  appBody._manualRTL = State.forcedDir === 'rtl';
  if (State.forcedDir === 'rtl') srcTextarea.setAttribute('dir', 'auto');
  else srcTextarea.removeAttribute('dir');

  welcomeEl.style.display = 'none';
  noteContent.style.display = 'block';
  editorArea.classList.remove('welcome'); // T-F13: a file is open → show the CM6 live-preview surface
  // T-F17: honor the persisted view mode. Reading shows #noteContent (preview pane) + hides the
  // writing toolbar; Edit shows the CM6 surface. The `reading` class drives the pane CSS.
  editorArea.classList.toggle('reading', State.viewMode === 'reading');
  toolbarStrip.style.display = (State.viewMode === 'reading') ? 'none' : 'flex';
  syncReaderControls();

  loadIntoEditor(file.content || ''); // textarea (default) or CodeMirror (flag) — T-F13

  // Strip YAML front matter (T-R6) so it never renders as body text.
  const { body } = parseFrontMatter(file.content || '');
  const html = parseMarkdown(body);
  const wordCount = (body.match(/\S+/g) || []).length;
  const readMin = Math.max(1, Math.round(wordCount / 220));
  const isAr = isArabicHeavy(body);

  // EC-A2 (T-B9): when the open file diverged on disk while it had unsaved edits, show a
  // resolve banner — Keep my edits (retain) or Reload from disk (take the disk version).
  const conflictBanner = file.conflict ? `
    <div class="conflict-banner" role="alert">
      <span class="cf-msg">⚠ This note changed on disk while you had unsaved edits.</span>
      <button class="cf-btn cf-keep" type="button">Keep my edits</button>
      <button class="cf-btn cf-reload" type="button">Reload from disk</button>
    </div>` : '';

  noteContent.innerHTML = `
    <div class="doc-meta">
      <span>${isAr ? 'مقالة' : 'note'}</span>
      <span>·</span>
      <span>${wordCount} ${isAr ? 'كلمة' : 'words'}</span>
      <span>·</span>
      <span>${escapeHtml(file.path)}</span>
      ${file.dirty ? '<span>·</span><span style="color: var(--accent);">● unsaved</span>' : ''}
    </div>
    ${html}
  `;
  rewriteVaultImages(noteContent); // R10: note-relative images → bpmd://vault/<vaultId>/<rel>
  // EC-A2 (T-B9): the conflict banner must stay VISIBLE — render it in the dedicated
  // #conflictBar above the editor, not inside #noteContent (which is hidden behind the CM6
  // surface now, T-F13). Cleared when the file is not in conflict.
  const conflictBar = $('conflictBar');
  if (conflictBar) {
    conflictBar.innerHTML = conflictBanner;
    if (file.conflict) {
      conflictBar.querySelector('.cf-keep')?.addEventListener('click', () => resolveConflict(idx, 'keep'));
      conflictBar.querySelector('.cf-reload')?.addEventListener('click', () => resolveConflict(idx, 'reload'));
    }
  }

  // Callouts (T-F14): rewrite `> [!TYPE]` blockquotes into styled callouts BEFORE
  // the bidi pass so callout bodies still get per-block direction (R1/R2).
  transformCallouts(noteContent, { parseCalloutHeader, resolveDirection: resolveBlockDirection });
  // Code highlighting + math (T-F9): also before the bidi pass.
  decorateCodeAndMath();
  // Per-block direction + inline bidi isolation (T-R1/R2), replacing the old
  // whole-document isArabicHeavy flip. The manual ⇄ toggle remains the override.
  applyBidiToNote(file.content || '');

  $('propFile').textContent = file.name;
  $('propWords').textContent = wordCount;
  $('propRead').textContent = `≈ ${readMin} min`;
  $('readTime').textContent = `≈ ${readMin} min read`;
  $('wordCount').textContent = `${wordCount} words`;
  $('cursorPos').textContent = 'ln 1 · col 1';
  $('propMode').textContent = State.editorMode.charAt(0).toUpperCase() + State.editorMode.slice(1);

  buildTOC();
  renderTabs();
  highlightTreeActive();
  pushRecent(file);

  document.querySelector('.editor-wrap').scrollTop = 0;

  // Wire wikilink clicks
  noteContent.querySelectorAll('a.wikilink').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); navWikilink(a.dataset.target); });
  });
  persistSettings(); // M6: the active tab changed — snapshot the session (debounced, no-op while restoring)
}
window.renderFile = renderFile;

// EC-A2 resolve (T-B9): apply the user's choice for a disk-conflicted file.
function resolveConflict(idx, action) {
  const f = State.files[idx];
  if (!f || !f.conflict) return;
  if (action === 'reload') {
    if (f.diskContent != null) f.content = f.diskContent; // take the disk version…
    f.dirty = false;                                       // …discarding local edits
  } // 'keep' → retain edits + dirty
  if (f.diskMeta) f.meta = f.diskMeta; // acknowledge current disk identity (both keep + reload) so we don't re-nag / mis-baseHash the next Save
  f.conflict = false;
  f.diskContent = null;
  f.diskMeta = null;
  renderFile(idx);
  showToast(action === 'reload' ? 'Reloaded from disk' : 'Kept your edits', 'info');
}
window.resolveConflict = resolveConflict;

// Outline (T-F7): full h1–h6 tree with Arabic-aware slugs, matching ids on the
// rendered headings (click-to-scroll), and scroll-sync highlighting.
let _tocHeadings = []; // [{ el, item, pos }] in document order, for scroll-sync (pos = CM6 source offset)

// Scan the CM6 source for ATX heading lines → [{ pos, level, text }] in document order.
// Skips fenced code blocks so a `# comment` inside ``` isn't mistaken for a heading. Used to
// map each rendered-DOM outline entry back to a position in the editor (CM6 is the sole surface
// now, so the outline must scroll the editor, not the hidden preview pane).
function cmHeadingPositions(src) {
  return sourceHeadingPositions(src);
}
const _normHeading = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

function buildTOC() {
  // Derive the outline from the RENDERED DOM headings (the source of truth for
  // what's displayed) rather than from marked.lexer tokens index-aligned to the
  // DOM: the lexer only emits top-level headings, so a heading nested in a
  // blockquote/callout/list (or raw HTML) would desync the index and mis-assign
  // ids/labels/scroll-targets. Slug + GitHub-style de-dup mirror outline.js, using
  // the same Arabic-aware slugify, so ids/labels/targets are inherently consistent.
  const rendered = [...noteContent.querySelectorAll('h1, h2, h3, h4, h5, h6')];

  _tocHeadings = [];
  if (!rendered.length) {
    tocList.className = 'toc-empty';
    tocList.textContent = 'No headings.';
    return;
  }
  tocList.className = '';
  tocList.innerHTML = '';
  // CM6 source heading offsets, to map each rendered heading → an editor position. Aligned by
  // index (rendered heading i ↔ source heading i), with a text-match fallback for the cases
  // where counts drift (e.g. an inline-styled heading whose rendered text differs).
  const srcHeads = cmAdapter ? cmHeadingPositions(cmAdapter.getValue()) : [];
  const usedSrc = new Set();
  const seen = new Map();
  rendered.forEach((el, i) => {
    const text = (el.textContent || '').trim();
    let slug = slugify(text);
    if (seen.has(slug)) { const k = seen.get(slug) + 1; seen.set(slug, k); slug = `${slug}-${k}`; }
    else seen.set(slug, 0);
    el.id = slug;
    // Resolve the CM6 source position for this heading.
    let pos = null;
    if (cmAdapter && srcHeads.length) {
      if (srcHeads[i] && !usedSrc.has(i) && _normHeading(srcHeads[i].text) === _normHeading(text)) {
        pos = srcHeads[i].pos; usedSrc.add(i);
      } else {
        const j = srcHeads.findIndex((h, k) => !usedSrc.has(k) && _normHeading(h.text) === _normHeading(text));
        if (j >= 0) { pos = srcHeads[j].pos; usedSrc.add(j); }
        else if (srcHeads[i] && !usedSrc.has(i)) { pos = srcHeads[i].pos; usedSrc.add(i); } // last-resort index
      }
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `toc-item h${el.tagName.charAt(1)}` + (_tocHeadings.length === 0 ? ' active' : '');
    item.textContent = text; // clean rendered text (no raw markdown punctuation)
    item.setAttribute('dir', 'auto'); // Arabic outline entries render RTL
    const entry = { el, item, pos };
    item.addEventListener('click', () => scrollToHeading(entry));
    tocList.appendChild(item);
    _tocHeadings.push(entry);
  });
  setupScrollSync();
}
window.buildTOC = buildTOC; // test hook + used to rebuild the outline after the async CM6 mount

// The rendered note scrolls inside .preview-pane (.editor-area is overflow:hidden,
// so .editor-wrap itself never scrolls).
function previewScroller() { return document.querySelector('.preview-pane'); }

// Outline click → jump to the visible surface: CM6 only in Edit mode, otherwise the preview.
function scrollToHeading(entry) {
  if (State.viewMode !== 'reading' && cmAdapter && entry) {
    // Resolve the editor position on demand if it wasn't known when the outline was built
    // (e.g. the outline predated the CM6 mount): match the entry's text against the live source.
    let pos = entry.pos;
    if (pos == null && entry.el) {
      const want = _normHeading(entry.el.textContent);
      const hit = cmHeadingPositions(cmAdapter.getValue()).find((h) => _normHeading(h.text) === want);
      if (hit) pos = entry.pos = hit.pos;
    }
    if (pos != null) { cmAdapter.scrollToPos(pos, { select: true }); return; }
  }
  const el = entry && entry.el;
  const wrap = previewScroller();
  if (!wrap || !el) return;
  const top = el.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  wrap.scrollTo({ top: Math.max(0, top - 12), behavior: reduceMotion ? 'auto' : 'smooth' });
}

function setupScrollSync() {
  // Edit mode tracks CM6; Reading mode always tracks the visible rendered preview.
  if (State.viewMode !== 'reading' && cmAdapter && cmAdapter._view) {
    const view = cmAdapter._view;
    const sc = view.scrollDOM;
    if (sc._tocSyncWired) return;
    sc._tocSyncWired = true;
    const sync = () => {
      if (!_tocHeadings.length) return;
      // The doc offset at the very top of the viewport (robust for off-screen headings, which
      // coordsAtPos can't measure). Active = the last heading at or before that offset.
      let topPos;
      try { topPos = view.lineBlockAtHeight(sc.scrollTop).from; } catch (_) { topPos = 0; }
      let idx = 0;
      for (let i = 0; i < _tocHeadings.length; i++) {
        const p = _tocHeadings[i].pos;
        if (p != null && p <= topPos + 4) idx = i;
      }
      _tocHeadings.forEach(({ item }, i) => item.classList.toggle('active', i === idx));
    };
    sc.addEventListener('scroll', sync, { passive: true });
    return;
  }
  // Reading mode and the textarea fallback share the visible rendered preview pane.
  const wrap = previewScroller();
  if (!wrap || wrap._tocSyncWired) return;
  wrap._tocSyncWired = true;
  wrap.addEventListener('scroll', () => {
    if (!_tocHeadings.length) return;
    const wrapTop = wrap.getBoundingClientRect().top;
    const offsets = _tocHeadings.map(({ el }) => el.getBoundingClientRect().top - wrapTop + wrap.scrollTop);
    const atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 2;
    const idx = atBottom ? _tocHeadings.length - 1 : activeHeading(wrap.scrollTop, offsets);
    _tocHeadings.forEach(({ item }, i) => item.classList.toggle('active', i === idx));
  }, { passive: true });
}

// =====================================================================
// TREE
// =====================================================================
function highlightTreeActive() {
  treeEl.querySelectorAll('.tree-node').forEach(n => {
    n.classList.toggle('active', parseInt(n.dataset.fileIdx) === State.activeFile);
  });
}

// Folder collapse state (T-F1/M3): set of collapsed dir paths, persisted to localStorage
// so the tree shape survives re-renders (vault reconcile, file open) AND relaunch.
let _treeCollapsed = null;
function treeCollapsed() {
  if (_treeCollapsed) return _treeCollapsed;
  try { _treeCollapsed = new Set(JSON.parse(localStorage.getItem('bpmd-tree-collapsed') || '[]')); }
  catch (_) { _treeCollapsed = new Set(); }
  return _treeCollapsed;
}
function saveTreeCollapsed() {
  try { localStorage.setItem('bpmd-tree-collapsed', JSON.stringify([...treeCollapsed()])); } catch (_) { /* best-effort */ }
}

// B4 (multi-folder workspaces): loose files (no vaultId — single-file opens, new
// notes, drag-drop, or a browser-picked folder with no main-issued capability) get a
// synthetic pseudo-root so they are still visible in the tree at all, rendered LAST
// (after every named folder). It carries no close affordance -- there is no folder to
// close, only individual tabs.
const LOOSE_ROOT_ID = '@loose';

// Build a nested, collapsible folder tree from State.files (T-F1/M3, forest since B4).
// Vault-scoped files group into one named root per open folder (buildForest); loose
// files fold into the @loose pseudo-root. Each row is indented by depth; dir/root rows
// toggle (click / Enter / Space / Arrow), file rows open, and a non-loose root row also
// closes (× button or Delete/Backspace) via workspaceController.closeVault. State.files
// index travels as fileIdx (assigned by ORIGINAL position, before grouping) so
// highlightTreeActive + open still work regardless of which group a file lands in.
function renderTree(entries) {
  treeEl.innerHTML = '';
  treeEl.style.display = entries.length ? 'block' : 'none';
  sbEmptyEl.style.display = entries.length ? 'none' : 'block';
  if (!entries.length) { renderTags(); return; }
  const collapsed = treeCollapsed();

  const roots = new Map(workspaceController.getOpenVaults().map((v) => [v.id, v.name]));
  const vaultItems = [];
  const looseItems = [];
  entries.forEach((f, i) => {
    const item = { name: f.name, relPath: f.path, fileIdx: i };
    if (f.vaultId) { item.vaultId = f.vaultId; vaultItems.push(item); }
    else looseItems.push(item);
  });
  const forest = buildForest(vaultItems, roots);
  if (looseItems.length) {
    const looseTree = buildFileTree(looseItems);
    prefixTreePaths(looseTree, LOOSE_ROOT_ID);
    forest.children.push({
      type: 'root', id: LOOSE_ROOT_ID, name: tr('sidebar.openFiles', State.uiLocale),
      path: LOOSE_ROOT_ID, children: looseTree.children,
    });
  }

  flattenTree(forest, collapsed).forEach(row => {
    const node = document.createElement('div');
    node.setAttribute('role', 'treeitem');
    node.setAttribute('tabindex', treeEl.childElementCount === 0 ? '0' : '-1');
    node.setAttribute('aria-label', row.name);
    // v10 redesign (2026-08-25): indent is expressed as a custom property, consumed by
    // components.css's calc(), not a literal inline pixel value -- padding-inline-start
    // stays depth-aware (this app allows arbitrary nesting; the reference's fixed 32px
    // single-level indent does not), while the elbow/trunk connectors below key off the
    // .tree-indent class this now also sets.
    node.style.setProperty('--tree-depth', String(row.depth));
    const indentClass = row.depth > 0 ? ' tree-indent' : '';
    const moveFocus = (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
      e.preventDefault();
      const nodes = [...treeEl.querySelectorAll('[role="treeitem"]')];
      const current = nodes.indexOf(node);
      const next = nodes[Math.max(0, Math.min(nodes.length - 1, current + (e.key === 'ArrowDown' ? 1 : -1)))];
      nodes.forEach(n => { n.tabIndex = n === next ? 0 : -1; });
      next?.focus();
      return true;
    };
    const nameIsAr = isArabicHeavy(row.name);
    const nameHtml = `<span class="tree-name${nameIsAr ? ' arabic' : ''}"${nameIsAr ? ' dir="rtl"' : ''}>${escapeHtml(row.name)}</span>`;
    if (row.type === 'dir') {
      const isCollapsed = collapsed.has(row.path);
      node.className = `tree-node tree-dir${indentClass}`;
      node.setAttribute('aria-expanded', String(!isCollapsed));
      // v10 redesign (2026-08-25): the glyph itself no longer swaps -- CSS rotates a
      // single unconditional down-chevron off aria-expanded, set two lines above.
      // Swapping the glyph AND rotating it would double-encode the state (a rotated
      // "already-pointing-left" triangle would point up when collapsed).
      node.innerHTML = `<span class="tree-twisty">▾</span>${nameHtml}`;
      const setOpen = (open) => {
        if (open === !collapsed.has(row.path)) return; // no change
        if (open) collapsed.delete(row.path); else collapsed.add(row.path);
        saveTreeCollapsed(); renderTree(entries);
      };
      node.addEventListener('click', () => setOpen(collapsed.has(row.path)));
      node.addEventListener('keydown', e => {
        if (moveFocus(e)) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(collapsed.has(row.path)); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setOpen(true); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setOpen(false); }
      });
    } else if (row.type === 'root') {
      // B4: a named folder root behaves like a dir (click/Enter/Space/Arrow toggle) but
      // also owns a close affordance — except the @loose pseudo-root, which has no
      // folder to close, only individual tabs.
      const isLoose = row.id === LOOSE_ROOT_ID;
      const isCollapsed = collapsed.has(row.path);
      node.className = `tree-node tree-root${indentClass}`;
      node.setAttribute('aria-expanded', String(!isCollapsed));
      node.innerHTML = `<span class="tree-twisty">▾</span>${nameHtml}`;
      const setOpen = (open) => {
        if (open === !collapsed.has(row.path)) return;
        if (open) collapsed.delete(row.path); else collapsed.add(row.path);
        saveTreeCollapsed(); renderTree(entries);
      };
      node.addEventListener('click', (e) => {
        if (e.target.closest('.tree-root-close')) return; // the close button handles its own click
        setOpen(collapsed.has(row.path));
      });
      node.addEventListener('keydown', e => {
        if (moveFocus(e)) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(collapsed.has(row.path)); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setOpen(true); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setOpen(false); }
        else if (!isLoose && (e.key === 'Delete' || e.key === 'Backspace')) {
          e.preventDefault();
          workspaceController.closeVault(row.id);
        }
      });
      if (!isLoose) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'tree-root-close';
        closeBtn.setAttribute('aria-label', `${tr('sidebar.closeFolder', State.uiLocale)}: ${row.name}`);
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); workspaceController.closeVault(row.id); });
        node.appendChild(closeBtn);
      }
    } else {
      node.className = `tree-node tree-file${indentClass}`;
      node.dataset.fileIdx = row.fileIdx;
      node.innerHTML = `<span class="tree-icon">¶</span>${nameHtml}`;
      const activate = () => openFromTree(row.fileIdx);
      node.addEventListener('click', activate);
      node.addEventListener('keydown', e => {
        if (moveFocus(e)) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    }
    treeEl.appendChild(node);
  });
  renderTags();
  highlightTreeActive(); // re-mark the active file: this in-tree rebuild (folder toggle) would otherwise drop it (F1/M3)
}

async function openFromTree(idx) {
  const f = State.files[idx];
  if (f.handle && !f.content) {
    try { const file = await f.handle.getFile(); f.content = await file.text(); }
    catch(e) { showToast('Could not read file', 'error'); return; }
  }
  renderFile(idx);
}

// =====================================================================
// TAGS
// =====================================================================
function renderTags() {
  const tagsPane = $('tagsPane');
  const tagMap = extractTagsFromFiles(State.files);
  const tags = Object.entries(tagMap).sort((a, b) => b[1].length - a[1].length);
  if (!tags.length) {
    tagsPane.innerHTML = '<div class="search-empty">No tags found.</div>';
    return;
  }
  tagsPane.textContent = '';
  const cloud = document.createElement('div');
  cloud.className = 'tag-cloud';
  tags.forEach(([tag, files]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag';
    button.dataset.tag = tag;
    button.appendChild(document.createTextNode(tag));
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(files.length);
    button.appendChild(count);
    button.addEventListener('click', () => filterByTag(tag));
    cloud.appendChild(button);
  });
  tagsPane.appendChild(cloud);
}

function filterByTag(tag) {
  switchSbPane('search');
  $('sbSearchInput').value = '#' + tag;
  runSidebarSearch('#' + tag);
}

// =====================================================================
// FILE I/O
// =====================================================================
// v10 redesign (2026-08-25): the sidebar vault header (#vaultName) is removed; the
// status-bar stat below is the surviving vault indicator. B4 (multi-folder workspaces):
// derives the summary from every currently-open folder rather than the single name it
// used to be called with (the parameter is kept, ignored, so every existing call site —
// which still knows and passes the folder it just opened — needs no change).
function setVaultUi(_folderName) {
  const status = $('sbVault');
  if (!status) return;
  const vaults = workspaceController.getOpenVaults();
  if (vaults.length === 0) {
    status.textContent = 'no folder';
    status.removeAttribute('data-tip');
  } else if (vaults.length === 1) {
    status.textContent = `folder: ${vaults[0].name}`;
    status.removeAttribute('data-tip');
  } else {
    status.textContent = `folders: ${vaults.length}`;
    status.dataset.tip = vaults.map((v) => v.name).join(', ');
  }
}

const workspaceController = createWorkspaceController({
  state: State,
  hostWindow: window,
  hostDocument: document,
  fileInput,
  closeMenu,
  showToast,
  showWelcome,
  confirmDiscard: (message) => confirm(message),
  addFile,
  renderFile,
  renderTree,
  renderTabs,
  setVaultUi,
  getElement: $,
});
const {
  openVault,
  openSingleFile,
  saveCurrent,
  saveAs,
  pushRecent,
  renderRecents,
  openRecent,
  openExternalFile,
  handleVaultChanged,
  markUserIntent,
  mayAbandonWorkspace,
} = workspaceController;
window.openVault = openVault;
window.openSingleFile = openSingleFile;
window.saveCurrent = saveCurrent;
window.openRecent = openRecent;
window.openExternalFile = openExternalFile;
window.handleVaultChanged = handleVaultChanged;


fileInput.addEventListener('change', async () => {
  for (const file of fileInput.files) {
    const content = await file.text();
    addFile({ name: file.name, path: file.name, handle: null, content, dirty: false });
  }
  if (fileInput.files.length > 0) showToast(`Opened ${fileInput.files.length} file(s)`);
  fileInput.value = '';
});

function addFile(f) {
  if (!Number.isInteger(f.revision)) f.revision = 0;
  // B4: dedupe by fileKey (doc capability > vault-scoped path > bare path), not a bare
  // name+path pair — two open folders sharing a relative path (both have notes/todo.md)
  // must never overwrite each other's entry just because a new loose file coincidentally
  // shares that path.
  const key = fileKey(f);
  const existing = key ? State.files.findIndex(x => fileKey(x) === key) : -1;
  if (existing >= 0) { State.files[existing] = f; renderTree(State.files); renderFile(existing); }
  else { State.files.push(f); renderTree(State.files); renderFile(State.files.length - 1); }
}

function newNote() {
  closeMenu();
  markUserIntent();
  const n = State.files.filter(f => f.name.startsWith('Untitled')).length;
  const name = `Untitled${n > 0 ? '-' + n : ''}.md`;
  addFile({ name, path: name, handle: null, content: `# Untitled\n\nStart writing…\n`, dirty: true, revision: 1 });
}
window.newNote = newNote;


// =====================================================================
// WIKILINKS
// =====================================================================
function navWikilink(target) {
  const t = target.toLowerCase();
  const idx = State.files.findIndex(f =>
    f.name.replace(/\.md$/, '').toLowerCase() === t ||
    f.name.replace(/\.md$/, '').toLowerCase() === t.replace(/-/g, ' ')
  );
  if (idx >= 0) renderFile(idx);
  else showToast(`No note found for "${target}"`, 'error');
}

// =====================================================================
// DEMO
// =====================================================================
function loadDemo() {
  closeMenu();
  markUserIntent();
  if (!mayAbandonWorkspace()) return;
  const demos = [
    { name: 'on-reading.md', path: 'essays/on-reading.md', dirty: false, handle: null,
      content: `# On the act of reading\n\nThe page is not a screen. A reader does not scroll — they *turn*.\n\n**Slowness** is not the enemy of attention. It is its precondition.\n\n#reading #prose\n\n## A short list\n\n- Slow tools beget slow thought.\n- See [[the-quiet-page]] for further argument.\n\n> "A book is a thing among things." — Borges\n\n## Code\n\n\`\`\`js\nconst reader = (words) => words.slow();\n\`\`\`\n\n---\n\nTo be continued. See also [[slow-tools]].`
    },
    { name: 'the-quiet-page.md', path: 'essays/the-quiet-page.md', dirty: false, handle: null,
      content: `# The quiet page\n\nWhat if the most radical interface does almost nothing?\n\n#prose #draft\n\n## Three properties\n\n1. **Receptivity.** The page absorbs without judgment.\n2. **Patience.** It does not interrupt.\n3. **Restraint.** It refuses to be helpful.\n\n> The page that helps you write is helping you not write.\n\nCompare [[on-reading]] for the symmetric argument.`
    },
    { name: 'مقالة-القراءة.md', path: 'المسوّدات/مقالة-القراءة.md', dirty: false, handle: null,
      content: `# في فعلِ القراءة\n\nالصفحةُ ليست شاشةً، والقارئُ لا يُمرِّر النصَّ بل يقلِبُه.\n\n#قراءة #أدب\n\n## قائمةٌ موجزة\n\n- الأدواتُ البطيئة تولّدُ فكراً بطيئاً.\n\n> "الكتابُ شيءٌ بين الأشياء." — بورخيس`
    }
  ];
  workspaceController.clearVaultIdentity();
  State.files = demos;
  State.vaultName = 'demo';
  $('sbVault').textContent = 'folder: demo';
  renderTree(demos);
  renderFile(0);
  showToast('Demo notes loaded');
}
window.loadDemo = loadDemo;

// =====================================================================
// SOURCE TEXTAREA INPUT
// =====================================================================
let _srcDebounce = null;
// Shared by the textarea engine and the CodeMirror engine (T-F13): apply an edit from
// whichever source editor is active. `val` is the full doc text, `pos` the caret offset.
function applyEditorInput(val, pos) {
  if (State.activeFile === null || !State.files[State.activeFile]) return;
  const f = State.files[State.activeFile];
  f.content = val;
  f.revision = (Number.isInteger(f.revision) ? f.revision : 0) + 1;
  f.dirty = true;
  updateTabState(State.activeFile);
  // Fast: cursor position update on every keystroke
  const upto = val.slice(0, pos);
  const ln = upto.split('\n').length;
  const col = pos - upto.lastIndexOf('\n');
  $('cursorPos').textContent = `ln ${ln} · col ${col}`;
  // Heavy: markdown render debounced at 150ms
  clearTimeout(_srcDebounce);
  _srcDebounce = setTimeout(() => {
    // Bail if the user switched files during the debounce: this closure captured `f`, and
    // #noteContent / the outline are SHARED globals — rendering the now-inactive file here
    // would clobber the active file's display + outline with stale content (the "content not
    // transferred to display" / wrong-outline bug). renderFile already rendered the new file.
    if (State.activeFile === null || State.files[State.activeFile] !== f) return;
    const { body } = parseFrontMatter(f.content); // T-R6: keep front matter out of the body
    const html = parseMarkdown(body);
    const wordCount = (body.match(/\S+/g) || []).length;
    const readMin = Math.max(1, Math.round(wordCount / 220));
    noteContent.innerHTML = `
      <div class="doc-meta">
        <span>note</span><span>·</span>
        <span>${wordCount} words</span><span>·</span>
        <span>${escapeHtml(f.path)}</span>
        <span>·</span><span style="color: var(--accent);">● unsaved</span>
      </div>
      ${html}
    `;
    rewriteVaultImages(noteContent); // R10: note-relative images → bpmd://vault/<vaultId>/<rel>
    transformCallouts(noteContent, { parseCalloutHeader, resolveDirection: resolveBlockDirection });
    decorateCodeAndMath();
    applyBidiToNote(f.content);
    $('propWords').textContent = wordCount;
    $('propRead').textContent = `≈ ${readMin} min`;
    $('readTime').textContent = `≈ ${readMin} min read`;
    $('wordCount').textContent = `${wordCount} words`;
    buildTOC();
  }, 150);
}
function onSourceInput() { applyEditorInput(srcTextarea.value, srcTextarea.selectionStart); }
srcTextarea.addEventListener('input', onSourceInput);

// ── T-F13: CodeMirror 6 is the ONE and ONLY editor — a single live-preview surface mounted
// on launch (no source/split modes, no opt-in flag). The textarea (#srcTextarea) stays in the
// DOM purely as a fallback if the CM6 bundle fails to load. cmAdapter conforms to EditorPort. ──
let cmAdapter = null;   // non-null ⇒ CodeMirror is the active source engine
let cmLoading = false;  // suppress onChange while we load a doc programmatically
let _cmPromise = null;
function loadCM6() {
  if (_cmPromise) return _cmPromise;
  _cmPromise = new Promise((resolve, reject) => {
    if (typeof window.CM6 !== 'undefined') return resolve(window.CM6);
    const s = document.createElement('script');
    s.src = '../../resources/vendor/codemirror/codemirror.min.js';
    s.onload = () => (window.CM6 ? resolve(window.CM6) : reject(new Error('CM6 unavailable')));
    s.onerror = () => { s.remove(); reject(new Error('CM6 failed to load')); };
    document.head.appendChild(s);
  });
  _cmPromise.catch(() => { _cmPromise = null; }); // allow retry after a transient failure
  return _cmPromise;
}
// T-F13 parity: render a markdown BLOCK (table…) to a DOM element for the CM6 live-preview
// block widgets, reusing the SAME pipeline as the rendered preview pane — parseMarkdown
// (marked → hardened sanitize), then applyBidi (which mirrors RTL table columns via
// applyTableDirection, R9) and wireTableNav (EC-C2 cell traversal). Returns null for
// block types not yet supported (the widget then shows raw markdown).
function renderCmBlock(type, source) {
  if (type === 'table') {
    const el = document.createElement('div');
    el.innerHTML = parseMarkdown(source);
    decorateBlockContent(el); // highlight code + render KaTeX inside cells (F9 parity)
    applyBidi(el, { baseDir: State.direction === 'rtl' ? 'rtl' : 'ltr', escape: escapeHtml, forceDir: State.forcedDir });
    wrapTablesInFrames(el, { locale: State.uiLocale });
    wireTableNav(el);
    return el;
  }
  if (type === 'mermaid') {
    // Build the <pre><code class="language-mermaid"> shape renderMermaid expects, then render
    // the SVG asynchronously (engine is lazy-loaded). dir=ltr is forced by renderMermaid.
    const el = document.createElement('div');
    const code = source.replace(/^[ \t]*(```|~~~)[^\n]*\n?/, '').replace(/\n?[ \t]*(```|~~~)[ \t]*$/, '');
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.className = 'language-mermaid';
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    el.appendChild(pre);
    loadMermaid()
      .then((mermaid) => renderMermaid(el, { mermaid, sanitize: (svg) => sanitizeSvg(svg, DOMPurify), idPrefix: `cmmmd-${_mmdSeq++}` }))
      .catch(() => { /* engine failed to load — the code block stays as the fallback */ });
    return el;
  }
  if (type === 'callout') {
    const el = document.createElement('div');
    el.innerHTML = parseMarkdown(source);
    transformCallouts(el, { parseCalloutHeader, resolveDirection: resolveBlockDirection }); // > [!NOTE] → styled callout (F14)
    decorateBlockContent(el); // highlight code + render KaTeX inside the callout body (F9 parity)
    applyBidi(el, { baseDir: State.direction === 'rtl' ? 'rtl' : 'ltr', escape: escapeHtml, forceDir: State.forcedDir });
    return el;
  }
  if (type === 'image') {
    // Render the standalone image through the same sanitized pipeline; the <img> loads via the
    // same src/CSP rules (bpmd:// vault images, data:, file:) as the preview pane.
    const tmp = document.createElement('div');
    tmp.innerHTML = parseMarkdown(source);
    rewriteVaultImages(tmp); // R10: note-relative images → bpmd://vault/<vaultId>/<rel>
    return tmp.querySelector('img') || null;
  }
  return null;
}

// T-F13 × F9: render a single $…$ / $$…$$ TeX span for the CM6 inline math widgets, reusing
// the same hardened KaTeX render+sanitize path (renderTex) as the preview pane (LTR-isolated).
function renderCmMath(tex, display) {
  return (typeof katex !== 'undefined') ? renderTex(tex, display, { katex, DOMPurify, doc: document }) : null;
}

async function initCM6Editor() {
  // T-F13: CM6 is now the ONE and ONLY editor — mount it unconditionally on launch. The
  // textarea remains in the DOM purely as a fallback if the CM6 bundle fails to load.
  if (cmAdapter) return false;
  let CM6;
  try { CM6 = await loadCM6(); } catch (_) { return false; }
  const pane = document.querySelector('.source-pane');
  if (!pane) return false;
  srcTextarea.style.display = 'none';
  const mount = document.createElement('div');
  mount.className = 'cm-mount';
  pane.appendChild(mount);
  const active = (State.activeFile != null && State.files[State.activeFile]) ? State.files[State.activeFile] : null;
  cmAdapter = createCodeMirrorAdapter(mount, {
    CM6,
    doc: active ? active.content : '',
    dir: State.direction === 'rtl' ? 'rtl' : 'ltr',
    forceDir: State.forcedDir, // honor a forced direction chosen before the editor mounts
    onChange: (val) => { if (!cmLoading) applyEditorInput(val, cmAdapter.getSelection().start); },
    renderBlock: renderCmBlock, // T-F13: inline block rendering (tables…) in the single CM6 surface
    renderMath: renderCmMath,   // T-F13 × F9: inline KaTeX rendering in the single CM6 surface
    onWikilink: navWikilink,    // R09: clicking a rendered [[wikilink]] in the editor navigates
    onSelectionChange: updateToolbarActiveState, // highlight toolbar buttons for the caret's construct
    onTab: tableTab,            // Tab/Shift-Tab navigate table cells when inside a table
  });
  window.__cmActive = true;
  // T-F13: collapse to the single CM6 live-preview surface (CSS shows the source pane,
  // hides the redundant markdown preview pane + the 3 mode buttons). Added ONLY after a
  // successful mount, so a CM6 load failure leaves the full 3-mode UI intact.
  editorArea.classList.add('cm-single');
  toolbarStrip.classList.add('cm-single');
  // CM6 mounts async + unawaited at startup, so a file may already be open (its outline built
  // with no editor positions + scroll-sync wired to the now-hidden preview pane). Rebuild the
  // outline now that the editor exists, so clicks/active-tracking drive CM6.
  if (State.activeFile != null && noteContent.querySelector('h1,h2,h3,h4,h5,h6')) buildTOC();
  return true;
}
// Load a document into whichever source engine is active (used by renderFile).
function loadIntoEditor(content) {
  if (cmAdapter) { cmLoading = true; cmAdapter.load(content || ''); cmLoading = false; }
  else { srcTextarea.value = content || ''; }
}
window.loadCM6 = loadCM6;
window.initCM6Editor = initCM6Editor;
window.createCodeMirrorAdapter = createCodeMirrorAdapter;
// Test hook: the live CM6 EditorPort (or null before mount). Lets e2e tests set selections /
// read the value precisely against the single editor surface.
window.getActiveCmAdapter = () => cmAdapter;

// A1: the persisted "Live-Preview Editor" setting governs whether CM6 is the active surface.
// Toggling it mounts CM6 (single live-preview mode) or tears it back down to the classic
// textarea — live, no relaunch. Default off, so the textarea + 3-mode UI is the default.
function teardownCM6Editor() {
  if (!cmAdapter) return;
  try { cmAdapter.destroy(); } catch (_) { /* best-effort */ }
  cmAdapter = null;
  window.__cmActive = false;
  document.querySelector('.cm-mount')?.remove();
  srcTextarea.style.display = '';
  editorArea.classList.remove('cm-single');
  toolbarStrip.classList.remove('cm-single');
  // repopulate the textarea + the (now-visible) preview pane for the active note
  if (State.activeFile != null && State.files[State.activeFile]) renderFile(State.activeFile);
}
async function setCmEditor(on) {
  on = !!on;
  State.cmEditor = on; // persists via the subscribe hook (PERSISTED_KEYS)
  if (on && !cmAdapter) await initCM6Editor();
  else if (!on && cmAdapter) teardownCM6Editor();
  if (!settingsController?.isRestoring()) showToast(`Live-preview editor: ${on ? 'on (CodeMirror)' : 'off (classic)'}`, 'info');
}
function toggleCmEditor() { setCmEditor(!State.cmEditor); }
window.setCmEditor = setCmEditor;
window.toggleCmEditor = toggleCmEditor;

// Bug 7 fix: blockquote Enter handling.
// - Empty blockquote line (body is whitespace-only): strip prefix, place cursor on blank line.
// - Non-empty blockquote line: continue with the > prefix on the next line.
// Only fires when cursor is on a blockquote line. Non-blockquote Enter passes through unmodified.
function handleBlockquoteEnter(e) {
  // Guard: ignore IME composition (prevents double-handling on CJK/Arabic input)
  if (e.isComposing) return;
  if (e.key !== 'Enter' || e.shiftKey) return;

  const ta = srcTextarea;
  const pos = ta.selectionStart;
  const val = ta.value;

  // Find the start and end of the current line
  const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
  const lineEndRaw = val.indexOf('\n', pos);
  const lineEnd = lineEndRaw < 0 ? val.length : lineEndRaw;
  // Use the full line (not just up-to-cursor) to detect emptiness after prefix,
  // so that a cursor sitting in the middle of "> " still triggers the exit path.
  const fullLine = val.slice(lineStart, lineEnd);
  // Also compute the cursor-relative line slice used for prefix detection
  const currentLine = val.slice(lineStart, pos);

  // Detect blockquote prefix: one or more ">", each optionally preceded by whitespace,
  // followed by optional trailing whitespace. The non-capturing group (?:\s*>)+ ensures
  // the full prefix for nested blockquotes (e.g., "> > > ") is captured correctly.
  const prefixMatch = /^((?:\s*>)+\s*)/.exec(currentLine);
  if (!prefixMatch) return; // not a blockquote line — let default Enter run

  const prefix = prefixMatch[1];
  // Emptiness is determined against the full line (not just up-to-cursor slice)
  const body = fullLine.slice(prefix.length);

  e.preventDefault();

  if (body.trim() === '') {
    // Empty blockquote line: replace the prefix with a blank non-blockquote line.
    replaceInTextarea(ta, lineStart, pos, '\n');
    ta.selectionStart = ta.selectionEnd = lineStart + 1;
  } else {
    // Non-empty blockquote line: continue with the same prefix on the next line.
    replaceInTextarea(ta, pos, pos, '\n' + prefix);
    ta.selectionStart = ta.selectionEnd = pos + 1 + prefix.length;
  }
}

srcTextarea.addEventListener('keydown', handleBlockquoteEnter);

srcTextarea.addEventListener('keyup', () => {
  const pos = srcTextarea.selectionStart;
  const upto = srcTextarea.value.slice(0, pos);
  const ln = upto.split('\n').length;
  const col = pos - upto.lastIndexOf('\n');
  $('cursorPos').textContent = `ln ${ln} · col ${col}`;
});

// =====================================================================
// TOOLBAR MARKDOWN HELPERS
// =====================================================================
function ensureSourceFocus() {
  // Switch to source mode if needed, then focus SYNCHRONOUSLY so the
  // execCommand-based edits below run against a focused, editable textarea.
  if (State.editorMode === 'live') setEditorMode('source');
  srcTextarea.focus();
}
// Replace [start,end) in the textarea with `text` while keeping it on the NATIVE
// undo stack (execCommand('insertText')), so Ctrl+Z and Undo (Edit menu +
// right-click) can reverse toolbar/blockquote edits. execCommand fires a native
// 'input' event, which drives onSourceInput. Falls back to a value-splice (with
// a manual 'input' dispatch) only if execCommand can't run in this context.
function replaceInTextarea(ta, start, end, text) {
  ta.focus();
  ta.setSelectionRange(start, end);
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch (_) { ok = false; }
  if (!ok) {
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
// Word boundaries around `pos` in `v`, excluding markdown punctuation so a caret in a word
// expands to the word (not adjacent markers). null when there's no word at the caret.
function wordBounds(v, pos) {
  const isW = (c) => !!c && !/[\s`*_~$=\[\]()<>#!|]/.test(c);
  if (!isW(v[pos]) && !isW(v[pos - 1])) return null;
  let s = pos, e = pos;
  while (s > 0 && isW(v[s - 1])) s--;
  while (e < v.length && isW(v[e])) e++;
  return s < e ? { start: s, end: e } : null;
}
// Toggle an inline wrap (bold/italic/strike/code/math/highlight/sub/sup). Best-practice
// semantics (verified via the markdown-toolbar research): re-applying UNWRAPS (markers inside
// OR just outside the selection); an empty selection expands to the surrounding WORD (else
// inserts empty delimiters with the caret between them); a multi-line selection wraps each
// non-blank line's content individually (inline marks can't span newlines). A selection stays
// selected afterward.
function wrapSelection(left, right) {
  if (cmAdapter) { // T-F13: route through the active EditorPort, NOT the hidden textarea
    cmAdapter.focus();
    let { start, end } = cmAdapter.getSelection();
    const v = cmAdapter.getValue();
    if (start === end) { const w = wordBounds(v, start); if (w) { start = w.start; end = w.end; } }
    const sel = v.slice(start, end);
    // multi-line → per-line wrap/unwrap
    if (sel.includes('\n')) {
      const lines = sel.split('\n');
      const ne = lines.filter((l) => l.trim() !== '');
      const wrapped = (core) => core.length >= left.length + right.length && core.startsWith(left) && core.endsWith(right);
      const allWrapped = ne.length > 0 && ne.every((l) => wrapped(l.trim()));
      const out = lines.map((l) => {
        if (l.trim() === '') return l;
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(l); const lead = m[1], core = m[2], trail = m[3];
        return lead + (allWrapped ? core.slice(left.length, core.length - right.length) : left + core + right) + trail;
      }).join('\n');
      cmAdapter.setSelection({ start, end }); cmAdapter.replaceSelection(out);
      cmAdapter.setSelection({ start, end: start + out.length });
      return;
    }
    // markers INSIDE the selection → unwrap
    if (sel.length >= left.length + right.length && sel.startsWith(left) && sel.endsWith(right)) {
      const inner = sel.slice(left.length, sel.length - right.length);
      cmAdapter.setSelection({ start, end }); cmAdapter.replaceSelection(inner);
      cmAdapter.setSelection({ start, end: start + inner.length });
      return;
    }
    // markers just OUTSIDE the selection → unwrap
    if (v.slice(start - left.length, start) === left && v.slice(end, end + right.length) === right) {
      cmAdapter.setSelection({ start: start - left.length, end: end + right.length });
      cmAdapter.replaceSelection(sel);
      cmAdapter.setSelection({ start: start - left.length, end: start - left.length + sel.length });
      return;
    }
    if (!sel) { // no word at caret → empty delimiters, caret between them
      cmAdapter.setSelection({ start, end }); cmAdapter.replaceSelection(left + right);
      cmAdapter.setSelection({ start: start + left.length });
      return;
    }
    cmAdapter.setSelection({ start, end }); cmAdapter.replaceSelection(left + sel + right);
    cmAdapter.setSelection({ start: start + left.length, end: start + left.length + sel.length });
    return;
  }
  ensureSourceFocus();
  const ta = srcTextarea;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(start, end) || 'text';
  replaceInTextarea(ta, start, end, left + sel + right);
  ta.selectionStart = start + left.length;
  ta.selectionEnd = start + left.length + sel.length;
}
function insertText(left, right) {
  if (cmAdapter) {
    cmAdapter.focus();
    const { start, end } = cmAdapter.getSelection();
    const sel = cmAdapter.getValue().slice(start, end);
    cmAdapter.setSelection({ start, end });
    cmAdapter.replaceSelection(left + sel + right);
    cmAdapter.setSelection({ start: start + left.length + sel.length });
    return;
  }
  ensureSourceFocus();
  const ta = srcTextarea;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(start, end);
  replaceInTextarea(ta, start, end, left + sel + right);
  ta.selectionStart = ta.selectionEnd = start + left.length + sel.length;
}
function lineStart(prefix) {
  if (cmAdapter) {
    cmAdapter.focus();
    const { start } = cmAdapter.getSelection();
    const ls = cmAdapter.getValue().slice(0, start).lastIndexOf('\n') + 1;
    cmAdapter.setSelection({ start: ls, end: ls });
    cmAdapter.replaceSelection(prefix);
    cmAdapter.setSelection({ start: start + prefix.length });
    return;
  }
  ensureSourceFocus();
  const ta = srcTextarea;
  const start = ta.selectionStart;
  const before = ta.value.slice(0, start);
  const ls = before.lastIndexOf('\n') + 1;
  replaceInTextarea(ta, ls, ls, prefix);
  ta.selectionStart = ta.selectionEnd = start + prefix.length;
}
// Insert a block (callout / table / hr / image) on its OWN line — never splitting the caret's
// line mid-word (the prior bug: "hel|lo" + Table → "hel\n<table>\nlo"). If the caret is on a
// blank line the block lands there; otherwise it goes on a fresh, blank-line-separated line
// AFTER the current line. The caret is placed at the start of the inserted block.
function insertBlock(text) {
  const block = String(text).replace(/\n+$/, '');
  if (cmAdapter) {
    cmAdapter.focus();
    const v = cmAdapter.getValue();
    const { end } = cmAdapter.getSelection();
    const lineStartIdx = v.slice(0, end).lastIndexOf('\n') + 1;
    let lineEnd = v.indexOf('\n', end); if (lineEnd === -1) lineEnd = v.length;
    if (v.slice(lineStartIdx, lineEnd).trim() === '') {
      cmAdapter.setSelection({ start: lineStartIdx, end: lineEnd });
      cmAdapter.replaceSelection(block);
      cmAdapter.setSelection({ start: lineStartIdx });
    } else {
      cmAdapter.setSelection({ start: lineEnd, end: lineEnd });
      cmAdapter.replaceSelection('\n\n' + block);
      cmAdapter.setSelection({ start: lineEnd + 2 });
    }
    return;
  }
  ensureSourceFocus();
  const ta = srcTextarea;
  const start = ta.selectionStart;
  let lineEnd = ta.value.indexOf('\n', start); if (lineEnd === -1) lineEnd = ta.value.length;
  const lineStartIdx = ta.value.slice(0, start).lastIndexOf('\n') + 1;
  if (ta.value.slice(lineStartIdx, lineEnd).trim() === '') {
    replaceInTextarea(ta, lineStartIdx, lineEnd, block);
    ta.selectionStart = ta.selectionEnd = lineStartIdx;
  } else {
    replaceInTextarea(ta, lineEnd, lineEnd, '\n\n' + block);
    ta.selectionStart = ta.selectionEnd = lineEnd + 2;
  }
}
// Fenced code block on its OWN line. With a selection, fence it in place (caret start at a
// line boundary so it never splits text); empty, drop an empty fence on a fresh line after the
// current one (or on the current blank line) with the caret inside, ready to type.
function insertCodeBlock() {
  if (cmAdapter) {
    cmAdapter.focus();
    const v = cmAdapter.getValue();
    const { start, end } = cmAdapter.getSelection();
    const body = v.slice(start, end);
    if (body) {
      const atLineStart = start === 0 || v[start - 1] === '\n';
      const lead = atLineStart ? '' : '\n';
      cmAdapter.setSelection({ start, end });
      cmAdapter.replaceSelection(lead + '```\n' + body + '\n```');
      const pos = start + lead.length + 4; // after the opening ```\n
      cmAdapter.setSelection({ start: pos, end: pos + body.length });
    } else {
      const lineStartIdx = v.slice(0, start).lastIndexOf('\n') + 1;
      let lineEnd = v.indexOf('\n', start); if (lineEnd === -1) lineEnd = v.length;
      if (v.slice(lineStartIdx, lineEnd).trim() === '') {
        cmAdapter.setSelection({ start: lineStartIdx, end: lineEnd });
        cmAdapter.replaceSelection('```\n\n```');
        cmAdapter.setSelection({ start: lineStartIdx + 4 });
      } else {
        cmAdapter.setSelection({ start: lineEnd, end: lineEnd });
        cmAdapter.replaceSelection('\n\n```\n\n```');
        cmAdapter.setSelection({ start: lineEnd + 2 + 4 });
      }
    }
    return;
  }
  ensureSourceFocus();
  const ta = srcTextarea;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const body = ta.value.slice(start, end);
  const atLineStart = start === 0 || ta.value[start - 1] === '\n';
  const lead = atLineStart ? '' : '\n';
  replaceInTextarea(ta, start, end, lead + '```\n' + body + '\n```');
  const pos = start + lead.length + 4;
  ta.selectionStart = pos; ta.selectionEnd = pos + body.length;
}
// Operate on EVERY line the selection spans: fn(lines[]) -> lines[]. Replaces that block
// and keeps it selected so a repeated click toggles the same region. cmAdapter-aware; the
// textarea path mirrors it (CM6-load-failure fallback only). Powers the smart line tools
// below so headings/quote/lists REPLACE or TOGGLE rather than stacking markers.
function applyBlock(fn) {
  if (cmAdapter) {
    cmAdapter.focus();
    const v = cmAdapter.getValue();
    const { start, end } = cmAdapter.getSelection();
    const from = v.slice(0, start).lastIndexOf('\n') + 1;
    let to = v.indexOf('\n', end); if (to === -1) to = v.length;
    const out = fn(v.slice(from, to).split('\n')).join('\n');
    cmAdapter.setSelection({ start: from, end: to });
    cmAdapter.replaceSelection(out);
    cmAdapter.setSelection({ start: from, end: from + out.length });
    return;
  }
  ensureSourceFocus();
  const ta = srcTextarea;
  const v = ta.value;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const from = v.slice(0, start).lastIndexOf('\n') + 1;
  let to = v.indexOf('\n', end); if (to === -1) to = v.length;
  const out = fn(v.slice(from, to).split('\n')).join('\n');
  replaceInTextarea(ta, from, to, out);
  ta.selectionStart = from; ta.selectionEnd = from + out.length;
}

const HEADING_RE = /^(#{1,6})[ \t]+/;
// Set the heading level on the spanned line(s). A line already AT this level is demoted
// back to a paragraph (toggle off); a line at a different level (or none) is set to it.
function toggleHeading(level) {
  applyBlock((lines) => lines.map((line) => {
    if (line.trim() === '') return line;
    const m = HEADING_RE.exec(line);
    if (m) return m[1].length === level ? line.slice(m[0].length) : '#'.repeat(level) + ' ' + line.slice(m[0].length);
    return '#'.repeat(level) + ' ' + line;
  }));
}

const QUOTE_RE = /^[ \t]*>[ \t]?/;
// Toggle blockquote: if every non-blank line is already quoted, unquote all; else quote all.
function toggleQuote() {
  applyBlock((lines) => {
    const ne = lines.filter((l) => l.trim() !== '');
    const allQuoted = ne.length > 0 && ne.every((l) => QUOTE_RE.test(l));
    return lines.map((l) => (l.trim() === '' ? l : allQuoted ? l.replace(QUOTE_RE, '') : '> ' + l));
  });
}

const TASK_RE = /^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+/;
const ORDERED_RE = /^[ \t]*\d+\.[ \t]+/;
const BULLET_RE = /^[ \t]*[-*+][ \t]+/;
function listKind(line) {
  if (TASK_RE.test(line)) return 'task';
  if (ORDERED_RE.test(line)) return 'ordered';
  if (BULLET_RE.test(line)) return 'bullet';
  return null;
}
function stripList(line) {
  return line.replace(/^[ \t]*(?:[-*+][ \t]+\[[ xX]\][ \t]+|[-*+][ \t]+|\d+\.[ \t]+)/, '');
}
// Bulleted / numbered / task list. If every non-blank line is ALREADY this kind, strip the
// markers (toggle off); otherwise REPLACE any existing list marker with this kind's (ordered
// renumbers 1., 2., …) — so switching bullet→numbered swaps cleanly instead of stacking.
function toggleList(kind) {
  applyBlock((lines) => {
    const ne = lines.filter((l) => l.trim() !== '');
    const allKind = ne.length > 0 && ne.every((l) => listKind(l) === kind);
    let n = 0;
    return lines.map((line) => {
      if (line.trim() === '') return line;
      if (allKind) return stripList(line);
      n += 1;
      const marker = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : n + '. ';
      return marker + stripList(line);
    });
  });
}

// Strip inline formatting markers (**bold**, *em*, ~~strike~~, `code`, ==hl==, <u>, ~sub~, ^sup^)
// from the selection (or the word at the caret). Pairs only; leaves prose untouched.
function clearFormatting() {
  const strip = (s) => s
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1').replace(/__([\s\S]*?)__/g, '$1')
    .replace(/\*([\s\S]*?)\*/g, '$1').replace(/(?<!\w)_([\s\S]*?)_(?!\w)/g, '$1')
    .replace(/~~([\s\S]*?)~~/g, '$1').replace(/==([\s\S]*?)==/g, '$1')
    .replace(/`([^`]*?)`/g, '$1').replace(/<\/?u>/gi, '')
    .replace(/\^([^\^\s]+?)\^/g, '$1').replace(/~([^~\n]+?)~/g, '$1');
  if (cmAdapter) {
    cmAdapter.focus();
    let { start, end } = cmAdapter.getSelection();
    const v = cmAdapter.getValue();
    if (start === end) { const w = wordBounds(v, start); if (w) { start = w.start; end = w.end; } }
    const cleaned = strip(v.slice(start, end));
    cmAdapter.setSelection({ start, end });
    cmAdapter.replaceSelection(cleaned);
    cmAdapter.setSelection({ start, end: start + cleaned.length });
    return;
  }
  ensureSourceFocus();
  const ta = srcTextarea;
  const cleaned = strip(ta.value.slice(ta.selectionStart, ta.selectionEnd));
  replaceInTextarea(ta, ta.selectionStart, ta.selectionEnd, cleaned);
}
window.clearFormatting = clearFormatting;

// Insert a numbered footnote: a [^N] reference at the caret + a "[^N]: " definition appended at
// the end of the document, with the caret left after the colon to type the note (R11).
function insertFootnote() {
  if (!cmAdapter) { insertText('[^1]', ''); return; }
  cmAdapter.focus();
  const v = cmAdapter.getValue();
  const used = [...v.matchAll(/\[\^(\d+)\]/g)].map((m) => parseInt(m[1], 10));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  const { start, end } = cmAdapter.getSelection();
  cmAdapter.setSelection({ start, end });
  cmAdapter.replaceSelection(`[^${n}]`);
  const v2 = cmAdapter.getValue();
  const sep = v2.endsWith('\n\n') ? '' : v2.endsWith('\n') ? '\n' : '\n\n';
  cmAdapter.setSelection({ start: v2.length, end: v2.length });
  cmAdapter.replaceSelection(`${sep}[^${n}]: `);
  cmAdapter.setSelection({ start: cmAdapter.getValue().length });
}
window.insertFootnote = insertFootnote;

// Interactive table editing: apply a structural op (rowAfter/rowBefore/rowDelete/colAfter/
// colBefore/colDelete/nextCell/prevCell) to the table at the caret. Returns true if a table was
// found + edited. Pure engine in table-edit.js; here we just splice the result into CM6.
function tableOp(kind) {
  if (!cmAdapter) return false;
  const r = tableEdit(cmAdapter.getValue(), cmAdapter.getSelection().start, kind);
  if (!r) return false;
  cmAdapter.focus();
  cmAdapter.setSelection({ start: r.from, end: r.to });
  cmAdapter.replaceSelection(r.md);
  cmAdapter.setSelection({ start: r.caret });
  return true;
}
window.tableOp = tableOp;
// Tab handler bound in the CM6 keymap: navigate table cells when inside a table, else let Tab
// fall through to indentWithTab. `shift` = previous cell.
function tableTab(shift) { return tableOp(shift ? 'prevCell' : 'nextCell'); }

// Indent (+1) / outdent (-1) the spanned lines by two spaces — for nesting list items (Tab /
// Shift+Tab also do this via CM6's indentWithTab; these are the toolbar equivalents).
function indentSelection(delta) {
  applyBlock((lines) => lines.map((l) => {
    if (l.trim() === '') return l;
    return delta > 0 ? '  ' + l : l.replace(/^( {1,2}|\t)/, '');
  }));
}
window.indentSelection = indentSelection;

const TABLE_TEMPLATE = '| Column | Column |\n| --- | --- |\n| Cell | Cell |\n';
const CALLOUT_TEMPLATE = '> [!NOTE] Title\n> Body text\n';

// Highlight toolbar buttons for the construct(s) the caret is currently inside (active-state).
// Driven by cmAdapter.getActiveMarks() on every selection/doc change (wired in initCM6Editor).
function updateToolbarActiveState() {
  if (!cmAdapter || typeof cmAdapter.getActiveMarks !== 'function') return;
  const m = cmAdapter.getActiveMarks();
  const set = (id, on) => { const el = $(id); if (el) el.classList.toggle('is-active', !!on); };
  set('tbBold', m.has('bold'));
  set('tbItalic', m.has('italic'));
  set('tbStrike', m.has('strike'));
  set('tbCode', m.has('code'));
  set('tbQuote', m.has('quote'));
  set('tbList', m.has('bullet') && !m.has('task'));
  set('tbListOrdered', m.has('ordered'));
  set('tbTaskList', m.has('task'));
  set('tbCodeBlock', m.has('codeblock'));
  set('tbHeading', m.has('heading'));
  set('tbTable', m.has('table'));
  // Reveal the table row/column controls only while the caret is inside a table.
  const tc = $('tableControls');
  if (tc) tc.classList.toggle('show', m.has('table'));
}
window.updateToolbarActiveState = updateToolbarActiveState;

window.wrapSelection = wrapSelection;
window.insertText = insertText;
window.lineStart = lineStart;
window.insertBlock = insertBlock;
window.insertCodeBlock = insertCodeBlock;
window.toggleHeading = toggleHeading;
window.toggleQuote = toggleQuote;
window.toggleList = toggleList;

// =====================================================================
// COMMAND PALETTE
// =====================================================================
// Section labels carry a stable English `sec` (used for grouping + English display)
// and a localization key resolved at render time (T-R7).
const PAL_SEC_KEY = { 'Files': 'palette.sec.files', 'View': 'palette.sec.view', 'Help': 'palette.sec.help', 'Files in folder': 'palette.sec.filesInFolder' };
const PALETTE_COMMANDS = [
  { sec: 'Files', key: 'palette.openFolder', icon: 'folder', name: 'Open Folder…', meta: 'command', sk: 'Ctrl+⇧+O', act: openVault },
  { sec: 'Files', key: 'palette.openFile', icon: 'file', name: 'Open File…', meta: 'command', sk: 'Ctrl+O', act: openSingleFile },
  { sec: 'Files', key: 'palette.newNote', icon: 'file-plus', name: 'New Note', meta: 'command', sk: 'Ctrl+N', act: newNote },
  { sec: 'Files', key: 'palette.save', icon: 'save', name: 'Save', meta: 'command', sk: 'Ctrl+S', act: saveCurrent },
  { sec: 'Files', key: 'palette.exportHtml', icon: 'file-code', name: 'Export HTML', meta: 'command', act: () => exportHTML() },
  { sec: 'Files', key: 'palette.exportPdf', icon: 'printer', name: 'Export PDF', meta: 'command', act: () => exportPDF() },
  { sec: 'Files', key: 'palette.loadDemo', icon: 'sparkles', name: 'Load demo notes', meta: 'command', act: loadDemo },
  { sec: 'View', key: 'palette.toggleReading', icon: 'book-open', name: 'Toggle Reading Mode', meta: 'view', sk: 'Ctrl+E', act: toggleViewMode },
  { sec: 'View', key: 'palette.flip', icon: 'flip', name: 'Flip direction (RTL ⇄ LTR)', meta: 'view', sk: 'Ctrl+⇧+L', act: toggleRTL },
  { sec: 'View', key: 'palette.themePaper', icon: 'sun', name: 'Theme: Paper', meta: 'view', act: () => setTheme('paper') },
  { sec: 'View', key: 'palette.themeInk', icon: 'moon', name: 'Theme: Ink', meta: 'view', act: () => setTheme('ink') },
  { sec: 'View', key: 'palette.themeSepia', icon: 'book-open', name: 'Theme: Sepia', meta: 'view', act: () => setTheme('sepia') },
  { sec: 'View', key: 'palette.toggleSidebar', icon: 'panel-left', name: 'Toggle Sidebar', meta: 'view', sk: 'Ctrl+\\', act: toggleSidebar },
  { sec: 'View', key: 'palette.toggleInspector', icon: 'panel-right', name: 'Toggle Inspector', meta: 'view', act: toggleInspector },
  { sec: 'View', key: 'palette.toggleArabic', icon: 'languages', name: 'Toggle Arabic Interface (العربية)', meta: 'view', act: toggleArabicUI },
  { sec: 'View', key: 'palette.toggleKashida', icon: 'align-justify', name: 'Toggle Arabic Kashida Justification', meta: 'view', act: toggleKashida },
  { sec: 'View', key: 'palette.toggleItalic', icon: 'italic', name: 'Toggle Italic Recolour', meta: 'view', act: toggleItalicRecolor },
  { sec: 'View', key: 'palette.zoomIn', icon: 'zoom-in', name: 'Zoom In',    meta: 'view', sk: 'Ctrl+=', act: zoomIn },
  { sec: 'View', key: 'palette.zoomOut', icon: 'zoom-out', name: 'Zoom Out',   meta: 'view', sk: 'Ctrl+-', act: zoomOut },
  { sec: 'View', key: 'palette.resetZoom', icon: 'rotate-ccw', name: 'Reset Zoom', meta: 'view', sk: 'Ctrl+0', act: zoomReset },
  { sec: 'Help', key: 'palette.shortcuts', icon: 'keyboard', name: 'Keyboard Shortcuts', meta: 'help', sk: 'Ctrl+/', act: showShortcuts },
  { sec: 'View', get key() { return togglePaletteKey('autoHideTitlebar'); }, icon: 'panel-left', get name() { return toggleFallback('autoHideTitlebar'); }, meta: 'view', sk: 'Ctrl+⇧+T', act: () => toggleAutoHideTitlebar() },
  { sec: 'View', get key() { return togglePaletteKey('hideStatusBar'); }, icon: 'panel-right', get name() { return toggleFallback('hideStatusBar'); }, meta: 'view', sk: 'Ctrl+⇧+B', act: () => toggleHideStatusBar() },
  { sec: 'View', key: 'palette.settings', icon: 'align-justify', name: 'Settings…', meta: 'view', sk: 'Ctrl+,', act: () => showSettings() },
  { sec: 'Help', key: 'palette.about', icon: 'info', name: 'About BP MD RTL Reader', meta: 'help', act: showAbout }
];

let palIdx = 0, palVisible = [];
function openPalette() {
  if (dropdown.classList.contains('open')) closeMenu(); // don't strand a menu open behind the overlay (returns focus to its button first)
  if (!palOverlay.classList.contains('open')) pushFocus(); // remember the opener (may be inside a modal)
  palOverlay.classList.add('open');
  palInput.setAttribute('aria-expanded', 'true');
  palInput.value = '';
  filterPalette('');
  setTimeout(() => palInput.focus(), 50);
}
function closePalette() {
  const wasOpen = palOverlay.classList.contains('open');
  palOverlay.classList.remove('open');
  palInput.setAttribute('aria-expanded', 'false');
  palInput.value = '';
  if (wasOpen) restoreFocus();
}
window.openPalette = openPalette;
window.closePalette = closePalette;
window.openFind = openFind;
window.runFind = runFind;
window.findStep = findStep;
window.closeFind = closeFind;
window.showShortcuts = showShortcuts;

// T-F19: Settings. Built the way showShortcuts()/showAbout() are — a template string
// through openModal() — so it inherits the app's single modal: the focus stack, the
// Escape priority chain and the Tab trap all work with no new machinery. buildMenu()
// already ships role/aria-checked through the same innerHTML sink under the 'default'
// Trusted Types policy, so the ARIA state attributes survive DOMPurify.
function showSettings() {
  closeMenu();
  const L = (key, fallback) => {
    const v = tr(key, State.uiLocale);
    return escapeHtml(!v || v === key ? fallback : v);
  };
  const mode = State.windowTitleMode === 'app' ? 'app' : 'file';
  const sw = (id, key, fallback, on) =>
    `<button type="button" class="set-switch" id="${id}" role="switch"` +
    ` aria-checked="${on ? 'true' : 'false'}" aria-label="${L(key, fallback)}"></button>`;

  const html = `
    <div class="set-group">
      <div class="set-group-label">${L('settings.window', 'Window')}</div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('settings.windowTitle', 'Window title')}</div>
          <div class="set-desc">${L('settings.windowTitleDesc', 'What Windows shows in the taskbar and Alt+Tab. The app icon is unchanged either way; unsaved files are marked with a leading dot.')}</div>
        </div>
        <div class="set-seg" role="group" aria-label="${L('settings.windowTitle', 'Window title')}">
          <button type="button" id="setTitleModeFile" aria-pressed="${mode === 'file'}">${L('settings.titleModeFile', 'File name')}</button>
          <button type="button" id="setTitleModeApp" aria-pressed="${mode === 'app'}">${L('settings.titleModeApp', 'App name')}</button>
        </div>
      </div>
    </div>
    <div class="set-group">
      <div class="set-group-label">${L('settings.appearance', 'Appearance')}</div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('settings.autoHideTitlebar', 'Auto-hide top bar')}</div>
          <div class="set-desc">${L('settings.autoHideTitlebarDesc', 'Hides the top bar and the window controls until the pointer reaches the top edge. Always reachable from View or Ctrl+Shift+T. While it is hidden the window cannot be dragged.')}</div>
        </div>
        ${sw('setAutoHide', 'settings.autoHideTitlebar', 'Auto-hide top bar', State.autoHideTitlebar)}
      </div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('settings.hideStatusBar', 'Hide bottom status bar')}</div>
          <div class="set-desc">${L('settings.hideStatusBarDesc', 'Removes the status bar and gives its row back to the note. Ctrl+Shift+B.')}</div>
        </div>
        ${sw('setHideStatus', 'settings.hideStatusBar', 'Hide bottom status bar', State.hideStatusBar)}
      </div>
    </div>`;

  const title = tr('settings.title', State.uiLocale);
  openModal(!title || title === 'settings.title' ? 'Settings' : title, html);

  // Wire after insertion, mirroring buildMenu()'s querySelectorAll pass over its own
  // innerHTML output.
  const sync = () => {
    $('setAutoHide')?.setAttribute('aria-checked', String(!!State.autoHideTitlebar));
    $('setHideStatus')?.setAttribute('aria-checked', String(!!State.hideStatusBar));
    $('setTitleModeFile')?.setAttribute('aria-pressed', String(State.windowTitleMode !== 'app'));
    $('setTitleModeApp')?.setAttribute('aria-pressed', String(State.windowTitleMode === 'app'));
  };
  $('setAutoHide')?.addEventListener('click', () => { toggleAutoHideTitlebar(); sync(); });
  $('setHideStatus')?.addEventListener('click', () => { toggleHideStatusBar(); sync(); });
  $('setTitleModeFile')?.addEventListener('click', () => { setWindowTitleMode('file'); sync(); });
  $('setTitleModeApp')?.addEventListener('click', () => { setWindowTitleMode('app'); sync(); });
}
window.showSettings = showSettings;

window.newDailyNote = newDailyNote;
window.renderTree = renderTree;
window.showWelcome = showWelcome;
window.parseMarkdown = parseMarkdown;
window.PALETTE_COMMANDS = PALETTE_COMMANDS;
// T-F19: exposed for the shortcut-drift guard in tests/e2e/click-audit-all.spec.js,
// mirroring PALETTE_COMMANDS above. A shortcut lives in four places by hand.
window.MENU_DEFS = MENU_DEFS;
// v10 redesign (D1): the context menu's role labels/shortcuts are a fifth hand-copy of the
// same six Edit-menu chords (CA19) — exposed so click-audit-all.spec.js can guard it too.
window.CTX_ROLE_DISPLAY = CTX_ROLE_DISPLAY;
// Exposed for the Electron-lane cross-check in tests/e2e/electron/context-menu.spec.js —
// main's APP_COMMANDS carries only ids; this is where their display text actually lives.
window.APP_COMMAND_DISPLAY = APP_COMMAND_DISPLAY;

function filterPalette(q) {
  q = (q || '').trim().toLowerCase();
  const loc = State.uiLocale;
  const labelOf = (c) => (c.key ? tr(c.key, loc) : c.name); // localized display name (T-R7)
  const items = [];
  // Match BOTH the English name and the localized label so search works in either language.
  PALETTE_COMMANDS.forEach(c => {
    const label = labelOf(c);
    if (!q || c.name.toLowerCase().includes(q) || label.toLowerCase().includes(q)) items.push({ ...c, _kind: 'cmd', _label: label });
  });
  State.files.forEach((f, i) => {
    if (!q || f.name.toLowerCase().includes(q)) {
      items.push({ sec: 'Files in folder', icon: 'file', name: f.name, _label: f.name, meta: f.path, _kind: 'file', _idx: i });
    }
  });
  const sections = {};
  items.forEach(it => { sections[it.sec] = sections[it.sec] || []; sections[it.sec].push(it); });
  let html = ''; palVisible = [];
  Object.entries(sections).forEach(([sec, arr]) => {
    const secLabel = PAL_SEC_KEY[sec] ? tr(PAL_SEC_KEY[sec], loc) : sec;
    html += `<div class="pal-section-label">${escapeHtml(secLabel)}</div>`;
    arr.forEach(it => {
      palVisible.push(it);
      const sk = it.sk ? `<span class="pi-shortcut">${it.sk.split('+').map(p => `<span class="kbd">${p}</span>`).join('')}</span>` : '';
      const optionIndex = palVisible.length - 1;
      html += `<button type="button" class="pal-item${palVisible.length === 1 ? ' active' : ''}" role="option" id="pal-option-${optionIndex}" aria-selected="${palVisible.length === 1}" data-i="${optionIndex}">
        <span class="pi-icon">${it.icon ? `<svg class="ic"><use href="#ic-${escapeHtml(it.icon)}"/></svg>` : ''}</span>
        <span class="pi-name">${escapeHtml(it._label || it.name)}</span>
        <span class="pi-meta">${escapeHtml(it.meta || '')}</span>
        ${sk}
      </button>`;
    });
  });
  if (!items.length) html = `<div class="search-empty" style="padding: 20px;">${escapeHtml(tr('palette.noMatches', loc))}</div>`;
  palResults.innerHTML = html;
  palIdx = 0;
  if (palVisible.length) palInput.setAttribute('aria-activedescendant', 'pal-option-0');
  else palInput.removeAttribute('aria-activedescendant');
  palResults.querySelectorAll('.pal-item').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.i);
      const it = palVisible[i];
      closePalette();
      if (it._kind === 'cmd') it.act();
      else if (it._kind === 'file') renderFile(it._idx);
    });
  });
}

function syncPaletteActive(items) {
  items.forEach((item, i) => {
    const active = i === palIdx;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  });
  const active = items[palIdx];
  if (active) palInput.setAttribute('aria-activedescendant', active.id);
  else palInput.removeAttribute('aria-activedescendant');
}

palInput.addEventListener('keydown', e => {
  const items = palResults.querySelectorAll('.pal-item');
  if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, items.length - 1); syncPaletteActive(items); items[palIdx]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); syncPaletteActive(items); }
  else if (e.key === 'Enter') { e.preventDefault(); items[palIdx]?.click(); }
  // Stop the Esc from also reaching the global handler — otherwise it would see the
  // palette already closed and go on to close a modal underneath it (nested overlays).
  else if (e.key === 'Escape') { e.stopPropagation(); closePalette(); }
});
palInput.addEventListener('input', () => filterPalette(palInput.value));

// =====================================================================
// WINDOW BUTTONS
// =====================================================================
function winMinimize() {
  if (window.electronAPI) window.electronAPI.minimizeWindow();
}
function winMaximize() {
  if (window.electronAPI) window.electronAPI.maximizeWindow();
}
async function winClose() {
  const dirty = State.files.filter(f => f.dirty).length;
  if (dirty > 0) { if (!confirm(`${dirty} unsaved file${dirty === 1 ? '' : 's'}. Close anyway?`)) return; }
  await flushSettings();
  if (window.electronAPI) window.electronAPI.closeWindow();
}
if (window.electronAPI && typeof window.electronAPI.onCloseRequested === 'function') {
  window.electronAPI.onCloseRequested(() => { winClose(); });
}

// =====================================================================
// GLOBAL KEYBOARD SHORTCUTS
// =====================================================================
document.addEventListener('keydown', e => {
  const cmd = e.ctrlKey || e.metaKey;
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

  if (cmd && e.key.toLowerCase() === 'k' && !e.shiftKey) { e.preventDefault(); openPalette(); }
  else if (cmd && e.key.toLowerCase() === 'p' && !e.shiftKey) { e.preventDefault(); openPalette(); }
  else if (cmd && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleRTL(); }
  else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); toggleViewMode(); } // T-F17 Reading/Edit
  else if (cmd && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); cycleTheme(); }
  else if (cmd && e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); toggleInspector(); }
  else if (cmd && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openVault(); }
  else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); openSingleFile(); }
  else if (cmd && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newDailyNote(); }
  else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
  else if (cmd && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveAs(); }
  else if (cmd && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); }
  else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'w') { e.preventDefault(); if (State.activeFile !== null) closeTab(State.activeFile); }
  else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
  else if (cmd && e.key === '\\') { e.preventDefault(); toggleSidebar(); }
  else if (cmd && e.key === '/') { e.preventDefault(); showShortcuts(); }
  // T-F19 chrome. Ctrl+Shift+B is deliberately ABOVE the Bold branch further down:
  // that one matches `cmd && !inInput && key === 'b'` with no !e.shiftKey guard, so
  // placing this after it would make Bold swallow the chord.
  else if (cmd && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); toggleAutoHideTitlebar(); }
  // !inInput so the very common Ctrl+Shift+B typo -- reaching for Bold with Shift still
  // down -- falls through to the Bold branch below instead of silently hiding the
  // status bar and discarding the keystroke.
  else if (cmd && e.shiftKey && !inInput && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleHideStatusBar(); }
  else if (cmd && !e.shiftKey && e.key === ',') { e.preventDefault(); showSettings(); }
  // Zoom shortcuts: e.key === '=' for Ctrl+=, '-' for Ctrl+-, '0' for Ctrl+0
  else if (cmd && !e.shiftKey && e.key === '=') { e.preventDefault(); zoomIn(); }
  else if (cmd && !e.shiftKey && e.key === '-') { e.preventDefault(); zoomOut(); }
  else if (cmd && !e.shiftKey && e.key === '0') { e.preventDefault(); zoomReset(); }
  // Ctrl+A: when a text field (INPUT/TEXTAREA) is focused, leave NATIVE select-all
  // intact (e.g. #findInput selects its own text). Only scope-select the
  // live-preview noteContent via execEditCmd when focus is NOT in a field.
  else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'a') {
    if (inInput) return; // native behavior selects the focused field's text
    e.preventDefault();
    execEditCmd('selectAll');
  }
  else if (cmd && !inInput && e.key.toLowerCase() === 'b') { e.preventDefault(); wrapSelection('**', '**'); }
  else if (cmd && !inInput && e.key.toLowerCase() === 'i') { e.preventDefault(); wrapSelection('*', '*'); }
  // Ctrl/Cmd+1–6 → set heading level (toggle off if already at that level). Conventional
  // (Typora). Ctrl+0 stays Zoom-Reset (app convention), so re-click/re-press the level to clear.
  else if (cmd && !e.shiftKey && !inInput && /^[1-6]$/.test(e.key)) { e.preventDefault(); toggleHeading(parseInt(e.key, 10)); }
  else if (e.key === 'Escape') {
    if (palOverlay.classList.contains('open')) closePalette();
    else if (modalOverlay.classList.contains('open')) closeModal();
    else if ($('findBar').classList.contains('open')) {
      closeFind();
      e.stopImmediatePropagation(); // preserve lower-priority reader popover for the next Escape
    }
    else if (dropdown.classList.contains('open')) closeMenu();
  }
});

// T-F4: keep Tab inside the top-most open overlay (palette wins over modal when
// both are open). The pure trapTab() decides the wrap target; the browser handles
// interior moves (it returns null for those).
document.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const overlay = palOverlay.classList.contains('open') ? palOverlay
    : modalOverlay.classList.contains('open') ? modalOverlay : null;
  if (!overlay) return;
  const target = trapTab(getFocusable(overlay), document.activeElement, e.shiftKey);
  if (target) { e.preventDefault(); target.focus(); }
});

// T-F5: keyboard control of the open toolbar menu. Document-level so it works even
// when the menu was mouse-opened (focus still on the editor): Up/Down/Home/End rove
// between items, pulling focus IN if it isn't already (rovingNext maps current=-1 to
// first/last). Tab closes the menu (standard ARIA) and returns focus to the opener.
// Esc is handled by the global Escape branch (also via closeMenu → opener restore).
document.addEventListener('keydown', e => {
  if (!dropdown.classList.contains('open')) return;
  if (e.key === 'Tab') { e.preventDefault(); closeMenu(); return; }
  const items = [...dropdown.querySelectorAll('.dd-item:not(.disabled)')];
  if (!items.length) return;
  const next = rovingNext(e.key, items.indexOf(document.activeElement), items.length, { loop: true });
  if (next < 0) return;
  e.preventDefault();
  items.forEach((it, i) => it.setAttribute('tabindex', i === next ? '0' : '-1'));
  items[next].focus();
});

// =====================================================================
// EVENT WIRING
// =====================================================================
$('sidebarToggleBtn').addEventListener('click', toggleSidebar);
$('inspectorToggleBtn').addEventListener('click', toggleInspector);
// T-F18: the reveal strips were removed; the titlebar toggles above are the sole
// reveal affordance. `$` returns null for a missing id, so leaving these behind would
// throw at boot and silently kill every later listener registration.
$('themeBtn').addEventListener('click', cycleTheme);
$('fullscreenBtn').addEventListener('click', toggleFullscreen);
$('rtlBtn').addEventListener('click', toggleRTL);
$('viewModeBtn')?.addEventListener('click', toggleViewMode); // T-F17: Reading ⇄ Edit
$('tabAddBtn').addEventListener('click', newNote);
$('searchBtn').addEventListener('click', openPalette);
$('winMinBtn').addEventListener('click', winMinimize);
$('winMaxBtn').addEventListener('click', winMaximize);
$('winCloseBtn').addEventListener('click', winClose);
$('modalCloseBtn').addEventListener('click', closeModal);
$('modalOverlay').addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
$('palOverlay').addEventListener('click', e => { if (e.target === palOverlay) closePalette(); });
readerControlsButton?.addEventListener('click', () => setReaderControlsOpen(readerControlsPopover.hidden));
readerTextScaleDecrease?.addEventListener('click', () => setReaderTextScale(State.readerTextScale - 0.1));
readerTextScaleReset?.addEventListener('click', () => setReaderTextScale(1));
readerTextScaleIncrease?.addEventListener('click', () => setReaderTextScale(State.readerTextScale + 0.1));
readerWidthSlider?.addEventListener('input', (event) => setReaderWidthCh(Number(event.currentTarget.value)));
document.addEventListener('click', (event) => {
  if (!readerControlsPopover || readerControlsPopover.hidden || readerControlsEl?.contains(event.target)) return;
  setReaderControlsOpen(false, true);
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !readerControlsPopover || readerControlsPopover.hidden) return;
  event.preventDefault();
  setReaderControlsOpen(false, true);
});

document.querySelectorAll('.tb-menu-item').forEach(btn => {
  // Keep the editor focused/selected when opening a menu — a mousedown would
  // otherwise blur the textarea, breaking Copy/Cut/Undo run from the Edit menu.
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', e => openMenu(e, btn.dataset.menu));
});
document.querySelectorAll('.sb-tab').forEach(btn => {
  btn.addEventListener('click', () => switchSbPane(btn.dataset.pane));
});
$('sbSearchInput').addEventListener('input', e => scheduleSidebarSearch(e.target.value));
// v10 redesign (2026-08-25): the sidebar vault header (#sbOpenVaultBtn,
// #sbOpenFileBtn, #sbNewNoteBtn) is removed. Open Folder / Open File / New Note stay
// reachable through the buttons below (.sb-empty) and the welcome card.
$('emptyOpenVault').addEventListener('click', openVault);
$('emptyOpenFile').addEventListener('click', openSingleFile);
$('emptyLoadDemo').addEventListener('click', loadDemo);
$('wbOpenVault').addEventListener('click', openVault);
$('wbOpenFile').addEventListener('click', openSingleFile);
$('wbNewNote').addEventListener('click', newNote);
$('wbLoadDemo').addEventListener('click', loadDemo);

// Toolbar buttons (CM6 is the sole editor; every action routes through the cmAdapter helpers).
$('tbBold').addEventListener('click', () => wrapSelection('**', '**'));
$('tbItalic').addEventListener('click', () => wrapSelection('*', '*'));
$('tbStrike').addEventListener('click', () => wrapSelection('~~', '~~'));
$('tbUnderline').addEventListener('click', () => wrapSelection('<u>', '</u>'));
$('tbCode').addEventListener('click', () => wrapSelection('`', '`'));
$('tbHighlight').addEventListener('click', () => wrapSelection('==', '=='));
$('tbSub').addEventListener('click', () => wrapSelection('~', '~'));
$('tbSup').addEventListener('click', () => wrapSelection('^', '^'));
$('tbClear').addEventListener('click', () => clearFormatting());
$('tbLink').addEventListener('click', () => insertText('[', '](url)'));
$('tbWikilink').addEventListener('click', () => insertText('[[', ']]'));
$('tbMath').addEventListener('click', () => wrapSelection('$', '$'));
$('tbFootnote').addEventListener('click', () => insertFootnote());
$('tbQuote').addEventListener('click', () => toggleQuote());
$('tbCallout').addEventListener('click', () => insertBlock(CALLOUT_TEMPLATE));
$('tbList').addEventListener('click', () => toggleList('bullet'));
$('tbListOrdered').addEventListener('click', () => toggleList('ordered'));
$('tbTaskList').addEventListener('click', () => toggleList('task'));
$('tbOutdent').addEventListener('click', () => indentSelection(-1));
$('tbIndent').addEventListener('click', () => indentSelection(1));
$('tbCodeBlock').addEventListener('click', () => insertCodeBlock());
$('tbTable').addEventListener('click', () => insertBlock(TABLE_TEMPLATE));
$('tbImage').addEventListener('click', () => insertText('![', '](url)'));
$('tbRule').addEventListener('click', () => insertBlock('---\n'));
// Table row/column controls (shown only when the caret is inside a table).
$('tcRowAfter').addEventListener('click', () => tableOp('rowAfter'));
$('tcRowDelete').addEventListener('click', () => tableOp('rowDelete'));
$('tcColAfter').addEventListener('click', () => tableOp('colAfter'));
$('tcColDelete').addEventListener('click', () => tableOp('colDelete'));

// Heading-level pop-down (H1–H6) — fixes the missing H4/H5/H6.
const headingMenu = $('headingMenu');
function closeHeadingMenu() { headingMenu.classList.remove('open'); $('tbHeading').setAttribute('aria-expanded', 'false'); }
$('tbHeading').addEventListener('click', (e) => {
  e.stopPropagation();
  const open = headingMenu.classList.toggle('open');
  $('tbHeading').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    const buttonRect = $('tbHeading').getBoundingClientRect();
    const inlineStart = document.documentElement.dir === 'rtl'
      ? window.innerWidth - buttonRect.right
      : buttonRect.left;
    headingMenu.style.top = `${toolbarStrip.getBoundingClientRect().bottom}px`;
    headingMenu.style.insetInlineStart = `${inlineStart}px`;
  }
});
headingMenu.querySelectorAll('.td-item').forEach((it) => {
  it.addEventListener('click', () => {
    const n = parseInt(it.getAttribute('data-level'), 10) || 1;
    toggleHeading(n);
    closeHeadingMenu();
  });
});
document.addEventListener('click', (e) => {
  if (headingMenu.classList.contains('open') && !headingMenu.contains(e.target) && !$('tbHeading').contains(e.target)) closeHeadingMenu();
});

// Find bar
$('findInput').addEventListener('input', e => runFind(e.target.value));
$('findPrevBtn').addEventListener('click', () => findStep(-1));
$('findNextBtn').addEventListener('click', () => findStep(1));
$('findCloseBtn').addEventListener('click', closeFind);

// Main/preload notifications are bound once through the workspace controller.
workspaceController.bindExternalEvents();

document.addEventListener('click', e => {
  if (!e.target.closest('.tb-menu-item') && !e.target.closest('.dropdown') && !e.target.closest('.tb-menu-btn')) closeMenu();
});

// =====================================================================
// DRAG-DROP (Issue #7)
// =====================================================================
function initDragDrop() {
  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

  document.body.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.body.addEventListener('drop', async e => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    let loaded = 0;
    for (const file of files) {
      if (!isDroppableFile(file.name)) {
        showToast(`Skipped "${file.name}" — only .md/.markdown/.txt files`, 'info');
        continue;
      }
      if (file.size > MAX_SIZE) {
        showToast(`Skipped "${file.name}" — file exceeds 10 MB limit`, 'error');
        continue;
      }
      try {
        const content = await file.text();
        addFile({ name: file.name, path: file.name, handle: null, content, dirty: false });
        loaded++;
      } catch(err) {
        showToast(`Could not read "${file.name}"`, 'error');
      }
    }
    if (loaded > 0) showToast(`Loaded ${loaded} file${loaded === 1 ? '' : 's'}`);
  });
}
window.initDragDrop = initDragDrop;
window.renderTags = renderTags;
window.escapeHtml = escapeHtml;

// =====================================================================
// PERSISTENT SETTINGS (T-F8 / B5)
// Restore theme / zoom / editor-mode / panel visibility / recents from the
// main process on launch and persist them (debounced) whenever they change.
// Outside Electron (browser/dev) there is no bridge, so we keep the existing
// localStorage theme fallback untouched.
// =====================================================================
const SettingsBridge =
  (window.electronAPI && typeof window.electronAPI.getSettings === 'function')
    ? window.electronAPI : null;

settingsController = createSettingsController({
  state: State,
  bridge: SettingsBridge,
  subscribe,
  themes: THEMES,
  getLastSession: workspaceController.buildSession,
  actions: {
    applyTheme(theme) {
      document.documentElement.setAttribute('data-theme', theme);
      $('themeBtn')?.classList.toggle('active', theme !== 'paper'); updateThemeIcon(theme);
      if ($('themeLabel')) $('themeLabel').textContent = theme;
    },
    setZoom,
    setReaderTextScale,
    setReaderWidthCh,
    setEditorMode,
    setViewMode,
    applyPanelLayout,
    applyChromeLayout,   // T-F19
    syncWindowTitle,     // T-F19
    renderRecents,
    applyKashida,
    applyItalicRecolor,
    setUiLocale,
    setUiDirection,
    restoreLastSession: workspaceController.restoreLastSession,
  },
});
const {
  persistSettings,
  flushSettings,
  restoreSettings,
} = settingsController;
settingsController.bind();
window.persistSettings = persistSettings;
window.flushSettings = flushSettings;
window.restoreSettings = restoreSettings;

// =====================================================================
// INIT
// =====================================================================
(function init() {
  // Detect Electron and apply native-window overrides
  if (window.electronAPI) document.documentElement.classList.add('electron');

  // Panel visibility: the static markup starts with `no-sidebar no-inspector` (clean editor-only
  // first paint, no flash). In the packaged app, restoreSettings() applies the persisted/default
  // values (default closed). With NO settings bridge (browser/dev), reflect the in-memory State
  // defaults (panels open) so the dev/test surface keeps both panels available.
  restoreSettings().then((restored) => {
    if (!restored) {
      applyPanelLayout();
      // T-F19: no bridge here, so the localStorage mirror IS the persisted state. Seed
      // State from it before applying, or this would overwrite what theme-boot.js just
      // painted and the choice would be lost on every reload.
      try {
        const cached = localStorage.getItem('bpmdrtlreader-chrome') || '';
        State.autoHideTitlebar = cached.split(' ').includes('autohide');
        State.hideStatusBar = cached.split(' ').includes('nostatus');
      } catch (_) { /* storage unavailable — fall through to the defaults */ }
      applyChromeLayout();
      const stored = localStorage.getItem('bpmdrtlreader-theme');
      if (stored && THEMES.includes(stored)) {
        State.theme = stored;
        document.documentElement.setAttribute('data-theme', stored);
        $('themeBtn')?.classList.toggle('active', stored !== 'paper'); updateThemeIcon(stored);
        if ($('themeLabel')) $('themeLabel').textContent = stored;
      }
    }
    // T-F19: name the way out when the app OPENS with no chrome. restoreSettings() sets
    // the flags straight from disk and calls applyChromeLayout() — it never goes through
    // setAutoHideTitlebar(), which is where the "press Ctrl+Shift+T" toast lives. So a
    // user who quit with the bar hidden got a window with no title bar, no menus and no
    // window controls, and nothing on screen explaining any of it.
    if (State.autoHideTitlebar || State.hideStatusBar) {
      const what = State.autoHideTitlebar ? 'Top bar' : 'Status bar';
      const how = State.autoHideTitlebar
        ? 'move the pointer to the top edge, or press Ctrl+Shift+T'
        : 'press Ctrl+Shift+B';
      showToast(`${what} hidden — ${how}. Ctrl+, opens Settings.`, 'info');
    }
    // T-F13/A1: mount CM6 if the persisted "Live-Preview Editor" setting (or ?cm=1 / localStorage)
    // asks for it — AFTER restore so State.cmEditor is in effect. Lazy + reversible; textarea on failure.
    initCM6Editor().catch(() => { /* fall back to the textarea */ });
  });

  showWelcome();
  initDragDrop();
})();

function updateThemeIcon(theme) {
  let icon = '#ic-sun';
  if (theme === 'ink') icon = '#ic-moon';
  else if (theme === 'sepia') icon = '#ic-book-open';
  $('themeBtn')?.querySelector('use')?.setAttribute('href', icon);
}
