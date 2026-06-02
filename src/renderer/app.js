'use strict';

import { isArabicHeavy, escapeHtml, escapeReg } from './i18n.js';
import { THEMES, getNextTheme, clampZoom } from './theme.js';
import { createState } from './state.js';
import { vaultSearch as _vaultSearch } from './search.js';
import { configureMarked, parseMarkdown as _parseMarkdown, parseCalloutHeader } from './markdown.js';
import { execEditCmd as _execEditCmdImpl } from './edit-commands.js';
import { applyBidi } from './bidi-dom.js';
import { resolveDirection, slugify, resolveDocDirection } from './bidi.js';
import { transformCallouts } from './callouts.js';
import { activeHeading } from './outline.js';
import { parseFrontMatter, frontMatterDirection } from './frontmatter.js';
import { dailyNoteName } from './dates.js';
import { highlightCode } from './highlight.js';
import { mathExtension, restoreMath } from './math.js';
import { sanitizeHtml, sanitizeSvg } from './trusted.js';
import { renderMermaid } from './mermaid.js';
import { getFocusable, trapTab, rovingNext } from './focus.js';

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
  arabicKashida: false
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

// Code highlighting + KaTeX math (T-F9). Runs on the rendered DOM BEFORE the bidi
// pass so code blocks (forced dir=ltr) and KaTeX spans (dir=ltr, ltr-isolated)
// compose with R1/R2. Both libraries are vendored locally and sanitized.
function decorateCodeAndMath() {
  if (typeof hljs !== 'undefined') {
    highlightCode(noteContent, { hljs, sanitize: (h) => sanitizeHtml(h, DOMPurify) });
  }
  if (typeof katex !== 'undefined') {
    restoreMath(noteContent, { katex, DOMPurify });
  }
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

// =====================================================================
// DROPDOWN MENUS
// =====================================================================
const MENU_DEFS = {
  file: {
    x: 76,
    items: [
      { kind: 'label', text: 'Open' },
      { kind: 'item', icon: '⌂', name: 'Open Folder…', shortcut: 'Ctrl+Shift+O', action: () => openVault() },
      { kind: 'item', icon: '¶', name: 'Open File…', shortcut: 'Ctrl+O', action: () => openSingleFile() },
      { kind: 'divider' },
      { kind: 'label', text: 'New' },
      { kind: 'item', icon: '+', name: 'New Note', shortcut: 'Ctrl+N', action: () => newNote() },
      { kind: 'item', icon: '◷', name: 'New Daily Note', shortcut: 'Ctrl+Shift+N', action: () => newDailyNote() },
      { kind: 'divider' },
      { kind: 'item', icon: '↓', name: 'Save', shortcut: 'Ctrl+S', action: () => saveCurrent() },
      { kind: 'item', icon: '⇣', name: 'Save As…', shortcut: 'Ctrl+Shift+S', action: () => saveAs() },
      { kind: 'divider' },
      { kind: 'item', icon: '⇪', name: 'Export HTML', action: () => exportHTML() },
      { kind: 'item', icon: '⎙', name: 'Export PDF', action: () => exportPDF() },
      { kind: 'divider' },
      { kind: 'item', icon: '★', name: 'Load Demo Notes', action: () => loadDemo() },
      { kind: 'divider' },
      { kind: 'item', icon: '×', name: 'Close Tab', shortcut: 'Ctrl+W', action: () => { if (State.activeFile !== null) closeTab(State.activeFile); closeMenu(); } },
      { kind: 'item', icon: '×', name: 'Close Window', shortcut: 'Alt+F4', action: () => winClose() }
    ]
  },
  edit: {
    x: 110,
    items: [
      { kind: 'item', icon: '↶', name: 'Undo', shortcut: 'Ctrl+Z', action: () => execEditCmd('undo') },
      { kind: 'item', icon: '↷', name: 'Redo', shortcut: 'Ctrl+Y', action: () => execEditCmd('redo') },
      { kind: 'divider' },
      { kind: 'item', icon: '✂', name: 'Cut', shortcut: 'Ctrl+X', action: () => execEditCmd('cut') },
      { kind: 'item', icon: '⧉', name: 'Copy', shortcut: 'Ctrl+C', action: () => execEditCmd('copy') },
      { kind: 'item', icon: '⎘', name: 'Paste', shortcut: 'Ctrl+V', action: () => execEditCmd('paste') },
      { kind: 'item', icon: '⊟', name: 'Select All', shortcut: 'Ctrl+A', action: () => execEditCmd('selectAll') },
      { kind: 'divider' },
      { kind: 'item', icon: '⌕', name: 'Find…', shortcut: 'Ctrl+F', action: () => { closeMenu(); openFind(); } },
      { kind: 'divider' },
      { kind: 'item', icon: 'B', name: 'Bold', shortcut: 'Ctrl+B', action: () => { closeMenu(); wrapSelection('**', '**'); } },
      { kind: 'item', icon: 'I', name: 'Italic', shortcut: 'Ctrl+I', action: () => { closeMenu(); wrapSelection('*', '*'); } },
      { kind: 'item', icon: '∞', name: 'Insert Link', shortcut: 'Ctrl+L', action: () => { closeMenu(); insertText('[', '](url)'); } },
      { kind: 'item', icon: '[[', name: 'Insert Wikilink', action: () => { closeMenu(); insertText('[[', ']]'); } }
    ]
  },
  view: {
    x: 145,
    items: [
      { kind: 'label', text: 'Mode' },
      { kind: 'check', name: 'Live Preview', checked: () => State.editorMode === 'live', action: () => { setEditorMode('live'); closeMenu(); } },
      { kind: 'check', name: 'Split View', checked: () => State.editorMode === 'split', action: () => { setEditorMode('split'); closeMenu(); } },
      { kind: 'check', name: 'Source Mode', checked: () => State.editorMode === 'source', action: () => { setEditorMode('source'); closeMenu(); } },
      { kind: 'divider' },
      { kind: 'label', text: 'Panels' },
      { kind: 'check', name: 'Show Sidebar', shortcut: 'Ctrl+\\', checked: () => State.sidebarVisible, action: () => { toggleSidebar(); closeMenu(); } },
      { kind: 'check', name: 'Show Inspector', shortcut: 'Ctrl+Shift+I', checked: () => State.inspectorVisible, action: toggleInspector },
      { kind: 'divider' },
      { kind: 'label', text: 'Theme' },
      { kind: 'check', name: 'Paper (light)', checked: () => State.theme === 'paper', action: () => setTheme('paper') },
      { kind: 'check', name: 'Ink (dark)', checked: () => State.theme === 'ink', action: () => setTheme('ink') },
      { kind: 'check', name: 'Sepia', checked: () => State.theme === 'sepia', action: () => setTheme('sepia') },
      { kind: 'divider' },
      { kind: 'item', icon: '⇄', name: 'Flip Direction (RTL/LTR)', shortcut: 'Ctrl+Shift+L', action: () => { toggleRTL(); closeMenu(); } },
      { kind: 'divider' },
      { kind: 'label', text: 'Calendar' },
      { kind: 'check', name: 'Gregorian', checked: () => State.calendar === 'gregorian', action: () => setCalendar('gregorian') },
      { kind: 'check', name: 'Hijri (Umm al-Qura)', checked: () => State.calendar === 'hijri', action: () => setCalendar('hijri') },
      { kind: 'divider' },
      { kind: 'label', text: 'Arabic' },
      { kind: 'check', name: 'Kashida Justification', checked: () => State.arabicKashida, action: () => toggleKashida() },
      { kind: 'divider' },
      { kind: 'label', text: 'Zoom' },
      { kind: 'item', icon: '+', name: 'Zoom In',    shortcut: 'Ctrl+=', action: () => { zoomIn();    closeMenu(); } },
      { kind: 'item', icon: '−', name: 'Zoom Out',   shortcut: 'Ctrl+-', action: () => { zoomOut();   closeMenu(); } },
      { kind: 'item', icon: '1', name: 'Reset Zoom', shortcut: 'Ctrl+0', action: () => { zoomReset(); closeMenu(); } },
      { kind: 'divider' },
      { kind: 'item', icon: '⌘', name: 'Command Palette', shortcut: 'Ctrl+K', action: () => { closeMenu(); openPalette(); } }
    ]
  },
  help: {
    x: 184,
    items: [
      { kind: 'item', icon: '⌨', name: 'Keyboard Shortcuts', shortcut: 'Ctrl+/', action: showShortcuts },
      { kind: 'item', icon: 'i', name: 'About BP MD RTL Reader', action: showAbout }
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
  dropdown.style.insetInlineStart = MENU_DEFS[name].x + 'px';
  _menuOpener = e.currentTarget;
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
  def.items.forEach((it, i) => {
    if (it.kind === 'label') html += `<div class="dd-section-label">${escapeHtml(it.text)}</div>`;
    else if (it.kind === 'divider') html += `<div class="dd-divider"></div>`;
    else if (it.kind === 'check') {
      const checked = it.checked ? it.checked() : false;
      html += `<div class="dd-item${checked ? ' checked' : ''}" data-i="${i}" role="menuitemcheckbox" aria-checked="${checked}" tabindex="0">
        <span class="dd-check">✓</span><span class="dd-icon">·</span>
        <span class="dd-name">${escapeHtml(it.name)}</span>
        ${it.shortcut ? `<span class="dd-shortcut">${escapeHtml(it.shortcut)}</span>` : ''}
      </div>`;
    } else {
      html += `<div class="dd-item${it.disabled ? ' disabled' : ''}" data-i="${i}" role="menuitem"${it.disabled ? ' aria-disabled="true"' : ' tabindex="0"'}>
        <span class="dd-icon">${escapeHtml(it.icon || '·')}</span>
        <span class="dd-name">${escapeHtml(it.name)}</span>
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

  // Source mode: search inside the textarea, since the preview is hidden.
  if (State.editorMode === 'source') {
    if (!q) { $('findInfo').textContent = '0/0'; return; }
    const re = new RegExp(escapeReg(q), 'gi');
    const val = srcTextarea.value;
    let m, matches = [];
    while ((m = re.exec(val)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length });
      if (m.index === re.lastIndex) re.lastIndex++; // safety
    }
    State.findSourceMatches = matches;
    State.findIdx = 0;
    if (matches.length) {
      srcTextarea.focus();
      srcTextarea.setSelectionRange(matches[0].start, matches[0].end);
      // Scroll the textarea to keep the selection visible without moving the
      // statusbar — textareas handle this natively when setSelectionRange runs
      // on a focused element, so no extra work needed.
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
  // Source mode: navigate textarea match positions
  if (State.editorMode === 'source') {
    const matches = State.findSourceMatches || [];
    if (!matches.length) return;
    State.findIdx = (State.findIdx + d + matches.length) % matches.length;
    const m = matches[State.findIdx];
    srcTextarea.focus();
    srcTextarea.setSelectionRange(m.start, m.end);
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
// Build the standalone, bidi-aware export document for a file — shared by HTML export
// and PDF export (T-F6). Strips front matter, then derives the document base direction
// by precedence (manual override > front-matter direction > content first-strong),
// carrying per-block direction + inline isolation into the body so it reads correctly
// even without a toggle (T-R1/R2/R6). Math is pre-rendered (T-F9) so the doc needs no JS.
function buildExportDoc(f, { csp = false } = {}) {
  const { data, body } = parseFrontMatter(f.content || '');
  const exportDir = resolveDocDirection({
    manual: (appBody._manualRTL || State.direction === 'rtl') ? 'rtl' : null,
    frontMatter: frontMatterDirection(data),
    content: resolveDirection(body, 'ltr'),
  });
  const exportEl = document.createElement('div');
  exportEl.innerHTML = parseMarkdown(body);
  if (typeof katex !== 'undefined') restoreMath(exportEl, { katex, DOMPurify }); // T-F9
  applyBidi(exportEl, { baseDir: exportDir, escape: escapeHtml });
  const html = exportEl.innerHTML;
  // Strip any accepted note extension (case-insensitive); fall back to a sane name.
  const baseName = (f.name || '').replace(/\.(md|markdown|txt)$/i, '') || 'document';
  // For PDF export, embed a strict CSP so the offscreen render can't pull remote
  // resources (SC2 0-network) — belt-and-suspenders with the main-process session block.
  // (HTML export keeps no CSP so a user-opened doc behaves like a normal page.)
  const cspMeta = csp ? `\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">` : '';
  const fullHtml = `<!DOCTYPE html>
<html lang="${exportDir === 'rtl' ? 'ar' : 'en'}" dir="${exportDir}">
<head>
<meta charset="UTF-8">${cspMeta}
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(baseName)}</title>
<style>
body { font-family: Georgia, serif; font-size: 18px; line-height: 1.7; max-width: 720px; margin: 60px auto; padding: 0 24px; color: #1F1B16; }
h1,h2,h3 { font-weight: 600; line-height: 1.2; }
a { color: #C0492C; }
code { background: #F2EDE0; padding: 1px 5px; border-radius: 3px; font-size: 14px; }
pre { background: #F2EDE0; padding: 16px 20px; border-radius: 6px; overflow-x: auto; }
blockquote { border-inline-start: 3px solid #C0492C; padding-block: 8px; padding-inline-start: 20px; margin: 24px 0; font-style: italic; }
</style>
</head>
<body>
${html}
</body>
</html>`;
  return { fullHtml, baseName };
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
  $('modeLive').classList.toggle('active', mode === 'live');
  $('modeSplit').classList.toggle('active', mode === 'split');
  $('modeSource').classList.toggle('active', mode === 'source');
  $('propMode').textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
  showToast(`Mode: ${mode}`, 'info');
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
    tab.className = 'tab' + (i === State.activeFile ? ' active' : '') + (f.dirty ? ' dirty' : '');
    tab.title = f.name;
    const closeIcon = f.dirty ? '●' : '×';
    tab.innerHTML = `<span class="tab-name">${escapeHtml(f.name)}</span><span class="close">${closeIcon}</span>`;
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

  srcTextarea.value = file.content || '';

  // Strip YAML front matter (T-R6) so it never renders as body text.
  const { body } = parseFrontMatter(file.content || '');
  const html = parseMarkdown(body);
  const wordCount = (body.match(/\S+/g) || []).length;
  const readMin = Math.max(1, Math.round(wordCount / 220));
  const isAr = isArabicHeavy(body);

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
}
window.renderFile = renderFile;

// Outline (T-F7): full h1–h6 tree with Arabic-aware slugs, matching ids on the
// rendered headings (click-to-scroll), and scroll-sync highlighting.
let _tocHeadings = []; // [{ el, item }] in document order, for scroll-sync

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
  const seen = new Map();
  rendered.forEach((el) => {
    const text = (el.textContent || '').trim();
    let slug = slugify(text);
    if (seen.has(slug)) { const k = seen.get(slug) + 1; seen.set(slug, k); slug = `${slug}-${k}`; }
    else seen.set(slug, 0);
    el.id = slug;
    const item = document.createElement('div');
    item.className = `toc-item h${el.tagName.charAt(1)}` + (_tocHeadings.length === 0 ? ' active' : '');
    item.textContent = text; // clean rendered text (no raw markdown punctuation)
    item.setAttribute('dir', 'auto'); // Arabic outline entries render RTL
    item.addEventListener('click', () => scrollToHeading(el));
    tocList.appendChild(item);
    _tocHeadings.push({ el, item });
  });
  setupScrollSync();
}

// The rendered note scrolls inside .preview-pane (.editor-area is overflow:hidden,
// so .editor-wrap itself never scrolls).
function previewScroller() { return document.querySelector('.preview-pane'); }

function scrollToHeading(el) {
  const wrap = previewScroller();
  if (!wrap || !el) return;
  const top = el.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
  wrap.scrollTo({ top: Math.max(0, top - 12), behavior: 'smooth' });
}

function setupScrollSync() {
  const wrap = previewScroller();
  if (!wrap || wrap._tocSyncWired) return;
  wrap._tocSyncWired = true;
  wrap.addEventListener('scroll', () => {
    if (!_tocHeadings.length) return;
    const wrapTop = wrap.getBoundingClientRect().top;
    const offsets = _tocHeadings.map(({ el }) => el.getBoundingClientRect().top - wrapTop + wrap.scrollTop);
    // At the very bottom the last heading's section is in view even if the heading
    // itself can't reach the top — highlight it explicitly.
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

function renderTree(entries) {
  treeEl.innerHTML = '';
  treeEl.style.display = 'block';
  sbEmptyEl.style.display = 'none';
  entries.forEach((entry, i) => {
    const node = document.createElement('div');
    node.className = 'tree-node tree-indent';
    node.dataset.fileIdx = i;
    node.setAttribute('role', 'treeitem');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', entry.name);
    const nameIsAr = isArabicHeavy(entry.name);
    node.innerHTML = `<span class="tree-icon">¶</span><span class="tree-name${nameIsAr ? ' arabic' : ''}"${nameIsAr ? ' dir="rtl"' : ''}>${escapeHtml(entry.name)}</span>`;
    const activate = () => openFromTree(i);
    node.addEventListener('click', activate);
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    treeEl.appendChild(node);
  });
  renderTags();
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
      const md = entries.map(e => ({ name: e.name, path: e.relPath, handle: null, content: e.content, dirty: false }));
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
  if (f.handle && f.handle.createWritable) {
    try {
      const w = await f.handle.createWritable();
      await w.write(f.content); await w.close();
      f.dirty = false; renderTabs();
      showToast(`Saved ${f.name}`);
    } catch(e) { showToast('Could not save', 'error'); }
  } else {
    const blob = new Blob([f.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${f.name}`);
  }
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
function onSourceInput() {
  if (State.activeFile === null || !State.files[State.activeFile]) return;
  const f = State.files[State.activeFile];
  f.content = srcTextarea.value;
  f.dirty = true;
  renderTabs();
  // Fast: cursor position update on every keystroke
  const pos = srcTextarea.selectionStart;
  const upto = srcTextarea.value.slice(0, pos);
  const ln = upto.split('\n').length;
  const col = pos - upto.lastIndexOf('\n');
  $('cursorPos').textContent = `ln ${ln} · col ${col}`;
  // Heavy: markdown render debounced at 150ms
  clearTimeout(_srcDebounce);
  _srcDebounce = setTimeout(() => {
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
srcTextarea.addEventListener('input', onSourceInput);

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
function wrapSelection(left, right) {
  ensureSourceFocus();
  const ta = srcTextarea;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(start, end) || 'text';
  replaceInTextarea(ta, start, end, left + sel + right);
  ta.selectionStart = start + left.length;
  ta.selectionEnd = start + left.length + sel.length;
}
function insertText(left, right) {
  ensureSourceFocus();
  const ta = srcTextarea;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sel = ta.value.slice(start, end);
  replaceInTextarea(ta, start, end, left + sel + right);
  ta.selectionStart = ta.selectionEnd = start + left.length + sel.length;
}
function lineStart(prefix) {
  ensureSourceFocus();
  const ta = srcTextarea;
  const start = ta.selectionStart;
  const before = ta.value.slice(0, start);
  const ls = before.lastIndexOf('\n') + 1;
  replaceInTextarea(ta, ls, ls, prefix);
  ta.selectionStart = ta.selectionEnd = start + prefix.length;
}

// =====================================================================
// COMMAND PALETTE
// =====================================================================
const PALETTE_COMMANDS = [
  { sec: 'Files', icon: '⌂', name: 'Open Folder…', meta: 'command', sk: 'Ctrl+⇧+O', act: openVault },
  { sec: 'Files', icon: '¶', name: 'Open File…', meta: 'command', sk: 'Ctrl+O', act: openSingleFile },
  { sec: 'Files', icon: '+', name: 'New Note', meta: 'command', sk: 'Ctrl+N', act: newNote },
  { sec: 'Files', icon: '↓', name: 'Save', meta: 'command', sk: 'Ctrl+S', act: saveCurrent },
  { sec: 'Files', icon: '⇪', name: 'Export HTML', meta: 'command', act: () => exportHTML() },
  { sec: 'Files', icon: '⎙', name: 'Export PDF', meta: 'command', act: () => exportPDF() },
  { sec: 'Files', icon: '★', name: 'Load demo notes', meta: 'command', act: loadDemo },
  { sec: 'View', icon: '¶', name: 'Mode: Live preview', meta: 'view', act: () => setEditorMode('live') },
  { sec: 'View', icon: '‖', name: 'Mode: Split view', meta: 'view', act: () => setEditorMode('split') },
  { sec: 'View', icon: '<>', name: 'Mode: Source', meta: 'view', act: () => setEditorMode('source') },
  { sec: 'View', icon: '⇄', name: 'Flip direction (RTL ⇄ LTR)', meta: 'view', sk: 'Ctrl+⇧+L', act: toggleRTL },
  { sec: 'View', icon: '◐', name: 'Theme: Paper', meta: 'view', act: () => setTheme('paper') },
  { sec: 'View', icon: '◐', name: 'Theme: Ink', meta: 'view', act: () => setTheme('ink') },
  { sec: 'View', icon: '◐', name: 'Theme: Sepia', meta: 'view', act: () => setTheme('sepia') },
  { sec: 'View', icon: '≡', name: 'Toggle Sidebar', meta: 'view', sk: 'Ctrl+\\', act: toggleSidebar },
  { sec: 'View', icon: 'i', name: 'Toggle Inspector', meta: 'view', act: toggleInspector },
  { sec: 'View', icon: 'ـ', name: 'Toggle Arabic Kashida Justification', meta: 'view', act: toggleKashida },
  { sec: 'View', icon: '+', name: 'Zoom In',    meta: 'view', sk: 'Ctrl+=', act: zoomIn },
  { sec: 'View', icon: '−', name: 'Zoom Out',   meta: 'view', sk: 'Ctrl+-', act: zoomOut },
  { sec: 'View', icon: '1', name: 'Reset Zoom', meta: 'view', sk: 'Ctrl+0', act: zoomReset },
  { sec: 'Help', icon: '⌨', name: 'Keyboard Shortcuts', meta: 'help', sk: 'Ctrl+/', act: showShortcuts },
  { sec: 'Help', icon: 'i', name: 'About BP MD RTL Reader', meta: 'help', act: showAbout }
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
  const items = [];
  PALETTE_COMMANDS.forEach(c => { if (!q || c.name.toLowerCase().includes(q)) items.push({ ...c, _kind: 'cmd' }); });
  State.files.forEach((f, i) => {
    if (!q || f.name.toLowerCase().includes(q)) {
      items.push({ sec: 'Files in folder', icon: '¶', name: f.name, meta: f.path, _kind: 'file', _idx: i });
    }
  });
  const sections = {};
  items.forEach(it => { sections[it.sec] = sections[it.sec] || []; sections[it.sec].push(it); });
  let html = ''; palVisible = [];
  Object.entries(sections).forEach(([sec, arr]) => {
    html += `<div class="pal-section-label">${escapeHtml(sec)}</div>`;
    arr.forEach(it => {
      palVisible.push(it);
      const sk = it.sk ? `<span class="pi-shortcut">${it.sk.split('+').map(p => `<span class="kbd">${p}</span>`).join('')}</span>` : '';
      html += `<div class="pal-item${palVisible.length === 1 ? ' active' : ''}" data-i="${palVisible.length - 1}">
        <span class="pi-icon">${escapeHtml(it.icon)}</span>
        <span class="pi-name">${escapeHtml(it.name)}</span>
        <span class="pi-meta">${escapeHtml(it.meta || '')}</span>
        ${sk}
      </div>`;
    });
  });
  if (!items.length) html = '<div class="search-empty" style="padding: 20px;">No matches.</div>';
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

// Toolbar buttons
$('modeLive').addEventListener('click', () => setEditorMode('live'));
$('modeSplit').addEventListener('click', () => setEditorMode('split'));
$('modeSource').addEventListener('click', () => setEditorMode('source'));
$('tbBold').addEventListener('click', () => wrapSelection('**', '**'));
$('tbItalic').addEventListener('click', () => wrapSelection('*', '*'));
$('tbStrike').addEventListener('click', () => wrapSelection('~~', '~~'));
$('tbH1').addEventListener('click', () => lineStart('# '));
$('tbH2').addEventListener('click', () => lineStart('## '));
$('tbH3').addEventListener('click', () => lineStart('### '));
$('tbLink').addEventListener('click', () => insertText('[', '](url)'));
$('tbQuote').addEventListener('click', () => lineStart('> '));
$('tbList').addEventListener('click', () => lineStart('- '));
$('tbCode').addEventListener('click', () => wrapSelection('`', '`'));
$('tbWikilink').addEventListener('click', () => insertText('[[', ']]'));

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

document.addEventListener('click', e => {
  if (!e.target.closest('.tb-menu-item') && !e.target.closest('.dropdown') && !e.target.closest('.tb-menu-btn')) closeMenu();
});

// =====================================================================
// DRAG-DROP (Issue #7)
// =====================================================================
function initDragDrop() {
  const ALLOWED_EXT = /\.(md|markdown|txt)$/i;
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
      if (!ALLOWED_EXT.test(file.name)) {
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
  'theme', 'zoomFactor', 'editorMode', 'sidebarVisible', 'inspectorVisible', 'recents', 'calendar', 'arabicKashida',
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
    if (typeof s.editorMode === 'string') setEditorMode(s.editorMode);
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
  } finally {
    _restoring = false;
  }
  return true;
}
window.restoreSettings = restoreSettings;

// =====================================================================
// INIT
// =====================================================================
(function init() {
  // Detect Electron and apply native-window overrides
  if (window.electronAPI) document.documentElement.classList.add('electron');

  // Restore persisted settings from the main process. When there is no bridge
  // (browser/dev), fall back to the localStorage theme exactly as before.
  restoreSettings().then((restored) => {
    if (restored) return;
    const stored = localStorage.getItem('bpmdrtlreader-theme');
    if (stored && THEMES.includes(stored)) {
      State.theme = stored;
      document.documentElement.setAttribute('data-theme', stored);
      $('themeBtn')?.classList.toggle('active', stored !== 'paper');
      if ($('themeLabel')) $('themeLabel').textContent = stored;
    }
  });

  showWelcome();
  initDragDrop();
})();

