/**
 * edit-commands.js — pure dispatcher for the Edit menu (audit Edit-Menu fix).
 *
 * Why extracted: the inline version inside index.html cannot be Stryker-mutated
 * and is hard to unit-test. This module takes ALL its dependencies via a `deps`
 * object — no module-level `document`, no `window.electronAPI` access, no
 * `navigator.clipboard` import — so vitest can exercise every branch with a
 * synthetic `deps` and Stryker can score mutation cleanly.
 *
 * Contract:
 *   execEditCmd(cmd, deps) → Promise<{ok, reason?}>
 *
 *   cmd       — one of 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
 *   deps      — see ALL_DEPS below; missing keys = renderer fallback
 *   returns   — { ok: boolean, reason?: string }
 *                 reason categories:
 *                   'unknown-cmd'      — cmd not in the 6 valid commands
 *                   'no-editor'        — no editable surface in scope
 *                   'no-selection'     — cut/copy with empty selection
 *                   'preview-readonly' — cut/paste attempted on live preview
 *                   'no-clipboard'     — paste with no navigator.clipboard
 *                   'ipc'              — forwarded to electronAPI.editCommand
 *
 * Critical fix vs old inline version:
 *   - selectAll is NEVER forwarded to webContents (Chromium would select the
 *     ENTIRE renderer DOM including titlebar/sidebar/statusbar). Always scoped
 *     in renderer to the active editor surface.
 *   - cut/copy/paste/undo/redo always restore focus to the saved editable
 *     BEFORE calling the IPC, so webContents.<cmd> targets the textarea and
 *     not the just-closed menu div.
 */

const VALID_CMDS = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];

/* ALL_DEPS reference (for tests/docs — not used at runtime):
   {
     electronAPI:   { editCommand(cmd): void } | null,
     getMode():     'source' | 'live' | 'split',
     getSrcTextarea(): HTMLTextAreaElement | null,
     getNoteContent(): HTMLElement | null,
     getLastFocusedEditable(): HTMLElement | null,
     getActiveElement(): Element | null,
     getSelection(): Selection | null,
     createRange(): Range,
     clipboard: { readText(): Promise<string>, writeText(s): Promise<void> } | null,
     showToast(msg, level): void,
     closeMenu(): void,
   }
*/

function isField(el) {
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
}

/**
 * CM6 path (T-F13): CodeMirror is the sole editor, so the Edit menu must act on IT — not the
 * old textarea (a hidden fallback) nor the hidden rendered preview. Returns a result object
 * when CM6 is active and handled the command, or `null` when there is no CM6 adapter (the
 * caller then runs the legacy textarea/preview path — i.e. the CM6-failed-to-load fallback).
 */
function cmEdit(cmd, deps) {
  const cm = deps.getCmAdapter && deps.getCmAdapter();
  if (!cm) return null;
  if (deps.closeMenu) deps.closeMenu();
  cm.focus();

  // selectAll is always renderer-scoped to the editor (never the IPC bridge, which would
  // select the whole webContents DOM); the execEditCmd shim already passes electronAPI:null.
  if (cmd === 'selectAll') { cm.selectAll(); return { ok: true }; }

  // In Electron, the native command targets the now-focused CM6 surface: it uses the system
  // clipboard for copy/cut/paste and CM6's own beforeinput (historyUndo/Redo) handling for
  // undo/redo. Prefer it. Outside Electron (Playwright/file://) fall through to CM6 directly.
  if (deps.electronAPI && deps.electronAPI.editCommand) {
    deps.electronAPI.editCommand(cmd);
    return { ok: true, reason: 'ipc' };
  }

  if (cmd === 'undo') { cm.undo(); return { ok: true }; }
  if (cmd === 'redo') { cm.redo(); return { ok: true }; }

  const sel = cm.getSelection();
  const val = cm.getValue();
  if (cmd === 'copy' || cmd === 'cut') {
    const txt = val.slice(sel.start, sel.end);
    if (!txt) return { ok: false, reason: 'no-selection' };
    if (deps.clipboard && deps.clipboard.writeText) {
      deps.clipboard.writeText(txt).catch(() => { if (deps.showToast) deps.showToast(`${cmd === 'cut' ? 'Cut' : 'Copy'} failed`, 'error'); });
    }
    if (cmd === 'cut') cm.replaceSelection('');
    return { ok: true };
  }
  if (cmd === 'paste') {
    if (!deps.clipboard || !deps.clipboard.readText) {
      if (deps.showToast) deps.showToast('Paste not supported in this context', 'info');
      return { ok: false, reason: 'no-clipboard' };
    }
    deps.clipboard.readText().then((txt) => { cm.focus(); cm.replaceSelection(txt); });
    return { ok: true };
  }
  return { ok: false, reason: 'unknown-cmd' };
}

function resolveTarget(deps) {
  const ae = deps.getActiveElement && deps.getActiveElement();
  if (isField(ae)) return ae;
  const last = deps.getLastFocusedEditable && deps.getLastFocusedEditable();
  if (isField(last)) return last;
  return null;
}

