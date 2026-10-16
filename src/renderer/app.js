'use strict';

import { isArabicHeavy, escapeHtml, escapeReg } from './i18n.js';
import { THEMES, getNextTheme, clampZoom } from './theme.js';
import { createState } from './state.js';
import { vaultSearch as _vaultSearch, warmSearchIndexSlice } from './components/search.js';
import { NEEDS_FOLD, normalizeArabic, normalizeArabicWithMap, mapEnd } from './components/text-normalize.js';
import { configureMarked, parseMarkdown as _parseMarkdown, parseCalloutHeader, lastRenderLimited } from './markdown/markdown.js';
import { execEditCmd as _execEditCmdImpl } from './editor/edit-commands.js';
import { applyBidi } from './bidi-dom.js';
import { resolveBlockDirection, proseText, headingSlugs, resolveDocDirection, nextCellIndex } from './bidi.js';
import { transformCallouts } from './markdown/callouts.js';
import { activeCodeBlock } from './markdown/code-track.js';
import { flipEdit, markerDirection, markerRanges, pinEdit } from './markdown/block-direction.js';
import { activeHeading, sourceHeadingPositions } from './components/outline.js';
import { parseFrontMatter, frontMatterDirection } from './markdown/frontmatter.js';
import { dailyNoteName } from './dates.js';
import { highlightCode } from './markdown/highlight.js';
import { mathExtension, restoreMath, renderTex } from './markdown/math.js';
import { sanitizeHtml, sanitizeSvg } from './markdown/trusted.js';
import { renderMermaid } from './markdown/mermaid.js';
import { tableEdit } from './components/table-edit.js';
import { applyEdit, adoptDiskText, discardEdits } from './components/dirty-state.js';
import { wrapTablesInFrames } from './components/table-frame.js';
import { getFocusable, trapTab, rovingNext } from './components/focus.js';
import { t as tr, tPlural, localeDirection, formatMessage, isolateLatinVars } from './locale.js';
import { buildExportDocAsync as buildExportDocImpl, isLanguageTag } from './markdown/export.js';
// T6.1c: the EPUB path (renderer builds the whole archive; main only writes the bytes).
import { buildEpubFromNoteAsync } from './markdown/epub.js';
import { createCodeMirrorAdapter } from './editor/codemirror-adapter.js';
import { isWrappedInside, isWrappedOutside } from './editor/wrap-detect.js';
import { historyKeyOf } from './editor/history-store.js';
import { isDroppableFile, nextUntitledName } from './file-predicates.js';
import { buildFileTree, flattenTree, buildForest, prefixTreePaths, treeFileCounts } from './components/tree.js';
import { fileKey } from './session.js';
// T4.1: reading-position shelf (capture/restore lives below, next to previewScroller()).
import { scrollRatio, progressEntryFor, upsertProgress, relativeTime } from './reading-progress.js';
// T5.1c: reading-view highlights + margin notes (re-anchoring lives in markdown/annotations.js).
import { applyHighlights, findSingleTextNodeSelection, newHighlightId, noteExcerpt } from './markdown/annotations.js';
import { extractTagsFromFiles } from './components/tags.js';
import { createWorkspaceController } from './components/workspace-controller.js';
import {
  TIER, applyLimits, getLimits, noteTier, megabytes, limitMb, inLargeMode, skipsEditPreview, needsRenderPrompt,
  isLargeExport, exportFailureKind, renderSlice, RENDER_ANYWAY_CHARS, MIB, applyNoteSize, mirrorSignature, serialQueue,
} from './components/large-file.js';
import { createSettingsController } from './components/settings-controller.js';
import { fileDirKind, crumbSegments, fileMeta, shelfRatio, outlineNumbers, bodyWordCount, readMinutes } from './components/doc-meta.js';
import { inspectorData, renderInspectorDoc, renderInspectorProgress, renderZoom } from './components/inspector-ui.js';
import { createMarginNotes, placeMarginHost, pickMarginMode } from './components/margin-notes.js';
import { streakGrid } from './components/streak-grid.js';
import { ctxIconName, ctxHeader, ctxRows, buildCtxHeader, buildCtxRow, surfaceActions } from './components/context-menu-items.js';
import { svgIcon, hydrateIcons } from './icons.js';
import { shortcutLetter, hitKey, hitCode } from './shortcut-keys.js';

// QA-L2: about 110 functions and the app state used to sit on `window` for the test suites,
// where any script running in the page could call them. They are exposed only to a test run:
// the browser lane loads the page from file://, the Electron lane adds ?bpmdTest=1 (added by
// window-controller for a development build under BPMD_TEST=1, never for a packaged one).
const testHooks = (location.protocol === 'file:' || new URLSearchParams(location.search).has('bpmdTest')) ? window : {};

// APP-12: the gates that pause autosave, the close flow and the recovery prompt are module
// state. Only a test run sees them, as testHooks._saveDialogOpen and so on.
const gates = { saveDialogOpen: false, closeFlowActive: false, recoveryPromptOpen: false, recoveryDismissed: false };
Object.defineProperties(testHooks, {
  _saveDialogOpen: { configurable: true, get: () => gates.saveDialogOpen, set: (v) => { gates.saveDialogOpen = v; } },
  _closeFlowActive: { configurable: true, get: () => gates.closeFlowActive, set: (v) => { gates.closeFlowActive = v; } },
  _recoveryPromptOpen: { configurable: true, get: () => gates.recoveryPromptOpen, set: (v) => { gates.recoveryPromptOpen = v; } },
  _recoveryDismissed: { configurable: true, get: () => gates.recoveryDismissed, set: (v) => { gates.recoveryDismissed = v; } },
});

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
  // Margin notes folded to gutter markers (persisted via PERSISTED_KEYS).
  marginNotesCollapsed: false,
  // v1.2: Word-style auto-save (files opened from disk; untitled notes still need Save
  // As because their location is unknown). Persisted via PERSISTED_KEYS.
  autosave: true,
  // v5 (T0.1). readingProgress (per-file scroll shelf), themeFollowSystem (first-run system
  // scheme follow), updateCheck ('manual' = no network at all), readingGoalMin (0 = off).
  readingProgress: [],
  themeFollowSystem: true,
  updateCheck: 'manual',
  readingGoalMin: 10,
  // T8.1: { today, date, streak, days } from main, or null when there is no bridge yet.
  readingStats: null,
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
testHooks._appState = State;
testHooks._appSubscribe = subscribe;

// Created after the renderer actions it injects have been declared. Toasts consult
// the controller during restore so applying persisted values stays quiet.
let settingsController = null;

// =====================================================================
// CONSTANTS & DOM REFS
// =====================================================================
const $ = id => document.getElementById(id);
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
const noteList = $('noteList'); // T5.1c: the Inspector "Notes" list (present in index.html)
const editorArea = $('editorArea');
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
// QA-M16: the note body as sanitized nodes, appended to the page as they are. Assigning the
// HTML string instead made the page parse it again and the Trusted Types default policy
// sanitize it a second time. The string fallbacks (no marked / DOMPurify) still go through it.
function noteBodyNodes(md) {
  hideDirBadge(); // the blocks it pointed at are about to be replaced
  const out = _parseMarkdown(md, { marked, DOMPurify, escapeHtml, fragment: true, sourceLines: true });
  if (typeof out !== 'string') return out;
  const holder = document.createElement('div');
  holder.innerHTML = out;
  const frag = document.createDocumentFragment();
  while (holder.firstChild) frag.appendChild(holder.firstChild);
  return frag;
}
// audit M4: the render ran out of its time budget and part of the note is shown as literal
// text. Said once per note, right after the parse it refers to; not on every keystroke.
function noteRenderLimit(file) {
  if (!file || !lastRenderLimited() || file._renderLimitTold) return;
  file._renderLimitTold = true;
  showToast(tl('toast.renderLimited'), 'info');
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
    if (!rel) return;
    img.setAttribute('src', 'bpmd://vault/' + encodeURIComponent(file.vaultId) + '/' + rel.split('/').map(enc).join('/'));
    // audit UX-12: a vault image whose file is gone used to leave the browser's broken-image
    // glyph and no explanation. Swap it for a named placeholder (the relative path is what
    // the author wrote, so that is what we name).
    img.dataset.relPath = rel;
    img.addEventListener('error', () => {
      const placeholder = document.createElement('div');
      placeholder.className = 'img-missing';
      placeholder.setAttribute('role', 'img');
      placeholder.textContent = tl('img.missing', { name: img.dataset.relPath || rel });
      img.replaceWith(placeholder);
    }, { once: true });
  });
}

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
    content: resolveBlockDirection(proseText(body), 'ltr'), // prose only (no code/math, audit H8); dominant-script: an Arabic-majority note reads RTL even if it opens with English
  });
  applyBidi(noteContent, { baseDir: docDir, escape: escapeHtml, forceDir: forcedDir });
  // QA-M22: the note no longer inherits the interface's language (an English note in the
  // Arabic UI was announced with an Arabic voice). Its blocks carry the front matter's
  // `lang:`, or lang="" ("unknown") so a screen reader uses its own default; a guess would
  // mislabel half of a mixed Arabic/English note (EC-C6). Set on the blocks, not on
  // #noteContent, whose aria-label is in the interface language.
  const noteLang = isLanguageTag(data && data.lang) ? data.lang : '';
  for (const block of noteContent.children) block.setAttribute('lang', noteLang);
  if (cmAdapter) cmAdapter.setDirection(docDir, forcedDir); // keep the CM6 editor in sync (also closes the front-matter gap)
  wrapTablesInFrames(noteContent, { locale: State.uiLocale });
  wireTableNav(noteContent); // T-R9: logical (EC-C2) arrow-key cell traversal in rendered tables
  // An explicit choice (toggle or front matter) flips the whole note's container direction;
  // otherwise the container stays neutral and each block resolves its own (R1/R2).
  const editorEl = $('editor');
  if (editorEl) {
    // The container carries `dir` for forced RTL and for a front-matter direction (unless the
    // toggle forces LTR, the default). Otherwise it stays neutral and each block resolves its
    // own, but the document's OVERALL direction still follows its dominant script (RTL-M2):
    // the indicator must show RTL for an Arabic-majority note, and the CM6 widgets inherit
    // State.direction as their baseDir.
    if (State.forcedDir === 'rtl' || (State.forcedDir !== 'ltr' && fmDir)) editorEl.setAttribute('dir', docDir);
    else editorEl.removeAttribute('dir');
    if (State.direction !== docDir) State.direction = docDir;
    updateDirUI();
  }
}

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
  } else if (typeof el.querySelector === 'function' && el.querySelector('pre > code:not(.language-mermaid)')) {
    // audit PERF-07: hljs loads lazily — render plain now, re-decorate this element when
    // the engine arrives (idempotent: highlightCode skips .hljs blocks, restoreMath's
    // placeholders are already consumed).
    loadHighlightJs().then(() => decorateBlockContent(el)).catch(() => { /* plain-text fallback */ });
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
        errorText: tl('mermaid.failed'),
      }))
      .catch(() => { /* engine failed to load — code-block fallback remains */ });
  }
  scheduleCodeTrack(); // floating copy button follows the visible code block (reading view)
}

// Lazy-load the vendored Mermaid engine once (5 MB — never on the critical path).
// securityLevel:'strict' + htmlLabels:false → SVG-native text (no <foreignObject>),
// so the SVG profile sanitizer keeps the labels. Layout, theme and look are named so a
// Mermaid upgrade cannot change how an existing diagram is drawn (D11).
let _mmdSeq = 0;
let _mermaidPromise = null;
function loadMermaid() {
  if (_mermaidPromise) return _mermaidPromise;
  _mermaidPromise = new Promise((resolve, reject) => {
    const init = (ns) => {
      const m = (ns && (ns.default || ns));
      if (!m || typeof m.render !== 'function') return reject(new Error('mermaid unavailable'));
      m.initialize({
        startOnLoad: false, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false },
        layout: 'dagre', theme: 'default', look: 'classic',
      });
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
testHooks.loadMermaid = loadMermaid;

// Lazy-load the vendored highlight.js (1.08 MB = 76% of the old blocking payload — audit
// PERF-07). Only notes that actually contain a fenced block pay for it; a transient
// failure falls back to plain code (decorateBlockContent's guard) and retries next render.
let _hljsPromise = null;
function loadHighlightJs() {
  if (typeof hljs !== 'undefined') return Promise.resolve(hljs);
  if (_hljsPromise) return _hljsPromise;
  _hljsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '../../resources/vendor/highlight/highlight.min.js';
    s.onload = () => (window.hljs && typeof window.hljs.highlight === 'function'
      ? resolve(window.hljs)
      : reject(new Error('hljs unavailable')));
    s.onerror = () => { s.remove(); reject(new Error('hljs script failed to load')); };
    document.head.appendChild(s);
  });
  _hljsPromise.catch(() => { _hljsPromise = null; });
  return _hljsPromise;
}

testHooks.isArabicHeavy = isArabicHeavy;

// =====================================================================
// TOAST
// =====================================================================
const TOAST_MS = 2200;
const TOAST_WITH_ACTION_MS = 6000;
function hideToast() {
  clearTimeout(toastEl._t);
  toastEl.classList.remove('show', 'has-action');
  toastEl.querySelector('.toast-action')?.remove(); // no focusable control in a hidden toast
}
/**
 * Show a short message. `action` ({ label, onClick }) adds one button to it, for a step
 * the user can take back; such a toast stays longer and takes pointer input.
 */
function showToast(msg, kind, action, { sticky = false, ms = 0 } = {}) {
  if (settingsController?.isRestoring()) return;
  toastEl.textContent = msg;
  toastEl.classList.remove('error', 'info', 'has-action');
  if (kind === 'error') toastEl.classList.add('error');
  else if (kind === 'info') toastEl.classList.add('info');
  const hide = hideToast;
  const hasAction = !!action && typeof action.label === 'string' && typeof action.onClick === 'function';
  if (hasAction) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      clearTimeout(toastEl._t);
      hide();
      action.onClick();
    });
    toastEl.appendChild(button);
    toastEl.classList.add('has-action');
  }
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  // `sticky`: a busy message that stays until the work ends (the next toast or hideToast).
  // `ms`: a notice that needs longer than a confirmation to be read.
  if (!sticky) toastEl._t = setTimeout(hide, ms || (hasAction ? TOAST_WITH_ACTION_MS : TOAST_MS));
}
testHooks.showToast = showToast;
testHooks.hideToast = hideToast;

// =====================================================================
// THEME
// =====================================================================
// audit M21: the status bar, the theme toast and the Inspector showed the internal ids
// ("paper", "Live") in the Arabic interface. These read the name from the catalog.
function catalogName(prefix, id) {
  const key = prefix + id;
  const name = tl(key);
  return !name || name === key ? String(id) : name;
}
const themeName = (id) => catalogName('theme.', id);
const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);
function setThemeLabel(id) {
  if ($('themeLabel')) $('themeLabel').textContent = themeName(id);
}
// The labels above have no data-i18n hook (their text depends on state), so a change of
// the interface language writes them again.
function localizeStateLabels() {
  setThemeLabel(State.theme);
  setVaultUi();
  // A11y: name the two menu containers for screen readers.
  ctxMenu.setAttribute('aria-label', tl('ctxmenu.label'));
  dropdown.setAttribute('aria-label', tl('dropdown.label'));
}
// The kind of a palette command ("command", "view", "help"); a file shows its path instead.
const paletteMeta = (it) => (it.act && it.key && it.meta ? catalogName('palette.meta.', it.meta) : (it.meta || ''));

// Show `theme`: the root attribute, the theme button, its icon and its label.
function applyThemeToDom(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  $('themeBtn')?.classList.toggle('active', theme !== 'paper');
  updateThemeIcon(theme);
  setThemeLabel(theme);
}

// The user picked `theme`: apply it, mirror it for the pre-paint boot, and say so.
function chooseTheme(theme) {
  State.theme = theme;
  // T2.1: an explicit choice ends the system-follow, so the OS scheme cannot fight the
  // user's theme on the next launch.
  State.themeFollowSystem = false;
  applyThemeToDom(theme);
  try { localStorage.setItem('bpmdrtlreader-theme', theme); } catch (_) { /* storage off */ }
}

function cycleTheme() {
  const next = getNextTheme(State.theme);
  chooseTheme(next);
  showToast(tl('toast.theme', { name: capitalised(themeName(next)) }), 'info');
}
testHooks.cycleTheme = cycleTheme;

function setTheme(t) {
  chooseTheme(t);
  closeMenu();
  showToast(tl('toast.theme', { name: capitalised(themeName(t)) }), 'info');
}

// =====================================================================
// RTL
// =====================================================================
function toggleRTL() {
  // Cycle the EXPLICIT content-direction choice: AUTO → RTL → LTR → AUTO.
  // AUTO = smart per-block detection (default). RTL/LTR force EVERY block of the note.
  applyForcedDir(State.forcedDir === null ? 'rtl' : State.forcedDir === 'rtl' ? 'ltr' : null);
}
testHooks.toggleRTL = toggleRTL;

function applyForcedDir(next) {
  State.forcedDir = next;
  appBody._manualRTL = State.forcedDir === 'rtl'; // back-compat mirror for existing RTL tests/export
  const editorEl = $('editor');
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
  syncMarginNotes(); // the notes column mirrors with the reading column's direction
  updateDirUI();
  showToast(tl('toast.direction', { dir: State.forcedDir ? State.forcedDir.toUpperCase() : tl('dir.auto') }));
}

function updateDirUI() {
  // The indicator + the lit state reflect the EFFECTIVE direction (forced choice, else the
  // auto/front-matter-resolved one) so a front-matter `direction: rtl` also lights the button.
  const isRTL = (State.forcedDir || State.direction) === 'rtl';
  $('dirIndicator').textContent = isRTL ? 'RTL' : 'LTR';
  $('dirIndicator').dataset.d = isRTL ? 'rtl' : 'ltr';
  $('propDir').textContent = isRTL ? 'RTL' : 'LTR';
  const btn = $('rtlBtn');
  if (btn) {
    btn.dataset.mode = State.forcedDir || 'auto';
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
testHooks.applyPanelLayout = applyPanelLayout;

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
  const bar = document.querySelector('.titlebar');
  if (!chromeRevealThreshold && bar) {
    const appEl = $('app');
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
testHooks.applyChromeLayout = applyChromeLayout;

function setAutoHideTitlebar(on) {
  State.autoHideTitlebar = !!on;
  applyChromeLayout();
  if (!settingsController?.isRestoring()) {
    showToast(on ? tl('toast.topbarHidden') : tl('toast.topbarShown'), 'info');
  }
}
function toggleAutoHideTitlebar() { setAutoHideTitlebar(!State.autoHideTitlebar); }
testHooks.toggleAutoHideTitlebar = toggleAutoHideTitlebar;

function setHideStatusBar(on) {
  State.hideStatusBar = !!on;
  applyChromeLayout();
  if (!settingsController?.isRestoring()) {
    showToast(on ? tl('toast.statusbarHidden') : tl('toast.statusbarShown'), 'info');
  }
}
function toggleHideStatusBar() { setHideStatusBar(!State.hideStatusBar); }
testHooks.toggleHideStatusBar = toggleHideStatusBar;

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
testHooks.syncWindowTitle = syncWindowTitle;

function setWindowTitleMode(mode) {
  if (mode !== 'app' && mode !== 'file') return;
  State.windowTitleMode = mode; // persisted via the PERSISTED_KEYS subscribe hook
  syncWindowTitle();
}

function toggleSidebar() {
  State.sidebarVisible = !State.sidebarVisible;
  applyPanelLayout();
  showToast(tl('toast.sidebar', { state: State.sidebarVisible ? tl('toast.shown') : tl('toast.hidden') }), 'info');
}

function toggleInspector() {
  State.inspectorVisible = !State.inspectorVisible;
  applyPanelLayout();
  closeMenu();
  showToast(tl('toast.inspector', { state: State.inspectorVisible ? tl('toast.shown') : tl('toast.hidden') }), 'info');
}
testHooks.toggleInspector = toggleInspector;

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
  const isFull = _nativeFullscreen || !!document.fullscreenElement;
  const key = isFull ? 'titlebar.exitFullscreen' : 'titlebar.fullscreen';
  const enText = tr(key, 'en');
  btn.setAttribute('aria-pressed', String(isFull));
  btn.querySelector('use')?.setAttribute('href', isFull ? '#ic-shrink' : '#ic-expand');
  btn.dataset.i18nTip = key;
  btn.dataset.i18nAriaLabel = key;
  btn.dataset.i18nTipOrig = enText;
  btn.dataset.i18nAriaLabelOrig = enText;
  const label = tr(key, State.uiLocale || 'en');
  btn.setAttribute('data-tip', label);
  btn.setAttribute('aria-label', label);
}
// v1.2: fullscreen moves from the DOM Fullscreen API to the real OS window in Electron
// (win.setFullScreen) — F11 and the titlebar toggle now behave like every desktop app:
// the taskbar entry follows, Alt+Tab shows it maximized, and Escape is handled by the
// platform. The DOM path stays as the browser/dev-lane fallback.
let _nativeFullscreen = false;
function toggleFullscreen() {
  if (window.electronAPI && typeof window.electronAPI.setFullscreen === 'function') {
    window.electronAPI.setFullscreen(!_nativeFullscreen);
    return;
  }
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    $('app')?.requestFullscreen();
  }
}
document.addEventListener('fullscreenchange', updateFullscreenUi);
if (window.electronAPI && typeof window.electronAPI.onFullscreenChanged === 'function') {
  window.electronAPI.onFullscreenChanged((flag) => {
    _nativeFullscreen = !!flag;
    updateFullscreenUi();
  });
}

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

const pendingModalSettlers = new Set();
function openModal(title, html, variant) {
  if (dropdown.classList.contains('open')) closeMenu(); // dismiss any open menu (returns focus to its button → captured as the restore target)
  // A body swap while the overlay is already open destroys the previous dialog's
  // buttons while its promise is still pending — settle it now with its abandoned
  // value instead of letting it hang and resolve late, mislabeling a live outcome.
  if (modalOverlay.classList.contains('open')) {
    for (const abandon of [...pendingModalSettlers]) abandon();
    pendingModalSettlers.clear();
  }
  if (variant) modalOverlay.dataset.variant = variant; else delete modalOverlay.dataset.variant;
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

// =====================================================================
// LOCALIZED MESSAGE HELPER (v1.2)
// =====================================================================
// Catalog lookup + {var} substitution in one call, so call sites read
// tl('toast.saved', { name }) instead of concatenating English fragments.
// Falls back to the key itself when the catalog is missing an entry, never throws.
function tl(key, vars) {
  // A counted sentence (vars.n is a number) takes the plural form of the language (audit M20).
  const template = tPlural(key, vars ? vars.n : undefined, State.uiLocale);
  return formatMessage(template, localeDirection(State.uiLocale) === 'rtl' ? isolateLatinVars(vars) : vars);
}

// =====================================================================
// WORD-STYLE SAVE DIALOG (v1.2) — Save / Don't Save / Cancel
// =====================================================================
// Replaces the native confirm() that used to guard every destructive path. The old
// prompt was English-only, unstyleable, and offered just two choices — discard or
// cancel — so the DEFAULT button was the one that lost the user's data. This themed
// three-way dialog joins the app's focus trap and locale catalog, and its Save
// choice actually saves (with Save As for untitled notes) before the destructive
// action proceeds. Escape / click-away resolve as 'cancel'.
// DOMPurify strips <use> from sanitized innerHTML (safe default), so the dialog
// badge icon is mounted through the DOM API after openModal() instead.
function setBadgeIcon(badgeId) {
  const badge = $(badgeId);
  if (!badge || badge.querySelector('svg')) return;
  badge.appendChild(svgIcon('file'));
}

// v1.3.0 (DATA-03): the autosave gate is a COUNT, not a boolean. openModal settles a
// superseded dialog synchronously, and that settle used to write `false` over the
// `true` the incoming Save dialog had just armed — leaving autosave free to write
// behind a pending Don't-Save. A dialog now releases only its own interest; the gate
// clears when the LAST live Save dialog settles.
let _saveDialogCount = 0;
function saveDialogOpened() {
  _saveDialogCount += 1;
  gates.saveDialogOpen = true;
}
function saveDialogClosed() {
  _saveDialogCount = Math.max(0, _saveDialogCount - 1);
  gates.saveDialogOpen = _saveDialogCount > 0;
}

/**
 * One answer from the modal. A button settles it with its value (a function is called at
 * click time); Escape, the backdrop or ✕ close the modal without a button, and that settles
 * it as `abandon`. QA-M16: a second settle is a no-op and no settler outlives the dialog, so
 * a later supersede cannot close an unrelated dialog.
 */
function askModal(title, html, { buttons, abandon, focus, badge, onSettle } = {}) {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!modalOverlay.classList.contains('open')) { observer.disconnect(); abandoned(); }
    });
    observer.observe(modalOverlay, { attributes: true, attributeFilter: ['class'] });
    openModal(title, html);
    if (badge) setBadgeIcon(badge);
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (onSettle) onSettle();
      observer.disconnect();
      pendingModalSettlers.delete(abandoned);
      closeModal();
      resolve(value);
    };
    const abandoned = () => settle(abandon);
    pendingModalSettlers.add(abandoned);
    for (const [id, value] of Object.entries(buttons || {})) {
      $(id)?.addEventListener('click', () => settle(typeof value === 'function' ? value() : value));
    }
    // The chosen control owns initial focus: openModal's own focus lands on ✕, this later
    // 0 ms timer wins.
    if (focus) setTimeout(() => $(focus)?.focus(), 0);
  });
}

function askSaveChanges({ name, count = 0 } = {}) {
  // Autosave must not write behind a Save/Don't-Save answer — a trailing tick landing
  // after "Don't Save" would persist exactly what the user declined to keep.
  saveDialogOpened();
  const many = count > 1;
  // Centered-icon design (v1.2, user-picked): the file name is bolded inline, so the
  // sentence is assembled from prefix + bold name + postfix instead of one template.
  const msgHtml = many
    ? escapeHtml(tl('dlg.saveMany', { n: count }))
    : `${escapeHtml(tl('dlg.saveOnePre'))}<bdi dir="ltr" class="doc-name">“${escapeHtml(name || '')}”</bdi>${escapeHtml(tl('dlg.saveOnePost'))}`;
  const saveLabel = many ? tl('dlg.saveAll') : tl('dlg.save');
  const dontLabel = many ? tl('dlg.closeWithoutSaving') : tl('dlg.dontSave');
  const html = `
    <div class="dlg-body">
      <div class="dlg-badge" id="dlgBadge"></div>
      <div class="dlg-title">${escapeHtml(tl('dlg.unsavedTitle'))}</div>
      <div class="dlg-msg">${msgHtml}</div>
      <div class="dlg-hint">${escapeHtml(tl('dlg.hint'))}</div>
    </div>
    <div class="dlg-actions">
      <button type="button" class="dlg-btn dlg-danger" id="dlgDontSaveBtn">${escapeHtml(dontLabel)}</button>
      <button type="button" class="dlg-btn" id="dlgCancelBtn">${escapeHtml(tl('dlg.cancel'))}</button>
      <button type="button" class="dlg-btn dlg-primary" id="dlgSaveBtn">${escapeHtml(saveLabel)}</button>
    </div>`;
  // Word convention: the affirmative choice owns initial focus.
  return askModal(tl('dlg.unsavedTitle'), html, {
    badge: 'dlgBadge',
    onSettle: saveDialogClosed,
    abandon: 'cancel',
    buttons: { dlgSaveBtn: 'save', dlgDontSaveBtn: 'discard', dlgCancelBtn: 'cancel' },
    focus: 'dlgSaveBtn',
  });
}

// Word behavior for the close flow: 'save' saves everything — untitled notes included,
// each through its Save As dialog (a canceled Save As aborts the close) — 'discard'
// proceeds, 'cancel' stays open.
async function resolveCloseChoice(choice, files = null) {
  if (choice === 'cancel') return false;
  if (choice === 'save') return workspaceController.saveAllDirty({ promptUntitled: true, files });
  return true;
}
testHooks._askSaveChanges = askSaveChanges; // e2e hook
testHooks._askNoteText = (excerpt) => askNoteText(excerpt); // e2e hook (QA-M16)
testHooks._pendingModalSettlers = () => pendingModalSettlers.size; // e2e hook (QA-M16)

// v1.3.0: the encoding-upgrade dialog (Sublime/Visual-Studio pattern). A legacy
// Windows-1256 file whose note now holds a character the code page cannot carry offers
// to upgrade THAT file to UTF-8 and complete the save; Cancel keeps the note dirty.
function askEncodingUpgrade({ name, encoding, count, samples }) {
  const html = `
    <div class="dlg-body">
      <div class="dlg-badge" id="encBadge"></div>
      <div class="dlg-title">${escapeHtml(tl('dlg.encodingTitle'))}</div>
      <div class="dlg-msg" dir="auto">${escapeHtml(tl('dlg.encodingBody', {
        name: name || '',
        encoding: encoding || '',
        n: count || 0,
        samples: (samples || []).join(' '),
      }))}</div>
      <div class="dlg-hint">${escapeHtml(tl('dlg.hint'))}</div>
    </div>
    <div class="dlg-actions">
      <button type="button" class="dlg-btn" id="encCancelBtn">${escapeHtml(tl('dlg.cancel'))}</button>
      <button type="button" class="dlg-btn dlg-primary" id="encUpgradeBtn">${escapeHtml(tl('dlg.encodingUpgrade'))}</button>
    </div>`;
  return askModal(tl('dlg.encodingTitle'), html, {
    badge: 'encBadge',
    abandon: false,
    buttons: { encUpgradeBtn: true, encCancelBtn: false },
    focus: 'encUpgradeBtn',
  });
}

