'use strict';

import { isArabicHeavy, escapeHtml, escapeReg } from './i18n.js';
import { THEMES, getNextTheme, clampZoom } from './theme.js';
import { createState } from './state.js';
import { vaultSearch as _vaultSearch } from './search.js';
import { configureMarked, parseMarkdown as _parseMarkdown, parseCalloutHeader } from './markdown.js';
import { execEditCmd as _execEditCmdImpl } from './edit-commands.js';
import { applyBidi } from './bidi-dom.js';
import { resolveDirection, slugify, resolveDocDirection, nextCellIndex } from './bidi.js';
import { transformCallouts } from './callouts.js';
import { activeHeading } from './outline.js';
import { parseFrontMatter, frontMatterDirection } from './frontmatter.js';
import { dailyNoteName } from './dates.js';
import { highlightCode } from './highlight.js';
import { mathExtension, restoreMath, renderTex } from './math.js';
import { sanitizeHtml, sanitizeSvg } from './trusted.js';
import { renderMermaid } from './mermaid.js';
import { tableEdit } from './table-edit.js';
import { getFocusable, trapTab, rovingNext } from './focus.js';
import { t as tr, localeDirection } from './locale.js';
import { buildExportDoc as buildExportDocImpl } from './export.js';
import { createCodeMirrorAdapter } from './editor/codemirror-adapter.js';
import { isDroppableFile } from './file-predicates.js';
import { buildSession, pickActiveIndex } from './session.js';
import { buildFileTree, flattenTree } from './tree.js';

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
  editorMode: 'live',
  sidebarVisible: true,
  inspectorVisible: true,
  vaultName: null,
  recents: [],
  findHits: [],
  findIdx: 0,
  zoomFactor: 1,
  calendar: 'gregorian',
  arabicKashida: false,
  italicRecolor: true,
  cmEditor: false,
  uiLocale: 'en',
  uiDirection: 'ltr'
});

// Export for testing via window (smoke tests only)
window._appState = State;
window._appSubscribe = subscribe;

// When true, settings restore is in progress: suppress startup toasts and the
// write-back that would otherwise echo the just-restored values to disk.
let _restoring = false;