function selectAll(deps) {
  if (deps.closeMenu) deps.closeMenu();
  const mode = deps.getMode ? deps.getMode() : 'source';

  if (mode === 'source' || mode === 'split') {
    const ta = deps.getSrcTextarea && deps.getSrcTextarea();
    if (!ta) return { ok: false, reason: 'no-editor' };
    ta.focus();
    ta.select();
    return { ok: true };
  }

  // mode === 'live' → scope selection to noteContent (the live-preview render
  // target). Never call webContents.selectAll() which would select the entire
  // page (titlebar/sidebar/statusbar).
  const content = deps.getNoteContent && deps.getNoteContent();
  const sel = deps.getSelection && deps.getSelection();
  if (!content || !sel || !deps.createRange) return { ok: false, reason: 'no-editor' };
  sel.removeAllRanges();
  const range = deps.createRange();
  range.selectNodeContents(content);
  sel.addRange(range);
  return { ok: true };
}

function forwardOrFallback(cmd, deps) {
  if (deps.closeMenu) deps.closeMenu();
  const target = resolveTarget(deps);

  // Prefer Electron's native command — but ONLY after restoring focus to the
  // saved editable. Without focus-restore, webContents.<cmd> would target the
  // just-closed menu div (which is not editable) and silently no-op.
  if (deps.electronAPI && deps.electronAPI.editCommand) {
    if (target) target.focus();
    deps.electronAPI.editCommand(cmd);
    return { ok: true, reason: 'ipc' };
  }

  // ── Renderer fallback (Playwright / file:// / non-Electron) ──────────
  if (!target) {
    // For live-mode copy via window.getSelection (no editable focus required).
    if (cmd === 'copy') return copyFromSelection(deps);
    return { ok: false, reason: 'no-editor' };
  }

  if (cmd === 'undo' || cmd === 'redo') {
    target.focus();
    try { document.execCommand(cmd); } catch (_) { /* no-op */ }
    return { ok: true };
  }

  if (cmd === 'copy') return copyField(target, deps);
  if (cmd === 'cut') return cutField(target, deps);
  if (cmd === 'paste') return pasteField(target, deps);
  return { ok: false, reason: 'unknown-cmd' };
}

function copyFromSelection(deps) {
  const sel = deps.getSelection && deps.getSelection();
  const txt = sel ? sel.toString() : '';
  if (!txt) return { ok: false, reason: 'no-selection' };
  if (deps.clipboard && deps.clipboard.writeText) {
    deps.clipboard.writeText(txt).catch(() => {
      if (deps.showToast) deps.showToast('Copy failed', 'error');
    });
  }
  return { ok: true };
}

function copyField(target, deps) {
  const txt = target.value.substring(target.selectionStart, target.selectionEnd);
  if (!txt) return { ok: false, reason: 'no-selection' };
  if (deps.clipboard && deps.clipboard.writeText) {
    deps.clipboard.writeText(txt).catch(() => {
      if (deps.showToast) deps.showToast('Copy failed', 'error');
    });
  }
  return { ok: true };
}

function cutField(target, deps) {
  const mode = deps.getMode ? deps.getMode() : 'source';
  if (mode === 'live') {
    if (deps.showToast) deps.showToast('Cut not supported in preview', 'info');
    return { ok: false, reason: 'preview-readonly' };
  }
  const s = target.selectionStart;
  const e = target.selectionEnd;
  const txt = target.value.substring(s, e);
  if (!txt) return { ok: false, reason: 'no-selection' };
  if (deps.clipboard && deps.clipboard.writeText) {
    deps.clipboard.writeText(txt).catch(() => {
      if (deps.showToast) deps.showToast('Cut failed', 'error');
    });
  }
  target.value = target.value.slice(0, s) + target.value.slice(e);
  target.selectionStart = s;
  target.selectionEnd = s;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true };
}

function pasteField(target, deps) {
  const mode = deps.getMode ? deps.getMode() : 'source';
  if (mode === 'live') {
    if (deps.showToast) deps.showToast('Paste not supported in preview', 'info');
    return { ok: false, reason: 'preview-readonly' };
  }
  if (!deps.clipboard || !deps.clipboard.readText) {
    if (deps.showToast) deps.showToast('Paste not supported in this context', 'info');
    return { ok: false, reason: 'no-clipboard' };
  }
  deps.clipboard.readText().then(txt => {
    // Guard: target might have been removed from the DOM between request
    // and resolve (fast file-switch). isConnected check prevents pasting
    // into a detached node.
    if (target.isConnected === false) return;
    target.focus();
    const s = target.selectionStart;
    const e = target.selectionEnd;
    target.value = target.value.slice(0, s) + txt + target.value.slice(e);
    const next = s + txt.length;
    target.selectionStart = next;
    target.selectionEnd = next;
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }).catch(() => {
    if (deps.showToast) deps.showToast('Paste failed', 'error');
  });
  return { ok: true };
}

export function execEditCmd(cmd, deps) {
  if (!VALID_CMDS.includes(cmd)) return { ok: false, reason: 'unknown-cmd' };
  // T-F13: when CM6 is the active editor, route every command to it. Falls through to the
  // legacy textarea/preview path only when no CM6 adapter is present (CM6 failed to load).
  const viaCm = cmEdit(cmd, deps);
  if (viaCm) return viaCm;
  if (cmd === 'selectAll') return selectAll(deps);
  return forwardOrFallback(cmd, deps);
}

export const _internal = {
  VALID_CMDS,
  isField,
  cmEdit,
  resolveTarget,
  selectAll,
  forwardOrFallback,
  copyField,
  cutField,
  pasteField,
  copyFromSelection,
};
