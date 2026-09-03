/**
 * context-menu.js — pure builder for the right-click menu (T-B12).
 * Returns ordered descriptors; src/main/index.js maps them to an Electron template and
 * attaches click handlers (shell/clipboard/webContents). No Electron here.
 *
 * Descriptor kinds:
 *   { kind:'role', role, enabled }
 *   { kind:'separator' }
 *   { kind:'action', id, label, ...payload }
 */

// v1.2: the menu titles used to be hard-coded English regardless of the UI locale.
// Main knows the persisted uiLocale (settings.json), so it passes a labels map and the
// builder resolves display text through it — English stays the default and the pinned
// test contract.
const DEFAULT_LABELS = {
  'open-link': 'Open Link in Browser',
  'copy-link': 'Copy Link Address',
  'copy-image': 'Copy Image',
  'copy-image-address': 'Copy Image Address',
  'save-image': 'Save Image',
  'add-to-dictionary': 'Add to Dictionary',
};

const AR_LABELS = {
  'open-link': 'فتح الرابط في المتصفح',
  'copy-link': 'نسخ عنوان الرابط',
  'copy-image': 'نسخ الصورة',
  'copy-image-address': 'نسخ عنوان الصورة',
  'save-image': 'حفظ الصورة',
  'add-to-dictionary': 'إضافة إلى القاموس',
};

/**
 * Resolve the labels map for a locale ('en' → defaults).
 * @param {string} locale
 */
function labelsForLocale(locale) {
  if (locale === 'ar') return { ...DEFAULT_LABELS, ...AR_LABELS };
  return { ...DEFAULT_LABELS };
}

/**
 * @param {object} params  Electron context-menu params (linkURL, mediaType, srcURL,
 *                          selectionText, isEditable, editFlags, misspelledWord,
 *                          dictionarySuggestions)
 * @param {object} deps    { isExternallyOpenable(url):boolean, labels?:Record<string,string> }
 * @returns {Array<object>} ordered descriptors (never empty unless truly nothing)
 */
function buildContextMenuTemplate(params = {}, deps = {}) {
  const labels = { ...DEFAULT_LABELS, ...(deps.labels || {}) };
  const isOpenable = typeof deps.isExternallyOpenable === 'function' ? deps.isExternallyOpenable : () => false;
  const f = params.editFlags || {};
  const hasSelection = !!(params.selectionText && params.selectionText.trim() !== '');
  const items = [];

  // ── Link context ─────────────────────────────────────────────
  if (params.linkURL && isOpenable(params.linkURL)) {
    items.push({ kind: 'action', id: 'open-link', label: labels['open-link'], url: params.linkURL });
    items.push({ kind: 'action', id: 'copy-link', label: labels['copy-link'], url: params.linkURL });
    items.push({ kind: 'separator' });
  }

  // ── Image/media context ──────────────────────────────────────
  if (params.mediaType === 'image') {
    items.push({ kind: 'action', id: 'copy-image', label: labels['copy-image'] });
    if (params.srcURL && isOpenable(params.srcURL)) {
      items.push({ kind: 'action', id: 'copy-image-address', label: labels['copy-image-address'], url: params.srcURL });
      items.push({ kind: 'action', id: 'save-image', label: labels['save-image'], url: params.srcURL });
    }
    items.push({ kind: 'separator' });
  }

  if (params.isEditable) {
    // ── Spellcheck suggestions ─────────────────────────────────
    const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : [];
    if (params.misspelledWord) {
      for (const s of suggestions) items.push({ kind: 'action', id: 'replace-misspelling', label: s, replacement: s });
      if (suggestions.length) items.push({ kind: 'separator' });
      items.push({ kind: 'action', id: 'add-to-dictionary', label: labels['add-to-dictionary'], word: params.misspelledWord });
      items.push({ kind: 'separator' });
    }
    // ── Edit roles ─────────────────────────────────────────────
    items.push({ kind: 'role', role: 'undo', enabled: !!f.canUndo });
    items.push({ kind: 'role', role: 'redo', enabled: !!f.canRedo });
    items.push({ kind: 'separator' });
    items.push({ kind: 'role', role: 'cut', enabled: !!f.canCut });
    items.push({ kind: 'role', role: 'copy', enabled: !!f.canCopy });
    items.push({ kind: 'role', role: 'paste', enabled: !!f.canPaste });
    items.push({ kind: 'separator' });
    items.push({ kind: 'role', role: 'selectAll', enabled: !!f.canSelectAll });
  } else {
    // Non-editable surface (live preview, empty area): Copy needs a selection;
    // Select All always offered so a menu appears on every right-click.
    items.push({ kind: 'role', role: 'copy', enabled: hasSelection && !!f.canCopy });
    items.push({ kind: 'role', role: 'selectAll', enabled: !!f.canSelectAll });
  }

  // Trim dangling separators at both ends.
  while (items.length && items[items.length - 1].kind === 'separator') items.pop();
  while (items.length && items[0].kind === 'separator') items.shift();
  return items;
}

module.exports = { buildContextMenuTemplate, labelsForLocale, DEFAULT_LABELS, AR_LABELS };
