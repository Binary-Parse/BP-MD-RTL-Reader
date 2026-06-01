/**
 * context-menu.js — pure builder for the right-click menu (T-B12).
 * Returns ordered descriptors; main.js maps them to an Electron template and
 * attaches click handlers (shell/clipboard/webContents). No Electron here.
 *
 * Descriptor kinds:
 *   { kind:'role', role, enabled }
 *   { kind:'separator' }
 *   { kind:'action', id, label, ...payload }
 */

/**
 * @param {object} params  Electron context-menu params (linkURL, mediaType, srcURL,
 *                          selectionText, isEditable, editFlags, misspelledWord,
 *                          dictionarySuggestions)
 * @param {object} deps    { isExternallyOpenable(url):boolean }
 * @returns {Array<object>} ordered descriptors (never empty unless truly nothing)
 */
function buildContextMenuTemplate(params = {}, deps = {}) {
  const isOpenable = typeof deps.isExternallyOpenable === 'function' ? deps.isExternallyOpenable : () => false;
  const f = params.editFlags || {};
  const hasSelection = !!(params.selectionText && params.selectionText.trim() !== '');
  const items = [];

  // ── Link context ─────────────────────────────────────────────
  if (params.linkURL) {
    if (isOpenable(params.linkURL)) {
      items.push({ kind: 'action', id: 'open-link', label: 'Open Link in Browser', url: params.linkURL });
    }
    items.push({ kind: 'action', id: 'copy-link', label: 'Copy Link Address', url: params.linkURL });
    items.push({ kind: 'separator' });
  }

  // ── Image/media context ──────────────────────────────────────
  if (params.mediaType === 'image') {
    items.push({ kind: 'action', id: 'copy-image', label: 'Copy Image' });
    if (params.srcURL) items.push({ kind: 'action', id: 'copy-image-address', label: 'Copy Image Address', url: params.srcURL });
    items.push({ kind: 'action', id: 'save-image', label: 'Save Image', url: params.srcURL });
    items.push({ kind: 'separator' });
  }

  if (params.isEditable) {
    // ── Spellcheck suggestions ─────────────────────────────────
    const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : [];
    if (params.misspelledWord) {
      for (const s of suggestions) items.push({ kind: 'action', id: 'replace-misspelling', label: s, replacement: s });
      if (suggestions.length) items.push({ kind: 'separator' });
      items.push({ kind: 'action', id: 'add-to-dictionary', label: 'Add to Dictionary', word: params.misspelledWord });
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

module.exports = { buildContextMenuTemplate };