/** audit M7: reopening with another encoding reads the disk again; unsaved edits go. */
function askReopenDiscard(name) {
  const html = `
    <div class="dlg-body">
      <div class="dlg-title">${escapeHtml(tl('dlg.reopenTitle'))}</div>
      <div class="dlg-msg" dir="auto">${escapeHtml(tl('dlg.reopenBody', { name: name || '' }))}</div>
    </div>
    <div class="dlg-actions">
      <button type="button" class="dlg-btn" id="reopenCancelBtn">${escapeHtml(tl('dlg.cancel'))}</button>
      <button type="button" class="dlg-btn dlg-primary" id="reopenConfirmBtn">${escapeHtml(tl('dlg.reopenConfirm'))}</button>
    </div>`;
  return askModal(tl('dlg.reopenTitle'), html, {
    abandon: false,
    buttons: { reopenConfirmBtn: true, reopenCancelBtn: false },
    focus: 'reopenCancelBtn',
  });
}

/** Large-file mode: "this note is N MB — open it in large-file mode?" Resolves true to open. */
// Two notes asked about at once (several files dropped, a launch argument and a drop) must be
// asked one after the other: a second dialog replaces the first one's controls, and the first
// answer would never come.
const largeOpenQueue = serialQueue();
function askLargeOpen(info) { return largeOpenQueue(() => askLargeOpenNow(info)); }
function askLargeOpenNow({ name, size }) {
  const html = `
    <div class="dlg-body">
      <div class="dlg-title">${escapeHtml(tl('dlg.largeOpenTitle'))}</div>
      <div class="dlg-msg" dir="auto"><bdi dir="ltr" class="doc-name">“${escapeHtml(name || '')}”</bdi></div>
      <div class="dlg-msg" dir="auto">${escapeHtml(tl('dlg.largeOpenBody', { mb: megabytes(size) }))}</div>
    </div>
    <div class="dlg-actions">
      <button type="button" class="dlg-btn" id="largeOpenCancelBtn">${escapeHtml(tl('dlg.cancel'))}</button>
      <button type="button" class="dlg-btn dlg-primary" id="largeOpenConfirmBtn">${escapeHtml(tl('dlg.largeOpenConfirm'))}</button>
    </div>`;
  return askModal(tl('dlg.largeOpenTitle'), html, {
    abandon: false,
    buttons: { largeOpenConfirmBtn: true, largeOpenCancelBtn: false },
    focus: 'largeOpenConfirmBtn',
  });
}
testHooks.askLargeOpen = askLargeOpen;
testHooks.applyLimits = applyLimits; // e2e: lower the size tiers so a small note exercises large-file mode

function showShortcuts() {
  closeMenu();
  // v1.2: the sheet reads its labels from the shared catalog (menu.*/palette.*) instead
  // of a fifth hand-maintained English copy — it now follows the Arabic UI too.
  const groups = [
    ['menu.file', [
      ['menu.openFolder','Ctrl+Shift+O'],
      ['menu.openFile','Ctrl+O'],
      ['menu.newNote','Ctrl+N'],
      ['menu.newDaily','Ctrl+Shift+N'],
      ['menu.save','Ctrl+S'],
      ['menu.saveAs','Ctrl+Shift+S'],
      ['menu.closeTab','Ctrl+W']
    ]],
    ['menu.edit', [
      ['menu.undo','Ctrl+Z'],
      ['menu.redo','Ctrl+Y Ctrl+Shift+Z'],
      ['menu.cut','Ctrl+X'],
      ['menu.copy','Ctrl+C'],
      ['menu.paste','Ctrl+V'],
      ['menu.selectAll','Ctrl+A'],
      ['menu.find','Ctrl+F'],
      ['menu.bold','Ctrl+B'],
      ['menu.italic','Ctrl+I'],
      ['tb.heading','Ctrl+1–6'],
      ['menu.insertLink','Ctrl+L']
    ]],
    ['menu.view', [
      ['palette.toggleReading','Ctrl+E'],
      ['palette.toggleSidebar','Ctrl+\\'],
      ['titlebar.toggleInspector','Ctrl+Shift+I'],
      ['sc.cycleTheme','Ctrl+Shift+D'],
      ['menu.flipDirection','Ctrl+Shift+L'],
      ['palette.flipBlock','Ctrl+D'],
      ['menu.zoomIn','Ctrl+='],
      ['menu.zoomOut','Ctrl+-'],
      ['menu.resetZoom','Ctrl+0'],
      ['titlebar.fullscreen','F11'],
      ['menu.commandPalette','Ctrl+K'],
      [toggleMenuKey('autoHideTitlebar'), CHROME_TOGGLES.autoHideTitlebar.menuShortcut],
      [toggleMenuKey('hideStatusBar'), CHROME_TOGGLES.hideStatusBar.menuShortcut],
      ['menu.settings','Ctrl+,']
    ]],
    ['menu.help', [['menu.shortcuts','Ctrl+/']]]
  ];
  const loc = State.uiLocale;
  const label = (k) => escapeHtml(tr(k, loc)); // tr falls back to English, then to the key
  let html = '';
  groups.forEach(([headingKey, rows]) => {
    html += `<h3>${label(headingKey)}</h3>`;
    rows.forEach(([n, k]) => {
      const keys = k.split(' ').map(chord => chord.split('+').map(p => `<span class="kbd">${escapeHtml(p)}</span>`).join('')).join(' ');
      html += `<div class="shortcut-row"><span class="shortcut-name">${label(n)}</span><span class="shortcut-keys">${keys}</span></div>`;
    });
  });
  openModal(tr('menu.shortcuts', loc), html, 'wide');
}

let _aboutVersion = null;
async function resolveAppVersion() {
  if (_aboutVersion) return _aboutVersion;
  try { _aboutVersion = await window.electronAPI?.getAppVersion?.() || null; } catch (_) { _aboutVersion = null; }
  return _aboutVersion;
}

async function showAbout() {
  closeMenu();
  await resolveAppVersion();
  const html = `
    <div class="about-logo">BP</div>
    <div class="about-name">BP MD RTL Reader</div>
    <div class="about-version">${escapeHtml(tl('about.version', { version: _aboutVersion || '2.1.0' }))} · ${new Date().getFullYear()}</div>
    <p class="about-tagline">${escapeHtml(tl('about.tagline'))}</p>
    <p style="text-align: center; color: var(--ink-soft); font-size: 13px; line-height: 1.6;">
      ${escapeHtml(tl('about.bilingual'))}<br>
      ${escapeHtml(tl('about.plainFiles'))}
    </p>
    <p style="text-align: center; color: var(--ink-soft); font-size: 12px; margin-top: 16px;">
      <strong>Binary Parse</strong> &middot; ${escapeHtml(tl('about.license'))}
    </p>
  `;
  openModal(tl('menu.about'), html); // QA-L2: the About dialog was English in the Arabic interface
}

// T-Q6: opt-in update CHECK (user-initiated only; never auto-checks/downloads). Asks the
// main process to compare the running version against the public releases manifest, and
// reports the result via a toast. Degrades gracefully outside the desktop app.
async function checkForUpdate() {
  if (!window.electronAPI || typeof window.electronAPI.checkForUpdate !== 'function') {
    showToast(tl('toast.updateNeedsDesktop'), 'error'); return;
  }
  showToast(tl('toast.checkingUpdates'), 'info');
  let res;
  try { res = await window.electronAPI.checkForUpdate(); } catch (_) { res = { error: 'ipc' }; }
  if (res && res.updateAvailable) showToast(tl('toast.updateAvailable', { latest: res.latest, current: res.current }));
  else if (res && res.latest) showToast(tl('toast.upToDate', { current: res.current }), 'info');
  // audit M37: a failed check leaves the user a way forward, the releases page.
  else showUpdateFailure(res && res.error === 'untrusted' ? 'untrusted' : 'failed');
  return res;
}
testHooks.checkForUpdate = checkForUpdate;

// ── T7.1: the opt-in update notice ───────────────────────────────────────────────────
// Main sends `update:available` when the daily auto check (or the settings switch) finds a
// newer release. #toast is text-only, so the notice is its own small card with the two
// actions the plan asks for: open the release page — a fixed URL that lives in MAIN, reached
// through a channel that takes no argument — or dismiss it.
let _updateBar = null;

function showUpdateNotice(info) {
  const latest = info && typeof info.latest === 'string' ? info.latest : '';
  if (!latest) return null;
  return showUpdateBar(tl('update.available', { latest }), tl('update.view'));
}

// audit M37: the check could not be made. 'untrusted' = the certificate matched no pin of
// this version (no later check will work either); anything else = offline or a server error.
// Both offer the one thing that still works: the fixed releases page, opened by main.
function showUpdateFailure(kind) {
  return showUpdateBar(tl(kind === 'untrusted' ? 'update.untrusted' : 'update.checkFailed'), tl('update.openReleases'));
}

function showUpdateBar(message, actionLabel) {
  if (!_updateBar) {
    _updateBar = document.createElement('div');
    _updateBar.id = 'updateBar';
    _updateBar.className = 'update-bar';
    _updateBar.setAttribute('role', 'status');
    _updateBar.setAttribute('dir', 'auto');
    const text = document.createElement('span');
    text.className = 'ub-text';
    const view = document.createElement('button');
    view.type = 'button';
    view.id = 'updateViewBtn';
    view.className = 'ub-btn ub-primary';
    view.addEventListener('click', () => {
      window.electronAPI?.openReleasePage?.();
      hideUpdateNotice();
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.id = 'updateDismissBtn';
    dismiss.className = 'ub-btn';
    dismiss.addEventListener('click', hideUpdateNotice);
    _updateBar.append(text, view, dismiss);
    document.body.appendChild(_updateBar);
  }
  _updateBar.querySelector('.ub-text').textContent = message;
  $('updateViewBtn').textContent = actionLabel;
  $('updateDismissBtn').textContent = tl('update.dismiss');
  _updateBar.hidden = false;
  return _updateBar;
}

function hideUpdateNotice() {
  if (_updateBar) _updateBar.hidden = true;
}
testHooks.showUpdateNotice = showUpdateNotice;

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
testHooks.CHROME_TOGGLES = CHROME_TOGGLES;

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
      { kind: 'item', icon: 'book', name: 'Export EPUB…', key: 'menu.exportEpub', action: () => exportEpub() },
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
      { kind: 'check', name: 'Oasis (warm dark)', key: 'menu.themeOasis', checked: () => State.theme === 'oasis', action: () => setTheme('oasis') },
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
      { kind: 'item', icon: 'gear', name: 'Settings…', key: 'menu.settings', shortcut: 'Ctrl+,', action: () => { closeMenu(); showSettings(); } },
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
        <span class="dd-icon">${it.icon ? `<span data-ic="${escapeHtml(it.icon)}"></span>` : ''}</span>
        <span class="dd-name">${escapeHtml(label(it))}</span>
        ${it.shortcut ? `<span class="dd-shortcut">${escapeHtml(it.shortcut)}</span>` : ''}
      </div>`;
    }
  });
  dropdown.innerHTML = html;
  hydrateIcons(dropdown);
  dropdown.setAttribute('role', 'menu');
  dropdown.querySelectorAll('.dd-item:not(.disabled)').forEach(el => {
    const i = parseInt(el.dataset.i);
    const activate = () => { try { def.items[i].action(); } catch(err) { console.error(err); } };
    // Don't let mousedown blur the editor before the action runs — Copy/Cut/Undo
    // need the editor to stay focused with its selection intact.
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
// audit UX-11: the counter is an aria-live (see index.html) region, so every update goes
// through the localized `{c}/{n}` format rather than a bare English-ish literal.
function setFindInfo(current, total) {
  $('findInfo').textContent = tl('find.count', { c: current, n: total });
}
function openFind() {
  const findBar = $('findBar');
  findBar.classList.add('open');
  setTimeout(() => $('findInput').focus(), 50);
}
/** Unwrap every reading-view match and forget both match lists. */
function clearFindMarks() {
  noteContent.querySelectorAll('mark.find-hit').forEach(m => {
    m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
  });
  noteContent.normalize();
  State.findHits = [];
  State.findSourceMatches = []; // APP-25: stale offsets must not survive a close
}
function closeFind() {
  const findBar = $('findBar');
  const hadFocus = findBar.contains(document.activeElement);
  findBar.classList.remove('open');
  if (cmAdapter) cmAdapter.setSearchHighlight(''); // F13: clear the .cm-searchMatch highlights
  clearFindMarks();
  setFindInfo(0, 0);
  // QA M15: the keyboard goes back to the note (the editor, at the last match) instead of
  // falling to <body>, where typing did nothing.
  if (hadFocus) {
    if (State.viewMode !== 'reading' && cmAdapter) cmAdapter.focus();
    else if (noteContent.offsetParent !== null) noteContent.focus();
  }
}
let _findFile = null; // the note the find bar last searched (QA M7)
function runFind(q) {
  _findFile = State.activeFile != null ? State.files[State.activeFile] : null;
  clearFindMarks();

  // Edit view: search the CM6 source (T-F13), since the markdown preview pane is hidden.
  // cmAdapter is null only while CM6 is still loading or failed to load; the rendered note
  // is searched then.
  if (State.viewMode !== 'reading' && cmAdapter) {
    // F13: highlight EVERY match in the CM6 editor (.cm-searchMatch), not just the selected
    // one. Cleared when the query is empty / on closeFind.
    cmAdapter.setSearchHighlight(q);
    if (!q) { setFindInfo(0, 0); return; }
    const matches = cmAdapter.find(q);
    State.findSourceMatches = matches;
    State.findIdx = 0;
    // QA H2: the keyboard stays in the find field. Focusing the editor here put the next
    // typed letter of the query over the selected match, and autosave wrote that to disk.
    if (matches.length) cmAdapter.setSelection(matches[0], { scroll: true });
    setFindInfo(matches.length ? 1 : 0, matches.length);
    return;
  }

  if (!q) { setFindInfo(0, 0); return; }
  const arabicFind = NEEDS_FOLD.test(q);
  const normQ = arabicFind ? normalizeArabic(q).toLowerCase() : null;
  const re = new RegExp(escapeReg(q), 'gi');
  const walker = document.createTreeWalker(noteContent, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let n; while ((n = walker.nextNode())) textNodes.push(n);
  textNodes.forEach(node => {
    const txt = node.nodeValue;
    const ranges = []; // [start,end) in ORIGINAL coordinates
    if (arabicFind) {
      const m = normalizeArabicWithMap(txt);
      const nl = m.norm.toLowerCase();
      let from = 0;
      while (normQ) {
        const idx = nl.indexOf(normQ, from);
        if (idx < 0) break;
        ranges.push([m.map[idx], mapEnd(txt, m, idx + normQ.length)]);
        from = idx + normQ.length;
      }
    } else {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(txt)) !== null) {
        ranges.push([m.index, m.index + m[0].length]);
        if (m.index === re.lastIndex) re.lastIndex++; // safety
      }
    }
    if (!ranges.length) return;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const [s, e] of ranges) {
      if (s > last) frag.appendChild(document.createTextNode(txt.slice(last, s)));
      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      mark.textContent = txt.slice(s, e);
      frag.appendChild(mark);
      State.findHits.push(mark);
      last = e;
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
      setFindInfo(idx + 1, State.findHits.length);
      // Bug 6 fix: scroll only within the preview-pane container so statusbar never shifts
      scrollMarkIntoPane(mark);
    });
  });
  if (State.findHits.length) {
    State.findHits[0].classList.add('current');
    scrollMarkIntoPane(State.findHits[0]);
  }
  setFindInfo(State.findHits.length ? 1 : 0, State.findHits.length);
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
  // Edit view: navigate the CM6 match positions.
  if (State.viewMode !== 'reading' && cmAdapter) {
    const matches = State.findSourceMatches || [];
    if (!matches.length) return;
    State.findIdx = (State.findIdx + d + matches.length) % matches.length;
    cmAdapter.setSelection(matches[State.findIdx], { scroll: true }); // T-F13; QA H2: no focus move
    setFindInfo(State.findIdx + 1, matches.length);
    return;
  }
  if (!State.findHits.length) return;
  State.findHits[State.findIdx].classList.remove('current');
  State.findIdx = (State.findIdx + d + State.findHits.length) % State.findHits.length;
  State.findHits[State.findIdx].classList.add('current');
  // Bug 6 fix: use contained scroll instead of scrollIntoView
  scrollMarkIntoPane(State.findHits[State.findIdx]);
  setFindInfo(State.findIdx + 1, State.findHits.length);
}

// =====================================================================
// EXPORT HTML
// =====================================================================
// Thin renderer wrapper around the extracted, import-testable export module (T-F12):
// injects the app's configured parseMarkdown + the manual-direction state + math globals.
// audit M34: the reader's own highlights and margin notes go into the file only when the
// caller says so. exportHTML and exportPDF ask first (askExportAnnotations).
function buildExportDoc(f, { includeAnnotations = false } = {}) {
  // T5.1c: the Notes appendix only belongs to the document the loaded annotations describe.
  const withNotes = includeAnnotations && ownAnnotationCount(f) > 0;
  return buildExportDocImpl(f, {
    ...exportRenderOptions(),
    annotations: withNotes ? _annotations : [],
    annotationsLabel: tl('panel.notes'),
  });
}

/** What the HTML and EPUB exports render with: the configured parser, the manual direction, the globals. */
function exportRenderOptions() {
  return {
    direction: State.forcedDir || 'auto',
    parseMarkdown,
    katex: (typeof katex !== 'undefined') ? katex : null,
    DOMPurify: (typeof DOMPurify !== 'undefined') ? DOMPurify : null,
    hljs: (typeof hljs !== 'undefined') ? hljs : null,
    sanitizeHighlight: (html) => sanitizeHtml(html, DOMPurify),
    loadMermaid,
  };
}

/** How many highlights and notes of the reader belong to this file (0 when another file's are loaded). */
function ownAnnotationCount(f) {
  return (f && _annotationsKey && _annotationsKey === fileKey(f)) ? _annotations.length : 0;
}

// audit M34: HTML and PDF export used to append the reader's highlights and margin notes
// without saying so, in a file that is made to be shared. The export now asks, and only when
// there is something to include. Resolves true (include), false (without) or null (cancel).
async function askExportAnnotations(f) {
  const count = ownAnnotationCount(f);
  if (count === 0) return false;
  const html = `
    <div class="dlg-body">
      <div class="dlg-title">${escapeHtml(tl('export.notesTitle'))}</div>
      <div class="dlg-msg">${escapeHtml(tl('export.notesBody', { n: count }))}</div>
      <div class="dlg-hint">${escapeHtml(tl('export.notesHint'))}</div>
    </div>
    <div class="dlg-actions">
      <button type="button" class="dlg-btn" id="exportWithNotesBtn">${escapeHtml(tl('export.withNotes'))}</button>
      <button type="button" class="dlg-btn dlg-primary" id="exportWithoutNotesBtn">${escapeHtml(tl('export.withoutNotes'))}</button>
    </div>`;
  return askModal(tl('export.notesTitle'), html, {
    abandon: null,
    buttons: { exportWithNotesBtn: true, exportWithoutNotesBtn: false },
    focus: 'exportWithoutNotesBtn',
  });
}

// A large note makes a slow export. Before the work starts the reader is told so, and the
// message stays up (sticky) while the note is built, handed to main and written; the result
// toast replaces it, and a cancelled save hides it. Returns true when the notice was shown.
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
async function noticeLargeExport(file) {
  const size = Math.max(Number(file.sizeBytes) || 0, (file.content || '').length);
  if (!isLargeExport(size)) return false;
  showToast(tl('toast.exportLarge'), 'info', undefined, { sticky: true });
  await nextPaint(); // let the message paint before the build blocks the page
  return true;
}
// Why an export failed, in words: too large (with the limit), timed out (PDF only), or failed.
function exportFailureMessage(format, res) {
  const kind = exportFailureKind(res);
  const limits = getLimits();
  if (format === 'pdf') {
    if (kind === 'too-large') return tl('toast.pdfTooLarge', { limit: limitMb(limits.maxPdfExportBytes) });
    return kind === 'timeout' ? tl('toast.pdfTimeout') : tl('toast.pdfFailed');
  }
  if (format === 'html') {
    return kind === 'too-large' ? tl('toast.htmlTooLarge', { limit: limitMb(limits.maxHtmlExportBytes) }) : tl('toast.htmlFailed');
  }
  return kind === 'too-large' ? tl('toast.epubTooLarge', { limit: limitMb(limits.maxEpubBytes) }) : tl('toast.epubFailed');
}
testHooks.exportFailureMessage = exportFailureMessage;

async function exportHTML() {
  closeMenu();
  if (State.activeFile === null || !State.files[State.activeFile]) {
    showToast(tl('toast.noFileToExport'), 'error'); return;
  }
  const file = State.files[State.activeFile];
  const includeAnnotations = await askExportAnnotations(file);
  if (includeAnnotations === null) return; // the question was dismissed: no export
  await noticeLargeExport(file);
  // QA M13: a note that fails to build (a broken diagram, a renderer bug) says so.
  let built;
  try { built = await buildExportDoc(file, { includeAnnotations }); } catch (err) {
    logExportError('html', err);
    showToast(tl('toast.htmlFailed'), 'error'); return;
  }
  const { fullHtml, baseName } = built;
  // audit L3: in the desktop app main asks where to save and writes the file, so "Exported"
  // is said only after the write, and a cancelled dialog says nothing.
  if (window.electronAPI && typeof window.electronAPI.exportHtml === 'function') {
    let res;
    try {
      res = await window.electronAPI.exportHtml({ html: fullHtml, defaultName: baseName + '.html' });
    } catch (err) {
      logExportError('html', err);
      res = { error: 'ipc-failed' };
    }
    if (res && res.ok) showToast(tl('toast.exported', { name: baseName + '.html' }));
    else if (res && res.canceled) hideToast(); // user cancelled — stay quiet
    else showToast(exportFailureMessage('html', res), 'error');
    return fullHtml;
  }
  const blob = new Blob([fullHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = baseName + '.html';
  a.click();
  URL.revokeObjectURL(url);
  showToast(tl('toast.exported', { name: a.download }));
  return fullHtml; // also returned so the export markup is unit/e2e-testable
}
testHooks.exportHTML = exportHTML;

// APP-29: the toast says an export failed; the local log keeps why.
function logExportError(format, err) {
  try {
    window.electronAPI?.logError?.({
      message: `export-${format}-failed: ${err instanceof Error ? err.message : String(err)}`,
      stack: err instanceof Error ? err.stack : undefined,
    });
  } catch (_) { /* never crash reporting */ }
}

// Export the current note to PDF (T-F6). Reuses the standalone export document and
// hands it to the main process (T-B6), which renders it offscreen and printToPDFs it.
// PDF export is a desktop-only capability (needs the Electron bridge).
async function exportPDF() {
  closeMenu();
  if (State.activeFile === null || !State.files[State.activeFile]) {
    showToast(tl('toast.noFileToExport'), 'error'); return;
  }
  if (!window.electronAPI || typeof window.electronAPI.exportPDF !== 'function') {
    showToast(tl('toast.pdfNeedsDesktop'), 'error'); return;
  }
  const file = State.files[State.activeFile];
  const includeAnnotations = await askExportAnnotations(file);
  if (includeAnnotations === null) return { canceled: true }; // the question was dismissed: no export
  const large = await noticeLargeExport(file);
  let built;
  try { built = await buildExportDoc(file, { includeAnnotations }); } catch (err) {
    logExportError('pdf', err);
    showToast(tl('toast.pdfFailed'), 'error'); return { error: 'build-failed' };
  }
  const { fullHtml, baseName } = built;
  // A large export keeps the "may take a while" message up until main answers.
  if (!large) showToast(tl('toast.exportingPdf'));
  let res;
  try {
    res = await window.electronAPI.exportPDF({ html: fullHtml, defaultName: baseName + '.pdf' });
  } catch (err) {
    logExportError('pdf', err);
    res = { error: 'ipc-failed' };
  }
  if (res && res.ok) showToast(tl('toast.exported', { name: `${baseName}.pdf` }));
  else if (res && res.canceled) hideToast(); // user cancelled — stay quiet
  else showToast(exportFailureMessage('pdf', res), 'error');
  return res;
}
testHooks.exportPDF = exportPDF;

// Export the current note as an EPUB (T6.1c). The archive is built entirely in the renderer
// (markdown → bidi-aware XHTML → stored ZIP, dependency-free) and handed to main as BYTES;
// main only asks where to put it and writes the file — no rendering, no network.
async function exportEpub() {
  closeMenu();
  if (State.activeFile === null || !State.files[State.activeFile]) {
    showToast(tl('toast.noFileToExport'), 'error'); return { error: 'no-file' };
  }
  if (!window.electronAPI || typeof window.electronAPI.exportEpub !== 'function') {
    showToast(tl('toast.epubNeedsDesktop'), 'error'); return { error: 'no-bridge' };
  }
  const large = await noticeLargeExport(State.files[State.activeFile]);
  let built;
  try {
    // The async build runs the same Mermaid stage the HTML export gets, so a diagram
    // note exports as a rendered figure instead of a raw code fence.
    built = await buildEpubFromNoteAsync(State.files[State.activeFile], exportRenderOptions());
  } catch (err) {
    logExportError('epub', err);
    showToast(tl('toast.epubFailed'), 'error');
    return { error: 'build-failed' };
  }
  if (!large) showToast(tl('toast.exportingEpub'));
  let res;
  try {
    res = await window.electronAPI.exportEpub({
      bytes: built.bytes,
      defaultName: `${built.baseName}.epub`,
    });
  } catch (err) {
    logExportError('epub', err);
    res = { error: 'ipc-failed' };
  }
  if (res && res.ok) showToast(tl('toast.exported', { name: `${built.baseName}.epub` }));
  else if (res && res.canceled) hideToast(); // user cancelled — stay quiet
  else showToast(exportFailureMessage('epub', res), 'error');
  return res;
}
testHooks.exportEpub = exportEpub;
testHooks.buildExportDoc = buildExportDoc;

// =====================================================================
// NEW DAILY NOTE
// =====================================================================
function newDailyNote() {
  closeMenu();
  markUserIntent();
  const d = new Date();
  // T-R8: filename + heading follow the chosen calendar (Gregorian or Hijri Umm al-Qura).
  const name = dailyNoteName(d, State.calendar);
  // Prefer a same-named note in the ACTIVE file's vault — two open folders can both hold
  // `2026-09-24.md`, and the first global match used to win regardless of context.
  const active = State.activeFile != null ? State.files[State.activeFile] : null;
  let existing = -1;
  if (active && active.vaultId) existing = State.files.findIndex((f) => f.vaultId === active.vaultId && f.name === name);
  if (existing < 0) existing = State.files.findIndex((f) => f.name === name);
  if (existing >= 0) { renderFile(existing); return; }
  const title = name.replace(/\.md$/, '');
  addFile({ name, path: name, handle: null, content: `# ${title}\n\n`, dirty: true });
}

// T-R8: daily-note calendar (Gregorian | Hijri). Persisted via settings:set (F8).
function setCalendar(cal) {
  if (cal !== 'gregorian' && cal !== 'hijri') return;
  State.calendar = cal; // triggers persistSettings via the subscribe hook
  closeMenu();
  showToast(tl('toast.calendar', { name: cal === 'hijri' ? tr('menu.hijri', State.uiLocale) : tr('menu.gregorian', State.uiLocale) }), 'info');
}
testHooks.setCalendar = setCalendar;

// T-R10: Arabic justification. Default OFF = ragged (the typographically safe default for
// Arabic). When ON, RTL blocks fill the measure via inter-character distribution (the
// closest CSS gets to OpenType kashida in Chromium) — see the `.kashida` rule. Persisted (F8).
function applyKashida() { appBody.classList.toggle('kashida', !!State.arabicKashida); }
function setKashida(on) {
  State.arabicKashida = !!on; // triggers persistSettings via the subscribe hook
  applyKashida();
  closeMenu();
  if (!settingsController?.isRestoring()) showToast(tl('toast.kashida', { state: State.arabicKashida ? tl('toast.kashidaOn') : tl('toast.kashidaOff') }), 'info');
}
function toggleKashida() { setKashida(!State.arabicKashida); }
testHooks.setKashida = setKashida;

// T-F11: italic recolor is ON by default (rendered <em> picks up the plum accent). This is an
// OPT-OUT — when disabled, emphasis keeps the body ink colour (only the slant distinguishes it).
// Persisted (F8). The `.no-italic-recolor` class neutralizes the accent in #noteContent.
function applyItalicRecolor() { appBody.classList.toggle('no-italic-recolor', !State.italicRecolor); }
function setItalicRecolor(on) {
  State.italicRecolor = !!on; // triggers persistSettings via the subscribe hook
  applyItalicRecolor();
  closeMenu();
  if (!settingsController?.isRestoring()) showToast(tl('toast.italicRecolor', { state: State.italicRecolor ? tl('toast.on') : tl('toast.off') }), 'info');
}
function toggleItalicRecolor() { setItalicRecolor(!State.italicRecolor); }
testHooks.setItalicRecolor = setItalicRecolor;

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
  renderCrumbs();
}
// Status-bar placeholders shown while no note is open, in the current interface language.
function localizeEmptyStatus() {
  $('readTime').textContent = tl('status.noReadTime');
  $('wordCount').textContent = tl('status.nWords', { n: 0 });
  $('cursorPos').textContent = '— · —';
}
function setUiLocale(locale) {
  if (locale !== 'en' && locale !== 'ar') return;
  State.uiLocale = locale;
  document.documentElement.setAttribute('lang', locale);
  applyLocale(locale);
  localizeStateLabels();
  if (State.files.length) { renderTree(State.files); syncInspector(); renderNoteList(); }
  // Text that was rendered with tl() at render time (doc-meta strip, read time, word count,
  // ln/col) has no data-i18n hook: rebuild it from the active note without touching the editor.
  if (State.activeFile !== null && State.files[State.activeFile]) { renderReadingContent(); updateCursorReadout(); }
  else localizeEmptyStatus();
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
  if (!settingsController?.isRestoring()) showToast(on ? tl('toast.arabicUIOn') : tl('toast.arabicUIOff'), 'info');
}
function toggleArabicUI() { setArabicUI(State.uiDirection !== 'rtl'); }
testHooks.setUiLocale = setUiLocale;
testHooks.setUiDirection = setUiDirection;
testHooks.setArabicUI = setArabicUI;
testHooks.toggleArabicUI = toggleArabicUI;