// =====================================================================
// CONSTANTS & DOM REFS
// =====================================================================
const $ = id => document.getElementById(id);
const appEl = $('app');
const appBody = $('appBody');
const tabsEl = $('tabs');
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
const toastEl = $('toast');
const fileInput = $('fileInput');
const modalOverlay = $('modalOverlay');
const modalTitle = $('modalTitle');
const modalBody = $('modalBody');
const editorArea = $('editorArea');
const srcTextarea = $('srcTextarea');

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
// `bpmd://vault/<relPath>`, served by the registered bpmd:// protocol (main.js)
// against the allow-listed vault root. No-op for absolute/scheme/data: srcs and
// for non-vault notes (browser/dev, new notes — they have no on-disk neighbour).
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
// active file's vaultRoot/path; a no-op when the note isn't an on-disk vault file.
function rewriteVaultImages(container) {
  if (!container) return;
  const file = State.activeFile != null ? State.files[State.activeFile] : null;
  if (!file || !file.vaultRoot) return;
  const noteDir = normalizeRel(String(file.path || '').replace(/[^\\/]*$/, ''));
  // Decode each segment first (so an already-percent-encoded author path isn't
  // double-encoded), then encode once — the protocol handler decodes once to the
  // literal filename. A no-op for plain names.
  const enc = (seg) => { let d = seg; try { d = decodeURIComponent(seg); } catch (_) { /* keep raw */ } return encodeURIComponent(d); };
  container.querySelectorAll('img[src]').forEach(img => {
    const rel = vaultRelImage(img.getAttribute('src'), noteDir);
    if (rel) img.setAttribute('src', 'bpmd://vault/' + rel.split('/').map(enc).join('/'));
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
  // Precedence: manual ⇄ override > front-matter direction > content first-strong.
  const docDir = resolveDocDirection({
    manual: appBody._manualRTL ? 'rtl' : null,
    frontMatter: fmDir,
    content: resolveDirection(body, 'ltr'),
  });
  applyBidi(noteContent, { baseDir: docDir, escape: escapeHtml });
  wireTableNav(noteContent); // T-R9: logical (EC-C2) arrow-key cell traversal in rendered tables
  // Front matter (or a manual toggle) flips the whole note's container direction;
  // otherwise the container stays neutral and each block resolves its own (R1/R2).
  const editorEl = $('editor');
  if (editorEl) {
    if (appBody._manualRTL) {
      // Manual ⇄ owns State.direction + the indicator (set in toggleRTL).
      editorEl.setAttribute('dir', docDir);
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
    if (typeof mermaidNS !== 'undefined') return init(mermaidNS);
    const s = document.createElement('script');
    s.src = 'assets/vendor/mermaid/mermaid.min.js';
    s.onload = () => init(window.mermaidNS);
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
  if (_restoring) return; // stay quiet while restoring persisted settings
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
  $('themeBtn').classList.toggle('active', next !== 'paper');
  if ($('themeLabel')) $('themeLabel').textContent = next;
  showToast(`Theme: ${next.charAt(0).toUpperCase() + next.slice(1)}`, 'info');
}
window.cycleTheme = cycleTheme;

function setTheme(t) {
  State.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('bpmdrtlreader-theme', t);
  $('themeBtn').classList.toggle('active', t !== 'paper');
  if ($('themeLabel')) $('themeLabel').textContent = t;
  closeMenu();
  showToast(`Theme: ${t.charAt(0).toUpperCase() + t.slice(1)}`, 'info');
}

// =====================================================================
// RTL
// =====================================================================
function toggleRTL() {
  const isRTL = State.direction === 'rtl';
  State.direction = isRTL ? 'ltr' : 'rtl';
  const editorEl = $('editor');
  if (State.direction === 'rtl') {
    srcTextarea.setAttribute('dir', 'auto');
    if (editorEl) editorEl.setAttribute('dir', 'rtl');
    appBody._manualRTL = true;
  } else {
    srcTextarea.removeAttribute('dir');
    if (editorEl) editorEl.removeAttribute('dir');
    appBody._manualRTL = false;
  }
  if (cmAdapter) cmAdapter.setDirection(State.direction); // T-F13: flip the CM6 source editor too
  updateDirUI();
  // Re-resolve per-block direction + inline isolation under the new override so
  // neutral-only blocks inherit the new base direction (EC-C1) and isolation is
  // refreshed immediately, not only on the next render.
  const af = State.files[State.activeFile];
  if (af) applyBidiToNote(af.content || '');
  showToast(`Direction: ${State.direction.toUpperCase()}`);
}
window.toggleRTL = toggleRTL;

function updateDirUI() {
  const isRTL = State.direction === 'rtl';
  $('dirIndicator').textContent = isRTL ? 'RTL' : 'LTR';
  $('propDir').textContent = isRTL ? 'RTL' : 'LTR';
  $('rtlBtn').classList.toggle('active', isRTL);
}

// =====================================================================
// SIDEBAR / INSPECTOR TOGGLE
// =====================================================================
function toggleSidebar() {
  State.sidebarVisible = !State.sidebarVisible;
  appBody.classList.toggle('no-sidebar', !State.sidebarVisible);
  showToast(`Sidebar: ${State.sidebarVisible ? 'shown' : 'hidden'}`, 'info');
}

function toggleInspector() {
  State.inspectorVisible = !State.inspectorVisible;
  appBody.classList.toggle('no-inspector', !State.inspectorVisible);
  closeMenu();
  showToast(`Inspector: ${State.inspectorVisible ? 'shown' : 'hidden'}`, 'info');
}
window.toggleInspector = toggleInspector;

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
  modalBody.innerHTML = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(html) : html;
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
      ['Command Palette','Ctrl+K']
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
    <div class="about-version">version 1.0.0 · ${new Date().getFullYear()}</div>
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
  if (State.editorMode === 'source' || cmAdapter) {
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
  if (State.editorMode === 'source' || cmAdapter) {
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
function buildExportDoc(f, { csp = false } = {}) {
  return buildExportDocImpl(f, {
    manualRtl: !!(appBody._manualRTL || State.direction === 'rtl'),
    parseMarkdown,
    csp,
    katex: (typeof katex !== 'undefined') ? katex : null,
    DOMPurify: (typeof DOMPurify !== 'undefined') ? DOMPurify : null,
  });
}

function exportHTML() {
  closeMenu();
  if (State.activeFile === null || !State.files[State.activeFile]) {
    showToast('No file to export', 'error'); return;
  }
  const { fullHtml, baseName } = buildExportDoc(State.files[State.activeFile]);
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
  const { fullHtml, baseName } = buildExportDoc(State.files[State.activeFile], { csp: true });
  showToast('Exporting PDF…');
  let res;
  try {
    res = await window.electronAPI.exportPDF({ html: fullHtml, defaultName: baseName + '.pdf' });
  } catch (_) {
    res = { error: 'ipc-failed' };
  }
  if (res && res.ok) showToast(`Exported ${String(res.path).split(/[\\/]/).pop()}`);
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
  if (!_restoring) showToast(`Arabic justification: ${State.arabicKashida ? 'kashida' : 'ragged'}`, 'info');
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
  if (!_restoring) showToast(`Italic recolour: ${State.italicRecolor ? 'on' : 'off'}`, 'info');
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
  // title= tooltips (find prev/next/close buttons, T-R7).
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    if (el.dataset.i18nTitleOrig === undefined) el.dataset.i18nTitleOrig = el.getAttribute('title') || '';
    el.setAttribute('title', locale === 'en' ? el.dataset.i18nTitleOrig : tr(el.dataset.i18nTitle, locale));
  });
}
function setUiLocale(locale) {
  if (locale !== 'en' && locale !== 'ar') return;
  State.uiLocale = locale;
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
  if (!_restoring) showToast(on ? 'الواجهة بالعربية' : 'English interface', 'info');
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
  // All logic lives in src/renderer/edit-commands.js (testable + mutatable).
  // This shim builds the deps object and forwards. Critically: selectAll is
  // NEVER routed through electronAPI.editCommand because webContents.selectAll
  // would select the entire renderer DOM (titlebar/sidebar/statusbar).
  const deps = {
    electronAPI: cmd === 'selectAll' ? null : (window.electronAPI || null),
    getMode: () => State.editorMode,
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
    const card = document.createElement('div');
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
  State.zoomFactor = clamped;
  document.documentElement.style.fontSize = (ZOOM_BASE_PX * clamped) + 'px';
  editorArea.style.zoom = ''; // drop the old content-only zoom — superseded by rem scaling
}
function zoomIn()    { setZoom(State.zoomFactor * 1.1); }
function zoomOut()   { setZoom(State.zoomFactor / 1.1); }
function zoomReset() { setZoom(1); }
window.setZoom   = setZoom;
window.zoomIn    = zoomIn;
window.zoomOut   = zoomOut;
window.zoomReset = zoomReset;

// =====================================================================
// TABS
// =====================================================================
function renderTabs() {
  tabsEl.querySelectorAll('.tab').forEach(t => t.remove());
  const addBtn = $('tabAddBtn');
  State.files.forEach((f, i) => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (i === State.activeFile ? ' active' : '') + (f.dirty ? ' dirty' : '') + (f.conflict ? ' conflict' : '');
    tab.title = f.conflict ? `${f.name} — changed on disk (unresolved)` : f.name;
    const closeIcon = f.dirty ? '●' : '×';
    // T-B9/EC-A2: a ⚠ marks a background tab whose file diverged on disk (surfaces the
    // conflict even when the tab isn't active; the resolve banner shows on switching to it).
    const conflictMark = f.conflict ? '<span class="tab-conflict" aria-label="changed on disk">⚠</span>' : '';
    tab.innerHTML = `${conflictMark}<span class="tab-name">${escapeHtml(f.name)}</span><span class="close">${closeIcon}</span>`;
    tab.querySelector('.close').addEventListener('click', e => { e.stopPropagation(); closeTab(i); });
    tab.addEventListener('click', () => renderFile(i));
    tabsEl.insertBefore(tab, addBtn);
  });
}

function closeTab(idx) {
  const f = State.files[idx];
  if (f.dirty) {
    if (!confirm(`"${f.name}" has unsaved changes. Close anyway?`)) return;
  }
  State.files.splice(idx, 1);
  if (State.files.length === 0) { State.activeFile = null; showWelcome(); return; }
  if (State.activeFile === idx) renderFile(Math.max(0, idx - 1));
  else { if (State.activeFile > idx) State.activeFile--; renderTabs(); }
}

function showWelcome() {
  welcomeEl.style.display = 'grid';
  noteContent.style.display = 'none';
  toolbarStrip.style.display = 'none';
  editorArea.classList.add('welcome'); // T-F13: reveal the welcome (preview pane) over the CM6 surface
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
// RENDER FILE
// =====================================================================
function renderFile(idx) {
  const file = State.files[idx];
  if (!file) return;
  State.activeFile = idx;

  welcomeEl.style.display = 'none';
  noteContent.style.display = 'block';
  toolbarStrip.style.display = 'flex';
  editorArea.classList.remove('welcome'); // T-F13: a file is open → show the CM6 live-preview surface

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
  rewriteVaultImages(noteContent); // R10: note-relative images → bpmd://vault/<rel>
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
  transformCallouts(noteContent, { parseCalloutHeader, resolveDirection });
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
  f.conflict = false;
  f.diskContent = null;
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
  const out = [];
  let off = 0, inFence = false;
  for (const line of String(src || '').split('\n')) {
    const isFence = /^[ \t]{0,3}(```|~~~)/.test(line);
    if (isFence) inFence = !inFence;
    else if (!inFence) {
      const m = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
      if (m) out.push({ pos: off, level: m[1].length, text: m[2].trim() });
    }
    off += line.length + 1;
  }
  return out;
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
    const item = document.createElement('div');
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

// Outline click → jump to the heading. CM6 is the sole surface now, so scroll the EDITOR to the
// heading line (and place the caret there); the old .preview-pane path stays for the textarea
// fallback (CM6-load failure), where the rendered pane IS the visible reading surface.
function scrollToHeading(entry) {
  if (cmAdapter && entry) {
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
  wrap.scrollTo({ top: Math.max(0, top - 12), behavior: 'smooth' });
}

function setupScrollSync() {
  // CM6 path: track the editor's own scroller and highlight the last heading at/above its top.
  if (cmAdapter && cmAdapter._view) {
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
  // Textarea-fallback path: the visible rendered preview pane scrolls.
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

// Build a nested, collapsible folder tree from the flat vault listing (T-F1/M3). Each
// row is indented by depth; dir rows toggle (click / Enter / Space / Arrow), file rows
// open. State.files index travels as fileIdx so highlightTreeActive + open still work.
function renderTree(entries) {
  treeEl.innerHTML = '';
  treeEl.style.display = 'block';
  sbEmptyEl.style.display = 'none';
  const collapsed = treeCollapsed();
  const root = buildFileTree(entries.map((f, i) => ({ name: f.name, relPath: f.path, fileIdx: i })));
  flattenTree(root, collapsed).forEach(row => {
    const node = document.createElement('div');
    node.setAttribute('role', 'treeitem');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', row.name);
    node.style.paddingInlineStart = `${8 + row.depth * 14}px`;
    const nameIsAr = isArabicHeavy(row.name);
    const nameHtml = `<span class="tree-name${nameIsAr ? ' arabic' : ''}"${nameIsAr ? ' dir="rtl"' : ''}>${escapeHtml(row.name)}</span>`;
    if (row.type === 'dir') {
      const isCollapsed = collapsed.has(row.path);
      node.className = 'tree-node tree-dir';
      node.setAttribute('aria-expanded', String(!isCollapsed));
      node.innerHTML = `<span class="tree-twisty">${isCollapsed ? '▸' : '▾'}</span>${nameHtml}`;
      const setOpen = (open) => {
        if (open === !collapsed.has(row.path)) return; // no change
        if (open) collapsed.delete(row.path); else collapsed.add(row.path);
        saveTreeCollapsed(); renderTree(entries);
      };
      node.addEventListener('click', () => setOpen(collapsed.has(row.path)));
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(collapsed.has(row.path)); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); setOpen(true); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); setOpen(false); }
      });
    } else {
      node.className = 'tree-node tree-file';
      node.dataset.fileIdx = row.fileIdx;
      node.innerHTML = `<span class="tree-icon">¶</span>${nameHtml}`;
      const activate = () => openFromTree(row.fileIdx);
      node.addEventListener('click', activate);
      node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
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
  const tagMap = {};
  State.files.forEach((f, i) => {
    const re = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;
    let m;
    while ((m = re.exec(f.content || '')) !== null) {
      if (!tagMap[m[1]]) tagMap[m[1]] = [];
      if (!tagMap[m[1]].includes(i)) tagMap[m[1]].push(i);
    }
  });
  const tags = Object.entries(tagMap).sort((a, b) => b[1].length - a[1].length);
  if (!tags.length) {
    tagsPane.innerHTML = '<div class="search-empty">No tags found.</div>';
    return;
  }
  tagsPane.innerHTML = `<div class="tag-cloud">${tags.map(([t, files]) =>
    `<span class="tag" data-tag="${escapeHtml(t)}">${escapeHtml(t)}<span class="count">${files.length}</span></span>`
  ).join('')}</div>`;
  tagsPane.querySelectorAll('.tag').forEach(el => {
    el.addEventListener('click', () => filterByTag(el.dataset.tag));
  });
}

function filterByTag(tag) {
  switchSbPane('search');
  $('sbSearchInput').value = '#' + tag;
  runSidebarSearch('#' + tag);
}

// =====================================================================
// FILE I/O
// =====================================================================
// Absolute path of the open vault (M6 session restore); the per-file relPaths live on State.files.
let _vaultPath = null;
async function openVault() {
  closeMenu();
  // Branch 1: Electron IPC path — preferred in packaged builds (Bug 1 / AC1)
  if (window.electronAPI && typeof window.electronAPI.openFolder === 'function') {
    try {
      const result = await window.electronAPI.openFolder();
      if (result.canceled || !result.folderPath) return;
      const folderPath = result.folderPath;
      const entries = await window.electronAPI.readVault(folderPath);
      const folderName = folderPath.split(/[\\/]/).filter(Boolean).pop() || 'folder';
      State.vaultName = folderName;
      _vaultPath = folderPath; // remember the absolute root for last-session restore (M6)
      // vaultRoot = the authorized absolute folder; lets saveCurrent() write the note
      // back in place via the fs:writeFile IPC bridge instead of a Blob download (M08).
      const md = entries.map(e => ({ name: e.name, path: e.relPath, handle: null, content: e.content, dirty: false, vaultRoot: folderPath }));
      State.files = md;
      $('vaultName').textContent = folderName;
      $('vaultName').classList.remove('empty');
      $('sbVault').textContent = `folder: ${folderName}`;
      if (md.length === 0) {
        showToast('Folder opened — no .md files found', 'info');
      } else {
        renderTree(md);
        renderFile(0);
        showToast(`Opened "${folderName}" — ${md.length} note${md.length === 1 ? '' : 's'}`);
      }
    } catch(e) {
      if (e.name !== 'AbortError') { showToast('Could not open folder', 'error'); }
    }
    return;
  }
  // Branch 2: File System Access API (browser / dev mode)
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await window.showDirectoryPicker();
      State.vaultName = handle.name;
      State.files = [];
      const md = [];
      for await (const entry of handle.values()) {
        if (entry.kind === 'file' && /\.(md|markdown)$/i.test(entry.name)) {
          md.push({ name: entry.name, path: entry.name, handle: entry, content: '', dirty: false });
        }
      }
      md.sort((a, b) => a.name.localeCompare(b.name));
      State.files = md;
      _vaultPath = null; // FSA vault has no absolute path for the readVault restore bridge (M6)
      $('vaultName').textContent = handle.name;
      $('vaultName').classList.remove('empty');
      $('sbVault').textContent = `folder: ${handle.name}`;
      if (md.length === 0) {
        showToast('Folder opened — no .md files found', 'info');
      } else {
        renderTree(md);
        renderFile(0);
        showToast(`Opened "${handle.name}" — ${md.length} note${md.length === 1 ? '' : 's'}`);
      }
    } catch(e) {
      if (e.name !== 'AbortError') { console.error(e); showToast('Could not open folder', 'error'); }
    }
  } else {
    // FSA unavailable — fall back to a hidden <input webkitdirectory>
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.setAttribute('webkitdirectory', '');
    inp.setAttribute('multiple', '');
    inp.accept = '.md,.markdown';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', async () => {
      const files = Array.from(inp.files || []).filter(f => /\.(md|markdown)$/i.test(f.name));
      document.body.removeChild(inp);
      if (files.length === 0) return;
      const md = [];
      for (const file of files) {
        const content = await file.text();
        md.push({ name: file.name, path: file.name, handle: null, content, dirty: false });
      }
      md.sort((a, b) => a.name.localeCompare(b.name));
      const folderName = files[0].webkitRelativePath.split('/')[0] || 'folder';
      State.vaultName = folderName;
      State.files = md;
      _vaultPath = null; // webkitdirectory vault is not restorable via the readVault bridge (M6)
      $('vaultName').textContent = folderName;
      $('vaultName').classList.remove('empty');
      $('sbVault').textContent = `folder: ${folderName}`;
      renderTree(md);
      renderFile(0);
      showToast(`Opened "${folderName}" — ${md.length} note${md.length === 1 ? '' : 's'}`);
    });
    inp.click();
  }
}
window.openVault = openVault;

async function openSingleFile() {
  closeMenu();
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }]
      });
      const file = await handle.getFile();
      const content = await file.text();
      addFile({ name: file.name, path: file.name, handle, content, dirty: false });
      showToast(`Opened ${file.name}`);
    } catch(e) {
      if (e.name !== 'AbortError') console.error(e);
    }
    return;
  }
  fileInput.click();
}
window.openSingleFile = openSingleFile;

fileInput.addEventListener('change', async () => {
  for (const file of fileInput.files) {
    const content = await file.text();
    addFile({ name: file.name, path: file.name, handle: null, content, dirty: false });
  }
  if (fileInput.files.length > 0) showToast(`Opened ${fileInput.files.length} file(s)`);
  fileInput.value = '';
});

function addFile(f) {
  const existing = State.files.findIndex(x => x.name === f.name && x.path === f.path);
  if (existing >= 0) { State.files[existing] = f; renderFile(existing); }
  else { State.files.push(f); renderFile(State.files.length - 1); }
}

function newNote() {
  closeMenu();
  const n = State.files.filter(f => f.name.startsWith('Untitled')).length;
  const name = `Untitled${n > 0 ? '-' + n : ''}.md`;
  addFile({ name, path: name, handle: null, content: `# Untitled\n\nStart writing…\n`, dirty: true });
}
window.newNote = newNote;

async function saveCurrent() {
  closeMenu();
  if (State.activeFile === null || !State.files[State.activeFile]) { showToast('No file to save', 'error'); return; }
  const f = State.files[State.activeFile];
  // Branch 1: an FSA handle (file opened via showOpenFilePicker / showDirectoryPicker,
  // browser or dev) — write in place through the File System Access API.
  if (f.handle && f.handle.createWritable) {
    try {
      const w = await f.handle.createWritable();
      await w.write(f.content); await w.close();
      f.dirty = false; renderTabs();
      showToast(`Saved ${f.name}`);
    } catch(e) { showToast('Could not save', 'error'); }
    return;
  }
  // Branch 2: a vault file in the packaged Electron app — handle is null, so write it
  // back in place through the atomic, allow-listed fs:writeFile IPC bridge (M08). This
  // is the path the prior code missed: it fell straight to a Blob download of a copy.
  if (f.vaultRoot && window.electronAPI && typeof window.electronAPI.writeFile === 'function') {
    try {
      const res = await window.electronAPI.writeFile({ folderPath: f.vaultRoot, relPath: f.path, content: f.content });
      if (res && res.ok) {
        f.dirty = false; renderTabs();
        showToast(`Saved ${f.name}`);
      } else {
        const why = res && res.error ? res.error : 'unknown';
        showToast(`Could not save ${f.name} (${why})`, 'error');
      }
    } catch(e) { showToast('Could not save', 'error'); }
    return;
  }
  // Branch 3: browser fallback (no handle, no IPC) — offer the content as a download.
  const blob = new Blob([f.content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${f.name}`);
}
window.saveCurrent = saveCurrent;

async function saveAs() {
  closeMenu();
  if (State.activeFile === null || !State.files[State.activeFile]) { showToast('No file to save', 'error'); return; }
  const f = State.files[State.activeFile];
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: f.name,
        types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }]
      });
      const w = await handle.createWritable();
      await w.write(f.content); await w.close();
      f.handle = handle; f.name = handle.name; f.path = handle.name; f.dirty = false;
      renderTabs(); renderFile(State.activeFile);
      showToast(`Saved as ${handle.name}`);
    } catch(e) { if (e.name !== 'AbortError') showToast('Could not save', 'error'); }
  } else { saveCurrent(); }
}

// =====================================================================
// RECENTS
// =====================================================================
function pushRecent(f) {
  State.recents = [{ name: f.name, path: f.path }, ...State.recents.filter(r => r.path !== f.path)].slice(0, 5);
  renderRecents();
}
function renderRecents() {
  const list = $('recentList'), empty = $('recentEmpty');
  if (!list) return;
  if (State.recents.length === 0) { empty.style.display = 'block'; list.innerHTML = ''; return; }
  empty.style.display = 'none';
  list.innerHTML = State.recents.map(r =>
    `<div class="recent-item" data-path="${escapeHtml(r.path)}"><span class="r-ic">¶</span><span>${escapeHtml(r.name)}</span><span class="r-path">${escapeHtml(r.path)}</span></div>`
  ).join('');
  list.querySelectorAll('.recent-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = State.files.findIndex(f => f.path === el.dataset.path);
      if (idx >= 0) renderFile(idx);
    });
  });
}

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
  _vaultPath = null; // demos are ephemeral — NOT a restorable Electron vault, so don't persist a conflated session (M6)
  State.files = demos;
  State.vaultName = 'demo';
  $('vaultName').textContent = 'demo';
  $('vaultName').classList.remove('empty');
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
  f.dirty = true;
  renderTabs();
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
    rewriteVaultImages(noteContent); // R10: note-relative images → bpmd://vault/<rel>
    transformCallouts(noteContent, { parseCalloutHeader, resolveDirection });
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
    s.src = 'assets/vendor/codemirror/codemirror.min.js';
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
    applyBidi(el, { baseDir: State.direction === 'rtl' ? 'rtl' : 'ltr', escape: escapeHtml });
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
    transformCallouts(el, { parseCalloutHeader, resolveDirection }); // > [!NOTE] → styled callout (F14)
    decorateBlockContent(el); // highlight code + render KaTeX inside the callout body (F9 parity)
    applyBidi(el, { baseDir: State.direction === 'rtl' ? 'rtl' : 'ltr', escape: escapeHtml });
    return el;
  }
  if (type === 'image') {
    // Render the standalone image through the same sanitized pipeline; the <img> loads via the
    // same src/CSP rules (bpmd:// vault images, data:, file:) as the preview pane.
    const tmp = document.createElement('div');
    tmp.innerHTML = parseMarkdown(source);
    rewriteVaultImages(tmp); // R10: note-relative images → bpmd://vault/<rel>
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
  if (!_restoring) showToast(`Live-preview editor: ${on ? 'on (CodeMirror)' : 'off (classic)'}`, 'info');
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
  { sec: 'Help', key: 'palette.about', icon: 'info', name: 'About BP MD RTL Reader', meta: 'help', act: showAbout }
];

let palIdx = 0, palVisible = [];
function openPalette() {
  if (dropdown.classList.contains('open')) closeMenu(); // don't strand a menu open behind the overlay (returns focus to its button first)
  if (!palOverlay.classList.contains('open')) pushFocus(); // remember the opener (may be inside a modal)
  palOverlay.classList.add('open');
  palInput.value = '';
  filterPalette('');
  setTimeout(() => palInput.focus(), 50);
}
function closePalette() {
  const wasOpen = palOverlay.classList.contains('open');
  palOverlay.classList.remove('open');
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
window.newDailyNote = newDailyNote;
window.renderTree = renderTree;
window.showWelcome = showWelcome;
window.parseMarkdown = parseMarkdown;
window.PALETTE_COMMANDS = PALETTE_COMMANDS;

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
      html += `<div class="pal-item${palVisible.length === 1 ? ' active' : ''}" data-i="${palVisible.length - 1}">
        <span class="pi-icon">${it.icon ? `<svg class="ic"><use href="#ic-${escapeHtml(it.icon)}"/></svg>` : ''}</span>
        <span class="pi-name">${escapeHtml(it._label || it.name)}</span>
        <span class="pi-meta">${escapeHtml(it.meta || '')}</span>
        ${sk}
      </div>`;
    });
  });
  if (!items.length) html = `<div class="search-empty" style="padding: 20px;">${escapeHtml(tr('palette.noMatches', loc))}</div>`;
  palResults.innerHTML = html;
  palIdx = 0;
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

palInput.addEventListener('keydown', e => {
  const items = palResults.querySelectorAll('.pal-item');
  if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palIdx + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('active', i === palIdx)); items[palIdx]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); items.forEach((it, i) => it.classList.toggle('active', i === palIdx)); }
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
function winClose() {
  const dirty = State.files.filter(f => f.dirty).length;
  if (dirty > 0) { if (!confirm(`${dirty} unsaved file${dirty === 1 ? '' : 's'}. Close anyway?`)) return; }
  if (window.electronAPI) window.electronAPI.closeWindow();
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
    else if ($('findBar').classList.contains('open')) closeFind();
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
$('showSidebarStrip').addEventListener('click', toggleSidebar);
$('showInspectorStrip').addEventListener('click', toggleInspector);
$('themeBtn').addEventListener('click', cycleTheme);
$('rtlBtn').addEventListener('click', toggleRTL);
$('tabAddBtn').addEventListener('click', newNote);
$('searchBtn').addEventListener('click', openPalette);
$('winMinBtn').addEventListener('click', winMinimize);
$('winMaxBtn').addEventListener('click', winMaximize);
$('winCloseBtn').addEventListener('click', winClose);
$('modalCloseBtn').addEventListener('click', closeModal);
$('modalOverlay').addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
$('palOverlay').addEventListener('click', e => { if (e.target === palOverlay) closePalette(); });

document.querySelectorAll('.tb-menu-item').forEach(btn => {
  // Keep the editor focused/selected when opening a menu — a mousedown would
  // otherwise blur the textarea, breaking Copy/Cut/Undo run from the Edit menu.
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', e => openMenu(e, btn.dataset.menu));
});
document.querySelectorAll('.sb-tab').forEach(btn => {
  btn.addEventListener('click', () => switchSbPane(btn.dataset.pane));
});
$('sbSearchInput').addEventListener('input', e => runSidebarSearch(e.target.value));
$('sbOpenVaultBtn').addEventListener('click', openVault);
$('sbOpenFileBtn').addEventListener('click', openSingleFile);
$('sbNewNoteBtn').addEventListener('click', newNote);
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

// ==== EXTERNAL FILE OPEN (Windows file-association / macOS dock drop) ====
// Main process sends this when the user launches BP MD RTL Reader by double-clicking a
// .md file with BP MD RTL Reader set as the default handler. We add it as a tab and
// render it immediately.
function openExternalFile({ name, path: filePath, content }) {
  if (!name || typeof content !== 'string') return;
  addFile({ name, path: filePath || name, handle: null, content, dirty: false });
}
window.openExternalFile = openExternalFile;
if (window.electronAPI && typeof window.electronAPI.onOpenFile === 'function') {
  window.electronAPI.onOpenFile(openExternalFile);
}

// T-B9 + EC-A2: the vault changed on disk (external edit). Re-list it, then reconcile:
// files with NO local edits silently adopt the disk content; a file with UNSAVED edits
// whose disk copy diverged is flagged `conflict` (its edits are kept — never silently
// overwritten — and the disk version is stashed on `diskContent`). The active file is
// preserved by path across the re-list so tabs/selection survive added/removed files.
async function handleVaultChanged({ folderPath, files } = {}) {
  if (!folderPath || !window.electronAPI || typeof window.electronAPI.readVault !== 'function') return;
  if (State.vaultName !== (String(folderPath).split(/[\\/]/).filter(Boolean).pop() || '')) return; // not the open vault
  let entries;
  try { entries = await window.electronAPI.readVault(folderPath); } catch (_) { return; }
  if (!Array.isArray(entries)) return; // an error object → leave state untouched

  const activePath = State.activeFile != null ? State.files[State.activeFile]?.path : null;
  const prevByPath = new Map(State.files.map(f => [f.path, f]));
  // Compare on EOL/CR-normalized text so a CRLF-only or trailing-newline difference is
  // NOT mistaken for a real change (avoids false conflicts + needless re-renders).
  const norm = (s) => String(s == null ? '' : s).replace(/\r\n?/g, '\n');
  let conflictName = null;
  const changedActive = { reloaded: false };

  const merged = entries.map(e => {
    const prev = prevByPath.get(e.relPath);
    if (!prev) return { name: e.name, path: e.relPath, handle: null, content: e.content, dirty: false, vaultRoot: folderPath };
    if (norm(prev.content) === norm(e.content)) return prev; // unchanged → keep (no churn)
    if (prev.dirty) {
      if (e.relPath === activePath) conflictName = prev.name;
      return { ...prev, conflict: true, diskContent: e.content }; // EC-A2: keep edits, stash disk copy
    }
    if (e.relPath === activePath) changedActive.reloaded = true;
    return { ...prev, content: e.content, conflict: false, diskContent: null }; // adopt disk (no local edits)
  });
  // Preserve open-but-now-deleted files as tabs so unsaved work is never lost.
  for (const f of State.files) {
    if (!entries.some(e => e.relPath === f.path)) merged.push(f);
  }

  State.files = merged;
  if (activePath != null) {
    const idx = merged.findIndex(f => f.path === activePath);
    State.activeFile = idx >= 0 ? idx : State.activeFile;
  }
  renderTree(State.files);
  // Re-render the open view if the active file was reloaded OR just became conflicted
  // (so its EC-A2 resolve banner appears); otherwise just refresh the tabs.
  if (changedActive.reloaded || conflictName) renderFile(State.activeFile);
  else renderTabs();
  if (conflictName) showToast(`"${conflictName}" changed on disk — your edits are kept; resolve in the editor.`, 'error');
}
window.handleVaultChanged = handleVaultChanged;
if (window.electronAPI && typeof window.electronAPI.onVaultChanged === 'function') {
  window.electronAPI.onVaultChanged(handleVaultChanged);
}

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
const PERSISTED_KEYS = new Set([
  'theme', 'zoomFactor', 'editorMode', 'sidebarVisible', 'inspectorVisible', 'recents', 'calendar', 'arabicKashida', 'italicRecolor', 'cmEditor', 'uiLocale', 'uiDirection',
]);
let _persistTimer = null;
function persistSettings() {
  if (!SettingsBridge || _restoring) return;
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    try {
      SettingsBridge.setSettings({
        theme: State.theme,
        zoomFactor: State.zoomFactor,
        editorMode: State.editorMode,
        sidebarVisible: State.sidebarVisible,
        inspectorVisible: State.inspectorVisible,
        recents: State.recents.map(r => ({ name: r.name, path: r.path })),
        calendar: State.calendar,
        arabicKashida: State.arabicKashida,
        italicRecolor: State.italicRecolor,
        cmEditor: State.cmEditor,
        uiLocale: State.uiLocale,
        uiDirection: State.uiDirection,
        lastSession: buildSession(_vaultPath, State.files, State.activeFile), // M6
      });
    } catch (_) { /* persistence is best-effort; never break the UI */ }
  }, 200);
}
window.persistSettings = persistSettings;
// Persist whenever a persisted key changes (debounced inside persistSettings).
subscribe((key) => { if (PERSISTED_KEYS.has(key)) persistSettings(); });

async function restoreSettings() {
  if (!SettingsBridge) return false;
  let s;
  try { s = await SettingsBridge.getSettings(); } catch (_) { return false; }
  if (!s || typeof s !== 'object') return false;
  _restoring = true; // suppress toasts + write-back while applying
  try {
    if (THEMES.includes(s.theme)) {
      State.theme = s.theme;
      document.documentElement.setAttribute('data-theme', s.theme);
      $('themeBtn')?.classList.toggle('active', s.theme !== 'paper');
      if ($('themeLabel')) $('themeLabel').textContent = s.theme;
    }
    if (typeof s.zoomFactor === 'number') setZoom(s.zoomFactor);
    // CM6 is the sole editor now — always 'live'. Ignore any persisted split/source so an
    // old setting can't re-show the second pane alongside the live-preview surface (T-F13).
    setEditorMode('live');
    if (typeof s.sidebarVisible === 'boolean') {
      State.sidebarVisible = s.sidebarVisible;
      appBody.classList.toggle('no-sidebar', !s.sidebarVisible);
    }
    if (typeof s.inspectorVisible === 'boolean') {
      State.inspectorVisible = s.inspectorVisible;
      appBody.classList.toggle('no-inspector', !s.inspectorVisible);
    }
    if (Array.isArray(s.recents)) {
      State.recents = s.recents
        .filter(r => r && typeof r.path === 'string')
        .map(r => ({ name: String(r.name || ''), path: r.path }));
      renderRecents();
    }
    if (s.calendar === 'hijri' || s.calendar === 'gregorian') State.calendar = s.calendar;
    if (typeof s.arabicKashida === 'boolean') { State.arabicKashida = s.arabicKashida; applyKashida(); }
    if (typeof s.italicRecolor === 'boolean') { State.italicRecolor = s.italicRecolor; applyItalicRecolor(); }
    if (typeof s.cmEditor === 'boolean') State.cmEditor = s.cmEditor; // A1: governs the startup initCM6Editor() below
    if (s.uiLocale === 'ar' || s.uiLocale === 'en') setUiLocale(s.uiLocale);       // T-R7
    if (s.uiDirection === 'rtl' || s.uiDirection === 'ltr') setUiDirection(s.uiDirection);
    await restoreLastSession(s.lastSession); // M6: re-open the last vault + active note
  } finally {
    _restoring = false;
  }
  return true;
}
window.restoreSettings = restoreSettings;

// M6: re-open the vault + active note from the previous session. Best-effort — a moved,
// deleted, or unauthorized vault degrades to the welcome screen without a toast. Runs
// while _restoring is true, so the renderFile→persistSettings hook is a no-op (no clobber).
async function restoreLastSession(ls) {
  if (!ls || typeof ls.vaultPath !== 'string' || !ls.vaultPath) return;
  if (!window.electronAPI || typeof window.electronAPI.readVault !== 'function') return;
  let entries;
  try { entries = await window.electronAPI.readVault(ls.vaultPath); }
  catch (_) { return; }
  if (!Array.isArray(entries) || !entries.length) return;
  const folderName = ls.vaultPath.split(/[\\/]/).filter(Boolean).pop() || 'folder';
  State.vaultName = folderName;
  _vaultPath = ls.vaultPath;
  State.files = entries.map(e => ({ name: e.name, path: e.relPath, handle: null, content: e.content, dirty: false }));
  const vn = $('vaultName'); if (vn) { vn.textContent = folderName; vn.classList.remove('empty'); }
  const sv = $('sbVault'); if (sv) sv.textContent = `folder: ${folderName}`;
  renderTree(State.files);
  renderFile(pickActiveIndex(State.files, ls.activePath));
}

// =====================================================================
// INIT
// =====================================================================
(function init() {
  // Detect Electron and apply native-window overrides
  if (window.electronAPI) document.documentElement.classList.add('electron');

  // Restore persisted settings from the main process. When there is no bridge
  // (browser/dev), fall back to the localStorage theme exactly as before.
  restoreSettings().then((restored) => {
    if (!restored) {
      const stored = localStorage.getItem('bpmdrtlreader-theme');
      if (stored && THEMES.includes(stored)) {
        State.theme = stored;
        document.documentElement.setAttribute('data-theme', stored);
        $('themeBtn')?.classList.toggle('active', stored !== 'paper');
        if ($('themeLabel')) $('themeLabel').textContent = stored;
      }
    }
    // T-F13/A1: mount CM6 if the persisted "Live-Preview Editor" setting (or ?cm=1 / localStorage)
    // asks for it — AFTER restore so State.cmEditor is in effect. Lazy + reversible; textarea on failure.
    initCM6Editor().catch(() => { /* fall back to the textarea */ });
  });

  showWelcome();
  initDragDrop();
})();

