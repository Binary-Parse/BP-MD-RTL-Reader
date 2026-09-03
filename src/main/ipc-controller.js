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
  isTooManyFiles,
  isAuthorizedPath,
  wouldExceedCumulative,
  isSymlinkEscape,
  filterAndSortMdFiles,
  migrate,
  compareVersions,
  fetchFn,
  // v1.2: surface-menu Reveal/Copy-Path support. Both optional so unit harnesses can
  // omit them; the handlers degrade to a no-op error instead of crashing.
  shell = null,
  clipboard = null,
  updateManifestUrl = DEFAULT_UPDATE_MANIFEST_URL,
}) {
  // B1 (multi-folder workspaces): one entry per currently-open vault, keyed by the
  // opaque capability id — was a single activeVault/vaultWatcher pair, which made
  // reading a second folder tear down the first folder's watcher (and made bpmd://
  // asset serving resolve against whichever folder was read LAST, regardless of which
  // folder the request's note actually lives in). Maps, not object literals — an
  // object keyed by a renderer-supplied id trips security/detect-object-injection.
  const openVaults = new Map();      // vaultId -> { id, name, path, generation, watcher }
  const readGenerations = new Map(); // vaultId -> last-issued read generation
  let pdfExportSeq = 0;
  const pdfFilteredSessions = new WeakSet();

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
    const allowedFiles = new Set(
      typeof capabilityRegistry.listDocuments === 'function'
        ? capabilityRegistry.listDocuments().map((item) => item.path)
        : [record.path],
    );
    if (!isAuthorizedPath(record.path, allowedFiles)) return { error: 'unauthorized-path' };
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

  // Close and forget exactly one vault's watcher — re-reading folder A must never
  // touch folder B's watcher.
  function closeVault(vaultId) {
    const entry = openVaults.get(vaultId);
    if (entry && entry.watcher) {
      try { entry.watcher.close(); } catch (_) { /* ignore */ }
    }
    openVaults.delete(vaultId);
  }

  // Full teardown (app quit / window close) — keeps its original name and signature
  // since window-controller.js and index.js already call it at three teardown sites.
  function closeVaultWatcher() {
    for (const vaultId of [...openVaults.keys()]) closeVault(vaultId);
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

    ipcMain.handle('dialog:openFolder', async (event) => {
      const win = windowForEvent(event);
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

    ipcMain.handle('dialog:openFile', async (event) => {
      const win = windowForEvent(event);
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
      const allowedFolders = new Set(
        typeof capabilityRegistry.listVaults === 'function'
          ? capabilityRegistry.listVaults().map((record) => record.path)
          : [folderPath],
      );
      if (!isAuthorizedPath(folderPath, allowedFolders)) return { error: 'unauthorized-path' };
      const requestGeneration = (readGenerations.get(vaultId) || 0) + 1;
      readGenerations.set(vaultId, requestGeneration);
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
          if (relPaths.length >= 5000 || (typeof isTooManyFiles === 'function' && isTooManyFiles(relPaths.length))) {
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

      if (requestGeneration !== readGenerations.get(vaultId)) return { error: 'stale-read' };

      closeVault(vaultId); // only THIS vault's prior watcher, never another open folder's
      const sender = event.sender;
      const watcher = docStore.watch(folderPath, ({ files }) => {
        if (sender && !sender.isDestroyed()) {
          sender.send('vault:changed', {
            vaultId,
            generation: requestGeneration,
            files,
          });
        }
      });
      openVaults.set(vaultId, {
        id: vaultId,
        name: path.basename(folderPath),
        path: folderPath,
        generation: requestGeneration,
        watcher,
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

    // Closing one folder must never touch another open folder's watcher — an unknown
    // or already-closed vaultId is a harmless no-op (Map.delete on a missing key).
    ipcMain.handle('fs:closeVault', async (_event, vaultId) => {
      closeVault(vaultId);
      return { ok: true };
    });

    ipcMain.handle('fs:writeFile', async (_event, payload) => {
      if (!payload || typeof payload !== 'object') return { error: 'invalid' };
      const {
        documentId, content, baseHash, bom, eol, finalNewline, revision, encoding,
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
        // v1.2: re-encode in the file's original encoding (UTF-8/UTF-16/Windows-1256).
        encoding: typeof encoding === 'string' ? encoding : 'utf8',
      });
      return result.ok ? { ...result, revision } : result;
    });

    ipcMain.handle('dialog:saveFile', async (event, payload) => {
      if (!payload || typeof payload.content !== 'string') return { error: 'invalid' };
      if (Buffer.byteLength(payload.content, 'utf8') > 10 * 1024 * 1024) {
        return { error: 'file-too-large' };
      }
      const result = await dialog.showSaveDialog(windowForEvent(event), {
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
        encoding: typeof payload.encoding === 'string' ? payload.encoding : 'utf8',
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

    ipcMain.handle('export:pdf', async (event, payload) => {
      if (!payload || typeof payload.html !== 'string') return { error: 'invalid' };
      const parent = windowForEvent(event);
      const defaultPath =
        (typeof payload.defaultName === 'string' && payload.defaultName) || 'document.pdf';
      const result = await dialog.showSaveDialog(parent, {
        title: 'Export PDF',
        defaultPath,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };

      const pdfSession = session.fromPartition('pdf-export');
      if (!pdfFilteredSessions.has(pdfSession)) {
        pdfFilteredSessions.add(pdfSession);
        pdfSession.webRequest.onBeforeRequest((details, callback) => {
          callback({ cancel: !/^(file:|data:|about:)/i.test(details.url) });
        });
      }

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
            webviewTag: false,
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
        return { ok: true };
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
          redirect: 'error',
          signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(15000)
            : undefined,
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

    // selectAll is deliberately NOT one of these: webContents.selectAll() selects the
    // entire renderer DOM (titlebar/sidebar/statusbar), not just the document — see
    // src/renderer/editor/edit-commands.js's module header. It is routed entirely inside
    // the renderer instead.
    ipcMain.on('edit:command', (event, command) => {
      const webContents = event.sender;
      if (!webContents || webContents.isDestroyed()) return;
      try {
        if (command === 'copy') webContents.copy();
        else if (command === 'cut') webContents.cut();
        else if (command === 'paste') webContents.paste();
        else if (command === 'undo') webContents.undo();
        else if (command === 'redo') webContents.redo();
      } catch (_) { /* no-op */ }
    });

    // v1.2: surface-menu support — Reveal in Explorer / Copy Path. The renderer only
    // ever sends an opaque documentId; main resolves it to the real path here, so the
    // renderer still never learns filesystem paths.
    ipcMain.handle('fs:reveal', (_event, documentId) => {
      const capabilityRegistry = getCapabilityRegistry();
      const record = capabilityRegistry && capabilityRegistry.resolveDocument(documentId);
      if (!record) return { error: 'unauthorized-capability' };
      if (!shell || typeof shell.showItemInFolder !== 'function') return { error: 'unsupported' };
      try {
        shell.showItemInFolder(record.path);
        return { ok: true };
      } catch (_) {
        return { error: 'reveal-failed' };
      }
    });

    ipcMain.handle('fs:copy-path', (_event, documentId) => {
      const capabilityRegistry = getCapabilityRegistry();
      const record = capabilityRegistry && capabilityRegistry.resolveDocument(documentId);
      if (!record) return { error: 'unauthorized-capability' };
      if (!clipboard || typeof clipboard.writeText !== 'function') return { error: 'unsupported' };
      try {
        clipboard.writeText(record.path);
        return { ok: true };
      } catch (_) {
        return { error: 'copy-failed' };
      }
    });

    // ── v1.2: crash-recovery snapshots (<userData>/recovery/snapshot.json). ──
    // The renderer mirrors its dirty in-memory notes every 10s; a sanctioned close
    // clears the file, a crash leaves it for the next launch's recovery prompt.
    const RECOVERY_MAX_FILES = 20;
    const RECOVERY_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
    const recoveryFilePath = () => path.join(app.getPath('userData'), 'recovery', 'snapshot.json');

    ipcMain.handle('recovery:snapshot', async (_event, files) => {
      if (!Array.isArray(files)) return { error: 'invalid' };
      const clean = [];
      let total = 0;
      for (const entry of files.slice(0, RECOVERY_MAX_FILES)) {
        if (!entry || typeof entry.name !== 'string' || typeof entry.content !== 'string') continue;
        if (entry.name.length === 0 || entry.name.length > 200) continue;
        const bytes = Buffer.byteLength(entry.content, 'utf8');
        if (bytes > 10 * 1024 * 1024) continue;
        if (total + bytes > RECOVERY_MAX_TOTAL_BYTES) break;
        total += bytes;
        clean.push({ name: entry.name, content: entry.content, at: Date.now() });
      }
      try {
        fs.mkdirSync(path.join(app.getPath('userData'), 'recovery'), { recursive: true });
      } catch (_) {
        return { error: 'write-failed' };
      }
      const result = atomicWriteFile(
        fs,
        recoveryFilePath(),
        Buffer.from(JSON.stringify({ files: clean }), 'utf8'),
      );
      return result && result.ok ? { ok: true, count: clean.length } : { error: 'write-failed' };
    });

    ipcMain.handle('recovery:pop', async () => {
      try {
        const raw = await fs.promises.readFile(recoveryFilePath(), 'utf8');
        fs.promises.unlink(recoveryFilePath()).catch(() => { /* best-effort cleanup */ });
        const parsed = JSON.parse(raw);
        const files = parsed && Array.isArray(parsed.files) ? parsed.files : [];
        return {
          ok: true,
          files: files.filter((f) => f && typeof f.name === 'string' && typeof f.content === 'string'),
        };
      } catch (_) {
        return { ok: true, files: [] }; // nothing to recover — the normal launch path
      }
    });

    ipcMain.handle('recovery:clear', async () => {
      try {
        await fs.promises.unlink(recoveryFilePath());
      } catch (_) { /* already absent — fine */ }
      return { ok: true };
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
    closeVault,
    getOpenVault: (vaultId) => openVaults.get(vaultId) || null,
    listOpenVaultRoots: () => [...openVaults.values()].map((entry) => entry.path),
  };
}

module.exports = {
  createIpcController,
  DEFAULT_UPDATE_MANIFEST_URL,
};