// =====================================================================
// EDIT MENU COMMANDS
// =====================================================================

// Track the last-focused editable field (textarea or input). This is needed
// because clicking the Edit menu blurs the field — by the time execEditCmd
// runs, document.activeElement is the menu DIV, not the field.
let _lastFocusedEditable = null;
document.addEventListener('focusin', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) {
    _lastFocusedEditable = t;
  }
}, true);

// QA-L2: editor/edit-commands.js is a pure module whose messages are English; they are
// translated here so the Arabic interface shows Arabic.
const EDIT_TOAST_KEYS = new Map([
  ['The reading view is read-only', 'toast.readOnlyView'],
  ['Copy failed', 'toast.copyFailed'],
  ['Cut failed', 'toast.cutFailed'],
  ['Paste failed', 'toast.pasteFailed'],
  ['Paste not supported in this context', 'toast.pasteUnsupported'],
  ['Cut not supported in preview', 'toast.cutPreview'],
  ['Paste not supported in preview', 'toast.pastePreview'],
]);
function execEditCmd(cmd) {
  // All logic lives in src/renderer/editor/edit-commands.js (testable + mutatable).
  // This shim builds the deps object and forwards. Critically: selectAll is
  // NEVER routed through electronAPI.editCommand because webContents.selectAll
  // would select the entire renderer DOM (titlebar/sidebar/statusbar).
  const deps = {
    electronAPI: cmd === 'selectAll' ? null : (window.electronAPI || null),
    // v10 redesign: selectAll is routed by VIEW mode (reading vs edit) — CM6 mounts
    // unconditionally at launch, so it can exist while Reading mode has it hidden behind
    // #noteContent. See edit-commands.js's selectAll().
    getViewMode: () => State.viewMode,
    hasDocument: () => State.activeFile !== null && !!State.files.at(State.activeFile),
    getCmAdapter: () => cmAdapter, // T-F13: CM6 is the live editor — Edit menu acts on it
    getNoteContent: () => noteContent,
    getLastFocusedEditable: () => _lastFocusedEditable,
    getActiveElement: () => document.activeElement,
    getSelection: () => window.getSelection(),
    createRange: () => document.createRange(),
    clipboard: (navigator && navigator.clipboard) || null,
    showToast: (m, l) => showToast(EDIT_TOAST_KEYS.has(m) ? tl(EDIT_TOAST_KEYS.get(m)) : m, l),
    closeMenu: () => closeMenu(),
  };
  return _execEditCmdImpl(cmd, deps);
}
testHooks.execEditCmd = execEditCmd;

// =====================================================================
// CONTEXT MENU (v10 redesign, D1) — themed HTML menu drawn from main's descriptors over
// an IPC bridge, replacing Electron's native Menu.popup(). Main is the sole authority on
// what the menu contains and what each action does; the renderer only draws it and echoes
// back { nonce, index } — never a label, url or role — so main can safely re-derive and
// dispatch the real action itself (see window-controller.js's contextMenuStash).
// =====================================================================
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
  // audit QA-14: the label is resolved through the SAME menu.* keys the Edit menu uses, so
  // the right-click roles follow the UI language and can never drift from the menu labels.
  const roleDisplay = isRole ? (CTX_ROLE_DISPLAY[item.role] || [item.role, '']) : null;
  const roleKey = roleDisplay ? `menu.${item.role}` : null;
  const roleTr = roleKey ? tr(roleKey, State.uiLocale) : null;
  const roleLabel = roleDisplay ? (roleTr && roleTr !== roleKey ? roleTr : roleDisplay[0]) : null;
  const roleShortcut = roleDisplay ? roleDisplay[1] : null;
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
  const iconName = ctxIconName(item);
  if (iconName) icon.appendChild(svgIcon(iconName));
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
    el.addEventListener('click', () => {
      // v1.2: surface items (id 'local:*') are renderer-local and dispatch here; wire
      // items keep the single main-side dispatch path.
      if (typeof item.id === 'string' && item.id.startsWith('local:')) dispatchLocalCtxItem(item.id);
      else dispatchCtxItem(index);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
    });
  }
  return el;
}

// v1.2: per-surface right-click items. Main still owns the content-driven items (it can
// never trust the renderer to name a target), but the renderer detects WHAT SURFACE the
// click landed on during the DOM capture phase and appends actions that only make sense
// there — file tree rows, document tabs, wikilinks — dispatching them locally.
let _ctxSurface = null;
function detectCtxSurface(el) {
  if (!(el instanceof Element)) return { kind: null, editable: false };
  const editable = !!el.closest('input, textarea, [contenteditable="true"], .cm-content');
  // The surface captures the file's IDENTITY (fileKey) next to the index: a vault watch
  // merge can rebuild/reorder State.files between right-click and click, and an index
  // captured stale would close or reveal the WRONG file.
  const withKey = (idx) => {
    const file = State.files[idx];
    return { idx, key: file ? fileKey(file) : null };
  };
  const tab = el.closest('.tab');
  if (tab && tab.dataset.fileIdx != null) return { kind: 'tab', ...withKey(parseInt(tab.dataset.fileIdx, 10)), editable: false };
  const treeItem = el.closest('#tree [role="treeitem"]');
  if (treeItem) {
    const idx = treeItem.dataset && treeItem.dataset.fileIdx != null ? parseInt(treeItem.dataset.fileIdx, 10) : null;
    return { kind: 'tree', ...(idx != null ? withKey(idx) : { idx, key: null }), isDir: treeItem.classList.contains('tree-dir'), editable: false };
  }
  const wikilink = el.closest('a.wikilink');
  if (wikilink) return { kind: 'wikilink', target: wikilink.dataset.target || wikilink.textContent || '', editable };
  if (!editable && State.viewMode === 'reading' && el.closest('#noteContent')) {
    const selected = String(window.getSelection() || '').trim();
    if (selected) return { kind: 'selection', text: selected, editable: false };
  }
  return { kind: editable ? 'text' : null, editable, inEditor: !!el.closest('.cm-content') };
}
document.addEventListener('contextmenu', (e) => {
  const el = e.target instanceof Element ? e.target : null;
  _ctxSurface = detectCtxSurface(el);
  // A second right-click elsewhere replaces the menu; main sends a fresh context-menu:show
  // for it, but the old one (if any) must not linger visually until that arrives.
  if (!ctxMenu.hidden) closeCtxMenu();
}, true);

function buildSurfaceItems(surface) {
  if (!surface || !surface.kind) return [];
  const mk = (id, key, vars) => ({ kind: 'action', id, label: tl(key, vars) });
  const fromActions = (actions) => actions.map((action) => mk(action.id, action.key, action.vars));
  if (surface.kind === 'selection' || surface.kind === 'text') return fromActions(surfaceActions(surface));
  if (surface.kind === 'tab') {
    const tabFile = State.files[surface.idx];
    if (!tabFile) return [];
    return [
      ...fromActions(surfaceActions(surface, { dirty: !!tabFile.dirty })),
      mk('local:tab-close', 'ctx.close'),
      mk('local:tab-close-others', 'ctx.closeOthers'),
      mk('local:tab-close-all', 'ctx.closeAll'),
      mk('local:tab-duplicate', 'ctx.duplicate'),
      mk('local:reveal', 'ctx.reveal'),
      mk('local:copy-path', 'ctx.copyPath'),
    ];
  }
  if (surface.kind === 'tree') {
    if (surface.isDir || surface.idx == null || !State.files[surface.idx]) return [];
    return [
      mk('local:tree-open', 'ctx.openNote'),
      mk('local:reveal', 'ctx.reveal'),
      mk('local:copy-path', 'ctx.copyPath'),
    ];
  }
  if (surface.kind === 'wikilink') {
    return [
      mk('local:wiki-open', 'ctx.openNote'),
      mk('local:wiki-copy', 'ctx.copyName'),
    ];
  }
  return [];
}

// Renderer-local dispatch: these actions call functions in this file (and, for
// Reveal/Copy-Path, a documentId-shaped IPC whose resolution happens main-side).
async function dispatchLocalCtxItem(id) {
  if (_ctxRestoreTarget && document.contains(_ctxRestoreTarget)) {
    try { _ctxRestoreTarget.focus(); } catch (_) { /* target gone */ }
  }
  hideCtxMenuUI();
  const surface = _ctxSurface || {};
  // Re-resolve by the identity captured at right-click time: the index alone goes stale
  // when a vault-watch merge reshuffles State.files between menu open and click.
  let idx = surface.idx;
  if (surface.key != null) {
    const byKey = fileIndexByKey(surface.key);
    if (byKey >= 0) idx = byKey;
  }
  const target = (idx != null) ? State.files[idx] : null;
  switch (id) {
    case 'local:tab-close':
      if (idx != null) await closeTab(idx);
      break;
    // QA M5: folder notes are tabs too (they were skipped), and Cancel on one unsaved tab
    // stops the run instead of asking about the next one.
    case 'local:tab-close-others': {
      const others = State.files.filter((f, i) => i !== idx && f.open !== false);
      for (const f of others) { const i = State.files.indexOf(f); if (i >= 0 && !(await closeTab(i))) break; }
      break;
    }
    case 'local:tab-close-all': {
      const all = State.files.filter((f) => f.open !== false);
      for (const f of all) { const i = State.files.indexOf(f); if (i >= 0 && !(await closeTab(i))) break; }
      break;
    }
    case 'local:tab-duplicate': {
      if (!target) break;
      const baseName = target.name.replace(/(\.md|\.markdown)?$/i, (ext) => ` (copy)${ext || '.md'}`);
      let copyName = baseName;
      for (let n = 2; State.files.some((f) => f.name === copyName); n++) {
        copyName = baseName.replace(/(\.md|\.markdown)$/i, (ext) => ` (copy ${n})${ext}`);
      }
      addFile({ name: copyName, path: copyName, handle: null, content: target.content || '', dirty: true, revision: 1 });
      break;
    }
    case 'local:tree-open':
      if (idx != null) openFromTree(idx);
      break;
    case 'local:reveal':
      if (target && target.documentId && window.electronAPI?.revealFile) {
        try {
          const r = await window.electronAPI.revealFile(target.documentId);
          if (r && r.error) showToast(tl('toast.revealFailed'), 'error');
        } catch (_) { showToast(tl('toast.revealFailed'), 'error'); }
      }
      break;
    case 'local:copy-path':
      if (target && target.documentId && window.electronAPI?.copyFilePath) {
        try {
          const r = await window.electronAPI.copyFilePath(target.documentId);
          if (r && r.error) showToast(tl('toast.copyPathFailed'), 'error');
        } catch (_) { showToast(tl('toast.copyPathFailed'), 'error'); }
      }
      break;
    case 'local:tab-save':
      if (target) {
        if (State.activeFile !== idx) renderFile(idx);
        await saveCurrent();
      }
      break;
    case 'local:sel-highlight':
    case 'local:sel-note':
      if (!_pendingSelection) onNoteMouseUp();
      await addHighlight(id === 'local:sel-note' ? 'note' : 'highlight');
      break;
    case 'local:sel-search':
      searchLibrary(surface.text);
      break;
    case 'local:fmt-bold': wrapSelection('**', '**'); break;
    case 'local:fmt-italic': wrapSelection('*', '*'); break;
    case 'local:fmt-strike': wrapSelection('~~', '~~'); break;
    case 'local:fmt-code': wrapSelection('`', '`'); break;
    case 'local:fmt-link': insertText('[', '](url)'); break;
    case 'local:wiki-open':
      if (surface.target) navWikilink(surface.target);
      break;
    case 'local:wiki-copy':
      if (surface.target && navigator.clipboard) {
        try { await navigator.clipboard.writeText(surface.target); } catch (_) { /* deny → ignore */ }
      }
      break;
    default:
      break;
  }
}

function openCtxMenu({ nonce, descriptors, appCommands, x, y }) {
  closeCtxMenu();
  _ctxNonce = nonce;
  const surfaceItems = buildSurfaceItems(_ctxSurface);
  // v1.2: the six app commands used to be injected into EVERY right-click — sitting
  // under the clipboard items inside text fields and over every selection. They now
  // appear only on neutral chrome/preview surfaces, never in an editable field and
  // never on a menu that already has surface-specific items.
  const showApp = appCommands.length > 0 && surfaceItems.length === 0 && !(_ctxSurface && _ctxSurface.editable);
  _ctxRestoreTarget = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  clearCtxMenu();
  const surfaceIdx = _ctxSurface && _ctxSurface.key != null ? fileIndexByKey(_ctxSurface.key) : -1;
  const surfaceFile = surfaceIdx >= 0 ? State.files.at(surfaceIdx) : null;
  const header = ctxHeader(_ctxSurface, surfaceFile, surfaceFile ? rootNameFor(surfaceFile) : '');
  if (header) ctxMenu.appendChild(buildCtxHeader(document, header));
  // The separator inserted above is display-only and must not consume an action index —
  // reconstruct the wire index (descriptors.length + k) for each appCommands entry;
  // renderer-local surface items carry id 'local:*' and never reach the wire.
  let wireIndex = 0;
  for (const item of descriptors) { ctxMenu.appendChild(renderCtxItem(item, wireIndex)); wireIndex++; }
  if (descriptors.length && (surfaceItems.length || showApp)) ctxMenu.appendChild(renderCtxItem({ kind: 'separator' }, -1));
  if (showApp) {
    const rows = ctxRows({
      forcedDir: State.forcedDir,
      theme: State.theme,
      scale: State.readerTextScale,
      hasDocument: State.activeFile !== null && !!State.files.at(State.activeFile),
      labels: {
        direction: tl('dir.label'),
        theme: tl('menu.theme'),
        textSize: tl('readerControls.textSize'),
        'dir.auto': tl('dir.auto'),
        'dir.rtl': tl('dir.rtl'),
        'dir.ltr': tl('dir.ltr'),
        'theme.paper': tl('menu.themePaper'),
        'theme.ink': tl('menu.themeInk'),
        'theme.sepia': tl('menu.themeSepia'),
        'theme.oasis': tl('menu.themeOasis'),
      },
    });
    for (const row of rows) ctxMenu.appendChild(buildCtxRow(document, row));
    ctxMenu.appendChild(renderCtxItem({ kind: 'separator' }, -1));
  }
  for (const item of surfaceItems) {
    const el = renderCtxItem(item, -1);
    el.dataset.localId = item.id;
    ctxMenu.appendChild(el);
  }
  if (surfaceItems.length && showApp) ctxMenu.appendChild(renderCtxItem({ kind: 'separator' }, -1));
  if (showApp) {
    appCommands.forEach((item, k) => ctxMenu.appendChild(renderCtxItem(item, descriptors.length + k)));
  }

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
  return Array.from(ctxMenu.querySelectorAll('.dd-item:not(.disabled), .dd-opt'));
}

function runCtxOption(optionId) {
  const [kind, value] = optionId.split(':');
  if (kind === 'scale') {
    const next = value === 'reset' ? 1 : Math.round((State.readerTextScale + (value === 'inc' ? 0.1 : -0.1)) * 10) / 10;
    setReaderTextScale(next);
    const percent = ctxMenu.querySelector('[data-ctx-opt="scale:reset"]');
    if (percent) percent.textContent = `${Math.round(State.readerTextScale * 100)}%`;
    return;
  }
  closeCtxMenu();
  if (kind === 'dir') applyForcedDir(value === 'auto' ? null : value);
  else if (kind === 'theme') setTheme(value);
}

ctxMenu.addEventListener('mousedown', (e) => {
  if (e.target.closest('.dd-opt')) e.preventDefault();
});
ctxMenu.addEventListener('click', (e) => {
  const option = e.target.closest('[data-ctx-opt]');
  if (option) runCtxOption(option.dataset.ctxOpt);
});

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
// (the contextmenu capture listener above — surface detection + menu replacement —
// covers this surface; a separate close-only listener would double-handle it)

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
testHooks.vaultSearch = vaultSearch;

// ==== SIDEBAR SEARCH RENDERER ====
// Builds result DOM entirely via createElement + textContent (no innerHTML injection).
function runSidebarSearch(q) {
  const out = $('searchResults');
  q = q.trim();
  if (q.length < 2) {
    out.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = tl('search.empty');
    out.appendChild(empty);
    return;
  }
  const results = vaultSearch(q);
  out.textContent = ''; // clear previous results without innerHTML
  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = tl('search.noMatches', { q });
    out.appendChild(empty);
    return;
  }
  results.forEach(r => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'search-result';
    const resultKey = fileKey(State.files[r.fileIdx]);
    card.addEventListener('click', () => {
      const target = fileIndexByKey(resultKey);
      if (target >= 0) renderFile(target);
      switchSbPane('files');
    });

    const nameEl = document.createElement('div');
    nameEl.className = 'sr-name';
    nameEl.textContent = r.name;
    card.appendChild(nameEl);

    const pathEl = document.createElement('div');
    pathEl.className = 'sr-path';
    pathEl.textContent = State.files.at(r.fileIdx).path || r.name;
    card.appendChild(pathEl);

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
      em.textContent = tl('search.nameMatch');
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
  renderZoom(document, State.zoomFactor);
}
function zoomIn()    { setZoom(State.zoomFactor * 1.1); }
function zoomOut()   { setZoom(State.zoomFactor / 1.1); }
function zoomReset() { setZoom(1); }
testHooks.setZoom   = setZoom;
testHooks.zoomIn    = zoomIn;
testHooks.zoomOut   = zoomOut;
testHooks.zoomReset = zoomReset;

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
testHooks.setReaderTextScale = setReaderTextScale;
testHooks.setReaderWidthCh = setReaderWidthCh;

// =====================================================================
// TABS
// =====================================================================
// v1.2: dirty-state ledger for the MAIN process. Main logs this count if the close
// failsafe ever fires; the count does not block the close.
let _lastDirtyReport = -1;
function reportDirtyCount() {
  const n = State.files.filter((f) => f.dirty).length;
  if (n === _lastDirtyReport) return;
  _lastDirtyReport = n;
  try { window.electronAPI?.reportDirtyState?.(n); } catch (_) { /* browser lane: no bridge */ }
}

function renderTabs() {
  // QA M15: rebuilding the strip removes the focused tab; keyboard focus then fell to <body>.
  const tabHadFocus = !!document.activeElement?.closest?.('.tab') && tabsEl.contains(document.activeElement);
  tabsEl.querySelectorAll('.tab').forEach(t => t.remove());
  State.files.forEach((f, i) => {
    if (f.open === false) return;
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab' + (i === State.activeFile ? ' active' : '') + (f.dirty ? ' dirty' : '') + (f.conflict ? ' conflict' : '') + (f.missing ? ' missing' : '');
    tab.dataset.fileIdx = String(i);
    tab.dataset.d = fileDirKind(f.content, f.forcedDir ?? null);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(i === State.activeFile));
    tab.setAttribute('aria-controls', 'noteContent');
    tab.tabIndex = i === State.activeFile ? 0 : -1;
    tab.dataset.tip = f.conflict ? tl('tab.conflictTip', { name: f.name }) : f.name;
    const closeIcon = f.dirty ? '●' : '×';
    // T-B9/EC-A2: a ⚠ marks a background tab whose file diverged on disk (surfaces the
    // conflict even when the tab isn't active; the resolve banner shows on switching to it).
    if (f.conflict) {
      const conflictMark = document.createElement('span');
      conflictMark.className = 'tab-conflict';
      conflictMark.setAttribute('aria-label', tl('tab.conflictAria'));
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
      // v1.2: the tab strip reverses under the RTL chrome, so the arrows must flip with
      // it (WAI-ARIA tabs pattern: arrows follow visual order).
      const rtl = document.documentElement.dir === 'rtl';
      const forward = (e.key === 'ArrowRight') !== rtl;
      const openTabs = [...tabsEl.querySelectorAll('.tab')];
      const at = openTabs.indexOf(tab);
      const next = openTabs[(at + (forward ? 1 : -1) + openTabs.length) % openTabs.length];
      next?.focus();
      next?.click();
    });
    tabsEl.appendChild(tab);
  });
  if (tabHadFocus) (tabsEl.querySelector('.tab.active') || tabsEl.querySelector('.tab'))?.focus();
  syncWindowTitle(); // T-F19: tab set or dirty flags changed
  renderCrumbs();
  reportDirtyCount();
}

function syncInspector() {
  const f = State.activeFile !== null ? State.files.at(State.activeFile) : null;
  renderInspectorDoc(document, f ? inspectorData({ file: f, ratio: shelfRatio(State.readingProgress, fileKey(f)), rootName: rootNameFor(f), mixedLabel: tl('dir.mixed') }) : null);
}

function rootNameFor(f) {
  const vault = f.vaultId ? workspaceController.getOpenVaults().find((v) => v.id === f.vaultId) : null;
  return vault ? vault.name : tr('sidebar.openFiles', State.uiLocale);
}

function renderCrumbs() {
  const host = $('crumbs');
  if (!host) return;
  host.replaceChildren();
  const f = State.activeFile !== null ? State.files.at(State.activeFile) : null;
  if (!f) {
    const placeholder = document.createElement('span');
    placeholder.className = 'crumb-ph';
    placeholder.setAttribute('data-i18n', 'titlebar.search');
    placeholder.textContent = tl('titlebar.search');
    host.appendChild(placeholder);
    return;
  }
  const segments = crumbSegments(rootNameFor(f), f.path || f.name);
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    const node = document.createElement('span');
    node.className = last ? 'crumb-cur' : 'crumb';
    const label = document.createElement('bdi');
    label.textContent = segment;
    node.appendChild(label);
    if (last && f.dirty) {
      const dot = document.createElement('i');
      dot.className = 'crumb-dot';
      node.appendChild(dot);
    }
    host.appendChild(node);
    if (!last) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      host.appendChild(sep);
    }
  });
}

function updateTabState(idx) {
  const f = State.files[idx];
  const tab = tabsEl.querySelector(`.tab[data-file-idx="${idx}"]`);
  if (!f || !tab) return;
  tab.classList.toggle('dirty', Boolean(f.dirty));
  tab.classList.toggle('conflict', Boolean(f.conflict));
  tab.dataset.tip = f.conflict ? tl('tab.conflictTip', { name: f.name }) : f.name;
  const close = tab.querySelector('.close');
  if (close) close.textContent = f.dirty ? '●' : '×';
  if (idx === State.activeFile) {
    syncWindowTitle(); // T-F19: dirty flag flipped
    renderCrumbs();
  }
  reportDirtyCount();
}

// Resolves true when the tab closed, false when the user kept it (Cancel, or a Save that
// did not complete).
async function closeTab(idx) {
  let f = State.files[idx];
  if (f && f.dirty) {
    // v1.2: Word-style three-way prompt replaces confirm("Close anyway?"), whose
    // default (OK) discarded the user's edits. Save actually saves first — and a
    // canceled Save As aborts the close.
    const choice = await askSaveChanges({ name: f.name });
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      await saveCurrent(f);
      if (f.dirty) { showToast(tl('toast.saveCanceled'), 'info'); return false; }
    }
    // B2: "Don't Save" really throws the edits away. A folder note's file object outlives its
    // tab (the folder's file list keeps it), so it goes back to its saved text and is clean --
    // otherwise the discarded text stays dirty, is mirrored into the recovery snapshot, comes
    // back when the note is reopened, and the autosave writes it to disk.
    if (choice === 'discard') discardEdits(f);
  }
  // The dialog above awaited — tabs may have shifted; close by identity, not index.
  const at = State.files.indexOf(f);
  if (at < 0) return true;
  f = State.files[at];
  if (cmAdapter && f._historyId != null) cmAdapter.releaseHistory(f._historyId); // B1: a closed tab frees its undo history
  if (f.inventory) {
    f.open = false;
    // A background tab: the file stays in State.files, so activeFile does not shift.
    if (State.activeFile !== at) { renderTabs(); persistSettings(); return true; }
    const next = State.files.findIndex((file, i) => i !== at && file.open !== false);
    if (next < 0) { State.activeFile = null; showWelcome(); persistSettings(); return true; }
    renderFile(next);
    return true;
  }
  // T14 (post-review H1): capture the CLOSED tab's reading position by identity BEFORE the
  // splice. After it, State.activeFile still points at `at` — which now holds the shifted-in
  // neighbor — so renderFile's outgoing-capture guard would measure this pane and file the
  // closed note's ratio under the neighbor's shelf entry.
  const closingActive = State.activeFile === at;
  if (closingActive) captureReadingProgress(f);
  State.files.splice(at, 1);
  // B4: a loose (non-inventory) file is tree-visible under @loose, so removing it here
  // must refresh the tree too -- every remaining file's fileIdx shifted by the splice.
  renderTree(State.files);
  // QA M6: the next tab is an OPEN one. A folder's closed notes stay in State.files, and
  // "the previous entry" used to reopen one of them instead of showing the welcome card.
  const isOpen = (file) => file.open !== false;
  let neighbour = -1;
  for (let i = Math.min(at, State.files.length) - 1; i >= 0 && neighbour < 0; i--) if (isOpen(State.files[i])) neighbour = i;
  for (let i = at; i < State.files.length && neighbour < 0; i++) if (isOpen(State.files[i])) neighbour = i;
  if (closingActive && neighbour < 0) { State.activeFile = null; showWelcome(); persistSettings(); return true; }
  if (State.files.length === 0) { State.activeFile = null; showWelcome(); persistSettings(); return true; }
  if (closingActive) {
    // Pre-point activeFile at the file renderFile is about to display, so the outgoing-capture
    // guard (files[activeFile] !== incoming) never sees the shifted array and double-fires.
    State.activeFile = neighbour;
    renderFile(State.activeFile);
  }
  else {
    if (State.activeFile > at) State.activeFile--;
    renderTabs();
    // audit QA-11: closing a BACKGROUND tab changed the session snapshot but never saved
    // it, so a relaunch could resurrect the tab the user just closed. Mirrors renderFile's
    // M6 persist; the active-tab branch already persists through renderFile.
    persistSettings();
  }
  return true;
}
testHooks.closeTab = closeTab; // test hook (mirrors window.renderFile)

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
  void resolveAppVersion().then((version) => { const stamp = $('welcomeVersion'); if (stamp && version) stamp.textContent = version; });
  // T14 (post-review F2): the welcome card is itself a scrollable .preview-pane, so a
  // trailing capture bound to the just-closed note would measure welcome-card geometry and
  // write it over that note's persisted shelf entry. Only renderFile cancelled until now.
  cancelPendingProgressCapture();
  welcomeEl.style.display = 'grid';
  noteContent.style.display = 'none';
  toolbarStrip.style.display = 'none';
  editorArea.classList.add('welcome'); // T-F13: reveal the welcome (preview pane) over the CM6 surface
  editorArea.classList.remove('reading'); // the welcome screen never carries a stale reading class (T-F17)
  syncEditorEmptyHint(null); // no open file → the empty-note hint must not float over the welcome card
  syncReaderControls();
  $('conflictBar') && ($('conflictBar').innerHTML = ''); // no open file → no conflict banner
  renderTabs();
  $('propFile').textContent = '—';
  $('propWords').textContent = '0';
  $('propRead').textContent = '—';
  syncInspector();
  localizeEmptyStatus();
  tocList.className = 'toc-empty';
  tocList.textContent = tl('outline.empty');
  renderRecents();
  renderContinue(); // T4.1: the shelf sits above the recents list on the welcome card
  renderStreakLine(); // T8.1: the reading line sits just above that shelf
  void loadAnnotations(null); // T5.1c: no open file → the Inspector notes list empties out
}

// =====================================================================
// VIEW MODE — Reading (clean read-only render) vs Edit (CM6) — T-F17
// =====================================================================
// Rebuild the rendered #noteContent from the active file's CURRENT content, so entering
// reading mode reflects unsaved edits even within the live-edit debounce window. Mirrors the
// renderFile/applyEditorInput preview pipeline but does NOT touch the CM6 editor.
// The word count and reading time, in the Inspector and the status bar.
function showWordCounts(words) {
  const readTime = tl('doc.readTime', { n: readMinutes(words) });
  $('propWords').textContent = words;
  $('propRead').textContent = readTime;
  $('readTime').textContent = readTime;
  $('wordCount').textContent = tl('status.nWords', { n: words });
}

