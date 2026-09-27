// ==== INJECTABLE BRIDGE SETUP (audit #3) ====
// The contextBridge wiring lives inside setupBridge() so this file can be
// imported (by Vitest/Stryker) WITHOUT exposing anything and WITHOUT a
// Module._resolveFilename hijack. The real preload entry calls setupBridge()
// with the live electron contextBridge/ipcRenderer at the bottom of this file,
// so runtime behaviour is identical to before.
//
// @param {object} deps
// @param {object} deps.contextBridge - electron.contextBridge (or a mock)
// @param {object} deps.ipcRenderer   - electron.ipcRenderer (or a mock)
// @param {object} [deps.webFrame] - electron.webFrame (or a mock)
function setupBridge({ contextBridge, ipcRenderer, webFrame }) {
  // SEC-02 (2026-09-26): Electron's structured clone ships a typed array's ENTIRE
  // backing ArrayBuffer, not just its view — a 1-byte view of a multi-GB buffer would
  // drag the whole store across the bridge BEFORE main's size caps can run. This is
  // the trusted boundary (contextIsolation means this wrapper is the only way across),
  // so any non-exact view is copied into its own right-sized buffer first.
  const sizedBytes = (bytes) => {
    if (bytes instanceof Uint8Array
      && (bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength)) {
      return new Uint8Array(bytes);
    }
    return bytes;
  };
  contextBridge.exposeInMainWorld('electronAPI', {
    closeWindow:    () => ipcRenderer.send('window-close-confirmed'),
    // v1.2: the close prompt resolved WITHOUT closing (Cancel, or a Save As declined
    // mid-save-all). Tells main to cancel the close failsafe for this window.
    abortWindowClose: () => ipcRenderer.send('window-close-aborted'),
    // Heartbeat for the close flow: while a Save/Save-As dialog is genuinely open the
    // renderer re-arms main's 20s force-close failsafe every few seconds, so a user
    // taking their time is never force-closed out from under — a wedged renderer
    // stops ticking and the failsafe still fires.
    extendWindowClose: () => ipcRenderer.send('window-close-extend'),
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    // v1.2: renderer → main count of files with unsaved edits, reported to main for
    // diagnostics (logged when the close failsafe fires).
    reportDirtyState: (count) => ipcRenderer.send('doc:dirty-state', count),
    // v1.2: fullscreen moves to the real OS window (F11 / titlebar toggle); main
    // echoes enter/leave back over 'window-fullscreen-changed'.
    setFullscreen: (flag) => ipcRenderer.send('window-set-fullscreen', flag === true),
    onFullscreenChanged: (cb) => ipcRenderer.on('window-fullscreen-changed', (_e, flag) => cb(flag)),
    // v1.2: crash-recovery mirror. The renderer periodically snapshots its dirty
    // in-memory notes; main stores them under <userData>/recovery/. Pop returns the
    // previous session's snapshots (and clears them); clear drops them without reading.
    recoverySnapshot: (files) => ipcRenderer.invoke('recovery:snapshot', files),
    recoveryPop: () => ipcRenderer.invoke('recovery:pop'),
    recoveryClear: () => ipcRenderer.invoke('recovery:clear'),
    // v1.2: surface-menu support. Main resolves the documentId back to a real path
    // server-side — the renderer still never learns filesystem paths.
    revealFile: (documentId) => ipcRenderer.invoke('fs:reveal', documentId),
    copyFilePath: (documentId) => ipcRenderer.invoke('fs:copy-path', documentId),
    // Open Folder IPC bridge (Bug 1 / AC1)
    // Renderer-local Chromium zoom; no privileged main-process IPC is needed.
    setAppZoom: (factor) => {
      if (typeof factor !== 'number' || !Number.isFinite(factor)) return null;
      const applied = Math.min(2, Math.max(0.6, factor));
      if (webFrame && typeof webFrame.setZoomFactor === 'function') webFrame.setZoomFactor(applied);
      return applied;
    },
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    readVault:  (vaultId) => ipcRenderer.invoke('fs:readVault', vaultId),
    // SEC-01: re-opening a persisted recent re-validates it against disk and grants
    // session authority for it (a persisted grant alone is no longer enough).
    reopenVault: (vaultId) => ipcRenderer.invoke('fs:reopenVault', vaultId),
    reopenDocument: (documentId) => ipcRenderer.invoke('fs:reopenDocument', documentId),
    // B1: release one folder's watcher without touching any other open folder.
    closeVault: (vaultId) => ipcRenderer.invoke('fs:closeVault', vaultId),
    // Main-issued opaque IDs are the only filesystem authority exposed here.
    openFile:   () => ipcRenderer.invoke('dialog:openFile'),
    readFile:   (documentId) => ipcRenderer.invoke('fs:readFile', documentId),
    writeFile:  (payload) => ipcRenderer.invoke('fs:writeFile', payload),
    saveFileAs: (payload) => ipcRenderer.invoke('dialog:saveFile', payload),
    // Drag-drop / file-input lanes: the renderer holds a File object, not a path, so it
    // ships the raw BYTES and main decodes them with the exact document-store detector
    // (UTF-8 / UTF-16 ±BOM / Windows-1256) used for picker-opened files. No filesystem
    // authority changes hands — pure bytes in, text out.
    decodeBytes: (bytes) => ipcRenderer.invoke('text:decode', sizedBytes(bytes)),
    // Persistent app settings (T-B5/T-F8): the renderer restores theme/zoom/
    // mode/panels/recents on launch and writes changes back. Main owns the
    // on-disk truth in <userData>/settings.json.
    getSettings: () => ipcRenderer.invoke('settings:get'),
    setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
    // T5.1a: highlights + margin notes, keyed by the opaque fileKey. TEXT ONLY — the
    // channel neither reads nor exposes any filesystem authority.
    annotationsGet: (docKey) => ipcRenderer.invoke('annotations:get', docKey),
    annotationsPut: (payload) => ipcRenderer.invoke('annotations:put', payload),
    // T8.1: reading minutes + streak. Local only (a file in <userData>); main owns the day key
    // and the caps — the renderer just reports "one more minute of reading".
    statsGet: () => ipcRenderer.invoke('stats:get'),
    statsAddMinutes: (minutes) => ipcRenderer.invoke('stats:addMinutes', minutes),
    // Export the current note to PDF (T-B6/F6): the renderer passes the standalone
    // note HTML; main renders it offscreen and printToPDFs it to a chosen path.
    exportPDF: (payload) => ipcRenderer.invoke('export:pdf', payload),
    // T6.1c: export the current note as an EPUB. The renderer builds the whole archive
    // (markdown → bidi-aware XHTML → stored ZIP) and hands main opaque BYTES; main only
    // asks for a path and writes the file. No rendering, no network.
    exportEpub: (payload) => ipcRenderer.invoke(
      'export:epub',
      payload && payload.bytes ? { ...payload, bytes: sizedBytes(payload.bytes) } : payload,
    ),
    // Edit command bridge — delegates clipboard/undo/redo to Chromium's native
    // webContents.copy/cut/paste/undo/redo/selectAll which operate on the focused
    // editable regardless of JS-side focus juggling caused by the menu opening.
    editCommand: (cmd) => ipcRenderer.send('edit:command', cmd),
    // v10 redesign (2026-08-25, D1): the right-click menu is drawn by the renderer, not
    // Electron's native Menu. Main sends the descriptor array to draw under a single-use
    // nonce; the renderer echoes back only { nonce, index } — never a label, url or role —
    // so a compromised renderer can only ever pick an item main itself already offered.
    onContextMenu: (cb) => ipcRenderer.on('context-menu:show', (_e, payload) => cb(payload)),
    contextAction: (payload) => ipcRenderer.send('context-menu:action', payload),
    contextMenuClosed: (nonce) => ipcRenderer.send('context-menu:closed', { nonce }),
    // The context menu's six app-local commands (New Note, Find, Palette, …) have no main-
    // side effect of their own; main just echoes them back so there is one dispatch path.
    onAppCommand: (cb) => ipcRenderer.on('app:command', (_e, command) => cb(command)),
    // Receives file content when the user double-clicked a .md file in Explorer
    // (file association) or dropped one on the macOS dock. The renderer wraps
    // this in addFile() to surface the content immediately.
    onOpenFile: (cb) => ipcRenderer.on('open-external-file', (_e, data) => cb(data)),
    // T-B9: the main process watches the open vault; this fires (debounced) when files
    // change on disk externally so the renderer can refresh + surface conflicts (EC-A2).
    onVaultChanged: (cb) => ipcRenderer.on('vault:changed', (_e, data) => cb(data)),
    onCloseRequested: (cb) => ipcRenderer.on('app:request-close', () => cb()),
    // T-Q6: opt-in update check — only ever called from an explicit "Check for Updates…"
    // user action (plus T7.1's opt-in daily auto check, which main itself re-validates
    // against the saved setting). No auto-download, no identifiers.
    checkForUpdate: () => ipcRenderer.invoke('update:check'),
    // The real app version for the About dialog (main reads app.getVersion()).
    getAppVersion: () => ipcRenderer.invoke('app:version'),
    // T7.1: the silent auto check + the notice. `onUpdateAvailable` is a RECEIVE-only
    // channel; `openReleasePage` takes no argument — main holds the one fixed URL.
    autoUpdateCheck: () => ipcRenderer.invoke('update:auto-check'),
    openReleasePage: () => ipcRenderer.invoke('update:release-page'),
    onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, data) => cb(data)),
    // One-way error reporter: forwards renderer-side errors (window.onerror,
    // unhandledrejection) to the main process, which appends a JSON line to
    // <userData>/logs/bpmdrtlreader.log. NO network, NO third party — local only.
    logError: (payload) => ipcRenderer.send('log:error', payload),
  });
}

module.exports = { setupBridge };

// ==== REAL PRELOAD ENTRY ====
// Only run the live bridge setup when loaded by Electron as a preload script.
// Under Vitest/Stryker the file is imported as a dependency (the vitest worker
// global is present), so the guard is false and nothing auto-runs — the tests
// drive setupBridge() with a mock contextBridge/ipcRenderer instead.
// Stryker disable all — this preload entry guard fires ONLY in the real Electron
// preload (the Vitest worker global is absent there), so the lines are
// unreachable by unit tests. setupBridge() itself is fully mutation-tested.
if (typeof globalThis.__vitest_worker__ === 'undefined') {
  const { contextBridge, ipcRenderer, webFrame } = require('electron');
  setupBridge({ contextBridge, ipcRenderer, webFrame });
}
// Stryker restore all
