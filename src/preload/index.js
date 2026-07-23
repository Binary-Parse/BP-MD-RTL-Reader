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
  contextBridge.exposeInMainWorld('electronAPI', {
    closeWindow:    () => ipcRenderer.send('window-close-confirmed'),
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
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
    // Main-issued opaque IDs are the only filesystem authority exposed here.
    openFile:   () => ipcRenderer.invoke('dialog:openFile'),
    readFile:   (documentId) => ipcRenderer.invoke('fs:readFile', documentId),
    writeFile:  (payload) => ipcRenderer.invoke('fs:writeFile', payload),
    saveFileAs: (payload) => ipcRenderer.invoke('dialog:saveFile', payload),
    // Persistent app settings (T-B5/T-F8): the renderer restores theme/zoom/
    // mode/panels/recents on launch and writes changes back. Main owns the
    // on-disk truth in <userData>/settings.json.
    getSettings: () => ipcRenderer.invoke('settings:get'),
    setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
    // Export the current note to PDF (T-B6/F6): the renderer passes the standalone
    // note HTML; main renders it offscreen and printToPDFs it to a chosen path.
    exportPDF: (payload) => ipcRenderer.invoke('export:pdf', payload),
    // Edit command bridge — delegates clipboard/undo/redo to Chromium's native
    // webContents.copy/cut/paste/undo/redo/selectAll which operate on the focused
    // editable regardless of JS-side focus juggling caused by the menu opening.
    editCommand: (cmd) => ipcRenderer.send('edit:command', cmd),
    // Receives file content when the user double-clicked a .md file in Explorer
    // (file association) or dropped one on the macOS dock. The renderer wraps
    // this in addFile() to surface the content immediately.
    onOpenFile: (cb) => ipcRenderer.on('open-external-file', (_e, data) => cb(data)),
    // T-B9: the main process watches the open vault; this fires (debounced) when files
    // change on disk externally so the renderer can refresh + surface conflicts (EC-A2).
    onVaultChanged: (cb) => ipcRenderer.on('vault:changed', (_e, data) => cb(data)),
    onCloseRequested: (cb) => ipcRenderer.on('app:request-close', () => cb()),
    // T-Q6: opt-in update check — only ever called from an explicit "Check for Updates…"
    // user action. No auto-check, no auto-download, no identifiers.
    checkForUpdate: () => ipcRenderer.invoke('update:check'),
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