// Render a note body into #noteContent: the doc-meta strip, the sanitized nodes (QA-M16: no
// string round trip), then the passes that rewrite them in place — note-relative images to
// bpmd:// (R10), callouts (F14) and code + math (F9) before per-block direction (R1/R2) —
// and the wikilink clicks. Callers keep their own counters, outline and scroll handling.
function renderNoteBody(file, bodyNodes, wordCount) {
  noteContent.innerHTML = `
    <div class="doc-meta" aria-hidden="true">
      <span>${escapeHtml(tl('doc.note'))}</span><span>·</span>
      <span>${tl('status.nWords', { n: wordCount })}</span><span>·</span>
      <span>${escapeHtml(file.path)}</span>${file.dirty ? '<span>·</span><span style="color: var(--accent);">● ' + escapeHtml(tl('doc.unsaved')) + '</span>' : ''}
    </div>
  `;
  noteContent.append(bodyNodes);
  rewriteVaultImages(noteContent);
  transformCallouts(noteContent, { parseCalloutHeader, resolveDirection: resolveBlockDirection });
  decorateCodeAndMath();
  applyBidiToNote(file.content || '');
  noteContent.querySelectorAll('a.wikilink').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); navWikilink(a.dataset.target); });
  });
}

// ── Large notes (large-file.js) ───────────────────────────────────────────────────────────────
// A note of 5-20 MB (LARGE) shows no preview while it is edited; it renders when Reading mode
// is on. A note of 20-100 MB (HUGE, large-file mode) is never rendered on its own: Reading mode
// shows a notice with a "Render anyway" button, and the outline is not built.
function previewDeferred(file) {
  return needsRenderPrompt(file) || (skipsEditPreview(file) && State.viewMode !== 'reading');
}
// The direction of a huge note comes from its first pages: reading 100 MB of prose for a vote
// is not worth the wait.
const DIRECTION_SAMPLE_CHARS = 200_000;
function renderDeferredNote(file) {
  noteContent.textContent = '';
  if (needsRenderPrompt(file)) {
    const box = document.createElement('div');
    box.className = 'conflict-banner large-notice'; // the banner look the conflict and encoding bars already have
    box.setAttribute('role', 'status');
    const message = document.createElement('span');
    message.className = 'cf-msg';
    message.textContent = `${tl('large.title')} — ${tl('large.body')}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cf-btn cf-reload';
    button.id = 'renderAnywayBtn';
    button.textContent = tl('large.render');
    button.addEventListener('click', () => { void renderLargeAnyway(file); });
    box.append(message, button);
    noteContent.appendChild(box);
  }
  applyBidiToNote((file.content || '').slice(0, DIRECTION_SAMPLE_CHARS));
}
// The outline of a deferred note: LARGE notes read it from the source (the existing rule),
// HUGE notes have none (splitting 100 MB into lines costs more than the outline is worth).
function buildDeferredToc(file) {
  if (inLargeMode(file)) {
    tocList.className = 'toc-empty';
    tocList.textContent = tl('outline.largeFile');
    _tocHeadings = [];
    return;
  }
  buildSourceTOC(file.content || '');
}
// A LARGE or HUGE note about to be drawn in Reading mode takes seconds to minutes (measured: about
// 30 s for 19 MB). The reader is told first, the message gets a frame to paint, and only then is the
// note rendered: renderFile and setViewMode show the notice and hand the render to this schedule.
// One render can be waiting at a time; anything that changes what is on screen cancels it.
let heavyRender = null; // { file, notice } while a render waits for the notice to paint
const readingRenderIsHeavy = (file) => !!file && State.viewMode === 'reading' && skipsEditPreview(file) && !needsRenderPrompt(file);
function noticeHeavyRender(file) {
  const rendering = tl('toast.renderingLarge');
  // The "this note is large" message is said once per open (announceLargeNote); here it leads the
  // notice so that it is read BEFORE the wait instead of after it.
  const notice = file._largeToldOpen ? rendering : `${tl('toast.largeNote', { mb: megabytes(file.sizeBytes) })} ${rendering}`;
  file._largeToldOpen = true;
  showToast(notice, 'info', undefined, { sticky: true });
  heavyRender = { file, notice };
}
function scheduleHeavyRender(file, { focus = false } = {}) {
  const mine = heavyRender;
  void nextPaint().then(() => {
    if (heavyRender !== mine) return; // superseded: whoever did it already cleaned up
    heavyRender = null;
    const stillShown = State.files[State.activeFile] === file && State.viewMode === 'reading';
    hideToast(); // the notice has painted; the render below blocks the page, then its own toasts show
    if (!stillShown) { _progressSuspended = false; return; }
    renderReadingContent();
    restoreReadingScroll(file, () => { _progressSuspended = false; });
    if (focus) noteContent.focus(); // focusable scroll region (a11y)
  });
}
function cancelHeavyRender() {
  const pending = heavyRender;
  if (!pending) return;
  heavyRender = null;
  _progressSuspended = false;
  if (toastEl.textContent === pending.notice) hideToast();
}
// "Render anyway": tell the reader it may take a while, let that paint, then render.
async function renderLargeAnyway(file) {
  if (!file || State.files[State.activeFile] !== file) return;
  file.renderAnyway = true;
  showToast(tl('toast.renderingLarge'), 'info', undefined, { sticky: true });
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  try { if (State.files[State.activeFile] === file && State.viewMode === 'reading') renderReadingContent(); }
  finally { hideToast(); }
}
testHooks.renderLargeAnyway = () => renderLargeAnyway(State.files[State.activeFile]);
// Said once per open of the note (not on every tab switch).
function announceLargeNote(file) {
  if (!file || file._largeToldOpen || !(file.largeTier >= TIER.LARGE)) return;
  file._largeToldOpen = true;
  if (inLargeMode(file)) showToast(tl('toast.largeMode'), 'info', undefined, { ms: 7000 });
  else showToast(tl('toast.largeNote', { mb: megabytes(file.sizeBytes) }), 'info', undefined, { ms: 7000 });
}

function renderReadingContent() {
  const f = State.files[State.activeFile];
  if (!f) return;
  if (needsRenderPrompt(f)) {
    renderDeferredNote(f);
    buildDeferredToc(f);
    showWordCounts(bodyWordCount(parseFrontMatter(f.content || '').body));
    syncInspector();
    return;
  }
  const whole = parseFrontMatter(f.content || '').body;
  const { body, cut } = renderSlice(f, whole);
  const bodyNodes = noteBodyNodes(body);
  noteRenderLimit(f);
  const wordCount = bodyWordCount(whole);
  renderNoteBody(f, bodyNodes, wordCount);
  if (cut) showToast(tl('toast.renderCut', { mb: Math.round(RENDER_ANYWAY_CHARS / MIB) }), 'info', undefined, { ms: 9000 });
  buildTOC();
  void loadAnnotations(f); // T5.1c: needs buildTOC's heading ids to re-anchor highlights
  showWordCounts(wordCount);
  syncInspector();
}

// Apply a view mode: 'reading' shows the clean rendered note (#noteContent) and hides the CM6
// editor + writing toolbar; 'edit' shows the CM6 surface. Persisted via the PERSISTED_KEYS hook.
function setViewMode(mode) {
  if (mode !== 'reading' && mode !== 'edit') return;
  if (mode === 'edit') cancelHeavyRender(); // the note was never drawn; Edit does not need it
  State.viewMode = mode;
  hideDirBadge(); // the block-direction badge belongs to the reading view
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
    if (open) {
      // T14 (post-review L1): the Edit→Reading toggle rebuilds #noteContent and the restore
      // assigns scrollTop — both fire scroll events that must not be measured mid-restore
      // (with rAFs paused in a hidden window a ~0 ratio would persist to the shelf). Same
      // cancel + suspend + settle pattern renderFile uses since T10 (BUG-1).
      const note = State.files[State.activeFile];
      if (heavyRender && heavyRender.file === note) {
        // renderFile already told the reader and scheduled this note's render
      } else {
        cancelPendingProgressCapture();
        _progressSuspended = true;
        if (readingRenderIsHeavy(note)) {
          noteContent.textContent = ''; // not the stale preview of an earlier edit state
          noticeHeavyRender(note);
          scheduleHeavyRender(note, { focus: true });
        } else {
          renderReadingContent();
          restoreReadingScroll(note, () => { _progressSuspended = false; });
          noteContent.focus(); // focusable scroll region (a11y)
        }
      }
    }
  } else if (cmAdapter && typeof cmAdapter.focus === 'function') {
    cmAdapter.focus();
    // Reading wires the preview listener; rebuild after returning to Edit so CM6 owns sync.
    if (open) { const note = State.files[State.activeFile]; if (previewDeferred(note)) buildDeferredToc(note); else buildTOC(); }
  }
}
testHooks.setViewMode = setViewMode;
function toggleViewMode() { setViewMode(State.viewMode === 'reading' ? 'edit' : 'reading'); }

// =====================================================================
// RENDER FILE
// =====================================================================
function fileIndexByKey(key) {
  if (key == null) return -1;
  return State.files.findIndex((f) => fileKey(f) === key);
}

function renderFile(idx) {
  const file = State.files[idx];
  if (!file) return;
  cancelHeavyRender(); // a render still waiting for its notice belonged to the note being left
  flushEditorChanges(); // a large note's pending text belongs to the note being left
  // T4.1: capture where the OUTGOING note was scrolled BEFORE the DOM is replaced —
  // State.activeFile still points at it here.
  if (State.activeFile != null && State.files[State.activeFile] && State.files[State.activeFile] !== file) {
    captureReadingProgress(State.files[State.activeFile]);
  }
  file.open = true;
  State.activeFile = idx;

  // Per-note toolbar direction (PARTIAL-01): restore this tab's own forced choice.
  // A note with no stored choice resolves to AUTO. applyBidiToNote (below) sets the
  // #editor dir, syncs the CM6 adapter, and calls updateDirUI(); here we only sync the
  // appBody._manualRTL mirror it doesn't cover.
  State.forcedDir = file.forcedDir ?? null;
  appBody._manualRTL = State.forcedDir === 'rtl';

  welcomeEl.style.display = 'none';
  noteContent.style.display = 'block';
  editorArea.classList.remove('welcome'); // T-F13: a file is open → show the CM6 live-preview surface
  // T-F17: honor the persisted view mode. Reading shows #noteContent (preview pane) + hides the
  // writing toolbar; Edit shows the CM6 surface. The `reading` class drives the pane CSS.
  editorArea.classList.toggle('reading', State.viewMode === 'reading');
  toolbarStrip.style.display = (State.viewMode === 'reading') ? 'none' : 'flex';
  syncReaderControls();

  loadIntoEditor(file); // CodeMirror (T-F13); one undo history per file (B1)
  syncEditorEmptyHint(file.content);

  // Strip YAML front matter (T-R6) so it never renders as body text.
  const whole = parseFrontMatter(file.content || '').body;
  const heavy = readingRenderIsHeavy(file); // told first, drawn after a frame (scheduleHeavyRender below)
  if (heavy) noticeHeavyRender(file);
  const deferred = previewDeferred(file) || heavy; // a large note is not rendered here: see "Large notes" above
  const slice = deferred ? { body: '', cut: false } : renderSlice(file, whole);
  const body = slice.body;
  const bodyNodes = deferred ? null : noteBodyNodes(body);
  if (!deferred) noteRenderLimit(file);
  const wordCount = bodyWordCount(whole);
  if (slice.cut) showToast(tl('toast.renderCut', { mb: Math.round(RENDER_ANYWAY_CHARS / MIB) }), 'info', undefined, { ms: 9000 });

  // EC-A2 (T-B9): when the open file diverged on disk while it had unsaved edits, show a
  // resolve banner — Keep my edits (retain) or Reload from disk (take the disk version).
  const conflictBanner = file.conflict ? `
    <div class="conflict-banner" role="alert">
      <span class="cf-msg">${escapeHtml(tl('banner.conflict', { name: file.name }))}</span>
      <button class="cf-btn cf-keep" type="button">${escapeHtml(tl('banner.keepMine'))}</button>
      <button class="cf-btn cf-reload" type="button">${escapeHtml(tl('banner.reload'))}</button>
    </div>` : '';

  if (deferred) renderDeferredNote(file); else renderNoteBody(file, bodyNodes, wordCount);
  // EC-A2 (T-B9): the conflict banner must stay VISIBLE — render it in the dedicated
  // #conflictBar above the editor, not inside #noteContent (which is hidden behind the CM6
  // surface now, T-F13). Cleared when the file is not in conflict.
  const conflictBar = $('conflictBar');
  if (conflictBar) {
    conflictBar.innerHTML = conflictBanner;
    if (file.conflict) {
      const bannerKey = fileKey(file);
      conflictBar.querySelector('.cf-keep')?.addEventListener('click', () => resolveConflict(fileIndexByKey(bannerKey), 'keep'));
      conflictBar.querySelector('.cf-reload')?.addEventListener('click', () => resolveConflict(fileIndexByKey(bannerKey), 'reload'));
    }
    // audit M7: a guessed encoding is asked about here, and no save happens before the answer.
    if (file.documentId && file.meta && file.meta.encodingUncertain) conflictBar.appendChild(buildEncodingBanner(file));
  }

  $('propFile').textContent = file.name;
  showWordCounts(wordCount);
  $('cursorPos').textContent = tl('status.lnCol', { l: 1, c: 1 });
  syncInspector();

  if (deferred) buildDeferredToc(file); else buildTOC();
  void loadAnnotations(file); // T5.1c: re-anchor this note's highlights after the rebuild
  renderTabs();
  highlightTreeActive();
  pushRecent(file);

  document.querySelector('.editor-wrap').scrollTop = 0;
  // T4.1 + T10 (BUG-1): the switch's own pane bookkeeping (reset to 0, then the restore
  // rAFs) fires scroll events that must not be read as reading progress — cancel any
  // trailing capture bound to the OUTGOING note and suspend until the restore settles.
  cancelPendingProgressCapture();
  hideHighlightBar(); // T14 (F3): a selection bar must not survive the document switch it enables
  _progressSuspended = true;
  const _previewScroller = previewScroller();
  if (_previewScroller) _previewScroller.scrollTop = 0;
  if (heavy) scheduleHeavyRender(file); // keeps _progressSuspended until the note is drawn
  else if (State.viewMode === 'reading') restoreReadingScroll(file, () => { _progressSuspended = false; });
  else _progressSuspended = false;

  file._lastRenderedSource = deferred ? null : whole; // a debounce tick right after this render is a no-op (audit PERF-01)
  announceLargeNote(file);
  persistSettings(); // M6: the active tab changed — snapshot the session (debounced, no-op while restoring)
  // QA M7: an open find bar searches the note now on screen, not the one it was opened on
  // (its matches were offsets and marks of the previous note).
  if (_findFile && _findFile !== file && $('findBar').classList.contains('open')) runFind($('findInput').value);
}
testHooks.renderFile = renderFile;

// ── audit M7 (decision D10): a guessed encoding is confirmed before the first save ──
const ENCODING_NAMES = new Map([
  ['utf8', 'UTF-8'], ['windows-1256', 'Windows-1256'], ['utf16le', 'UTF-16 LE'], ['utf16be', 'UTF-16 BE'],
]);
const encodingName = (encoding) => ENCODING_NAMES.get(encoding) || String(encoding || '');

/** The bar above the note: what was guessed, "Keep", and "Reopen as" for the other encodings. */
function buildEncodingBanner(file) {
  const meta = file.meta || {};
  const current = ENCODING_NAMES.has(meta.encoding) ? meta.encoding : 'utf8';
  const key = fileKey(file);
  const bar = document.createElement('div');
  bar.className = 'conflict-banner encoding-banner';
  bar.setAttribute('role', 'alert');
  const message = document.createElement('span');
  message.className = 'cf-msg';
  message.textContent = meta.encodingInvalidBytes > 0
    ? tl('banner.encodingDamaged', { name: file.name, n: meta.encodingInvalidBytes })
    : tl('banner.encodingGuessed', { name: file.name, encoding: encodingName(current) });
  bar.appendChild(message);
  const addButton = (label, className, encoding, reopen) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.dataset.encoding = encoding;
    button.textContent = label;
    button.addEventListener('click', () => { void resolveEncoding(fileIndexByKey(key), encoding, reopen); });
    bar.appendChild(button);
  };
  addButton(tl('banner.encodingKeep', { encoding: encodingName(current) }), 'cf-btn cf-reload enc-keep', current, false);
  for (const encoding of ENCODING_NAMES.keys()) {
    if (encoding !== current) addButton(tl('banner.encodingReopen', { encoding: encodingName(encoding) }), 'cf-btn enc-reopen', encoding, true);
  }
  return bar;
}

/** Apply the answer: keep the guess, or read the note again with another encoding. */
async function resolveEncoding(idx, encoding, reopen) {
  const f = idx >= 0 ? State.files.at(idx) : null;
  const bridge = window.electronAPI;
  if (!f || !f.documentId || !f.meta || !f.meta.encodingUncertain) return;
  if (!bridge || typeof bridge.confirmEncoding !== 'function') return;
  if (reopen && f.dirty && !(await askReopenDiscard(f.name))) return;
  let result;
  try { result = await bridge.confirmEncoding({ documentId: f.documentId, encoding, reopen }); }
  catch (_) { result = { error: 'ipc-failed' }; }
  if (!result || result.error || (reopen && typeof result.content !== 'string')) {
    showToast(tl('toast.encodingReopenFailed', { name: f.name, encoding: encodingName(encoding) }), 'error');
    return;
  }
  if (reopen) {
    adoptDiskText(f, result.content); // the disk text in the chosen encoding is the baseline
    f.meta = result.meta || f.meta;
    applyNoteSize(f, result.size); // the note is drawn again just below
  } else {
    const meta = { ...f.meta };
    delete meta.encodingUncertain;
    delete meta.encodingInvalidBytes;
    f.meta = meta;
  }
  const at = State.files.indexOf(f);
  if (at >= 0 && at === State.activeFile) renderFile(at);
  renderTabs();
  if (!f.meta.encodingUncertain) showToast(tl('toast.encodingConfirmed', { encoding: encodingName(f.meta.encoding) }), 'info');
}

// EC-A2 resolve (T-B9): apply the user's choice for a disk-conflicted file.
function resolveConflict(idx, action) {
  const f = State.files[idx];
  if (!f || !f.conflict) return;
  // The disk copy is larger than a large note and was not read when the conflict arose: ask now
  // (the reader chose this action), read it, and carry on with the answer.
  if (f.diskContent == null && Number.isFinite(f.diskSize) && f.documentId) {
    void (async () => {
      let loaded = false;
      try { loaded = await workspaceController.loadConflictDisk(f, { ask: true }); } catch (_) { /* reported below */ }
      if (!loaded) { showToast(tl('toast.diskUnreadable', { name: f.name }), 'error'); return; }
      resolveConflict(State.files.indexOf(f), action);
    })();
    return;
  }
  if (action === 'reload') {
    // QA H3: with no disk text to take (its re-read failed) "Reload" used to mark the edits
    // clean while they stayed on screen: no close prompt, no autosave, lost on close. The
    // banner stays and the edits stay unsaved until the disk copy can be read.
    if (f.diskContent == null) { showToast(tl('toast.diskUnreadable', { name: f.name }), 'error'); return; }
    // take the disk version, discarding local edits; the disk text becomes the baseline
    adoptDiskText(f, f.diskContent);
    applyNoteSize(f, f.diskSize); // the note is drawn again just below
  } else if (f.diskContent != null) {
    // 'keep' → retain the edits; the baseline still moves to the disk text we just
    // acknowledged (typing back to the OLD baseline must not look clean while disk differs)
    adoptDiskText(f, f.diskContent, { keepEdits: true });
  }
  if (f.diskMeta) f.meta = f.diskMeta; // acknowledge current disk identity (both keep + reload) so we don't re-nag / mis-baseHash the next Save
  f.conflict = false;
  f.diskContent = null;
  f.diskMeta = null;
  f.diskSize = null;
  renderFile(idx);
  showToast(action === 'reload' ? tl('toast.reloaded') : tl('toast.keptEdits'), 'info');
}

// Outline (T-F7): full h1–h6 tree with Arabic-aware slugs, matching ids on the
// rendered headings (click-to-scroll), and scroll-sync highlighting.
let _tocHeadings = []; // [{ el, item, pos }] in document order, for scroll-sync (pos = CM6 source offset)

// Heading text compared loosely (case, runs of spaces) when an outline entry from the
// rendered DOM is matched to a heading found by sourceHeadingPositions in the editor source.
const _normHeading = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Empty the outline; with nothing to list, show the "no headings" note and return false. */
function resetToc(count) {
  _tocHeadings = [];
  if (!count) {
    tocList.className = 'toc-empty';
    tocList.textContent = tl('outline.noHeadings');
    return false;
  }
  tocList.className = '';
  tocList.innerHTML = '';
  return true;
}
/** One outline row; a click scrolls to the rendered heading `el` or the editor offset `pos`. */
function addTocItem(level, text, no, el, pos) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `toc-item h${level}` + (_tocHeadings.length === 0 ? ' active' : '');
  item.textContent = text;
  item.dataset.no = no;
  // Same resolver as the heading itself (bidi-dom.js), so the outline entry and its heading
  // always agree. dir="auto" is plain first-strong and disagrees on "API دليل المستخدم".
  item.setAttribute('dir', resolveBlockDirection(text, State.direction === 'rtl' ? 'rtl' : 'ltr'));
  const entry = { el, item, pos };
  item.addEventListener('click', () => scrollToHeading(entry));
  tocList.appendChild(item);
  _tocHeadings.push(entry);
}
function buildTOC() {
  // Derive the outline from the RENDERED DOM headings (the source of truth for
  // what's displayed) rather than from marked.lexer tokens index-aligned to the
  // DOM: the lexer only emits top-level headings, so a heading nested in a
  // blockquote/callout/list (or raw HTML) would desync the index and mis-assign
  // ids/labels/scroll-targets. Slugs come from bidi.headingSlugs, the one id rule
  // the exports use too, so ids/labels/targets are consistent.
  const rendered = [...noteContent.querySelectorAll('h1, h2, h3, h4, h5, h6')];
  if (!resetToc(rendered.length)) return;
  // CM6 source heading offsets, to map each rendered heading → an editor position. Aligned by
  // index (rendered heading i ↔ source heading i), with a text-match fallback for the cases
  // where counts drift (e.g. an inline-styled heading whose rendered text differs).
  const srcHeads = cmAdapter ? sourceHeadingPositions(cmAdapter.getValue()) : [];
  const usedSrc = new Set();
  const slugs = headingSlugs(rendered.map((el) => (el.textContent || '').trim()));
  const outlineNos = outlineNumbers(rendered.map((el) => Number(el.tagName.charAt(1))));
  rendered.forEach((el, i) => {
    const text = (el.textContent || '').trim();
    let slug = slugs[i];
    // audit M1: a heading called "Editor" or "Toast" must not get the id (and with it the
    // CSS and the lookups) of an app element.
    const owner = slug ? document.getElementById(slug) : null;
    if (owner && !rendered.includes(owner)) slug = `${slug}-heading`;
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
    addTocItem(Number(el.tagName.charAt(1)), text, outlineNos.at(i), el, pos); // clean rendered text
  });
  setupScrollSync();
}
testHooks.buildTOC = buildTOC; // test hook + used to rebuild the outline after the async CM6 mount

// QA-M16: above this size an edit no longer re-renders the hidden reading pane (about half a
// second of work at this size, growing with the note).
const LARGE_EDIT_NOTE_CHARS = 200_000;
// The Edit-mode outline of such a note, read from the source: each entry carries its editor
// position and no rendered heading (scrollToHeading then uses the position).
function buildSourceTOC(md) {
  const heads = sourceHeadingPositions(md);
  if (!resetToc(heads.length)) return;
  const outlineNos = outlineNumbers(heads.map((h) => h.level));
  heads.forEach((h, i) => addTocItem(h.level, h.text.replace(/[*_`~]+/g, '').trim(), outlineNos.at(i), null, h.pos));
  setupScrollSync();
}

// The rendered note scrolls inside .preview-pane (.editor-area is overflow:hidden,
// so .editor-wrap itself never scrolls).
function previewScroller() { return document.querySelector('.preview-pane'); }

// ── T4.1: reading-position capture + restore ─────────────────────────────────────────
// The stored ratio is read from / written to .preview-pane, which is the ONLY scrolling
// surface in Reading mode (see previewScroller above). Edit (CM6) mode captures nothing:
// State.readingProgress records "how far through the note you were", which is a reading
// concept, and the doc's ChangeLog note records that limit.
function activeReadingFile() {
  return State.activeFile != null && State.files[State.activeFile] ? State.files[State.activeFile] : null;
}

function captureReadingProgress(file) {
  if (!file) return;
  const ratio = scrollRatio(previewScroller());
  if (ratio == null) return; // unmeasurable (short note / not laid out) — keep whatever we had
  file.scrollRatio = ratio;
  renderInspectorProgress(document, ratio);
  const entry = progressEntryFor(file, ratio, Date.now());
  if (!entry) return; // loose or untitled file: not reopenable, so never shelved
  const alreadyShelved = State.readingProgress.some((item) => item && item.key === entry.key);
  // A file that was opened but never scrolled must not fill the shelf with 0 % — but an
  // entry that already exists is updated (scrolling back to the top is a real position).
  if (ratio <= 0 && !alreadyShelved) return;
  State.readingProgress = upsertProgress(State.readingProgress, entry);
}

// Throttle: at most one write per second, with a single pending trailing timer. The pending
// write is bound to the file that was being scrolled when it was scheduled (T10 BUG-1):
// measuring whoever is ACTIVE at fire time would let a tab switch inside the throttle window
// read the incoming note's just-reset pane ratio and file it onto the wrong shelf entry.
let _progressTimer = null;
let _progressLastWrite = 0;
let _progressPendingFile = null;
// A file switch re-seats the pane (scrollTop = 0, then the restore rAFs); the scroll events
// fired by that re-seating are the switch's own bookkeeping, not reading (T10 BUG-1).
// Capture is suspended until the restore settles, so the incoming note's stored position
// can never be measured as ~0 and written over itself.
let _progressSuspended = false;
// T14 (post-review F4): each restore owns the pane for as long as its sequence number is
// current. A stale double-rAF chain from the PREVIOUS file must not apply its target onto
// the new file's DOM after a target-less restore lifted the suspension synchronously.
let _progressRestoreSeq = 0;

function cancelPendingProgressCapture() {
  if (_progressTimer) { clearTimeout(_progressTimer); _progressTimer = null; }
  _progressPendingFile = null;
}

function scheduleProgressCapture() {
  if (_progressSuspended) return;
  const now = Date.now();
  const since = now - _progressLastWrite;
  if (since >= 1000) {
    _progressLastWrite = now;
    captureReadingProgress(activeReadingFile());
    return;
  }
  if (_progressTimer) return; // one trailing write is enough
  _progressPendingFile = activeReadingFile();
  _progressTimer = setTimeout(() => {
    _progressTimer = null;
    _progressLastWrite = Date.now();
    captureReadingProgress(_progressPendingFile);
    _progressPendingFile = null;
  }, 1000 - since);
}

// Restore the stored ratio onto .preview-pane. Two rAFs: the first lets the pane lay out,
// the second lets late images change scrollHeight before the offset is applied. `onSettled`
// (T10 BUG-1) runs after the LAST attempt whether or not an offset could be applied — a
// hidden window pauses rAF, but whenever this chain runs at all, it ends here.
function restoreReadingScroll(file, onSettled) {
  if (!file) return;
  const seq = ++_progressRestoreSeq;
  let target = typeof file.scrollRatio === 'number' && Number.isFinite(file.scrollRatio)
    ? file.scrollRatio
    : null;
  if (target == null) {
    const key = fileKey(file);
    const hit = key ? State.readingProgress.find((item) => item && item.key === key) : null;
    target = hit ? hit.ratio : null;
  }
  if (target == null) { if (onSettled) onSettled(); return; }
  const apply = () => {
    if (seq !== _progressRestoreSeq) return; // T14 (F4): a newer restore owns the pane now
    const el = previewScroller();
    if (el) {
      const max = el.scrollHeight - el.clientHeight;
      if (max > 0) el.scrollTop = Math.round(target * max);
    }
    if (onSettled) onSettled();
  };
  requestAnimationFrame(() => requestAnimationFrame(apply));
}
testHooks._captureReadingProgress = captureReadingProgress;

// ── T8.1: reading minutes + streak (local only) ──────────────────────────────────────
// One minute per tick while a note is actually on screen in Reading mode. Deliberately simple:
// no idle detection and no keystroke tracking — "the reading view is open and the window is
// visible" is the whole signal. MAIN owns the date key (its local calendar) and the caps, so a
// tick can never land on the wrong day or write an arbitrary amount.
const STATS_TICK_MS = 60 * 1000;
let _statsTimer = null;

function statsBridge() {
  return (window.electronAPI && typeof window.electronAPI.statsAddMinutes === 'function')
    ? window.electronAPI : null;
}

/** One line on the welcome card: the streak and today's progress. Goal 0 hides it entirely. */
function renderStreakLine() {
  const el = $('streakLine');
  if (!el) return;
  const goal = Number(State.readingGoalMin) || 0;
  const stats = State.readingStats;
  if (!goal || !stats || (!stats.today && !stats.streak)) {
    el.hidden = true;
    el.textContent = '';
    renderStreakGrid(null, goal);
    return;
  }
  renderStreakGrid(stats, goal);
  const parts = [];
  if (stats.streak > 0) parts.push(tl('streak.days', { n: stats.streak }));
  parts.push(tl('streak.today', { n: stats.today, goal }));
  el.textContent = parts.join(' · ');
  el.hidden = false;
}

