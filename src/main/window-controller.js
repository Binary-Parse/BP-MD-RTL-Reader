'use strict';

function createWindowController({
  BrowserWindow,
  Menu,
  clipboard,
  screen,
  shell,
  path,
  rootDir,
  appRendererUrl,
  approvedCloseWindows,
  getCurrentSettings,
  persistWindowState,
  closeVaultWatcher,
  deliverPendingFile,
  clampWindowBounds,
  isPackaged,
  classifyNavigation,
  isExternallyOpenable,
  buildContextMenuTemplate,
  writeLog,
  ipcMain,
  crypto,
}) {
  const log = typeof writeLog === 'function' ? writeLog : () => {};

  // T-F19: Electron's default menu is the only source of Ctrl+Shift+I / Ctrl+R, so it is
  // suppressed on win32/linux. On darwin it also supplies the Cmd+C/V/X/Z clipboard chords,
  // so it must stay — but its stock Select All binds straight to the selectAll ROLE, which
  // selects the entire renderer DOM (titlebar/sidebar/statusbar), not just the document.
  // Install a minimal template instead: every native Edit role except Select All, which
  // relays to the renderer over the same 'app:command' channel the context menu uses.
  function installApplicationMenu(platform) {
    if (platform !== 'darwin') {
      if (Menu && typeof Menu.setApplicationMenu === 'function') Menu.setApplicationMenu(null);
      return;
    }
    if (!Menu || typeof Menu.buildFromTemplate !== 'function') return;
    const template = [
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' },
          {
            label: 'Select All',
            accelerator: 'CmdOrCtrl+A',
            click: (_item, win) => { if (win && win.webContents) win.webContents.send('app:command', 'selectAll'); },
          },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  // v10 redesign (2026-08-25): the context menu is now drawn by the renderer (D1), so the
  // renderer must never be trusted to name a target — it echoes back only { nonce, index }.
  // Main keeps the descriptor array (and the Chromium params they were built from) under a
  // single-use nonce here, re-derives everything from its OWN copy on dispatch, and deletes
  // the entry so a nonce cannot be replayed. Entries are also dropped when their webContents
  // is destroyed or the renderer reports the menu closed without a selection, so the stash
  // cannot grow unbounded across a long session.
  const contextMenuStash = new Map();
  // selectAll is deliberately absent: webContents.selectAll() selects the entire renderer
  // DOM (titlebar/sidebar/statusbar), not just the document (see
  // src/renderer/editor/edit-commands.js's module header). The dispatcher below relays a
  // selectAll role over 'app:command' instead of ever running it here.
  const ROLE_METHODS = { undo: 'undo', redo: 'redo', cut: 'cut', copy: 'copy', paste: 'paste' };

  // v10 redesign (D1 addendum): these six commands are renderer-local features (they call
  // functions already in app.js) with no main-side effect of their own. They still round-trip
  // through the same { nonce, index } dispatch as every other item — "one dispatch path, one
  // place to test" — main just relays the id back over 'app:command' for the renderer's own
  // onAppCommand() to route. They are addressed by an index PAST the end of the context-menu
  // descriptors array (see the combined-length check below), so they never collide with it.
  //
  // ids only, deliberately: main has no access to State or the locale catalog, so a label
  // hard-coded here would be a sixth hand-maintained copy of these strings AND would leave
  // the right-click menu untranslated even with the UI in Arabic. The renderer resolves
  // display text through its own APP_COMMAND_DISPLAY (app.js), which is locale-aware.
  const APP_COMMANDS = [
    { kind: 'app-command', id: 'newNote' },
    { kind: 'app-command', id: 'openFind' },
    { kind: 'app-command', id: 'openPalette' },
    { kind: 'app-command', id: 'toggleAutoHideTitlebar' },
    { kind: 'app-command', id: 'toggleHideStatusBar' },
    { kind: 'app-command', id: 'showSettings' },
  ];

  let contextMenuActionHandlerRegistered = false;
  function registerContextMenuActionHandler() {
    if (contextMenuActionHandlerRegistered || !ipcMain || typeof ipcMain.on !== 'function') return;
    contextMenuActionHandlerRegistered = true;
    ipcMain.on('context-menu:action', (event, payload) => {
      if (!payload || typeof payload !== 'object') return;
      const { nonce, index } = payload;
      if (typeof nonce !== 'string') return;
      // Map.get is safe against prototype-pollution-style keys ('constructor', '__proto__',
      // …) — unlike a plain object, there is no prototype chain to shadow.
      const entry = contextMenuStash.get(nonce);
      if (!entry) return;
      contextMenuStash.delete(nonce); // single-use: gone whether or not dispatch below succeeds
      if (!entry.sender || entry.sender !== event.sender) return; // foreign sender: ignore
      const combinedLength = entry.descriptors.length + APP_COMMANDS.length;
      if (!Number.isInteger(index) || index < 0 || index >= combinedLength) return;
      const win = BrowserWindow && typeof BrowserWindow.fromWebContents === 'function'
        ? BrowserWindow.fromWebContents(event.sender)
        : null;
      if (!win || win.isDestroyed()) return;
      if (index >= entry.descriptors.length) {
        const command = APP_COMMANDS[index - entry.descriptors.length];
        win.webContents.send('app:command', command.id);
        return;
      }
      const descriptor = entry.descriptors[index];
      if (descriptor.kind === 'role') {
        if (!descriptor.enabled) return;
        if (descriptor.role === 'selectAll') { win.webContents.send('app:command', 'selectAll'); return; }
        const method = ROLE_METHODS[descriptor.role];
        if (method && typeof win.webContents[method] === 'function') win.webContents[method]();
      } else if (descriptor.kind === 'action') {
        runContextAction(descriptor, entry.params, win);
      }
    });
    ipcMain.on('context-menu:closed', (event, payload) => {
      const nonce = payload && payload.nonce;
      if (typeof nonce !== 'string') return;
      const entry = contextMenuStash.get(nonce);
      if (entry && entry.sender === event.sender) contextMenuStash.delete(nonce);
    });
  }

  function runContextAction(descriptor, params, win) {
    try {
      switch (descriptor.id) {
        case 'open-link':
          if (isExternallyOpenable(descriptor.url)) shell.openExternal(descriptor.url);
          break;
        case 'copy-link':
        case 'copy-image-address':
          if (descriptor.url && isExternallyOpenable(descriptor.url)) clipboard.writeText(descriptor.url);
          break;
        case 'copy-image':
          if (params.x != null && params.y != null) win.webContents.copyImageAt(params.x, params.y);
          break;
        case 'save-image':
          if (descriptor.url && isExternallyOpenable(descriptor.url)) {
            win.webContents.downloadURL(descriptor.url);
          }
          break;
        case 'replace-misspelling':
          win.webContents.replaceMisspelling(descriptor.replacement);
          break;
        case 'add-to-dictionary':
          if (win.webContents.session?.addWordToSpellCheckerDictionary) {
            win.webContents.session.addWordToSpellCheckerDictionary(descriptor.word);
          }
          break;
        default:
          break;
      }
    } catch (_) { /* never let a menu click crash main */ }
  }

  function createWindow() {
    registerContextMenuActionHandler(); // idempotent; the first window registers it for all
    const displays = (screen && typeof screen.getAllDisplays === 'function') ? screen.getAllDisplays() : [];
    const currentSettings = getCurrentSettings();
    const bounds = clampWindowBounds(currentSettings && currentSettings.window, displays);

    const win = new BrowserWindow({
      width: bounds.w,
      height: bounds.h,
      ...(bounds.x != null ? { x: bounds.x } : {}),
      ...(bounds.y != null ? { y: bounds.y } : {}),
      minWidth: 800,
      minHeight: 600,
      title: 'BP MD RTL Reader',
      icon: path.join(rootDir, 'build', 'icons', 'icon.ico'),
      backgroundColor: '#1A1713',
      frame: false,
      transparent: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        nodeIntegrationInSubFrames: false,
        // T-F19: a shipped build has no reason to expose DevTools. This blocks the
        // openDevTools() API; the Ctrl+Shift+I accelerator is a separate matter and is
        // removed with Electron's default menu in index.js.
        devTools: !isPackaged,
        preload: path.join(rootDir, 'src', 'preload', 'index.js'),
      },
    });

    const ses = win.webContents.session;
    // v10 redesign (2026-08-25): the title bar's fullscreen toggle calls the DOM
    // requestFullscreen() API, which these deny-all handlers would otherwise refuse
    // exactly like every other permission. 'fullscreen' is the one permission allowed
    // through; everything else stays denied.
    if (ses && typeof ses.setPermissionRequestHandler === 'function') {
      ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'fullscreen'));
    }
    if (ses && typeof ses.setPermissionCheckHandler === 'function') {
      ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen');
    }
    win.webContents.on('will-attach-webview', (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
    });

    if (bounds.maximized) win.maximize();

    let rendererLoaded = false;
    if (typeof win.on === 'function') win.on('close', (event) => {
      if (approvedCloseWindows.has(win)) {
        approvedCloseWindows.delete(win);
        persistWindowState(win);
        closeVaultWatcher();
        return;
      }
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      if (!rendererLoaded || !win.webContents || win.webContents.isDestroyed()) {
        approvedCloseWindows.add(win);
        persistWindowState(win);
        closeVaultWatcher();
        if (win && !win.isDestroyed()) win.close();
        return;
      }
      win.webContents.send('app:request-close');
    });

    win.loadURL(appRendererUrl);
    win.webContents.on('did-finish-load', () => {
      rendererLoaded = true;
      deliverPendingFile(win);
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      log('error', 'window:did-fail-load', `${errorCode} ${errorDescription} ${validatedURL} main=${isMainFrame}`);
    });
    win.webContents.on('did-fail-provisional-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      log('error', 'window:did-fail-provisional-load', `${errorCode} ${errorDescription} ${validatedURL} main=${isMainFrame}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      rendererLoaded = false;
      log('error', 'window:render-process-gone', details && details.reason ? details.reason : 'gone');
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternallyOpenable(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    const guardNavigation = (event, url) => {
      const { action } = classifyNavigation(url, appRendererUrl);
      if (action === 'allow') return;
      event.preventDefault();
      if (action === 'external' && isExternallyOpenable(url)) shell.openExternal(url);
    };
    win.webContents.on('will-navigate', guardNavigation);
    win.webContents.on('will-redirect', guardNavigation);

    win.webContents.on('context-menu', (_event, params) => {
      const descriptors = buildContextMenuTemplate(params, { isExternallyOpenable });
      if (descriptors.length === 0) return;
      const nonce = crypto.randomUUID();
      contextMenuStash.set(nonce, { descriptors, params, sender: win.webContents });
      win.webContents.send('context-menu:show', { nonce, descriptors, appCommands: APP_COMMANDS, x: params.x, y: params.y });
    });
    win.webContents.on('destroyed', () => {
      for (const [nonce, entry] of contextMenuStash) {
        if (entry.sender === win.webContents) contextMenuStash.delete(nonce);
      }
    });

    return win;
  }

  /**
   * EC-D2 follow-up (T-F19): bounds are clamped to a visible display at launch, but a
   * display can disappear mid-session and strand the window off-screen — where, with the
   * title bar auto-hidden, there is no drag region left to pull it back with. Re-clamp
   * whenever the display set changes.
   *
   * Maximized windows are skipped: the platform owns their rect and re-clamping fights it.
   */
  function watchDisplays() {
    if (!screen || typeof screen.on !== 'function') return;
    const reclamp = () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
      const b = win.getBounds();
      const clamped = clampWindowBounds(
        { x: b.x, y: b.y, w: b.width, h: b.height },
        screen.getAllDisplays()
      );
      // clampWindowBounds DROPS x/y when the window overlaps no display at all — that is
      // how it says "let the platform place it". center() is the honest equivalent for a
      // window that already exists; handing the dropped undefined to setBounds would throw.
      if (clamped.x == null || clamped.y == null) {
        win.center();
        log('info', 'main:display-change', 'window was off every display — recentred');
        return;
      }
      if (clamped.x !== b.x || clamped.y !== b.y) {
        win.setBounds({ x: clamped.x, y: clamped.y, width: b.width, height: b.height });
      }
    };
    screen.on('display-removed', reclamp);
    screen.on('display-metrics-changed', reclamp);
  }

  return { createWindow, watchDisplays, registerContextMenuActionHandler, installApplicationMenu };
}

module.exports = { createWindowController };
