'use strict';

function createWindowController({
  BrowserWindow,
  Menu,
  clipboard,
  screen,
  shell,
  path,
  pathToFileURL,
  rootDir,
  approvedCloseWindows,
  getCurrentSettings,
  persistWindowState,
  closeVaultWatcher,
  deliverPendingFile,
  clampWindowBounds,
  classifyNavigation,
  isExternallyOpenable,
  buildContextMenuTemplate,
}) {
  function runContextAction(descriptor, params, win) {
    try {
      switch (descriptor.id) {
        case 'open-link':
          if (isExternallyOpenable(descriptor.url)) shell.openExternal(descriptor.url);
          break;
        case 'copy-link':
        case 'copy-image-address':
          if (descriptor.url) clipboard.writeText(descriptor.url);
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
      icon: path.join(rootDir, 'assets', 'icon.ico'),
      backgroundColor: '#1A1713',
      frame: false,
      transparent: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(rootDir, 'preload.js'),
      },
    });

    if (bounds.maximized) win.maximize();
    if (typeof win.on === 'function') win.on('close', (event) => {
      if (!approvedCloseWindows.has(win)) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (!win.webContents.isDestroyed()) win.webContents.send('app:request-close');
        return;
      }
      approvedCloseWindows.delete(win);
      persistWindowState(win);
      closeVaultWatcher();
    });

    win.loadFile('index.html');
    const appUrl = pathToFileURL(path.join(rootDir, 'index.html')).href;
    win.webContents.on('did-finish-load', () => deliverPendingFile(win));

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternallyOpenable(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    const guardNavigation = (event, url) => {
      const { action } = classifyNavigation(url, appUrl);
      if (action === 'allow') return;
      event.preventDefault();
      if (action === 'external' && isExternallyOpenable(url)) shell.openExternal(url);
    };
    win.webContents.on('will-navigate', guardNavigation);
    win.webContents.on('will-redirect', guardNavigation);

    win.webContents.on('context-menu', (_event, params) => {
      const descriptors = buildContextMenuTemplate(params, { isExternallyOpenable });
      const template = descriptors.map((descriptor) => {
        if (descriptor.kind === 'separator') return { type: 'separator' };
        if (descriptor.kind === 'role') {
          return { role: descriptor.role, enabled: descriptor.enabled };
        }
        return {
          label: descriptor.label,
          click: () => runContextAction(descriptor, params, win),
        };
      });
      if (template.length === 0) return;
      Menu.buildFromTemplate(template).popup({ window: win });
    });

    return win;
  }

  return { createWindow };
}

module.exports = { createWindowController };