function renderStreakGrid(stats, goal) {
  const host = $('streakGrid');
  if (!host) return;
  host.textContent = '';
  if (!stats || !stats.date) { host.hidden = true; return; }
  for (const cell of streakGrid(stats.days, stats.date, { goal })) {
    const dot = document.createElement('span');
    dot.className = 'sg-cell';
    dot.dataset.l = String(cell.level);
    if (cell.future) dot.dataset.future = '';
    dot.title = `${cell.date} · ${cell.minutes}`;
    host.appendChild(dot);
  }
  host.setAttribute('aria-label', tl('streak.grid'));
  host.hidden = false;
}

async function refreshReadingStats() {
  const bridge = statsBridge();
  if (!bridge || typeof bridge.statsGet !== 'function') { renderStreakLine(); return; }
  try { State.readingStats = await bridge.statsGet(); } catch (_) { /* keep the last known line */ }
  renderStreakLine();
}

/** Count a minute only when the reading view is genuinely the visible surface. */
function readingMinuteTick() {
  const bridge = statsBridge();
  if (!bridge) return;
  if (State.viewMode !== 'reading') return;
  if (State.activeFile === null || !State.files[State.activeFile]) return;
  if (document.visibilityState !== 'visible') return;
  void bridge.statsAddMinutes(1).then((res) => {
    if (res && res.ok) {
      const days = Object.assign({}, State.readingStats && State.readingStats.days, { [res.date]: res.today });
      State.readingStats = { today: res.today, date: res.date, streak: res.streak, days };
      renderStreakLine();
    }
  }).catch(() => { /* a failed tick is silent — stats must never nag */ });
}
testHooks._readingMinuteTick = readingMinuteTick;

function startReadingStats() {
  if (_statsTimer) return;
  _statsTimer = setInterval(readingMinuteTick, STATS_TICK_MS);
  if (typeof _statsTimer.unref === 'function') _statsTimer.unref();
}

// ── T5.1c: highlights + margin notes (Reading view) ──────────────────────────────────
// Stored by main in <userData>/annotations.json, keyed by fileKey() — the vault-scoped form
// for vault notes, so the key survives the per-session document-capability rotation (DATA-01);
// the renderer keeps the ACTIVE document's list only. Re-anchoring is text-based
// (markdown/annotations.js), so a highlight survives a re-render, a mode switch and a
// relaunch while its words are unchanged.
let _annotations = [];
let _annotationsKey = null;
let _hlBar = null;
let _pendingSelection = null; // { range, text, anchor } captured on mouseup, used on bar click
let _multiNodeToastAt = 0;

const annotationsBridge = () => (window.electronAPI
  && typeof window.electronAPI.annotationsGet === 'function' ? window.electronAPI : null);

/** Load the active document's highlights, re-anchor them, and refresh the Inspector list. */
async function loadAnnotations(file) {
  const bridge = annotationsBridge();
  const key = file ? fileKey(file) : null;
  if (!bridge || !key) {
    _annotations = [];
    _annotationsKey = null;
    renderNoteList();
    return;
  }
  _annotations = [];
  _annotationsKey = key;
  let list = [];
  try {
    const res = await bridge.annotationsGet(key);
    list = res && Array.isArray(res.highlights) ? res.highlights : [];
  } catch (_) { list = []; } // a failed read is an empty list, never a broken note
  // The user can switch files while this is in flight: only the still-active document may
  // repaint #noteContent — its DOM belongs to whoever rendered last.
  if (fileKey(activeReadingFile()) !== key) return;
  const addedInFlight = _annotationsKey === key ? _annotations : [];
  _annotations = list.concat(addedInFlight);
  _annotationsKey = key;
  if (addedInFlight.length) await saveAnnotations();
  applyHighlights(noteContent, _annotations);
  renderNoteList();
}

// QA-M9: Save As gives a note a new key (a new document, or out of its folder), and its
// highlights and reading position stayed behind under the old one. They are copied, not
// moved: the original file is still on disk and keeps its own.
async function carryOverNoteData(oldKey, file) {
  const newKey = fileKey(file);
  if (!oldKey || !newKey || oldKey === newKey) return;
  const shelved = State.readingProgress.find((item) => item && item.key === oldKey);
  const ratio = shelved ? shelved.ratio : file.scrollRatio;
  const entry = typeof ratio === 'number' ? progressEntryFor(file, ratio, Date.now()) : null;
  if (entry && (shelved || ratio > 0)) {
    State.readingProgress = upsertProgress(State.readingProgress, entry);
    persistSettings();
  }
  const bridge = annotationsBridge();
  if (!bridge) return;
  const res = await bridge.annotationsGet(oldKey);
  const highlights = res && Array.isArray(res.highlights) ? res.highlights : [];
  if (highlights.length) await bridge.annotationsPut({ docKey: newKey, highlights });
}

// The longest highlight text or note the store accepts (MAX_TEXT in
// src/main/annotations-store.js). The store refuses the WHOLE list when one entry is
// longer, so an entry over the limit must never enter the list (audit M13).
const HIGHLIGHT_MAX_TEXT = 5000;

/** Persist the active document's whole list (the store replaces it atomically). */
function saveAnnotations() {
  const bridge = annotationsBridge();
  if (!bridge || !_annotationsKey) return Promise.resolve({ error: 'no-bridge' });
  return Promise.resolve(bridge.annotationsPut({ docKey: _annotationsKey, highlights: _annotations }))
    .then((res) => {
      if (res && res.error) showToast(tl('hl.saveFailed'), 'error');
      return res;
    })
    .catch(() => {
      showToast(tl('hl.saveFailed'), 'error');
      return { error: 'ipc-failed' };
    });
}

/** The applied <mark> for one highlight id, or null when it is not in the reading DOM. */
function highlightMark(id) {
  const wanted = String(id);
  for (const mark of noteContent.querySelectorAll('mark.user-hl')) {
    if (mark.getAttribute('data-hl-id') === wanted) return mark;
  }
  return null;
}

/** Inspector "Notes": one row per stored highlight (excerpt + when + delete). */
const marginNotes = createMarginNotes({
  doc: document,
  host: $('marginNotes'),
  getNotes: () => _annotations,
  getAnchorTop: (id) => {
    const mark = highlightMark(id);
    const pane = previewScroller();
    if (!mark || !pane) return null;
    return mark.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  },
  formatTime: (at) => relativeTime(at, State.uiLocale),
  removeLabel: () => tl('hl.remove'),
  toggleLabel: (expanded) => tl(expanded ? 'mn.collapse' : 'mn.expand'),
  onJump: (id) => scrollToHighlight(id),
  onRemove: (id) => { void removeHighlight(id); },
  onToggle: () => setMarginNotesCollapsed(!State.marginNotesCollapsed),
  onMarker: (id, forced) => {
    if (forced) { scrollToHighlight(id); return; } // no room to expand: jump to the passage
    setMarginNotesCollapsed(false);
    marginNotes.setActive(id);
  },
});

/** Returns false when the gutter beside the reading column is too narrow for `mode` ('cards' | 'markers'). */
function positionMarginHost(mode) {
  const host = $('marginNotes');
  const pane = previewScroller();
  if (!host || !pane) return false;
  const padStart = parseFloat(getComputedStyle($('editor')).paddingInlineStart) || 0;
  const gap = Math.max(10, padStart - 14) + 24;
  const rtl = getComputedStyle(noteContent).direction === 'rtl';
  const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return placeMarginHost({ host, pane, column: noteContent, gap, rootFontSize, rtl, mode });
}

function syncMarginNotes() {
  const hasNotes = State.viewMode === 'reading' && _annotations.length > 0;
  const pick = hasNotes
    ? pickMarginMode({ collapsed: State.marginNotesCollapsed, fits: positionMarginHost })
    : null;
  if (!pick) { marginNotes.clear(); return; }
  marginNotes.refresh(pick);
}

/** Fold the margin notes to gutter markers (or unfold them); saved with the other UI prefs. */
function setMarginNotesCollapsed(collapsed) {
  State.marginNotesCollapsed = !!collapsed; // persisted via the PERSISTED_KEYS subscription
  syncMarginNotes();
}

function renderNoteList() {
  if (!noteList) return;
  noteList.textContent = '';
  if (!_annotations.length) {
    const empty = document.createElement('div');
    empty.className = 'note-empty';
    empty.textContent = tl('notes.empty');
    noteList.appendChild(empty);
    syncMarginNotes();
    return;
  }
  for (const entry of _annotations) {
    const row = document.createElement('div');
    row.className = 'note-row';
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'note-jump';
    jump.setAttribute('dir', 'auto');
    jump.title = entry.text; // the full passage, since the row shows only an excerpt
    const text = document.createElement('span');
    text.className = 'n-text';
    text.textContent = noteExcerpt(entry.note || entry.text, 60);
    const time = document.createElement('span');
    time.className = 'n-time';
    time.textContent = relativeTime(entry.at, State.uiLocale);
    jump.append(text, time);
    jump.addEventListener('click', () => scrollToHighlight(entry.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'note-del';
    del.setAttribute('aria-label', tl('hl.remove'));
    del.title = tl('hl.remove');
    del.textContent = '×';
    del.addEventListener('click', () => { void removeHighlight(entry.id); });
    row.append(jump, del);
    noteList.appendChild(row);
  }
  syncMarginNotes();
}
if (typeof ResizeObserver === 'function') {
  const marginObserver = new ResizeObserver(() => syncMarginNotes());
  marginObserver.observe(previewScroller());
  marginObserver.observe(noteContent);
}

/** Jump to a stored highlight; entering Reading first when the CM6 surface is showing. */
function scrollToHighlight(id) {
  if (State.viewMode !== 'reading') setViewMode('reading'); // rebuilds the reading DOM
  applyHighlights(noteContent, _annotations);               // idempotent: the switch is async
  const mark = highlightMark(id);
  if (!mark) { showToast(tl('hl.notFound'), 'error'); return; }
  noteContent.querySelectorAll('mark.user-hl.on').forEach((m) => m.classList.remove('on'));
  mark.classList.add('on');
  marginNotes.setActive(id);
  const pane = previewScroller();
  if (!pane) return;
  const top = mark.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  pane.scrollTo({ top: Math.max(0, top - 24), behavior: reduceMotion ? 'auto' : 'smooth' });
}

/** Take one highlight's <mark> out of the reading DOM, leaving its text in place. */
function unwrapHighlightMark(id) {
  const mark = highlightMark(id);
  if (!mark || !mark.parentNode) return;
  const parent = mark.parentNode;
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
  parent.removeChild(mark);
  parent.normalize(); // rejoin the text nodes extractContents split
}

/** Undo of a delete (audit M15): put the highlight back where it was in the list. */
async function restoreHighlight(entry, index, docKey) {
  // Only into the document it came from, and only once.
  if (docKey !== _annotationsKey || _annotations.some((item) => item && item.id === entry.id)) return;
  const next = _annotations.slice();
  next.splice(Math.min(index, next.length), 0, entry);
  _annotations = next;
  applyHighlights(noteContent, [entry]);
  renderNoteList();
  const saved = await saveAnnotations();
  if (saved && saved.error && docKey === _annotationsKey) {
    _annotations = _annotations.filter((item) => item && item.id !== entry.id);
    unwrapHighlightMark(entry.id);
    renderNoteList();
  }
}

async function removeHighlight(id) {
  const before = _annotations;
  const docKey = _annotationsKey;
  const index = before.findIndex((entry) => entry && entry.id === id);
  _annotations = _annotations.filter((entry) => entry && entry.id !== id);
  unwrapHighlightMark(id);
  renderNoteList();
  const saved = await saveAnnotations();
  if (saved && saved.error) {
    // Not removed on disk (saveAnnotations has said so): show what is really stored.
    if (docKey === _annotationsKey) {
      _annotations = before;
      applyHighlights(noteContent, before.filter((entry) => entry && entry.id === id));
      renderNoteList();
    }
    return;
  }
  const removed = before.find((entry) => entry && entry.id === id);
  if (!removed) return;
  // One click deletes a highlight and its note, so the delete can be taken back.
  showToast(tl('hl.removed'), 'info', {
    label: tl('menu.undo'),
    onClick: () => { void restoreHighlight(removed, index, docKey); },
  });
}

/** The floating Highlight/Note bar (created once, reused). */
function ensureHighlightBar() {
  if (_hlBar) return _hlBar;
  const bar = document.createElement('div');
  bar.className = 'hl-popover';
  bar.id = 'hlBar';
  bar.hidden = true;
  const mk = (id) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    return button;
  };
  const highlightBtn = mk('hlBtn');
  const noteBtn = mk('hlNoteBtn');
  highlightBtn.addEventListener('click', () => { void addHighlight('highlight'); });
  noteBtn.addEventListener('click', () => { void addHighlight('note'); });
  // Keep the selection alive: a mousedown on the bar would otherwise collapse it before click.
  bar.addEventListener('mousedown', (event) => event.preventDefault());
  bar.append(highlightBtn, noteBtn);
  document.body.appendChild(bar);
  _hlBar = bar;
  return bar;
}

function showHighlightBar(rect) {
  const bar = ensureHighlightBar();
  $('hlBtn').textContent = tl('hl.highlight');   // labels re-read per show, so a locale switch sticks
  $('hlNoteBtn').textContent = tl('hl.note');
  bar.hidden = false;
  const width = bar.offsetWidth || 150;
  const left = Math.min(rect.left + window.scrollX, Math.max(8, window.innerWidth - width - 8));
  bar.style.left = `${Math.max(8, left)}px`;
  bar.style.top = `${rect.bottom + window.scrollY + 6}px`;
}

function hideHighlightBar() {
  _pendingSelection = null;
  if (_hlBar) _hlBar.hidden = true;
}

/** A selection that spans elements cannot be anchored in v1 — hint once, then stay quiet. */
function noteMultiNodeHint() {
  const now = Date.now();
  if (now - _multiNodeToastAt < 4000) return; // drag-selecting must not spam toasts
  _multiNodeToastAt = now;
  showToast(tl('hl.multiNode'), 'info');
}

function onNoteMouseUp() {
  if (State.viewMode !== 'reading') return; // highlights are a Reading-view affordance
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) { hideHighlightBar(); return; }
  const found = findSingleTextNodeSelection(noteContent, selection);
  if (found.error) {
    hideHighlightBar();
    if (found.error === 'multi-node') noteMultiNodeHint();
    return;
  }
  _pendingSelection = { ...found, docKey: fileKey(activeReadingFile()) }; // T10 BUG-2: remember WHICH document
  showHighlightBar(found.range.getBoundingClientRect());
}

/** The note prompt: the existing modal with one textarea. Resolves '' when cancelled. */
function askNoteText(excerpt) {
  const html = `
    <div class="dlg-body">
      <blockquote class="note-excerpt" dir="auto">${escapeHtml(noteExcerpt(excerpt, 160))}</blockquote>
      <textarea class="note-field" id="noteField" dir="auto" rows="4" maxlength="${HIGHLIGHT_MAX_TEXT}"
        placeholder="${escapeHtml(tl('hl.notePlaceholder'))}"></textarea>
    </div>
    <div class="dlg-actions">
      <button type="button" class="dlg-btn" id="noteCancelBtn">${escapeHtml(tl('dlg.cancel'))}</button>
      <button type="button" class="dlg-btn dlg-primary" id="noteSaveBtn">${escapeHtml(tl('dlg.save'))}</button>
    </div>`;
  return askModal(tl('hl.noteTitle'), html, {
    abandon: '',
    buttons: { noteSaveBtn: () => $('noteField').value, noteCancelBtn: '' },
    focus: 'noteField',
  });
}

/** Store the pending selection, optionally with a margin note. */
async function addHighlight(mode) {
  const found = _pendingSelection;
  hideHighlightBar();
  if (!found || !_annotationsKey) return;
  if (found.text.length > HIGHLIGHT_MAX_TEXT) {
    _pendingSelection = null;
    showToast(tl('hl.tooLong', { n: HIGHLIGHT_MAX_TEXT }), 'error');
    return;
  }
  let note = '';
  if (mode === 'note') {
    note = (await askNoteText(found.text)).trim().slice(0, HIGHLIGHT_MAX_TEXT);
    if (note === '') return; // cancelled (or left empty) — store nothing
  }
  // T10 (BUG-2) + T14 (post-review F3): the selection must still belong to the loaded
  // document when the button lands. The note modal can outlive its document (Ctrl+W/O/E
  // fire with it open), and the floating bar survives a file switch whenever the outgoing
  // pane never scrolls (scrollTop already 0 fires no scroll event) — so the Highlight
  // branch needs exactly the docKey guard the note branch had: compare against the key
  // captured at mouseup, not the live one loadAnnotations() has re-pointed, and discard a
  // selection from another document instead of filing (and re-anchoring) it there.
  if (found.docKey !== _annotationsKey) { _pendingSelection = null; return; }
  const entry = { id: newHighlightId(), text: found.text, note, at: Date.now(), anchor: found.anchor };
  _annotations = _annotations.concat([entry]);
  applyHighlights(noteContent, [entry]);
  renderNoteList();
  const saved = await saveAnnotations();
  if (saved && saved.error) {
    // Not stored (saveAnnotations has said so). Take it back out, or every later save of
    // this document would carry it, and "Highlight saved" would hide the failure.
    if (found.docKey === _annotationsKey) {
      _annotations = _annotations.filter((item) => item && item.id !== entry.id);
      unwrapHighlightMark(entry.id);
      renderNoteList();
    }
    return;
  }
  showToast(tl('hl.saved'), 'info');
}
testHooks._addHighlight = addHighlight;

// Dismiss the bar whenever the gesture that produced it is over: a click elsewhere, a
// scroll that moves the anchor, or Escape.
function initAnnotationUI() {
  noteContent.addEventListener('mouseup', onNoteMouseUp);
  document.addEventListener('mousedown', (event) => {
    if (_hlBar && _hlBar.contains(event.target)) return;
    hideHighlightBar();
  });
  previewScroller()?.addEventListener('scroll', hideHighlightBar, { passive: true });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideHighlightBar();
  });
}

// Outline click → jump to the visible surface: CM6 only in Edit mode, otherwise the preview.
function scrollToHeading(entry) {
  if (State.viewMode !== 'reading' && cmAdapter && entry) {
    // UX-03: re-resolve against the LIVE source on every click — a cached pos goes
    // stale the moment anything is typed above the heading, and the outline used to
    // jump to a pre-edit offset. The rendered heading's text is the stable identity.
    const want = entry.el ? _normHeading(entry.el.textContent) : null;
    // QA-L3: the second of two headings with the same text jumped to the first one. Take
    // the source heading with the same place among the headings of that text.
    const nth = _tocHeadings.slice(0, Math.max(0, _tocHeadings.indexOf(entry)))
      .filter((e) => e.el && _normHeading(e.el.textContent) === want).length;
    const same = want != null
      ? sourceHeadingPositions(cmAdapter.getValue()).filter((h) => _normHeading(h.text) === want)
      : [];
    const hit = same[nth] || same[0] || null;
    if (hit) entry.pos = hit.pos;
    const pos = hit ? hit.pos : entry.pos;
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
  // Reading mode (and a CM6 load failure) show the rendered preview pane.
  const wrap = previewScroller();
  if (!wrap || wrap._tocSyncWired) return;
  wrap._tocSyncWired = true;
  wrap.addEventListener('scroll', () => {
    if (!_tocHeadings.length) return;
    const wrapTop = wrap.getBoundingClientRect().top;
    const offsets = _tocHeadings.map(({ el }) => (el ? el.getBoundingClientRect().top - wrapTop + wrap.scrollTop : 0));
    const atBottom = wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 2;
    const idx = atBottom ? _tocHeadings.length - 1 : activeHeading(wrap.scrollTop, offsets);
    _tocHeadings.forEach(({ item }, i) => item.classList.toggle('active', i === idx));
  }, { passive: true });
}

// =====================================================================
// CODE COPY TRACK — one floating copy button follows the visible code block
// =====================================================================
// The reading scroller (.preview-pane) hosts a single absolutely-positioned
// copy button pinned in CONTENT coordinates, so it scrolls along with the
// current block for free; the scroll listener only decides WHICH block is
// current (same rect-math pattern as setupScrollSync above) and moves the
// button when that changes. Direction-agnostic: identical behavior scrolling
// up or down. Mermaid fences are excluded (diagrams, not commands).
let _codeCopyBtn = null;
let _codeTrackRaf = 0;
let _codeTrackCurrent = -2; // -2 = force the first position paint
let _codeCopiedTimer = 0;

function ensureCodeCopyButton(sc) {
  if (_codeCopyBtn) return _codeCopyBtn;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'codeCopyFloat';
  btn.className = 'code-copy-float';
  const label = tl('codeCopy.copy');
  btn.setAttribute('aria-label', label);
  btn.setAttribute('data-i18n-aria-label', 'codeCopy.copy');
  btn.setAttribute('data-tip', label);
  btn.setAttribute('data-i18n-tip', 'codeCopy.copy');
  // applyLocale restores English from these; without them it would cache `label`, which is
  // already in the current UI language (cf. updateFullscreenUi).
  btn.dataset.i18nTipOrig = tr('codeCopy.copy', 'en');
  btn.dataset.i18nAriaLabelOrig = tr('codeCopy.copy', 'en');
  btn.hidden = true;
  btn.appendChild(svgIcon('copy'));
  btn.addEventListener('click', async () => {
    const codes = State.viewMode === 'reading'
      ? Array.from(noteContent.querySelectorAll('pre > code:not(.language-mermaid)'))
      : [];
    const idx = Math.min(_codeTrackCurrent, codes.length - 1);
    if (idx < 0 || !codes[idx]) return;
    const source = codes[idx].textContent.replace(/\n+$/, '');
    try {
      await navigator.clipboard.writeText(source);
      showToast(tl('toast.codeCopied'));
      btn.classList.add('copied');
      clearTimeout(_codeCopiedTimer);
      _codeCopiedTimer = setTimeout(() => btn.classList.remove('copied'), 1200);
    } catch (_) {
      showToast(tl('toast.clipboardFailed'), 'error');
    }
  });
  sc.appendChild(btn);
  _codeCopyBtn = btn;
  return btn;
}

function scheduleCodeTrack() {
  if (_codeTrackRaf) return;
  _codeTrackRaf = requestAnimationFrame(() => { _codeTrackRaf = 0; updateCodeTrack(); });
}

function updateCodeTrack() {
  const sc = previewScroller();
  if (!sc) return;
  if (!sc._codeTrackWired) {
    sc._codeTrackWired = true;
    sc.addEventListener('scroll', scheduleCodeTrack, { passive: true });
    window.addEventListener('resize', scheduleCodeTrack, { passive: true });
  }
  const btn = ensureCodeCopyButton(sc);
  const codes = State.viewMode === 'reading'
    ? Array.from(noteContent.querySelectorAll('pre > code:not(.language-mermaid)'))
    : [];
  if (!codes.length || !sc.clientHeight) {
    btn.hidden = true;
    _codeTrackCurrent = -2;
    return;
  }
  const scRect = sc.getBoundingClientRect();
  const tops = codes.map((code) => {
    const pre = code.parentElement;
    // viewport-relative offset inside the pane + scrollTop = content coordinate.
    return pre.getBoundingClientRect().top - scRect.top + sc.scrollTop;
  });
  const idx = activeCodeBlock(tops.map((top) => ({ top })), sc.scrollTop, sc.clientHeight, sc.scrollHeight);
  if (idx < 0) {
    btn.hidden = true;
    _codeTrackCurrent = -2;
    return;
  }
  if (idx !== _codeTrackCurrent) {
    btn.style.top = `${Math.round(tops[idx])}px`;
    btn.dataset.current = String(idx);
    _codeTrackCurrent = idx;
  }
  btn.hidden = false;
}

// =====================================================================
// BLOCK DIRECTION — pin one block RTL or LTR (design-mock feature 1)
// =====================================================================
// One floating badge in the reading column's start margin follows the block under the
// pointer (or the keyboard focus), like the code-copy button above. It shows the block's
// direction (ع / A): dashed while the block is automatic, filled while it is pinned. A click
// opens a three-choice menu: right to left, left to right, or Auto (no pin). The pin is a
// `<!-- dir: … -->` line above the block in the note (block-direction.js), written through
// the editor so undo, the dirty dot and autosave follow. Ctrl+D flips without the menu.
let _dirBadge = null;
let _dirBadgeBlock = null;
let _dirMenu = null;
// Where the pointer was when a menu choice closed the menu: the pointer now rests over another
// block, and the badge stays on its own block until the pointer really moves.
let _dirHoldAt = null;

function hideDirBadge() {
  closeDirMenu();
  _dirBadgeBlock = null;
  if (_dirBadge) _dirBadge.hidden = true;
}

function ensureDirBadge(sc) {
  if (_dirBadge && _dirBadge.isConnected) return _dirBadge;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'dirBadge';
  btn.className = 'dir-badge';
  btn.hidden = true;
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', (e) => {
    if (dirMenuOpen()) closeDirMenu();
    else if (_dirBadgeBlock) openDirMenu(_dirBadgeBlock, e.detail === 0);
  });
  // Moving from the block onto the badge (or into its open menu) must not hide it.
  btn.addEventListener('mouseleave', (e) => {
    if (!noteContent.contains(e.relatedTarget) && !dirMenuOpen()) hideDirBadge();
  });
  sc.appendChild(btn);
  _dirBadge = btn;
  return btn;
}

/** The top-level block of the note that `node` is in, or null. */
function dirBlockOf(node) {
  const el = node instanceof Element ? node : node && node.parentElement;
  const block = el && el.closest('#noteContent [data-src-line]');
  return block && noteContent.contains(block) ? block : null;
}

const blockIsCode = (block) => block.matches('pre, .mermaid');
function blockDirection(block) {
  return block.getAttribute('dir') || block.querySelector('[dir]')?.getAttribute('dir') || State.direction || 'ltr';
}
const blockPin = (block) => block.getAttribute('data-pinned') || null;
const dirMenuOpen = () => !!(_dirMenu && !_dirMenu.hidden);

function showDirBadge(block) {
  const sc = previewScroller();
  if (!sc || State.viewMode !== 'reading' || !block) { hideDirBadge(); return; }
  const btn = ensureDirBadge(sc);
  _dirBadgeBlock = block;
  const code = blockIsCode(block);
  const pin = code ? null : blockPin(block);
  const dir = blockDirection(block);
  btn.textContent = code ? '{}' : (dir === 'rtl' ? 'ع' : 'A');
  btn.disabled = code;
  btn.classList.toggle('pinned', !!pin);
  btn.classList.toggle('is-rtl', !code && dir === 'rtl');
  btn.classList.toggle('is-code', code);
  const dirWord = tl(dir === 'rtl' ? 'blockDir.rtlWord' : 'blockDir.ltrWord');
  const label = code ? tl('blockDir.code') : tl(pin ? 'blockDir.statePinned' : 'blockDir.stateAuto', { dir: dirWord });
  btn.setAttribute('aria-label', label);
  btn.setAttribute('data-tip', label);
  // Content coordinates inside the scroller, on the interface's start side of the column.
  const scRect = sc.getBoundingClientRect();
  const rect = block.getBoundingClientRect();
  const column = noteContent.getBoundingClientRect();
  const uiRtl = document.documentElement.getAttribute('dir') === 'rtl';
  const gap = 8;
  const size = 26;
  const left = uiRtl ? column.right - scRect.left + gap : column.left - scRect.left - size - gap;
  btn.style.top = `${Math.round(rect.top - scRect.top + sc.scrollTop)}px`;
  btn.style.left = `${Math.round(Math.max(0, left) + sc.scrollLeft)}px`;
  btn.hidden = false;
}

// The badge menu's three states. `value` is the pin: null is Auto (no pin line).
const DIR_CHOICES = [
  { value: 'rtl', glyph: 'ع', key: 'blockDir.optRtl', tip: 'blockDir.pinRtl' },
  { value: 'ltr', glyph: 'A', key: 'blockDir.optLtr', tip: 'blockDir.pinLtr' },
  { value: null, glyph: '⇆', key: 'blockDir.optAuto', tip: 'blockDir.unpin' },
];

function ensureDirMenu(sc) {
  if (_dirMenu && _dirMenu.isConnected) return _dirMenu;
  const menu = document.createElement('div');
  menu.id = 'dirMenu';
  menu.className = 'dir-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  for (const choice of DIR_CHOICES) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dir-menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.dataset.dir = choice.value || 'auto';
    const glyph = document.createElement('span');
    glyph.className = 'dir-menu-glyph';
    glyph.textContent = choice.glyph;
    const name = document.createElement('span');
    name.className = 'dir-menu-name';
    item.append(glyph, name);
    item.addEventListener('click', (e) => {
      const block = _dirBadgeBlock;
      _dirHoldAt = e.detail ? { x: e.clientX, y: e.clientY } : null;
      closeDirMenu();
      if (block) setBlockPin(block, choice.value);
    });
    menu.appendChild(item);
  }
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('.dir-menu-item')];
    const at = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDirMenu(true); }
    else if (e.key === 'Tab') closeDirMenu();
  });
  menu.addEventListener('mouseleave', (e) => {
    if (!noteContent.contains(e.relatedTarget) && e.relatedTarget !== _dirBadge) hideDirBadge();
  });
  sc.appendChild(menu);
  _dirMenu = menu;
  return menu;
}

