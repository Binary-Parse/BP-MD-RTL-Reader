'use strict';

const DEFAULT_UPDATE_MANIFEST_URL =
  'https://api.github.com/repos/Binary-Parse/BP-MD-RTL-Reader/releases/latest';

function createIpcController({
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  fs,
  path,
  docStore,
  atomicWriteFile,
  approvedCloseWindows,
  windowForEvent,
  writeLog,
  getCapabilityRegistry,
  getSettingsStore,
  getCurrentSettings,
  setCurrentSettings,
  isNetworkPath,
  isOversizedFile,
  wouldExceedCumulative,
  isSymlinkEscape,
  filterAndSortMdFiles,
  migrate,
  compareVersions,
  fetchFn,
  updateManifestUrl = DEFAULT_UPDATE_MANIFEST_URL,
}) {
  let activeVault = null;
  let vaultWatcher = null;
  let vaultReadGeneration = 0;
  let pdfExportSeq = 0;

  function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function readDocumentCapability(documentId) {
    const capabilityRegistry = getCapabilityRegistry();
    const record = capabilityRegistry && capabilityRegistry.resolveDocument(documentId);
    if (!record) return { error: 'unauthorized-capability' };
    try {
      const stat = fs.statSync(record.path);
      if (!stat.isFile()) return { error: 'not-regular-file' };
      if (isOversizedFile(stat.size)) return { error: 'file-too-large' };
      const { content, meta } = docStore.read(record.path);
      return {
        documentId: record.id,
        vaultId: record.vaultId,
        name: path.basename(record.path),
        content,
        meta,
      };
    } catch (_) {
      return { error: 'read-failed' };
    }
  }

  function closeVaultWatcher() {
    try {
      if (vaultWatcher) vaultWatcher.close();
    } catch (_) { /* ignore */ }
    vaultWatcher = null;
  }

  function registerIpcHandlers() {
    ipcMain.on('window-close-confirmed', (event) => {
      const win = windowForEvent(event);
      if (!win || win.isDestroyed()) return;
      approvedCloseWindows.add(win);
      win.close();
    });
    ipcMain.on('window-minimize', (event) => {
      const win = windowForEvent(event);
      if (win && !win.isDestroyed()) win.minimize();
    });
    ipcMain.on('window-maximize', (event) => {
      const win = windowForEvent(event);
      if (win && !win.isDestroyed()) win.isMaximized() ? win.unmaximize() : win.maximize();
    });

    ipcMain.handle('dialog:openFolder', async () => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Open Folder',
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const selected = result.filePaths[0];
      if (isNetworkPath(selected)) return { error: 'network-path-not-allowed' };
      try {
        return {
          canceled: false,
          vault: getCapabilityRegistry().grantVault(selected),
        };
      } catch (_) {
        return { error: 'invalid-vault' };
      }
    });

    ipcMain.handle('dialog:openFile', async () => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        title: 'Open File',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const selected = result.filePaths[0];
      if (isNetworkPath(selected)) return { error: 'network-path-not-allowed' };
      try {
        const filePath = fs.realpathSync(selected);
        const stat = fs.statSync(filePath);
        if (!stat.isFile() || !/\.(md|markdown)$/i.test(filePath)) {
          return { error: 'invalid-file' };
        }
        if (isOversizedFile(stat.size)) return { error: 'file-too-large' };
        const capability = getCapabilityRegistry().grantDocument(filePath);
        return { canceled: false, ...readDocumentCapability(capability.id) };
      } catch (_) {
        return { error: 'read-failed' };
      }
    });

    ipcMain.handle('fs:readFile', async (_event, documentId) => (
      readDocumentCapability(documentId)
    ));

    ipcMain.handle('fs:readVault', async (event, vaultId) => {
      const capabilityRegistry = getCapabilityRegistry();
      const vault = capabilityRegistry && capabilityRegistry.resolveVault(vaultId);
      if (!vault) return { error: 'unauthorized-capability' };
      const folderPath = vault.path;
      const requestGeneration = ++vaultReadGeneration;
      let topEntries;
      try {
        topEntries = await fs.promises.readdir(folderPath, { withFileTypes: true });
      } catch (_) {
        return { error: 'read-failed' };
      }

      const relPaths = [];
      let truncated = false;
      const appendMarkdown = (entries, baseRel = '') => {
        for (const name of filterAndSortMdFiles(entries)) {
          if (relPaths.length >= 5000) {
            truncated = true;
            return false;
          }
          relPaths.push(baseRel ? `${baseRel}/${name}` : name);
        }
        return true;
      };
      appendMarkdown(topEntries);
      const isDir = (entry) => (
        typeof entry.isDirectory === 'function' && entry.isDirectory()
      );
      async function collectSub(dir, baseRel, depth) {
        if (depth > 12 || truncated) return;
        let entries;
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (_) {
          return;
        }
        if (!appendMarkdown(entries, baseRel)) return;
        for (const entry of entries.filter(isDir)) {
          if (truncated) return;
          await collectSub(
            path.join(dir, entry.name),
            `${baseRel}/${entry.name}`,
            depth + 1,
          );
        }
      }
      for (const entry of topEntries.filter(isDir)) {
        await collectSub(path.join(folderPath, entry.name), entry.name, 1);
      }
      relPaths.sort((a, b) => a.localeCompare(b));

      const results = [];
      let cumulativeBytes = 0;
      const skipped = { unreadable: 0, oversized: 0, escaped: 0, special: 0 };

      for (const relPath of relPaths) {
        const fullPath = path.join(folderPath, relPath);
        try {
          const lstat = await fs.promises.lstat(fullPath);
          let canonical = fullPath;
          let stat = lstat;
          if (lstat.isSymbolicLink()) {
            canonical = await fs.promises.realpath(fullPath);
            if (isSymlinkEscape(canonical, folderPath, path)) {
              skipped.escaped++;
              continue;
            }
            stat = await fs.promises.stat(canonical);
          }
          if (typeof stat.isFile === 'function' && !stat.isFile()) {
            skipped.special++;
            continue;
          }
          if (isOversizedFile(stat.size)) {
            skipped.oversized++;
            continue;
          }
          if (wouldExceedCumulative(cumulativeBytes, stat.size)) {
            truncated = true;
            break;
          }
          cumulativeBytes += stat.size;
          const capability = capabilityRegistry.grantDocument(canonical, {
            vaultId,
            persistGrant: false,
          });
          const snapshot = readDocumentCapability(capability.id);
          if (snapshot.error) {
            skipped.unreadable++;
            continue;
          }
          results.push({ ...snapshot, relPath });
        } catch (_) {
          skipped.unreadable++;
        }
      }

      try {
        capabilityRegistry.flush();
      } catch (_) {
        return { error: 'capability-persist-failed' };
      }

      if (requestGeneration !== vaultReadGeneration) return { error: 'stale-read' };

      closeVaultWatcher();
      const sender = event.sender;
      activeVault = { ...vault, generation: requestGeneration };
      vaultWatcher = docStore.watch(folderPath, ({ files }) => {
        if (sender && !sender.isDestroyed()) {
          sender.send('vault:changed', {
            vaultId,
            generation: requestGeneration,
            files,
          });
        }
      });

      return {
        vault: {
          id: vaultId,
          name: path.basename(folderPath),
          generation: requestGeneration,
        },
        entries: results,
        skipped,
        truncated,
      };
    });

    ipcMain.handle('fs:writeFile', async (_event, payload) => {
      if (!payload || typeof payload !== 'object') return { error: 'invalid' };
      const {
        documentId, content, baseHash, bom, eol, finalNewline, revision,
      } = payload;
      if (typeof content !== 'string') return { error: 'invalid' };
      if (Buffer.byteLength(content, 'utf8') > 10 * 1024 * 1024) {
        return { error: 'file-too-large' };
      }
      const capabilityRegistry = getCapabilityRegistry();
      const document = capabilityRegistry && capabilityRegistry.resolveDocument(documentId);
      if (!document) return { error: 'unauthorized-capability' };
      const vault = document.vaultId
        ? capabilityRegistry.resolveVault(document.vaultId)
        : null;
      const result = docStore.write(document.path, content, {
        root: vault && vault.path,
        baseHash,
        bom,
        eol,
        finalNewline,
      });
      return result.ok ? { ...result, revision } : result;
    });

    ipcMain.handle('dialog:saveFile', async (_event, payload) => {
      if (!payload || typeof payload.content !== 'string') return { error: 'invalid' };
      if (Buffer.byteLength(payload.content, 'utf8') > 10 * 1024 * 1024) {
        return { error: 'file-too-large' };
      }
      const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), {
        title: 'Save Markdown File',
        defaultPath: typeof payload.suggestedName === 'string'
          ? payload.suggestedName
          : 'Untitled.md',
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      if (isNetworkPath(result.filePath)) return { error: 'network-path-not-allowed' };
      const written = docStore.write(result.filePath, payload.content, {
        bom: !!payload.bom,
        eol: payload.eol === '\r\n' ? '\r\n' : '\n',
        finalNewline: payload.finalNewline !== false,
      });
      if (!written.ok) return written;
      try {
        const capability = getCapabilityRegistry().grantDocument(result.filePath);
        return {
          ok: true,
          documentId: capability.id,
          name: capability.name,
          meta: written.meta,
          revision: payload.revision,
        };
      } catch (_) {
        return { error: 'write-failed' };
      }
    });

    ipcMain.handle('settings:get', async () => {
      let currentSettings = getCurrentSettings();
      if (!currentSettings) {
        const settingsStore = getSettingsStore();
        currentSettings = settingsStore ? settingsStore.load() : null;
        setCurrentSettings(currentSettings);
      }
      return currentSettings;
    });

    ipcMain.handle('settings:set', async (_event, patch) => {
      if (!patch || typeof patch !== 'object') return { error: 'invalid' };
      const merged = migrate({ ...getCurrentSettings(), ...patch });
      const result = getSettingsStore().save(merged);
      if (result && result.ok) setCurrentSettings(merged);
      return result;
    });

    ipcMain.handle('export:pdf', async (_event, payload) => {
      if (!payload || typeof payload.html !== 'string') return { error: 'invalid' };
      const parent = BrowserWindow.getFocusedWindow();
      const defaultPath =
        (typeof payload.defaultName === 'string' && payload.defaultName) || 'document.pdf';
      const result = await dialog.showSaveDialog(parent, {
        title: 'Export PDF',
        defaultPath,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };

      const pdfSession = session.fromPartition('pdf-export');
      pdfSession.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !/^(file:|data:|about:)/i.test(details.url) });
      });

      const tmpHtml = path.join(
        app.getPath('temp'),
        `bpmd-export-${Date.now()}-${pdfExportSeq++}.html`,
      );
      let pdfWin = null;
      try {
        await fs.promises.writeFile(tmpHtml, payload.html, 'utf8');
        pdfWin = new BrowserWindow({
          show: false,
          webPreferences: {
            partition: 'pdf-export',
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            javascript: false,
          },
        });
        pdfWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        await withTimeout(pdfWin.loadFile(tmpHtml), 30000);
        const data = await withTimeout(
          pdfWin.webContents.printToPDF({ printBackground: true }),
          30000,
        );
        const written = atomicWriteFile(fs, result.filePath, data);
        if (!written.ok) throw new Error(written.error);
        return { ok: true, path: result.filePath };
      } catch (_) {
        return { error: 'export-failed' };
      } finally {
        if (pdfWin && !pdfWin.isDestroyed()) pdfWin.close();
        fs.promises.unlink(tmpHtml).catch(() => { /* best-effort temp cleanup */ });
      }
    });

    ipcMain.handle('update:check', async () => {
      const current = app.getVersion();
      if (typeof fetchFn !== 'function') return { error: 'unsupported', current };
      let response;
      try {
        response = await fetchFn(updateManifestUrl, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'BP-MD-RTL-Reader',
          },
        });
      } catch (_) {
        return { error: 'network', current };
      }
      if (!response || !response.ok) return { error: 'http', current };
      let data;
      try {
        data = await response.json();
      } catch (_) {
        return { error: 'parse', current };
      }
      const latest = String((data && (data.tag_name || data.version)) || '')
        .replace(/^v/i, '');
      if (!latest) return { error: 'no-version', current };
      const comparison = compareVersions(latest, current);
      if (comparison === null) return { error: 'invalid-version', current };
      return {
        current,
        latest,
        updateAvailable: comparison > 0,
        url: (data && data.html_url) || '',
      };
    });

    ipcMain.on('edit:command', (event, command) => {
      const webContents = event.sender;
      if (!webContents || webContents.isDestroyed()) return;
      try {
        if (command === 'copy') webContents.copy();
        else if (command === 'cut') webContents.cut();
        else if (command === 'paste') webContents.paste();
        else if (command === 'undo') webContents.undo();
        else if (command === 'redo') webContents.redo();
        else if (command === 'selectAll') webContents.selectAll();
      } catch (_) { /* no-op */ }
    });

    const LOG_RATE_LIMIT_PER_MIN = 100;
    let logWindowStart = Date.now();
    let logCount = 0;
    let logDropped = 0;
    ipcMain.on('log:error', (_event, payload) => {
      if (!payload || typeof payload !== 'object') return;
      const now = Date.now();
      if (now - logWindowStart > 60_000) {
        if (logDropped > 0) {
          writeLog(
            'warn',
            'main:rateLimit',
            `dropped ${logDropped} renderer log entries (cap ${LOG_RATE_LIMIT_PER_MIN}/min)`,
          );
        }
        logWindowStart = now;
        logCount = 0;
        logDropped = 0;
      }
      if (logCount >= LOG_RATE_LIMIT_PER_MIN) {
        logDropped++;
        return;
      }
      logCount++;
      writeLog('error', 'renderer', payload.message, payload.stack);
    });
  }

  return {
    registerIpcHandlers,
    readDocumentCapability,
    closeVaultWatcher,
    getActiveVault: () => activeVault,
  };
}

module.exports = {
  createIpcController,
  DEFAULT_UPDATE_MANIFEST_URL,
};