/** The badge's menu for `block`: the three states, the current one checked. */
function openDirMenu(block, fromKeyboard = false) {
  const sc = previewScroller();
  if (!sc || !_dirBadge || blockIsCode(block)) return;
  const menu = ensureDirMenu(sc);
  menu.setAttribute('aria-label', tl('blockDir.menu'));
  const pin = blockPin(block);
  const items = menu.querySelectorAll('.dir-menu-item');
  DIR_CHOICES.forEach((choice, i) => {
    const item = items.item(i);
    const checked = choice.value === pin;
    item.setAttribute('aria-checked', String(checked));
    item.classList.toggle('checked', checked);
    item.querySelector('.dir-menu-name').textContent = tl(choice.key);
    item.setAttribute('data-tip', tl(choice.tip));
  });
  // Below the badge, aligned on the badge's start edge.
  menu.hidden = false;
  const top = parseFloat(_dirBadge.style.top) || 0;
  const left = parseFloat(_dirBadge.style.left) || 0;
  const uiRtl = document.documentElement.getAttribute('dir') === 'rtl';
  const x = uiRtl ? left + _dirBadge.offsetWidth - menu.offsetWidth : left;
  menu.style.top = `${Math.round(top + _dirBadge.offsetHeight + 4)}px`;
  menu.style.left = `${Math.round(Math.max(0, x))}px`;
  _dirBadge.setAttribute('aria-expanded', 'true');
  if (fromKeyboard) (menu.querySelector('.dir-menu-item.checked') || menu.querySelector('.dir-menu-item')).focus();
}

function closeDirMenu(restoreFocus = false) {
  if (!dirMenuOpen()) return;
  _dirMenu.hidden = true;
  if (!_dirBadge) return;
  _dirBadge.setAttribute('aria-expanded', 'false');
  if (restoreFocus && _dirBadge.isConnected && !_dirBadge.hidden) _dirBadge.focus();
}
document.addEventListener('click', (e) => {
  if (dirMenuOpen() && !_dirMenu.contains(e.target) && !(_dirBadge && _dirBadge.contains(e.target))) closeDirMenu();
});

noteContent.addEventListener('mouseover', (e) => {
  if (State.viewMode !== 'reading' || dirMenuOpen()) return; // an open menu keeps its block
  if (_dirHoldAt && e.clientX === _dirHoldAt.x && e.clientY === _dirHoldAt.y) return;
  _dirHoldAt = null;
  const block = dirBlockOf(e.target);
  if (block && block !== _dirBadgeBlock) showDirBadge(block);
});
noteContent.addEventListener('focusin', (e) => {
  if (State.viewMode === 'reading' && !dirMenuOpen()) showDirBadge(dirBlockOf(e.target));
});

/** How many lines the front matter takes: the rendered body's lines start after it. */
function frontMatterLines(content) {
  const text = content || '';
  const { body } = parseFrontMatter(text);
  const head = text.slice(0, text.length - body.length);
  return (head.match(/\n/g) || []).length;
}

function noteSourceText() {
  return cmAdapter ? cmAdapter.getValue() : (State.files[State.activeFile]?.content || '');
}

function applyPinEdit(edit) {
  if (!edit || !editorReady()) return null;
  cmAdapter.replaceRange(edit.from, edit.to, edit.insert);
  showToast(edit.dir ? tl(edit.dir === 'rtl' ? 'blockDir.pinnedRtl' : 'blockDir.pinnedLtr') : tl('blockDir.auto'));
  return edit;
}

function applyFlip(line, currentDir) {
  return applyPinEdit(flipEdit(noteSourceText(), line, currentDir === 'rtl' ? 'ltr' : 'rtl'));
}

/** The note line (0-based, front matter included) a rendered block starts on, or null. */
function blockSourceLine(block) {
  const f = State.files[State.activeFile];
  if (!f || !block || !block.isConnected || blockIsCode(block)) return null;
  const line = Number(block.getAttribute('data-src-line')) + frontMatterLines(noteSourceText());
  return Number.isInteger(line) ? line : null;
}

// Render now instead of after the typing debounce, and keep the badge on the block: a pin line
// added above it moved it down `shift` lines, a removed one moved it up.
function rerenderKeepingBadge(block, shift) {
  const moved = Number(block.getAttribute('data-src-line')) + shift;
  clearTimeout(_srcDebounce);
  renderReadingContent();
  const again = noteContent.querySelector(`[data-src-line="${moved}"]`);
  if (again) showDirBadge(again);
}

/** Reading view: flip the pin of a rendered block (Ctrl+D). */
function flipBlock(block) {
  if (block && block.isConnected && blockIsCode(block)) { showToast(tl('blockDir.code'), 'info'); return; }
  const line = blockSourceLine(block);
  if (line === null) return;
  const edit = applyFlip(line, blockDirection(block));
  if (edit) rerenderKeepingBadge(block, edit.dir ? 1 : -1);
}

/** Reading view: the badge menu's choice for a block, 'rtl' | 'ltr' | null (Auto). */
function setBlockPin(block, dir) {
  const line = blockSourceLine(block);
  if (line === null) return;
  const edit = applyPinEdit(pinEdit(noteSourceText(), line, dir));
  if (edit) rerenderKeepingBadge(block, edit.shift);
}

/** Edit mode: the block under the caret — its lines up to a blank line or a pin line above. */
function caretBlockLine(text, caret) {
  const lines = text.split('\n');
  let line = text.slice(0, caret).split('\n').length - 1;
  const here = lines.at(line);
  if (here !== undefined && markerDirection(here)) line++; // on the pin line itself
  while (line > 0 && lines[line - 1].trim() !== '' && !markerDirection(lines[line - 1])) line--;
  return { line, text: lines.slice(line).join('\n').split(/\n\s*\n/)[0] };
}

function flipCurrentBlock() {
  const f = State.files[State.activeFile];
  if (!f) { showToast(tl('blockDir.noNote'), 'error'); return; }
  if (State.viewMode === 'reading') {
    let block = _dirBadgeBlock && _dirBadgeBlock.isConnected ? _dirBadgeBlock : null;
    if (!block) {
      const sc = previewScroller();
      const top = sc ? sc.getBoundingClientRect().top : 0;
      block = [...noteContent.querySelectorAll('[data-src-line]')].find((el) => el.getBoundingClientRect().bottom > top) || null;
    }
    if (block) flipBlock(block);
    return;
  }
  if (!editorReady()) return;
  const text = noteSourceText();
  const { line, text: blockText } = caretBlockLine(text, cmAdapter.getSelection().start);
  const { data } = parseFrontMatter(text);
  const current = State.forcedDir || frontMatterDirection(data) || resolveBlockDirection(blockText, State.direction || 'ltr');
  applyFlip(line, current);
}

function resetBlockDirections() {
  const f = State.files[State.activeFile];
  if (!f) { showToast(tl('blockDir.noNote'), 'error'); return; }
  const text = noteSourceText();
  const ranges = markerRanges(text);
  if (!ranges.length) { showToast(tl('blockDir.noneToReset'), 'info'); return; }
  if (!editorReady()) return;
  const removed = ranges.length;
  // One edit for the whole note: a single undo brings every pin back.
  cmAdapter.applyChanges(ranges.map(({ from, to }) => ({ from, to, insert: '' })));
  if (State.viewMode === 'reading') { clearTimeout(_srcDebounce); renderReadingContent(); }
  showToast(tl('blockDir.resetDone', { n: removed }));
}
testHooks.flipCurrentBlock = flipCurrentBlock;
testHooks.resetBlockDirections = resetBlockDirections;

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

// audit PERF-06: warm the search index in idle chunks after the tree settles, so the
// first real query doesn't pay the whole toLowerCase pass on the UI thread.
let _warmTimer = null;
let _warmGen = 0;
function scheduleSearchWarm() {
  _warmGen += 1;
  const gen = _warmGen;
  clearTimeout(_warmTimer);
  _warmTimer = setTimeout(() => {
    const files = State.files;
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 40));
    const step = (from) => {
      if (gen !== _warmGen || from >= files.length) return;
      warmSearchIndexSlice(files, from, from + 128);
      idle(() => step(from + 128));
    };
    step(0);
  }, 400);
}

// Build a nested, collapsible folder tree from State.files (T-F1/M3, forest since B4).
// Vault-scoped files group into one named root per open folder (buildForest); loose
// files fold into the @loose pseudo-root. Each row is indented by depth; dir/root rows
// toggle (click / Enter / Space / Arrow), file rows open, and a non-loose root row also
// closes (× button or Delete/Backspace) via workspaceController.closeVault. State.files
// index travels as fileIdx (assigned by ORIGINAL position, before grouping) so
// highlightTreeActive + open still work regardless of which group a file lands in.
function renderTree(entries) {
  // QA M15: keep keyboard focus on the same row across the rebuild (expand, collapse, open).
  const focusKey = treeEl.contains(document.activeElement) ? document.activeElement.closest('[role="treeitem"]')?.dataset.treeKey : null;
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

  const fileCounts = treeFileCounts(forest);
  flattenTree(forest, collapsed).forEach(row => {
    const node = document.createElement('div');
    node.setAttribute('role', 'treeitem');
    node.setAttribute('tabindex', treeEl.childElementCount === 0 ? '0' : '-1');
    node.setAttribute('aria-label', row.name);
    node.dataset.treeKey = row.type === 'dir' || row.type === 'root' ? row.path : `file:${row.fileIdx}`;
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
    // Dir and root rows: click / Enter / Space toggle, the arrows open and close. v1.2: under
    // the RTL chrome the hierarchy mirrors, so the arrows flip too (WAI-ARIA treeview: Right
    // always means "into", Left "out of"). `onOtherKey` sees every other key.
    const wireToggle = (onOtherKey) => {
      const setOpen = (open) => {
        if (open === !collapsed.has(row.path)) return; // no change
        if (open) collapsed.delete(row.path); else collapsed.add(row.path);
        saveTreeCollapsed(); renderTree(entries);
      };
      node.addEventListener('click', (e) => {
        if (e.target.closest('.tree-root-close')) return; // the close button handles its own click
        setOpen(collapsed.has(row.path));
      });
      node.addEventListener('keydown', e => {
        if (moveFocus(e)) return;
        const rtl = document.documentElement.dir === 'rtl';
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(collapsed.has(row.path)); }
        else if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) { e.preventDefault(); setOpen(true); }
        else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) { e.preventDefault(); setOpen(false); }
        else if (onOtherKey) onOtherKey(e);
      });
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
      node.innerHTML = `<span class="tree-twisty">▾</span>${nameHtml}<i class="tree-rule"></i><span class="tree-count">${fileCounts.get(row.path) || 0}</span>`;
      wireToggle(null);
    } else if (row.type === 'root') {
      // B4: a named folder root behaves like a dir (click/Enter/Space/Arrow toggle) but
      // also owns a close affordance — except the @loose pseudo-root, which has no
      // folder to close, only individual tabs.
      const isLoose = row.id === LOOSE_ROOT_ID;
      const isCollapsed = collapsed.has(row.path);
      node.className = `tree-node tree-root${indentClass}`;
      node.setAttribute('aria-expanded', String(!isCollapsed));
      const rootCount = fileCounts.get(row.path) || 0;
      node.innerHTML = `<span class="tree-twisty">▾</span>${nameHtml}<span class="tree-count">${escapeHtml(tl('lib.noteCount', { n: rootCount }))}</span>`;
      wireToggle(isLoose ? null : (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); workspaceController.closeVault(row.id); }
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
      const treeFile = State.files.at(row.fileIdx);
      const meta = treeFile && treeFile.content ? fileMeta(treeFile) : null;
      const ratio = treeFile ? shelfRatio(State.readingProgress, fileKey(treeFile)) : 0;
      node.dataset.d = meta ? meta.dir : 'ltr';
      const percent = ratio > 0 ? ` · <bdi dir="ltr">${Math.round(ratio * 100)}%</bdi>` : '';
      const metaHtml = meta ? `<span class="tree-meta">${escapeHtml(tl('doc.readTime', { n: meta.minutes }))}${percent}</span>` : '';
      node.innerHTML = `<i class="tree-tick"></i><span class="tree-text">${nameHtml}${metaHtml}</span>${ratio > 0 ? '<span class="tree-prog"><i></i></span>' : ''}`;
      if (ratio > 0) node.style.setProperty('--p', ratio.toFixed(2));
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
  scheduleSearchWarm();
  highlightTreeActive(); // re-mark the active file: this in-tree rebuild (folder toggle) would otherwise drop it (F1/M3)
  const refocus = focusKey != null && [...treeEl.querySelectorAll('[role="treeitem"]')].find((n) => n.dataset.treeKey === focusKey);
  if (refocus) {
    treeEl.querySelectorAll('[role="treeitem"]').forEach((n) => { n.tabIndex = n === refocus ? 0 : -1; });
    refocus.focus();
  }
}

async function openFromTree(idx) {
  const f = State.files[idx];
  if (f.handle && !f.content) {
    try { const file = await f.handle.getFile(); f.content = await file.text(); }
    catch(_) { showToast(tl('toast.fileReadFailed'), 'error'); return; }
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
    // DOM-built (not innerHTML) so the localized empty state adds no new unsanitized sink.
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = tl('tags.empty');
    tagsPane.replaceChildren(empty);
    return;
  }
  tagsPane.textContent = '';
  const cloud = document.createElement('div');
  cloud.className = 'tag-cloud';
  const maxTagFiles = tags[0][1].length;
  const minTagFiles = tags[tags.length - 1][1].length;
  tags.forEach(([tag, files]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tag';
    button.dataset.tag = tag;
    const tagScale = maxTagFiles === minTagFiles ? 0.4 : (files.length - minTagFiles) / (maxTagFiles - minTagFiles);
    button.style.setProperty('--s', tagScale.toFixed(2));
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

function searchLibrary(text) {
  if (!State.sidebarVisible) toggleSidebar();
  switchSbPane('search');
  $('sbSearchInput').value = text;
  runSidebarSearch(text);
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
    // The demo notes name a folder (State.vaultName) without opening one (APP-33).
    status.textContent = State.vaultName ? tl('status.folder', { name: State.vaultName }) : tl('status.noFolder');
    status.removeAttribute('data-tip');
  } else if (vaults.length === 1) {
    status.textContent = tl('status.folder', { name: vaults[0].name });
    status.removeAttribute('data-tip');
  } else {
    status.textContent = tl('status.folders', { n: vaults.length });
    status.dataset.tip = vaults.map((v) => v.name).join(', ');
  }
}

// A save or a reload moved the note on screen into another size tier (large-file mode on or off):
// the editor's extensions are fixed when its state is made, so the note is shown again. The caret
// stays where it was (this can happen while the reader types, on an autosave).
function rebuildForTier(file) {
  const idx = State.files.indexOf(file);
  if (idx < 0 || idx !== State.activeFile) return; // a note off screen is built when it is shown
  const selection = cmAdapter ? cmAdapter.getSelection() : null;
  renderFile(idx);
  if (selection && cmAdapter && State.viewMode !== 'reading') {
    cmAdapter.setSelection({ start: selection.start, end: selection.end }, { scroll: true });
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
  // v1.2: the old pass-through to native confirm() is gone — the controller's discard
  // prompts now get the themed Word-style dialog. Save-all must succeed for the
  // destructive action to proceed; a canceled Save As keeps the workspace open.
  confirmDiscard: async (_message, files) => {
    const dirty = (Array.isArray(files) ? files : State.files).filter((f) => f.dirty);
    // QA M4: one dirty note is named ("save the changes to “”?" before), and "Save" saves
    // only the notes this prompt is about.
    const choice = await askSaveChanges(dirty.length === 1 ? { name: dirty[0].name } : { count: dirty.length });
    return resolveCloseChoice(choice, dirty);
  },
  confirmEncodingUpgrade: (info) => askEncodingUpgrade(info),
  confirmLargeOpen: (info) => askLargeOpen(info),
  onNoteTierChange: rebuildForTier,
  carryOverNoteData,
  addFile,
  renderFile,
  renderTree,
  renderTabs,
  setVaultUi,
  tmsg: (key, vars) => tl(key, vars),
  getElement: $,
});
const {
  openVault,
  openSingleFile,
  saveCurrent,
  saveAs,
  saveAllDirty,
  pushRecent,
  renderRecents,
  renderContinue,
  openRecent,
  openExternalFile,
  handleVaultChanged,
  markUserIntent,
} = workspaceController;
testHooks.openVault = openVault;
testHooks.openSingleFile = openSingleFile;
testHooks.saveCurrent = saveCurrent;
testHooks.saveAllDirty = saveAllDirty;
testHooks.openRecent = openRecent;
testHooks.openExternalFile = openExternalFile;
testHooks.handleVaultChanged = handleVaultChanged;


// v1.3.0: dropped/picked files carry no path, so encoding detection must run on the
// BYTES. Main's document-store detector (UTF-8 / UTF-16 ±BOM / Windows-1256) is the
// same one picker-opened files get — without it a legacy-encoded note opened as
// mojibake and a Save As over the original wrote that mojibake back permanently.
// Browser lane (no bridge) keeps the plain UTF-8 read.
async function readFileBytesDecoded(file) {
  if (window.electronAPI && typeof window.electronAPI.decodeBytes === 'function') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const decoded = await window.electronAPI.decodeBytes(bytes);
    if (decoded && decoded.ok && typeof decoded.text === 'string') return decoded;
    throw new Error((decoded && decoded.error) || 'decode-failed');
  }
  return { text: await file.text(), meta: undefined };
}

// The picker and drop lanes hold a File, not a path, so the size is known before any byte is
// read. Same tiers as the path lanes (large-file.js): over the limit is refused here so no
// multi-hundred-MB buffer is built (main refuses it again, UI-02), a HUGE note asks first.
// Resolves true when the note was added.
async function loadLooseFile(file) {
  const tier = noteTier(file.size);
  if (tier === TIER.REFUSED) {
    showToast(tl('toast.skippedSize', { name: file.name, limit: limitMb(getLimits().maxFileBytes) }), 'error');
    return false;
  }
  if (tier === TIER.HUGE && !(await askLargeOpen({ name: file.name, size: file.size }))) return false;
  try {
    const decoded = await readFileBytesDecoded(file);
    const name = looseDropName(file.name, decoded.text);
    addFile({ name, path: name, handle: null, content: decoded.text, dirty: false, meta: decoded.meta, sizeBytes: file.size, largeTier: tier });
    return true;
  } catch {
    showToast(tl('toast.couldNotRead', { name: file.name }), 'error');
    return false;
  }
}
fileInput.addEventListener('change', async () => {
  let toldLarge = false;
  for (const file of fileInput.files) {
    if (await loadLooseFile(file) && noteTier(file.size) >= TIER.LARGE) toldLarge = true;
  }
  if (fileInput.files.length > 0 && !toldLarge) showToast(tl('toast.openedNFiles', { n: fileInput.files.length }));
  fileInput.value = '';
});

// QA DROP: a dropped file has no real path, only its name. Two different files with one name
// (notes.md from two folders) used to share one tab, a false conflict and one set of
// highlights. A different text gets its own name, "notes (2).md"; the same text reuses the tab.
function looseDropName(name, text) {
  const looseAt = (n) => State.files.find((x) => !x.vaultId && !x.documentId && x.path === n);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`;
    const open = looseAt(candidate);
    if (!open || (open.content || '') === text) return candidate;
  }
}

function addFile(f) {
  if (!Number.isInteger(f.revision)) f.revision = 0;
  if (!f.dirty && typeof f.savedContent !== 'string') f.savedContent = f.content; // clean on arrival: the text is the saved baseline
  // B4: dedupe by fileKey (doc capability > vault-scoped path > bare path), not a bare
  // name+path pair — two open folders sharing a relative path (both have notes/todo.md)
  // must never overwrite each other's entry just because a new loose file coincidentally
  // shares that path.
  const key = fileKey(f);
  const existing = key ? State.files.findIndex(x => fileKey(x) === key) : -1;
  if (existing >= 0) {
    const cur = State.files[existing];
    const sameContent = (cur.content || '') === (f.content || '');
    if (cur.dirty && !sameContent) {
      // v1.2: re-opening a note that is ALREADY open with unsaved edits used to replace
      // the in-memory version with the disk copy unconditionally — double-clicking an
      // open note in Explorer silently destroyed the user's edits. Keep their version
      // and surface the standard conflict banner (Keep my edits / Reload from disk).
      cur.conflict = true;
      cur.diskContent = f.content;
      cur.diskMeta = f.meta || null;
      cur.diskSize = f.sizeBytes;
      renderTree(State.files);
      renderFile(existing);
      showToast(tl('toast.reopenedConflict', { name: f.name }), 'info');
      return;
    }
    State.files[existing] = f;
    renderTree(State.files);
    renderFile(existing);
  }
  else { State.files.push(f); renderTree(State.files); renderFile(State.files.length - 1); }
  reportDirtyCount();
}

function newNote() {
  closeMenu();
  markUserIntent();
  const name = nextUntitledName(State.files.map((f) => f.name), tl('file.untitled')); // first free name (audit H10); QA-L2: in the interface language
  // v1.2.2: a pristine note starts EMPTY and clean. The old scaffold (`# Untitled\n\n
  // Start writing…`) was real document content, so saving an untouched note wrote the
  // placeholder text to disk. The visible "Start writing…" is now a DOM-only hint
  // (syncEditorEmptyHint), and dirty:false means closing an untouched note needs no
  // Save prompt — the first keystroke marks it dirty via applyEditorInput.
  addFile({ name, path: name, handle: null, content: '', dirty: false });
}
testHooks.newNote = newNote;


// =====================================================================
// WIKILINKS
// =====================================================================
function navWikilink(target) {
  // RTL-M4: accept the Obsidian-style explicit extension ([[note.md]] resolves to note),
  // and fold Arabic on both sides — search surfaces normalize tashkeel, so a link written
  // with different vocalization than the file name must still find the open note.
  const t = normalizeArabic(String(target || '').toLowerCase().replace(/\.md$/i, ''));
  const matches = (f) => {
    const n = normalizeArabic(f.name.replace(/\.md$/, '').toLowerCase());
    return n === t || n === t.replace(/-/g, ' ');
  };
  // audit UX-14c: prefer a candidate in the ACTIVE file's own vault — two open folders can
  // both hold `index.md`, and the first global match used to win regardless of which note
  // the link was written in. Falls back to the global first match (loose/demo files have no
  // vault, and a link may legitimately point at another open folder).
  const active = State.activeFile != null ? State.files[State.activeFile] : null;
  let idx = -1;
  if (active && active.vaultId) idx = State.files.findIndex((f) => f.vaultId === active.vaultId && matches(f));
  if (idx < 0) idx = State.files.findIndex(matches);
  if (idx >= 0) renderFile(idx);
  else showToast(tl('toast.noNoteFound', { target }), 'error');
}

// =====================================================================
// DEMO
// =====================================================================
// QA-M8 (decision D10): the demo notes are added beside what is open. Load Demo used to close
// every folder and replace the saved folder session, so the folders were gone after a relaunch.
async function loadDemo() {
  closeMenu();
  markUserIntent();
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
  // A demo note that is already open (perhaps edited) is kept as it is, never replaced.
  const openAt = (demo) => State.files.findIndex((f) => fileKey(f) === fileKey(demo));
  for (const demo of demos) {
    const at = openAt(demo);
    if (at < 0) { State.files.push({ ...demo, revision: 0, savedContent: demo.content }); continue; }
    State.files[at].open = true;
  }
  if (!workspaceController.getOpenVaults().length) {
    State.vaultName = 'demo';
    setVaultUi();
  }
  renderTree(State.files);
  renderFile(openAt(demos[0]));
  showToast(tl('toast.demoLoaded'));
}
testHooks.loadDemo = loadDemo;

// =====================================================================
// v1.2.2: the "Start writing…" affordance is a DOM overlay, never document content.
// Toggled from the two places the active document's text is known: renderFile (load /
// switch / create) and applyEditorInput (every keystroke, so deleting all text brings
// it back). Text comes from the locale catalog (editor.emptyHint), so it follows the
// UI language — something the old in-document scaffold never could.
function syncEditorEmptyHint(content) {
  editorArea.classList.toggle('doc-empty', (content || '') === '');
}

// =====================================================================
// EDITOR INPUT
// =====================================================================
let _srcDebounce = null;
// ln/col status readout for a caret that moved WITHOUT an edit (click, arrows, selection).
// Edits update it in applyEditorInput; this covers the rest. No-op while no note is open.
function updateCursorReadout() {
  if (!cmAdapter || cmLoading || State.activeFile === null || !State.files[State.activeFile]) return;
  const { line, col } = cmAdapter.lineAt(cmAdapter.getSelection().start);
  $('cursorPos').textContent = tl('status.lnCol', { l: line, c: col });
}
// Apply an edit from the CodeMirror editor (T-F13). `val` is the full doc text, `pos` the
// caret offset.
function applyEditorInput(val, pos, target = null) {
  if (State.activeFile === null || !State.files[State.activeFile]) return;
  // `target` is the note a deferred (large-file mode) change belongs to; it can differ from the
  // active note when the text is handed over late. Everything else belongs to the active note.
  const f = target || State.files[State.activeFile];
  applyEdit(f, val); // content + dirty vs the saved baseline (undo back to saved text clears the dot)
  f.revision = (Number.isInteger(f.revision) ? f.revision : 0) + 1;
  f._editedAt = Date.now();
  if (f === State.files[State.activeFile]) syncEditorEmptyHint(val);
  updateTabState(State.files.indexOf(f));
  // Fast: cursor position update on every keystroke. audit PERF-08: ask the editor for
  // {line, col} (an O(log n) line-index lookup) instead of copying the whole document and
  // splitting it.
  if (cmAdapter) {
    const { line, col } = cmAdapter.lineAt(pos);
    $('cursorPos').textContent = tl('status.lnCol', { l: line, c: col });
  }
  // Heavy: markdown render debounced at 150ms
  clearTimeout(_srcDebounce);
  _srcDebounce = setTimeout(() => {
    // Bail if the user switched files during the debounce: this closure captured `f`, and
    // #noteContent / the outline are SHARED globals — rendering the now-inactive file here
    // would clobber the active file's display + outline with stale content (the "content not
    // transferred to display" / wrong-outline bug). renderFile already rendered the new file.
    if (State.activeFile === null || State.files[State.activeFile] !== f) return;
    const body0 = parseFrontMatter(f.content).body; // T-R6: keep front matter out of the body
    if (f._lastRenderedSource === body0) return;    // nothing changed since the last render (audit PERF-01)
    // QA-M16: in Edit mode the reading pane is hidden, and re-rendering a large note there
    // after every pause in typing froze the window for seconds. Only the cheap parts run:
    // counts and an outline read from the source. Switching to Reading renders the note.
    if (cmAdapter && (previewDeferred(f) || (State.viewMode !== 'reading' && body0.length > LARGE_EDIT_NOTE_CHARS))) {
      showWordCounts(bodyWordCount(body0));
      syncInspector();
      buildDeferredToc(f);
      return;
    }
    const body = body0;
    const bodyNodes = noteBodyNodes(body);
    const wordCount = bodyWordCount(body);
    renderNoteBody(f, bodyNodes, wordCount);
    showWordCounts(wordCount);
    syncInspector();
    // UX-03: rebuild on EVERY source change — CM6 offsets shift with any edit above a
    // heading, and the old heading-text-only gate left _tocHeadings positions stale
    // (outline clicks landed mid-paragraph; the scroll-sync highlight drifted).
    buildTOC();
    f._lastRenderedSource = body;
  }, 150);
}
// ── T-F13: CodeMirror 6 is the ONE and ONLY editor — a single live-preview surface mounted
// on launch. There is no second editor: if the CM6 bundle fails to load, notes still open
// in the rendered view, and every edit says the editor is unavailable. cmAdapter conforms
// to EditorPort. ──
let cmAdapter = null;   // non-null ⇒ CodeMirror is mounted
let cmLoading = false;  // suppress onChange while we load a doc programmatically
let _cmPromise = null;
// audit QA-08: one user-visible + one logged report per session for a CM6 load failure.
// `logError` takes an OBJECT (main's log:error handler ignores anything else — see
// ipc-controller.js), hence the same shape app.js's own error capture uses.
let _cm6FailureReported = false;
function reportCm6Unavailable() {
  if (_cm6FailureReported) return;
  _cm6FailureReported = true;
  try { window.electronAPI?.logError?.({ message: 'cm6-load-failed', kind: 'cm6' }); } catch (_) { /* never crash reporting */ }
  showToast(tl('toast.cm6Failed'), 'error');
}
// Every edit asks this first. False while the editor is not mounted: before CM6 has loaded
// (silently), or after it failed to (the failure notice again).
function editorReady() {
  if (cmAdapter) return true;
  if (_cm6FailureReported) showToast(tl('toast.cm6Failed'), 'error');
  return false;
}
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
// RTL-H4: the SAME forced direction applyBidiToNote uses — manual ⇄ first, then the note's
// front-matter `direction:` — so a `direction: rtl` table renders RTL in the EDITOR widgets
// too, not only in the reading pane.
function cmForcedDir() {
  if (State.forcedDir) return State.forcedDir;
  const file = State.activeFile !== null ? State.files[State.activeFile] : null;
  if (!file) return null;
  const { data } = parseFrontMatter(file.content || '');
  return frontMatterDirection(data);
}
function renderCmBlock(type, source) {
  if (type === 'table') {
    const el = document.createElement('div');
    el.innerHTML = parseMarkdown(source);
    decorateBlockContent(el); // highlight code + render KaTeX inside cells (F9 parity)
    applyBidi(el, { baseDir: State.direction === 'rtl' ? 'rtl' : 'ltr', escape: escapeHtml, forceDir: cmForcedDir() });
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
      .then((mermaid) => renderMermaid(el, { mermaid, sanitize: (svg) => sanitizeSvg(svg, DOMPurify), idPrefix: `cmmmd-${_mmdSeq++}`, errorText: tl('mermaid.failed') }))
      .catch(() => { /* engine failed to load — the code block stays as the fallback */ });
    return el;
  }
  if (type === 'callout') {
    const el = document.createElement('div');
    el.innerHTML = parseMarkdown(source);
    transformCallouts(el, { parseCalloutHeader, resolveDirection: resolveBlockDirection }); // > [!NOTE] → styled callout (F14)
    decorateBlockContent(el); // highlight code + render KaTeX inside the callout body (F9 parity)
    applyBidi(el, { baseDir: State.direction === 'rtl' ? 'rtl' : 'ltr', escape: escapeHtml, forceDir: cmForcedDir() });
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
  // T-F13: CM6 is the ONE and ONLY editor — mount it unconditionally on launch.
  if (cmAdapter) return false;
  let CM6;
  try { CM6 = await loadCM6(); } catch (_) {
    // audit QA-08: say so, and log it locally. Notes stay readable in the rendered view.
    reportCm6Unavailable();
    return false;
  }
  const pane = document.querySelector('.source-pane');
  if (!pane) return false;
  const mount = document.createElement('div');
  mount.className = 'cm-mount';
  pane.appendChild(mount);
  const active = (State.activeFile != null && State.files[State.activeFile]) ? State.files[State.activeFile] : null;
  cmAdapter = createCodeMirrorAdapter(mount, {
    CM6,
    doc: active ? active.content : '',
    largeMode: inLargeMode(active),
    dir: State.direction === 'rtl' ? 'rtl' : 'ltr',
    forceDir: State.forcedDir, // honor a forced direction chosen before the editor mounts
    onChange: (val) => { if (!cmLoading) applyEditorInput(val, cmAdapter.getSelection().start, inLargeMode(editorOwner) ? editorOwner : null); },
    onDeferredChange: markDeferredEdit,
    renderBlock: renderCmBlock, // T-F13: inline block rendering (tables…) in the single CM6 surface
    renderMath: renderCmMath,   // T-F13 × F9: inline KaTeX rendering in the single CM6 surface
    onWikilink: navWikilink,    // R09: clicking a rendered [[wikilink]] in the editor navigates
    onSelectionChange: () => { updateToolbarActiveState(); updateCursorReadout(); }, // toolbar state + ln/col follow the caret
    onTab: tableTab,            // Tab/Shift-Tab navigate table cells when inside a table
  });
  // T-F13: collapse to the single CM6 live-preview surface (CSS shows the source pane and
  // hides the redundant markdown preview pane). Added ONLY after a successful mount, so a
  // CM6 load failure leaves the rendered note in view.
  if (active) claimEditorOwner(active);
  editorArea.classList.add('cm-single');
  toolbarStrip.classList.add('cm-single');
  // CM6 mounts async + unawaited at startup, so a file may already be open (its outline built
  // with no editor positions + scroll-sync wired to the now-hidden preview pane). Rebuild the
  // outline now that the editor exists, so clicks/active-tracking drive CM6.
  if (State.activeFile != null && noteContent.querySelector('h1,h2,h3,h4,h5,h6')) buildTOC();
  return true;
}
// Load a document into the editor (used by renderFile). Before CM6 mounts, initCM6Editor
// picks up the active file itself.
// Audit B1: `file` selects the editor state (and so the undo history) the text is shown in —
// each open file has its own, and loading is never an undoable step.
// Large-file mode hands the editor text to the app at most every 400 ms (see the adapter), so
// the note being edited keeps its pending text in the editor. `content` on that note becomes an
// accessor whose getter first asks the editor to hand over what it has: every reader (save,
// autosave, recovery mirror, export, close flow) then sees the current text with no change to
// their code.
let editorOwner = null;
function releaseEditorOwner() {
  const prev = editorOwner;
  if (!prev) return;
  const d = Object.getOwnPropertyDescriptor(prev, 'content');
  // The getter hands over the editor's pending text only while the note still owns the editor, so
  // the read comes BEFORE the owner is cleared (after it, the pending edit was left behind).
  const text = d && d.get ? prev.content : null;
  editorOwner = null;
  if (text === null) return;
  Object.defineProperty(prev, 'content', { value: text, writable: true, enumerable: true, configurable: true });
}
function claimEditorOwner(file) {
  releaseEditorOwner();
  editorOwner = file;
  if (!inLargeMode(file)) return;
  let raw = file.content;
  Object.defineProperty(file, 'content', {
    enumerable: true,
    configurable: true,
    get() {
      if (editorOwner === file && cmAdapter && cmAdapter.hasPendingChange()) cmAdapter.flushChanges();
      return raw;
    },
    set(v) {
      if (editorOwner === file && cmAdapter) cmAdapter.discardPendingChange();
      raw = v;
    },
  });
}
// The first keystroke of a burst in large-file mode: mark the note unsaved at once; the text
// follows with the flush.
function markDeferredEdit() {
  const f = editorOwner;
  if (!f || cmLoading) return;
  if (f.savedContent === undefined && !f.dirty) {
    editorOwner = null; // read the stored text; the getter would hand over the pending change
    try { f.savedContent = f.content; } finally { editorOwner = f; }
  }
  f.dirty = true;
  const idx = State.files.indexOf(f);
  if (idx >= 0) updateTabState(idx);
}
// Hand a pending large-mode change to the active note now (before the note changes).
function flushEditorChanges() {
  if (cmAdapter && cmAdapter.hasPendingChange()) cmAdapter.flushChanges();
}
function loadIntoEditor(file) {
  if (!cmAdapter) return;
  claimEditorOwner(file);
  // Read the text before the loading flag goes up: a note in large-file mode hands over a pending
  // edit when its text is read, and that change must reach onChange, which ignores a load.
  const text = file.content || '';
  cmLoading = true;
  try { cmAdapter.load(text, historyKeyOf(file), { large: inLargeMode(file) }); } finally { cmLoading = false; }
  // Files that are gone (closed tab, closed folder) free their history here — after the load,
  // which parks the file just left; everything still open keeps it. Keys are only read, never
  // created, for files never shown.
  cmAdapter.retainHistory(State.files.map((f) => f._historyId).filter((k) => k != null));
}
testHooks.loadCM6 = loadCM6;
testHooks._loadIntoEditor = loadIntoEditor; // e2e: the owner hand-over of a note in large-file mode
testHooks.createCodeMirrorAdapter = createCodeMirrorAdapter;
// Test hook: the live CM6 EditorPort (or null before mount). Lets e2e tests set selections /
// read the value precisely against the single editor surface.
testHooks.getActiveCmAdapter = () => cmAdapter;

// =====================================================================
// TOOLBAR MARKDOWN HELPERS
// =====================================================================
// QA H1 (2026-10-12): Reading mode is read-only. The formatting shortcuts (Ctrl+B, Ctrl+I,
// Ctrl+L, Ctrl+1-6) and the Edit menu reached the hidden editor at its last caret, changed the
// note and autosave wrote the change to disk. Every editing command asks this first.
function readOnlyRefusal() {
  if (State.viewMode !== 'reading') return false;
  showToast(tl('toast.readOnlyView'), 'info');
  return true;
}
// Word boundaries around `pos` in `v`, excluding markdown punctuation so a caret in a word
// expands to the word (not adjacent markers). null when there's no word at the caret.
function wordBounds(v, pos) {
  const isW = (c) => !!c && !/[\s`*_~$=[\]()<>#!|]/.test(c);
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
  if (readOnlyRefusal()) return;
  if (!editorReady()) return;
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
  if (isWrappedInside(sel, left, right)) {
    const inner = sel.slice(left.length, sel.length - right.length);
    cmAdapter.setSelection({ start, end }); cmAdapter.replaceSelection(inner);
    cmAdapter.setSelection({ start, end: start + inner.length });
    return;
  }
  // markers just OUTSIDE the selection → unwrap
  if (isWrappedOutside(v, start, end, left, right)) {
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
}
function insertText(left, right) {
  if (readOnlyRefusal()) return;
  if (!editorReady()) return;
  cmAdapter.focus();
  const { start, end } = cmAdapter.getSelection();
  const sel = cmAdapter.getValue().slice(start, end);
  cmAdapter.setSelection({ start, end });
  cmAdapter.replaceSelection(left + sel + right);
  cmAdapter.setSelection({ start: start + left.length + sel.length });
}
// Insert a block (callout / table / hr / image) on its OWN line — never splitting the caret's
// line mid-word (the prior bug: "hel|lo" + Table → "hel\n<table>\nlo"). If the caret is on a
// blank line the block lands there; otherwise it goes on a fresh, blank-line-separated line
// AFTER the current line. The caret is placed at the start of the inserted block.
function insertBlock(text) {
  if (readOnlyRefusal()) return;
  const block = String(text).replace(/\n+$/, '');
  if (!editorReady()) return;
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
}
// Fenced code block on its OWN line. With a selection, fence it in place (caret start at a
// line boundary so it never splits text); empty, drop an empty fence on a fresh line after the
// current one (or on the current blank line) with the caret inside, ready to type.
function insertCodeBlock() {
  if (readOnlyRefusal()) return;
  if (!editorReady()) return;
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
}
// Operate on EVERY line the selection spans: fn(lines[]) -> lines[]. Replaces that block
// and keeps it selected so a repeated click toggles the same region. Powers the smart line tools
// below so headings/quote/lists REPLACE or TOGGLE rather than stacking markers.
// QA M11: a selection that ends at the start of a line (a triple-click, a drag past the
// line end) does not include that next line.
function blockEnd(v, start, end) {
  return end > start && v[end - 1] === '\n' ? end - 1 : end;
}
function applyBlock(fn) {
  if (readOnlyRefusal()) return;
  if (!editorReady()) return;
  cmAdapter.focus();
  const v = cmAdapter.getValue();
  const { start, end } = cmAdapter.getSelection();
  const from = v.slice(0, start).lastIndexOf('\n') + 1;
  let to = v.indexOf('\n', blockEnd(v, start, end)); if (to === -1) to = v.length;
  const out = fn(v.slice(from, to).split('\n')).join('\n');
  cmAdapter.setSelection({ start: from, end: to });
  cmAdapter.replaceSelection(out);
  cmAdapter.setSelection({ start: from, end: from + out.length });
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
  if (readOnlyRefusal()) return;
  // QA M11: a marker pair counts only when it hugs its text (`*a*`, not `2 * 3 *`), and
  // ~sub~ has no spaces, so prose like `~5 min or ~10 min` is left alone.
  const strip = (s) => s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1').replace(/__(?=\S)([\s\S]*?\S)__/g, '$1')
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, '$1').replace(/(?<!\w)_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1').replace(/==(?=\S)([\s\S]*?\S)==/g, '$1')
    .replace(/`([^`]*?)`/g, '$1').replace(/<\/?u>/gi, '')
    .replace(/\^([^^\s]+?)\^/g, '$1').replace(/~([^~\s]+?)~/g, '$1');
  if (!editorReady()) return;
  cmAdapter.focus();
  let { start, end } = cmAdapter.getSelection();
  const v = cmAdapter.getValue();
  if (start === end) { const w = wordBounds(v, start); if (w) { start = w.start; end = w.end; } }
  const cleaned = strip(v.slice(start, end));
  cmAdapter.setSelection({ start, end });
  cmAdapter.replaceSelection(cleaned);
  cmAdapter.setSelection({ start, end: start + cleaned.length });
}

// Insert a numbered footnote: a [^N] reference at the caret + a "[^N]: " definition appended at
// the end of the document, with the caret left after the colon to type the note (R11).
function insertFootnote() {
  if (readOnlyRefusal()) return;
  if (!editorReady()) return;
  cmAdapter.focus();
  const v = cmAdapter.getValue();
  const used = [...v.matchAll(/\[\^(\d+)\]/g)].map((m) => parseInt(m[1], 10));
  const n = (used.length ? Math.max(...used) : 0) + 1;
  // QA M11: the reference goes after the selected text; it never replaces it.
  const { end } = cmAdapter.getSelection();
  cmAdapter.setSelection({ start: end, end });
  cmAdapter.replaceSelection(`[^${n}]`);
  const v2 = cmAdapter.getValue();
  const sep = v2.endsWith('\n\n') ? '' : v2.endsWith('\n') ? '\n' : '\n\n';
  cmAdapter.setSelection({ start: v2.length, end: v2.length });
  cmAdapter.replaceSelection(`${sep}[^${n}]: `);
  cmAdapter.setSelection({ start: cmAdapter.getValue().length });
}
testHooks.insertFootnote = insertFootnote;

// Interactive table editing: apply a structural op (rowAfter/rowBefore/rowDelete/colAfter/
// colBefore/colDelete/nextCell/prevCell) to the table at the caret. Returns true if a table was
// found + edited. Pure engine in table-edit.js; here we just splice the result into CM6.
function tableOp(kind) {
  if (State.viewMode === 'reading') return false;
  if (!cmAdapter) return false;
  const r = tableEdit(cmAdapter.getValue(), cmAdapter.getSelection().start, kind);
  if (!r) return false;
  cmAdapter.focus();
  cmAdapter.setSelection({ start: r.from, end: r.to });
  cmAdapter.replaceSelection(r.md);
  cmAdapter.setSelection({ start: r.caret });
  return true;
}
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

testHooks.wrapSelection = wrapSelection;
testHooks.insertBlock = insertBlock;
testHooks.toggleList = toggleList;

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
  { sec: 'Files', key: 'palette.exportEpub', icon: 'book', name: 'Export EPUB…', meta: 'command', act: () => exportEpub() },
  { sec: 'Files', key: 'palette.loadDemo', icon: 'sparkles', name: 'Load demo notes', meta: 'command', act: loadDemo },
  { sec: 'View', key: 'palette.toggleReading', icon: 'book-open', name: 'Toggle Reading Mode', meta: 'view', sk: 'Ctrl+E', act: toggleViewMode },
  { sec: 'View', key: 'palette.flip', icon: 'flip', name: 'Flip direction (RTL ⇄ LTR)', meta: 'view', sk: 'Ctrl+⇧+L', act: toggleRTL },
  { sec: 'View', key: 'palette.flipBlock', icon: 'flip', name: 'Flip current block direction', meta: 'view', sk: 'Ctrl+D', act: () => flipCurrentBlock() },
  { sec: 'View', key: 'palette.resetBlockDirs', icon: 'rotate-ccw', name: 'Reset all block directions to auto', meta: 'view', act: () => resetBlockDirections() },
  { sec: 'View', key: 'palette.themePaper', icon: 'sun', name: 'Theme: Paper', meta: 'view', act: () => setTheme('paper') },
  { sec: 'View', key: 'palette.themeInk', icon: 'moon', name: 'Theme: Ink', meta: 'view', act: () => setTheme('ink') },
  { sec: 'View', key: 'palette.themeSepia', icon: 'palette', name: 'Theme: Sepia', meta: 'view', act: () => setTheme('sepia') },
  { sec: 'View', key: 'palette.themeOasis', icon: 'flame', name: 'Theme: Oasis', meta: 'view', act: () => setTheme('oasis') },
  { sec: 'View', key: 'palette.toggleSidebar', icon: 'panel-left', name: 'Toggle Sidebar', meta: 'view', sk: 'Ctrl+\\', act: toggleSidebar },
  { sec: 'View', key: 'palette.toggleInspector', icon: 'panel-right', name: 'Toggle Inspector', meta: 'view', act: toggleInspector },
  { sec: 'View', key: 'palette.toggleArabic', icon: 'languages', name: 'Toggle Arabic Interface (العربية)', meta: 'view', act: toggleArabicUI },
  { sec: 'View', key: 'palette.toggleKashida', icon: 'align-justify', name: 'Toggle Arabic Kashida Justification', meta: 'view', act: toggleKashida },
  { sec: 'View', key: 'palette.toggleItalic', icon: 'italic', name: 'Toggle Italic Recolour', meta: 'view', act: toggleItalicRecolor },
  { sec: 'View', key: 'palette.zoomIn', icon: 'zoom-in', name: 'Zoom In',    meta: 'view', sk: 'Ctrl+=', act: zoomIn },
  { sec: 'View', key: 'palette.zoomOut', icon: 'zoom-out', name: 'Zoom Out',   meta: 'view', sk: 'Ctrl+-', act: zoomOut },
  { sec: 'View', key: 'palette.resetZoom', icon: 'rotate-ccw', name: 'Reset Zoom', meta: 'view', sk: 'Ctrl+0', act: zoomReset },
  { sec: 'Help', key: 'palette.shortcuts', icon: 'keyboard', name: 'Keyboard Shortcuts', meta: 'help', sk: 'Ctrl+/', act: showShortcuts },
  { sec: 'View', get key() { return togglePaletteKey('autoHideTitlebar'); }, icon: 'panel-left', get name() { return toggleFallback('autoHideTitlebar'); }, meta: 'view', sk: CHROME_TOGGLES.autoHideTitlebar.paletteShortcut, act: () => toggleAutoHideTitlebar() },
  { sec: 'View', get key() { return togglePaletteKey('hideStatusBar'); }, icon: 'panel-right', get name() { return toggleFallback('hideStatusBar'); }, meta: 'view', sk: CHROME_TOGGLES.hideStatusBar.paletteShortcut, act: () => toggleHideStatusBar() },
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
testHooks.openPalette = openPalette;
testHooks.closePalette = closePalette;
testHooks.openFind = openFind;
testHooks.runFind = runFind;
testHooks.findStep = findStep;
testHooks.closeFind = closeFind;
testHooks.showShortcuts = showShortcuts;

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
  const goal = [0, 10, 20, 30].includes(Number(State.readingGoalMin)) ? Number(State.readingGoalMin) : 10;
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
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('settings.followSystem', 'Follow system colour scheme')}</div>
          <div class="set-desc">${L('settings.followSystemDesc', 'On first run (until you pick a theme yourself) use the dark theme when Windows is set to dark. Choosing a theme in View or with the theme button turns this off.')}</div>
        </div>
        ${sw('setFollowSystem', 'settings.followSystem', 'Follow system colour scheme', !!State.themeFollowSystem)}
      </div>
    </div>
    <div class="set-group">
      <div class="set-group-label">${L('settings.files', 'Files')}</div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('settings.autosave', 'Auto-save')}</div>
          <div class="set-desc">${L('settings.autosaveDesc', 'Automatically saves open files about 15 seconds after you stop typing. Untitled notes still need Save As.')}</div>
        </div>
        ${sw('setAutosave', 'settings.autosave', 'Auto-save', State.autosave)}
      </div>
    </div>
    <div class="set-group">
      <div class="set-group-label">${L('settings.reading', 'Reading')}</div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('settings.goal', 'Daily reading goal')}</div>
          <div class="set-desc">${L('settings.goalDesc', 'Counts the minutes you read in the reading view, on this machine only. Off hides the reading line on the welcome screen.')}</div>
        </div>
        <div class="set-seg" role="group" aria-label="${L('settings.goal', 'Daily reading goal')}">
          <button type="button" id="setGoalOff" aria-pressed="${!goal}">${L('settings.goalOff', 'Off')}</button>
          <button type="button" id="setGoal10" aria-pressed="${goal === 10}">10</button>
          <button type="button" id="setGoal20" aria-pressed="${goal === 20}">20</button>
          <button type="button" id="setGoal30" aria-pressed="${goal === 30}">30</button>
        </div>
      </div>
    </div>
    <div class="set-group">
      <div class="set-group-label">${L('settings.updates', 'Updates')}</div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('settings.updateAuto', 'Check for updates automatically')}</div>
          <div class="set-desc">${L('settings.updateAutoDesc', 'Checks when the app starts, then once a day while it runs, and only tells you when a newer version exists. Nothing is downloaded automatically, no data about you is sent, and it is off by default.')}</div>
        </div>
        ${sw('setUpdateAuto', 'settings.updateAuto', 'Check for updates automatically', State.updateCheck === 'auto')}
      </div>
    </div>
    <div class="set-group">
      <div class="set-group-label">${L('menu.arabic', 'Arabic')}</div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('menu.arabicInterface', 'Arabic Interface (العربية)')}</div>
          <div class="set-desc">${L('settings.arabicInterfaceDesc', 'Switch the whole interface to Arabic with a right-to-left layout. Notes are unaffected.')}</div>
        </div>
        ${sw('setArabicUI', 'menu.arabicInterface', 'Arabic Interface', State.uiDirection === 'rtl')}
      </div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('menu.calendar', 'Calendar')}</div>
          <div class="set-desc">${L('settings.calendarDesc', 'Used for daily-note names and dates (Umm al-Qura for Hijri).')}</div>
        </div>
        <div class="set-seg" role="group" aria-label="${L('menu.calendar', 'Calendar')}">
          <button type="button" id="setCalGreg" aria-pressed="${State.calendar !== 'hijri'}">${L('menu.gregorian', 'Gregorian')}</button>
          <button type="button" id="setCalHijri" aria-pressed="${State.calendar === 'hijri'}">${L('menu.hijri', 'Hijri (Umm al-Qura)')}</button>
        </div>
      </div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('menu.kashida', 'Kashida Justification')}</div>
          <div class="set-desc">${L('settings.kashidaDesc', 'Justify Arabic paragraphs by distributing the space between characters rather than between words.')}</div>
        </div>
        ${sw('setKashida', 'menu.kashida', 'Kashida Justification', !!State.arabicKashida)}
      </div>
      <div class="set-row">
        <div class="set-text">
          <div class="set-name">${L('menu.recolourItalics', 'Recolour Italics')}</div>
          <div class="set-desc">${L('settings.recolourDesc', 'Show italics in the accent colour in reading view.')}</div>
        </div>
        ${sw('setItalic', 'menu.recolourItalics', 'Recolour Italics', !!State.italicRecolor)}
      </div>
    </div>`;

  const title = tr('settings.title', State.uiLocale);
  openModal(!title || title === 'settings.title' ? 'Settings' : title, html, 'drawer');

  // Wire after insertion, mirroring buildMenu()'s querySelectorAll pass over its own
  // innerHTML output.
  const sync = () => {
    $('setAutoHide')?.setAttribute('aria-checked', String(!!State.autoHideTitlebar));
    $('setHideStatus')?.setAttribute('aria-checked', String(!!State.hideStatusBar));
    $('setAutosave')?.setAttribute('aria-checked', String(!!State.autosave));
    $('setTitleModeFile')?.setAttribute('aria-pressed', String(State.windowTitleMode !== 'app'));
    $('setTitleModeApp')?.setAttribute('aria-pressed', String(State.windowTitleMode === 'app'));
    $('setArabicUI')?.setAttribute('aria-checked', String(State.uiDirection === 'rtl'));
    $('setKashida')?.setAttribute('aria-checked', String(!!State.arabicKashida));
    $('setItalic')?.setAttribute('aria-checked', String(!!State.italicRecolor));
    $('setCalGreg')?.setAttribute('aria-pressed', String(State.calendar !== 'hijri'));
    $('setCalHijri')?.setAttribute('aria-pressed', String(State.calendar === 'hijri'));
    $('setFollowSystem')?.setAttribute('aria-checked', String(!!State.themeFollowSystem));
    $('setUpdateAuto')?.setAttribute('aria-checked', String(State.updateCheck === 'auto'));
    const goal = Number(State.readingGoalMin) || 0;
    $('setGoalOff')?.setAttribute('aria-pressed', String(goal === 0));
    $('setGoal10')?.setAttribute('aria-pressed', String(goal === 10));
    $('setGoal20')?.setAttribute('aria-pressed', String(goal === 20));
    $('setGoal30')?.setAttribute('aria-pressed', String(goal === 30));
  };
  $('setAutoHide')?.addEventListener('click', () => { toggleAutoHideTitlebar(); sync(); });
  $('setHideStatus')?.addEventListener('click', () => { toggleHideStatusBar(); sync(); });
  $('setFollowSystem')?.addEventListener('click', () => {
    State.themeFollowSystem = !State.themeFollowSystem; // persisted via the PERSISTED_KEYS subscription
    // Turning it ON applies the system scheme immediately so the choice is visible. This is
    // deliberately NOT setTheme(): that would write the pre-paint localStorage mirror and end
    // the follow, whereas this stays a derived preference. Turning it OFF leaves the current
    // theme alone.
    if (State.themeFollowSystem) {
      const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'ink' : 'paper';
      State.theme = systemTheme;
      applyThemeToDom(systemTheme);
    }
    sync();
  });
  $('setAutosave')?.addEventListener('click', () => {
    State.autosave = !State.autosave; // persisted via the PERSISTED_KEYS subscription
    sync();
  });
  $('setUpdateAuto')?.addEventListener('click', () => {
    // T7.1: the setting is the opt-in. Turning it ON checks once right away so the switch has
    // a visible effect and lets main arm its daily timer; turning it OFF needs nothing —
    // main re-reads the setting before every check anyway.
    State.updateCheck = State.updateCheck === 'auto' ? 'manual' : 'auto';
    sync();
    if (State.updateCheck === 'auto') {
      void window.electronAPI?.autoUpdateCheck?.().then((res) => {
        if (res && res.updateAvailable) showUpdateNotice(res);
        else if (res && res.error === 'untrusted') showUpdateFailure('untrusted');
      }).catch(() => { /* an offline check is silent, not an error toast */ });
    }
  });
  $('setTitleModeFile')?.addEventListener('click', () => { setWindowTitleMode('file'); sync(); });
  $('setTitleModeApp')?.addEventListener('click', () => { setWindowTitleMode('app'); sync(); });
  $('setArabicUI')?.addEventListener('click', () => { toggleArabicUI(); sync(); });
  $('setKashida')?.addEventListener('click', () => { toggleKashida(); sync(); });
  $('setItalic')?.addEventListener('click', () => { toggleItalicRecolor(); sync(); });
  $('setCalGreg')?.addEventListener('click', () => { setCalendar('gregorian'); sync(); });
  $('setCalHijri')?.addEventListener('click', () => { setCalendar('hijri'); sync(); });
  // T8.1: the daily reading goal. 0 = off, which hides the welcome line entirely.
  for (const value of [0, 10, 20, 30]) {
    const id = value === 0 ? 'setGoalOff' : `setGoal${value}`;
    $(id)?.addEventListener('click', () => {
      State.readingGoalMin = value; // persisted via the PERSISTED_KEYS subscription
      sync();
      renderStreakLine();
    });
  }
}
testHooks.showSettings = showSettings;

testHooks.newDailyNote = newDailyNote;
testHooks.renderTree = renderTree;
testHooks.showWelcome = showWelcome;
testHooks.parseMarkdown = parseMarkdown;
testHooks.PALETTE_COMMANDS = PALETTE_COMMANDS;
// T-F19: exposed for the shortcut-drift guard in tests/e2e/click-audit-all.spec.js,
// mirroring PALETTE_COMMANDS above. A shortcut lives in four places by hand.
testHooks.MENU_DEFS = MENU_DEFS;
// v10 redesign (D1): the context menu's role labels/shortcuts are a fifth hand-copy of the
// same six Edit-menu chords (CA19) — exposed so click-audit-all.spec.js can guard it too.
testHooks.CTX_ROLE_DISPLAY = CTX_ROLE_DISPLAY;
// Exposed for the Electron-lane cross-check in tests/e2e/electron/context-menu.spec.js —
// main's APP_COMMANDS carries only ids; this is where their display text actually lives.
testHooks.APP_COMMAND_DISPLAY = APP_COMMAND_DISPLAY;

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
  // audit UX-10: an empty query used to push EVERY open file (thousands of buttons in one
  // innerHTML write on a large vault). Commands still list in full; files cap at 50 with a
  // keep-typing hint.
  const PALETTE_FILE_CAP = 50;
  let fileHits = 0;
  State.files.forEach((f, i) => {
    if (!q || f.name.toLowerCase().includes(q)) {
      if (fileHits >= PALETTE_FILE_CAP) return;
      fileHits += 1;
      items.push({ sec: 'Files in folder', icon: 'file', name: f.name, _label: f.name, meta: f.path, _kind: 'file', _idx: i, _key: fileKey(f) });
    }
  });
  const sections = {};
  items.forEach(it => { sections[it.sec] = sections[it.sec] || []; sections[it.sec].push(it); });
  let html = ''; palVisible = [];
  Object.entries(sections).forEach(([sec, arr]) => {
    const secLabel = PAL_SEC_KEY[sec] ? tr(PAL_SEC_KEY[sec], loc) : sec;
    html += `<div class="pal-sec${sec === 'Files in folder' ? ' pal-sec-files' : ''}"><div class="pal-section-label">${escapeHtml(secLabel)}</div>`;
    arr.forEach(it => {
      palVisible.push(it);
      const sk = it.sk ? `<span class="pi-shortcut">${it.sk.split('+').map(p => `<span class="kbd">${p}</span>`).join('')}</span>` : '';
      const optionIndex = palVisible.length - 1;
      html += `<button type="button" class="pal-item${palVisible.length === 1 ? ' active' : ''}" role="option" id="pal-option-${optionIndex}" aria-selected="${palVisible.length === 1}" data-i="${optionIndex}">
        <span class="pi-icon">${it.icon ? `<span data-ic="${escapeHtml(it.icon)}"></span>` : ''}</span>
        <span class="pi-name">${escapeHtml(it._label || it.name)}</span>
        <span class="pi-meta">${escapeHtml(paletteMeta(it))}</span>
        ${sk}
      </button>`;
    });
    html += '</div>';
  });
  // Non-interactive: no .pal-item class, so it never enters palVisible / keyboard nav.
  if (!q && State.files.length > PALETTE_FILE_CAP) {
    html += `<div class="pal-hint">${escapeHtml(tl('palette.moreFiles', { n: State.files.length - PALETTE_FILE_CAP }))}</div>`;
  }
  if (!items.length) html = `<div class="search-empty" style="padding: 20px;">${escapeHtml(tr('palette.noMatches', loc))}</div>`;
  palResults.innerHTML = html;
  hydrateIcons(palResults);
  palIdx = 0;
  if (palVisible.length) palInput.setAttribute('aria-activedescendant', 'pal-option-0');
  else palInput.removeAttribute('aria-activedescendant');
  palResults.querySelectorAll('.pal-item').forEach(el => {
    el.addEventListener('click', () => {
      const i = parseInt(el.dataset.i);
      const it = palVisible[i];
      closePalette();
      if (it._kind === 'cmd') it.act();
      else if (it._kind === 'file') {
        const target = fileIndexByKey(it._key);
        if (target >= 0) renderFile(target);
      }
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
  // v1.3.0 (DATA-03): main re-sends app:request-close on EVERY close event (each
  // Alt+F4 / titlebar X). A second flow entering while the first waits on a Save
  // dialog would supersede it, clobber the autosave gate behind the dialog the user
  // is looking at, and — via the first flow's cancel-path abortWindowClose — kill the
  // close failsafe the visible dialog depends on. One close flow at a time; a second
  // request while one runs is a no-op (the failsafe's heartbeat keeps extending).
  if (gates.closeFlowActive) return;
  gates.closeFlowActive = true;
  // v1.2: Word-style close. One dirty file → Save / Don't Save / Cancel naming it;
  // several → Save All / Close without Saving / Cancel. The old prompt was an
  // English confirm() whose default button discarded everything.
  const closeApi = window.electronAPI;
  // Keep main's 20s force-close failsafe re-armed while this close flow waits on a
  // dialog: a user thinking inside a Save-As prompt must never be force-closed out
  // from under, and a wedged renderer simply stops ticking — the failsafe still fires.
  const keepCloseAlive = closeApi && typeof closeApi.extendWindowClose === 'function'
    ? setInterval(() => { try { closeApi.extendWindowClose(); } catch (_) { /* best-effort */ } }, 5000)
    : null;
  try {
    let proceed = true;
    const dirtyFiles = State.files.filter((f) => f.dirty);
    if (dirtyFiles.length > 0) {
      const choice = dirtyFiles.length === 1
        ? await askSaveChanges({ name: dirtyFiles[0].name })
        : await askSaveChanges({ count: dirtyFiles.length });
      // A Save choice can open dialogs that stay up as long as the user needs — the
      // native Save As for untitled notes, the encoding upgrade for legacy code pages —
      // well past main's 20s close failsafe. Abort the failsafe BEFORE any of them can
      // open: this close attempt is over, and if every note comes back clean the
      // sanctioned close tail below re-runs on its own.
      if (choice === 'save') {
        try { window.electronAPI?.abortWindowClose?.(); } catch (_) { /* best-effort */ }
      }
      proceed = await resolveCloseChoice(choice);
      if (!proceed) {
        // Canceled: main must tear down its force-close failsafe for this window.
        try { window.electronAPI?.abortWindowClose?.(); } catch (_) { /* best-effort */ }
        return;
      }
      if (choice === 'discard') {
        // B2: "Close without Saving" must not leave the discarded text dirty for the awaits
        // below (settings flush, recovery clear) -- the autosave timer and the recovery loop
        // keep running until the window is really gone and would write / mirror it. State only:
        // no re-render, the window is closing and a re-render would reset the scroll position
        // that is captured and saved right below.
        // QA-N3: a never-saved note has no saved text to go back to (discardEdits returns
        // false); it is marked clean so the recovery mirror cannot offer it at next launch.
        for (const f of dirtyFiles) if (!discardEdits(f)) f.dirty = false;
      }
    }
    // T14 (post-review L5): flush the active note's final reading position — the 1s capture
    // throttle otherwise leaves the shelf up to a second stale on quit. No-op in Edit mode
    // (captureReadingProgress refuses to measure a hidden pane).
    captureReadingProgress(activeReadingFile());
    await flushSettings();
    // This close is now sanctioned — drop any pending crash-recovery snapshots so the
    // next launch doesn't offer to restore what the user just chose to close. UNLESS a
    // recovery decision is still outstanding: a prompt still open, or one the user
    // dismissed this session without choosing, belongs to work the user never answered
    // for — quitting now must leave it re-offerable.
    if (!gates.recoveryPromptOpen && !gates.recoveryDismissed) {
      try { await window.electronAPI?.recoveryClear?.(); } catch (_) { /* best-effort */ }
    } else {
      // The offer stays; this session's own mirror (live.json) holds nothing worth offering
      // after a sanctioned close, so it is emptied.
      try { await window.electronAPI?.recoverySnapshot?.([]); } catch (_) { /* best-effort */ }
    }
    if (window.electronAPI) window.electronAPI.closeWindow();
  } finally {
    if (keepCloseAlive) clearInterval(keepCloseAlive);
    gates.closeFlowActive = false;
  }
}
if (window.electronAPI && typeof window.electronAPI.onCloseRequested === 'function') {
  window.electronAPI.onCloseRequested(() => { winClose(); });
}

// =====================================================================
// GLOBAL KEYBOARD SHORTCUTS
// =====================================================================
// Which key an event means is decided in shortcut-keys.js (audit M24): the character the
// layout produces when it is one a shortcut can use, the physical key otherwise.

// audit M25: Esc leaves fullscreen only when it had nothing else to close. The surfaces are
// read in the capture phase, before any of their own Escape handlers has closed one.
let _escapeHadSurface = false;
function escapeSurfaceOpen() {
  return palOverlay.classList.contains('open') || modalOverlay.classList.contains('open')
    || $('findBar').classList.contains('open') || dropdown.classList.contains('open')
    || !ctxMenu.hidden || !!(_hlBar && !_hlBar.hidden)
    || !!(readerControlsPopover && !readerControlsPopover.hidden) || dirMenuOpen();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') _escapeHadSurface = escapeSurfaceOpen();
}, true);

document.addEventListener('keydown', e => {
  const cmd = e.ctrlKey || e.metaKey;
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  // While a dialog is open its own buttons own the keyboard (native editing chords
  // still work — nothing here preventDefaults them). A shortcut-fired second dialog
  // would swap the body under the pending one and settle it as canceled. Same for the
  // command palette: Ctrl+S / Ctrl+W firing behind it would act on a surface the user
  // cannot currently see.
  const overlayOpen = modalOverlay.classList.contains('open') || palOverlay.classList.contains('open');
  if (overlayOpen && e.key !== 'Escape' && (cmd || e.key === 'F11')) return;

  if (cmd && hitKey(e, 'k') && !e.shiftKey) { e.preventDefault(); openPalette(); }
  else if (cmd && hitKey(e, 'p') && !e.shiftKey) { e.preventDefault(); openPalette(); }
  else if (cmd && e.shiftKey && hitKey(e, 'l')) { e.preventDefault(); toggleRTL(); }
  else if (cmd && !e.shiftKey && hitKey(e, 'e')) { e.preventDefault(); toggleViewMode(); } // T-F17 Reading/Edit
  else if (cmd && e.shiftKey && hitKey(e, 'd')) { e.preventDefault(); cycleTheme(); }
  else if (cmd && !e.shiftKey && !e.altKey && !inInput && hitKey(e, 'd')) { e.preventDefault(); flipCurrentBlock(); }
  else if (cmd && e.shiftKey && hitKey(e, 'i')) { e.preventDefault(); toggleInspector(); }
  else if (cmd && e.shiftKey && hitKey(e, 'o')) { e.preventDefault(); openVault(); }
  else if (cmd && !e.shiftKey && hitKey(e, 'o')) { e.preventDefault(); openSingleFile(); }
  else if (cmd && e.shiftKey && hitKey(e, 'n')) { e.preventDefault(); newDailyNote(); }
  else if (cmd && !e.shiftKey && hitKey(e, 'n')) { e.preventDefault(); newNote(); }
  else if (cmd && e.shiftKey && hitKey(e, 's')) { e.preventDefault(); saveAs(); }
  else if (cmd && !e.shiftKey && hitKey(e, 's')) { e.preventDefault(); saveCurrent(); }
  // audit M25: Ctrl+Shift+Z redoes too, as the shortcut document says. A press the editor
  // already acted on (its own history keymap) is not repeated here.
  else if (cmd && (e.shiftKey ? hitKey(e, 'z') : hitKey(e, 'y'))) { if (!e.defaultPrevented) { e.preventDefault(); execEditCmd('redo'); } } // Ctrl+Y Redo: was advertised in the Edit menu, the shortcut sheet and the context menu, but only ever worked inside CM6's own keymap — dead in Reading mode and every text field.
  // audit M25: the Edit menu shows Ctrl+L for Insert Link. Ctrl+Shift+L stays "direction".
  else if (cmd && !e.shiftKey && !e.altKey && !inInput && hitKey(e, 'l')) { e.preventDefault(); insertText('[', '](url)'); }
  else if (cmd && !e.shiftKey && hitKey(e, 'w')) { e.preventDefault(); if (State.activeFile !== null) closeTab(State.activeFile); }
  else if (cmd && !e.shiftKey && hitKey(e, 'f')) { e.preventDefault(); openFind(); }
  else if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
  else if (cmd && hitCode(e, '\\', 'Backslash')) { e.preventDefault(); toggleSidebar(); }
  else if (cmd && hitCode(e, '/', 'Slash')) { e.preventDefault(); showShortcuts(); }
  // T-F19 chrome. Ctrl+Shift+B is deliberately ABOVE the Bold branch further down:
  // that one matches `cmd && !inInput && key === 'b'` with no !e.shiftKey guard, so
  // placing this after it would make Bold swallow the chord.
  else if (cmd && e.shiftKey && hitKey(e, 't')) { e.preventDefault(); toggleAutoHideTitlebar(); }
  // !inInput so the very common Ctrl+Shift+B typo -- reaching for Bold with Shift still
  // down -- falls through to the Bold branch below instead of silently hiding the
  // status bar and discarding the keystroke.
  else if (cmd && e.shiftKey && !inInput && hitKey(e, 'b')) { e.preventDefault(); toggleHideStatusBar(); }
  else if (cmd && hitCode(e, ',', 'Comma')) { e.preventDefault(); showSettings(); }
  // Zoom shortcuts: Ctrl+= / Ctrl+- / Ctrl+0 (Digit0 covers the Arabic-layout digits too).
  else if (cmd && !e.shiftKey && (hitCode(e, '=', 'Equal') || e.key === '+')) { e.preventDefault(); zoomIn(); }
  else if (cmd && !e.shiftKey && hitCode(e, '-', 'Minus')) { e.preventDefault(); zoomOut(); }
  else if (cmd && !e.shiftKey && (e.key === '0' || e.code === 'Digit0')) { e.preventDefault(); zoomReset(); }
  // Ctrl+A: when a text field (INPUT/TEXTAREA) is focused, leave NATIVE select-all
  // intact (e.g. #findInput selects its own text). Only scope-select the
  // live-preview noteContent via execEditCmd when focus is NOT in a field.
  else if (cmd && !e.shiftKey && hitKey(e, 'a')) {
    if (inInput) return; // native behavior selects the focused field's text
    e.preventDefault();
    execEditCmd('selectAll');
  }
  else if (cmd && !inInput && !e.shiftKey && hitKey(e, 'b')) { e.preventDefault(); wrapSelection('**', '**'); }
  else if (cmd && !inInput && !e.shiftKey && hitKey(e, 'i')) { e.preventDefault(); wrapSelection('*', '*'); }
  // Ctrl/Cmd+1–6 → set heading level (toggle off if already at that level). Conventional
  // (Typora). Ctrl+0 stays Zoom-Reset (app convention), so re-click/re-press the level to clear.
  else if (cmd && !e.shiftKey && !inInput && /^[1-6]$/.test(shortcutLetter(e))) { e.preventDefault(); toggleHeading(parseInt(shortcutLetter(e), 10)); }
  else if (e.key === 'Escape') {
    if (palOverlay.classList.contains('open')) closePalette();
    else if (modalOverlay.classList.contains('open')) closeModal();
    else if ($('findBar').classList.contains('open')) {
      closeFind();
      e.stopImmediatePropagation(); // preserve lower-priority reader popover for the next Escape
    }
    else if (dropdown.classList.contains('open')) closeMenu();
    else if (!_escapeHadSurface && (_nativeFullscreen || document.fullscreenElement)) toggleFullscreen();
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
$('markBtn').addEventListener('click', () => { showAbout(); });
$('fullscreenBtn').addEventListener('click', toggleFullscreen);
$('zoomBtn')?.addEventListener('click', zoomReset);
$('rtlBtn').addEventListener('click', toggleRTL);
$('viewModeBtn')?.addEventListener('click', toggleViewMode); // T-F17: Reading ⇄ Edit
$('tabAddBtn').addEventListener('click', newNote);
$('searchBtn').addEventListener('click', openPalette);
$('winMinBtn').addEventListener('click', winMinimize);
$('winMaxBtn').addEventListener('click', winMaximize);
$('winCloseBtn').addEventListener('click', winClose);
$('modalCloseBtn').addEventListener('click', closeModal);
// QA M12: a stray click beside the dialog must not throw away a margin note being typed;
// Cancel, Escape and the close button still discard it on purpose.
$('modalOverlay').addEventListener('click', e => {
  if (e.target === modalOverlay && !($('noteField')?.value || '').trim()) closeModal();
});
$('palOverlay').addEventListener('click', e => { if (e.target === palOverlay || e.target.classList.contains('palette')) closePalette(); });
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
  // An overlay above the popover owns this Escape — one press must not close both.
  if (palOverlay.classList.contains('open') || modalOverlay.classList.contains('open')) return;
  event.preventDefault();
  setReaderControlsOpen(false, true);
});

document.querySelectorAll('.tb-menu-item').forEach(btn => {
  // Keep the editor focused/selected when opening a menu — a mousedown would
  // otherwise blur the editor, breaking Copy/Cut/Undo run from the Edit menu.
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
$('sbFootOpenFolder').addEventListener('click', openVault);
$('emptyOpenFile').addEventListener('click', openSingleFile);
$('sbFootOpenFile').addEventListener('click', openSingleFile);
$('sbFootNewNote').addEventListener('click', newNote);
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
// v1.2: Enter = next match, Shift+Enter = previous — the convention in every editor
// and browser. Previously Enter in the find field did nothing at all.
$('findInput').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  findStep(e.shiftKey ? -1 : 1);
});
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
  let dragDepth = 0;
  const dropOverlay = $('dropOverlay');
  const carriesFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
  document.body.addEventListener('dragenter', e => {
    if (!carriesFiles(e)) return;
    dragDepth += 1;
    dropOverlay.classList.add('on');
  });
  document.body.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.classList.remove('on');
  });

  document.body.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.body.addEventListener('drop', async e => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('on');
    const files = Array.from(e.dataTransfer.files || []);
    let loaded = 0;
    let toldLarge = false; // the "this note is large" message must not be replaced by "Loaded 1 file"
    for (const file of files) {
      if (!isDroppableFile(file.name)) {
        showToast(tl('toast.skippedType', { name: file.name }), 'info');
        continue;
      }
      if (await loadLooseFile(file)) { // the same size tiers as the picker lane (UI-02)
        loaded++;
        if (noteTier(file.size) >= TIER.LARGE) toldLarge = true;
      }
    }
    if (loaded > 0 && !toldLarge) showToast(tl('toast.loadedN', { n: loaded }));
  });
}
testHooks.initDragDrop = initDragDrop;
testHooks.renderTags = renderTags;
testHooks.escapeHtml = escapeHtml;

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
    applyTheme: applyThemeToDom,
    setZoom,
    setReaderTextScale,
    setReaderWidthCh,
    setViewMode,
    applyPanelLayout,
    applyChromeLayout,   // T-F19
    syncWindowTitle,     // T-F19
    renderRecents,
    renderContinue,      // T4.1: the Continue-reading shelf
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
testHooks.persistSettings = persistSettings;
testHooks.flushSettings = flushSettings;
testHooks.restoreSettings = restoreSettings;

// =====================================================================
// AUTO-SAVE + CRASH RECOVERY (v1.2 — Word-style data safety)
// =====================================================================
// Auto-save: files opened from disk (documentId) are written back in place when the
// user pauses ~15s after an edit. Untitled notes are skipped — their destination is
// unknown, so they keep their dirty flag and the close prompt covers them.
const AUTOSAVE_TICK_MS = 5000;
const AUTOSAVE_IDLE_MS = 15000;
let _autosaveTimer = null;
async function autosaveTick() {
  if (!State.autosave || settingsController?.isRestoring()) return;
  if (gates.saveDialogOpen) return; // a pending Save/Don't-Save answer owns the disk
  // audit M10: a note whose conflict banner is unanswered is left alone. Trying again every
  // tick only got 'conflict' again and re-rendered the note under the user's hands.
  const due = State.files.filter((f) => f.dirty && f.documentId && !f.conflict
    && Date.now() - (f._editedAt || 0) >= AUTOSAVE_IDLE_MS);
  let saved = false;
  for (const f of due) {
    let outcome = 'error';
    try { outcome = await workspaceController.writeThrough(f); if (outcome === 'ok') saved = true; }
    catch (_) { outcome = 'error'; }
    if (outcome === 'error' && !f._autosaveFailNotified) {
      // Persistent save failures were previously invisible (audit QA-01) — say so once per file.
      f._autosaveFailNotified = true;
      showToast(tl('toast.autosaveFailed', { name: f.name }), 'error');
    } else if (outcome === 'ok') {
      f._autosaveFailNotified = false;
    }
    if (outcome === 'conflict') {
      // writeThrough already re-read the disk copy for the banner; show it now for the
      // active tab instead of waiting for the next tab switch.
      const idx = State.files.indexOf(f);
      if (idx >= 0 && idx === State.activeFile) renderFile(idx);
    }
  }
  if (saved) renderTabs();
}
function startAutosaveLoop() {
  if (_autosaveTimer) return;
  _autosaveTimer = setInterval(() => { autosaveTick(); }, AUTOSAVE_TICK_MS);
}
testHooks._autosaveTick = autosaveTick; // e2e hook (same pattern as the other window.* test exports)

// Crash recovery: every 10s the renderer mirrors its dirty in-memory notes into
// <userData>/recovery/ (main-side, atomic). A crash, a forced shutdown, or the
// close failsafe can then offer the work back on next launch — the Word
// "recover unsaved documents" model. Cleared on a sanctioned close (winClose).
let _recoveryBusy = false;
let _recoveryAgain = false; // a mirror was asked for while one was in flight (audit M11)
// A large note is mirrored less often: serialising and writing tens of MB every 10 s would
// compete with typing. It is mirrored when it changed, at most every LARGE_MIRROR_MIN_MS; a
// session end or a restore (`force`) does not wait.
const LARGE_MIRROR_CHARS = 2_500_000;
const LARGE_MIRROR_MIN_MS = 30_000;
let _largeMirrorAt = 0;
let _largeMirrorSig = '';
async function mirrorDirtyNotes({ force = false } = {}) {
  if (!window.electronAPI || typeof window.electronAPI.recoverySnapshot !== 'function') return;
  if (_recoveryBusy) { _recoveryAgain = true; return; }
  _recoveryBusy = true;
  try {
    const dirtyFiles = State.files.filter((f) => f.dirty).slice(0, 20);
    const hasLarge = dirtyFiles.some((f) => skipsEditPreview(f) || (f.content || '').length > LARGE_MIRROR_CHARS);
    const sig = hasLarge ? mirrorSignature(dirtyFiles) : ''; // text first, then revision (see mirrorSignature)
    if (hasLarge && !force && (sig === _largeMirrorSig || Date.now() - _largeMirrorAt < LARGE_MIRROR_MIN_MS)) return;
    const res = await window.electronAPI.recoverySnapshot(dirtyFiles.map((f) => ({ name: f.name, content: String(f.content || '') })));
    if (hasLarge && res && res.ok) { _largeMirrorSig = sig; _largeMirrorAt = Date.now(); }
    // Never silent: a note main could not mirror is named once, so the reader knows to save it.
    const skipped = res && Array.isArray(res.skipped) ? res.skipped : [];
    for (const name of skipped) {
      const f = dirtyFiles.find((x) => x.name === name);
      if (f && !f._recoverySkipTold) { f._recoverySkipTold = true; showToast(tl('toast.recoverySkipped', { name }), 'error', undefined, { ms: 7000 }); }
    }
  } catch (_) { /* best-effort; retried next tick */ }
  finally { _recoveryBusy = false; }
  if (_recoveryAgain) { _recoveryAgain = false; await mirrorDirtyNotes(); }
}
testHooks._mirrorDirtyNotes = mirrorDirtyNotes; // e2e: the large-note mirror's change check
function startRecoveryLoop() {
  if (!window.electronAPI || typeof window.electronAPI.recoverySnapshot !== 'function') return;
  setInterval(() => { void mirrorDirtyNotes(); }, 10000);
  // audit M11: Windows is logging off or shutting down; do not wait for the next tick.
  if (typeof window.electronAPI.onFlushRecovery === 'function') window.electronAPI.onFlushRecovery(() => { mirrorDirtyNotes({ force: true }); });
}

// Next-launch prompt: offer the snapshots back. Restore reopens them as dirty,
// unsaved copies (Save As decides where they live — same as Word's recovered docs).
async function offerRecovery() {
  if (!window.electronAPI || typeof window.electronAPI.recoveryPop !== 'function') return;
  let res = null;
  try { res = await window.electronAPI.recoveryPop(); } catch (_) { return; }
  // The handler returns {ok, files} (audit QA-06); tolerate a legacy array mock too.
  const snaps = Array.isArray(res) ? res : (res && Array.isArray(res.files) ? res.files : []);
  if (res && res.unreadable) showToast(tl('recovery.unreadable'), 'error');
  if (snaps.length === 0) return;
  // The prompt peeks, never deletes: only an explicit Restore/Discard click decides and
  // clears the snapshot. A dismissed prompt (Escape/backdrop) or a quit mid-dialog
  // leaves it in place so the next launch re-offers the crashed-away work.
  gates.recoveryPromptOpen = true;
  let decision = 'dismiss';
  try {
    const html = `
      <div class="dlg-body">
        <div class="dlg-badge" id="recoveryBadge"></div>
        <div class="dlg-title">${escapeHtml(tl('recovery.title'))}</div>
        <div class="dlg-msg">${escapeHtml(tl('recovery.body', { n: snaps.length }))}</div>
        <div class="dlg-hint">${escapeHtml(tl('recovery.hint'))}</div>
      </div>
      <div class="dlg-actions">
        <button type="button" class="dlg-btn" id="recoveryDiscardBtn">${escapeHtml(tl('recovery.discard'))}</button>
        <button type="button" class="dlg-btn dlg-primary" id="recoveryRestoreBtn">${escapeHtml(tl('recovery.restore'))}</button>
      </div>`;
    decision = await askModal(tl('recovery.title'), html, {
      badge: 'recoveryBadge',
      abandon: 'dismiss',
      buttons: { recoveryRestoreBtn: 'restore', recoveryDiscardBtn: 'discard' },
      focus: 'recoveryRestoreBtn',
    });
  } finally { gates.recoveryPromptOpen = false; }
  if (decision === 'dismiss') {
    // Dismissal is not a decision: the snapshot stays, and this session must not
    // clear it on quit either (winClose honours this flag).
    gates.recoveryDismissed = true;
    return;
  }
  try { await window.electronAPI?.recoveryClear?.(); } catch (_) { /* best-effort */ }
  if (decision === 'discard') return;
  const used = new Set(State.files.map((f) => f.name));
  for (const snap of snaps) {
    // REC-01: derive every candidate from the extension-bearing base INSIDE the loop —
    // the old body re-derived from the raw snap.name, so an extension-less snapshot lost
    // the appended '.md' on the first collision and a bare-name collision could never
    // change the name again (an unbounded synchronous loop = a boot-hang trap).
    const rawName = String(snap.name || 'Recovered.md');
    const base = /\.(md|markdown)$/i.test(rawName) ? rawName : `${rawName}.md`;
    let name = base;
    let k = 0;
    while (used.has(name) && k < 1000) {
      k += 1;
      name = base.replace(/(\.md|\.markdown)$/i, (ext) => ` (recovered ${k})${ext}`);
    }
    used.add(name);
    addFile({ name, path: name, handle: null, content: String(snap.content || ''), dirty: true, revision: 1 });
  }
  // Mirror the restored notes now instead of at the next 10s tick: the offered snapshot was
  // just cleared, and until they are mirrored a crash would lose them.
  await mirrorDirtyNotes({ force: true });
  showToast(tl('recovery.restored', { n: snaps.length }), 'info');
}
testHooks._offerRecovery = offerRecovery;

// =====================================================================
// INIT
// =====================================================================
(function init() {
  // Detect Electron and apply native-window overrides
  if (window.electronAPI) document.documentElement.classList.add('electron');

  // The size thresholds belong to main (main-logic.js); the page starts with its own copy of
  // them and takes main's as soon as they arrive (well before any note can be opened).
  try {
    const asked = window.electronAPI && typeof window.electronAPI.getLimits === 'function' ? window.electronAPI.getLimits() : null;
    if (asked && typeof asked.then === 'function') asked.then(applyLimits).catch(() => { /* keep the defaults */ });
  } catch (_) { /* keep the defaults */ }

  localizeStateLabels();

  // Panel visibility: the static markup starts with `no-sidebar no-inspector` (clean editor-only
  // first paint, no flash). In the packaged app, restoreSettings() applies the persisted/default
  // values (default closed). With NO settings bridge (browser/dev), reflect the in-memory State
  // defaults (panels open) so the dev/test surface keeps both panels available.
  // v1.3.0 (DATA-04): the data-safety loops must start whether restore succeeds or not.
  // restoreSettings() rethrows from its try/finally and its restore-lastSession tail runs
  // the full render pipeline unwrapped — one throw there used to skip autosave, the
  // recovery mirror and the recovery prompt for the WHOLE session while the editor
  // happily showed restored content. The rejection handler starts the same loops and
  // names the failure; only the restore-specific chrome work is skipped.
  const startDataSafetyLoops = () => {
    // T-F13/A1: mount CM6 — lazy; on failure notes stay readable and edits say why.
    initCM6Editor().catch(() => { reportCm6Unavailable(); });
    // v1.2: Word-style data safety — auto-save loop, recovery mirror, and the
    // next-launch recovery prompt (after restore, so restored notes sit with the session).
    startAutosaveLoop();
    startRecoveryLoop();
    offerRecovery().catch(() => { /* never block boot on recovery */ });
  };
  restoreSettings().then((restored) => {
    // APP-24: .then(ok, fail) does not catch a throw inside ok, so the loops start in finally.
    try {
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
        let stored = null;
        try { stored = localStorage.getItem('bpmdrtlreader-theme'); } catch (_) { /* storage off */ }
        if (stored && THEMES.includes(stored)) {
          State.theme = stored;
          applyThemeToDom(stored);
        }
      }
      // T-F19: name the way out when the app OPENS with no chrome. restoreSettings() sets
      // the flags straight from disk and calls applyChromeLayout() — it never goes through
      // setAutoHideTitlebar(), which is where the "press Ctrl+Shift+T" toast lives. So a
      // user who quit with the bar hidden got a window with no title bar, no menus and no
      // window controls, and nothing on screen explaining any of it.
      if (State.autoHideTitlebar || State.hideStatusBar) {
        showToast(State.autoHideTitlebar ? tl('toast.topbarHidden') : tl('toast.statusbarHidden'), 'info');
      }
    } finally {
      startDataSafetyLoops();
    }
  }, () => {
    showToast(tl('toast.restoreFailed'), 'error');
    startDataSafetyLoops();
  });

  showWelcome();
  initDragDrop();
  // T4.1: one permanent, passive listener for the reading-position shelf. Throttled inside
  // scheduleProgressCapture (one write per second, at most one pending timer).
  previewScroller()?.addEventListener('scroll', scheduleProgressCapture, { passive: true });
  // T5.1c: the highlight selection bar (mouseup + dismissal).
  initAnnotationUI();
  // T7.1: main's opt-in auto check reports a newer release on this channel (receive-only).
  window.electronAPI?.onUpdateAvailable?.((info) => showUpdateNotice(info));
  window.electronAPI?.onUpdateUnverified?.(() => showUpdateFailure('untrusted'));
  // T8.1: the reading line + one minute per tick while the reading view is on screen.
  startReadingStats();
  void refreshReadingStats();
})();

function updateThemeIcon(theme) {
  // v1.2: sepia previously borrowed #ic-book-open — the SAME glyph as the adjacent
  // Reading/Edit toggle — leaving two identical buttons side by side in the most
  // reading-appropriate theme. Sepia now gets the palette glyph; sun/moon keep their
  // light/dark meaning, and T1.1's oasis theme gets the flame (warm dark).
  let icon = '#ic-sun';
  if (theme === 'ink') icon = '#ic-moon';
  else if (theme === 'sepia') icon = '#ic-palette';
  else if (theme === 'oasis') icon = '#ic-flame';
  $('themeBtn')?.querySelector('use')?.setAttribute('href', icon);
}
