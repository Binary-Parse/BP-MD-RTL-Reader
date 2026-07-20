const path = require('path');
const { pathToFileURL } = require('url');
const {
  parseFileArg,
  isNetworkPath,
  isTooManyFiles,
  isOversizedFile,
  wouldExceedCumulative,
  isSymlinkEscape,
  filterAndSortMdFiles,
} = require('./src/main-logic');
const { classifyNavigation, isExternallyOpenable } = require('./src/main/navigation');
const { buildContextMenuTemplate } = require('./src/main/context-menu');
const { createDocumentStore, atomicWriteFile } = require('./src/main/document-store');
const { createCapabilityRegistry } = require('./src/main/capabilities');
const { createSettingsStore, clampWindowBounds, migrate } = require('./src/main/settings');
const { compareVersions } = require('./src/main/version');
const { resolveAsset, validateAsset } = require('./src/main/protocol');
const crypto = require('crypto');

// T-Q6: the public releases manifest consulted ONLY when the user explicitly checks for
// updates (opt-in, no auto-check, no auto-download, no identifiers sent).
const UPDATE_MANIFEST_URL = 'https://api.github.com/repos/Binary-Parse/BP-MD-RTL-Reader/releases/latest';

// ==== INJECTABLE BOOTSTRAP (audit #3) ====
// All Electron/fs side-effects live inside bootstrap() so the module can be
// imported (by Vitest/Stryker) WITHOUT running the real app and WITHOUT a
// Module._resolveFilename hijack. The real app entry calls bootstrap() with
// the live electron/fs/process at the bottom of this file (guarded by
// require.main === module), so runtime behaviour is identical to before.
//
// @param {object} deps
// @param {object} deps.electron - the 'electron' module (or a mock)
// @param {object} deps.fs       - the 'fs' module (or a mock)
// @param {object} [deps.proc]   - process-like object (argv/platform/on); defaults to global process
function bootstrap({ electron, fs, proc = process, fetchFn = globalThis.fetch }) {
  const { app, BrowserWindow, ipcMain, shell, dialog, crashReporter, Menu, clipboard, screen, session, protocol } = electron;

  // T-AI2: the bpmd:// asset scheme must be declared privileged BEFORE app `ready`
  // (so it behaves as a standard, secure, fetch-able scheme that the CSP img-src
  // allow-lists). The handler itself is attached after ready (registerBpmdProtocol).
  if (protocol && typeof protocol.registerSchemesAsPrivileged === 'function') {
    protocol.registerSchemesAsPrivileged([
      { scheme: 'bpmd', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    ]);
  }

  // Reject `promise` if it hasn't settled within `ms` — bounds a stuck PDF render so
  // the export can't hang forever (T-B6). Clears the timer so no listener leaks.
  function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
  let pdfExportSeq = 0;

  // ==== CONTEXT-MENU ACTION DISPATCH (T-B12) ====
  // Executes the side-effecting click for an action descriptor from
  // buildContextMenuTemplate. Kept tiny; all policy lives in the pure builder.
  function runContextAction(d, params, win) {
    try {
      switch (d.id) {
        case 'open-link':
          if (isExternallyOpenable(d.url)) shell.openExternal(d.url);
          break;
        case 'copy-link':
        case 'copy-image-address':
          if (d.url) clipboard.writeText(d.url);
          break;
        case 'copy-image':
          if (params.x != null && params.y != null) win.webContents.copyImageAt(params.x, params.y);
          break;
        case 'save-image':
          if (d.url && isExternallyOpenable(d.url)) win.webContents.downloadURL(d.url);
          break;
        case 'replace-misspelling':
          win.webContents.replaceMisspelling(d.replacement);
          break;
        case 'add-to-dictionary':
          if (win.webContents.session?.addWordToSpellCheckerDictionary) {
            win.webContents.session.addWordToSpellCheckerDictionary(d.word);
          }
          break;
        default:
          break;
      }
    } catch (_) { /* never let a menu click crash main */ }
  }

  // ==== OBSERVABILITY ====
  // Local-only crash + error capture. NO data leaves the user's machine
  // (uploadToServer: false). Minidumps land in app.getPath('crashDumps');
  // JS errors land in <userData>/logs/bpmdrtlreader.log (rotated at 1 MiB, keep 3).
  crashReporter.start({ uploadToServer: false, submitURL: '' });

  const LOG_MAX_BYTES = 1024 * 1024;
  const LOG_KEEP = 3;
  let logFilePath = null;

  function ensureLogPath() {
    if (logFilePath) return logFilePath;
    const dir = path.join(app.getPath('userData'), 'logs');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* ignore */ }
    logFilePath = path.join(dir, 'bpmdrtlreader.log');
    return logFilePath;
  }

  function rotateIfNeeded(p) {
    try {
      const st = fs.statSync(p);
      if (st.size < LOG_MAX_BYTES) return;
      for (let i = LOG_KEEP - 1; i >= 1; i--) {
        const older = `${p}.${i + 1}`;
        const newer = `${p}.${i}`;
        if (fs.existsSync(newer)) fs.renameSync(newer, older);
      }
      fs.renameSync(p, `${p}.1`);
    } catch (_) { /* file doesn't exist yet, or rotation failed — ignore */ }
  }

  function writeLog(level, source, message, stack) {
    try {
      const p = ensureLogPath();
      rotateIfNeeded(p);
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        source,
        message: String(message ?? '').slice(0, 4000),
        stack: stack ? String(stack).slice(0, 8000) : undefined,
      }) + '\n';
      fs.appendFileSync(p, line);
    } catch (_) { /* never let logging crash the process */ }
  }

  proc.on('uncaughtException', (err) => {
    writeLog('error', 'main:uncaughtException', err?.message, err?.stack);
  });
  proc.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stk = reason instanceof Error ? reason.stack : undefined;
    writeLog('error', 'main:unhandledRejection', msg, stk);
  });

  // ==== SECURITY: MAIN-OWNED CAPABILITIES ====
  // Native-picker paths are stored only in a main-owned registry. The renderer sees
  // opaque IDs and therefore cannot mint authority through settings or IPC payloads.
  let capabilityRegistry = null;
  let activeVault = null;

  // Serve a bpmd://vault/<rel> request: resolve it (path-traversal guarded) against
  // the active vault root, re-check the root is still allow-listed, and stream the
  // file's bytes. Any miss/escape → 404/403; never throws into Electron.
  function registerBpmdProtocol() {
    if (!protocol || typeof protocol.handle !== 'function') return;
    protocol.handle('bpmd', async (request) => {
      const root = activeVault && activeVault.path;
      const res = resolveAsset(request.url, root, path);
      if (res.error) return new Response('Not found', { status: 404 });
      try {
        const checked = await validateAsset(res.path, root, fs, path);
        if (checked.error) return new Response('Not found', { status: 404 });
        const data = await fs.promises.readFile(checked.path);
        return new Response(data, { headers: { 'content-type': checked.type, 'content-length': String(checked.size) } });
      } catch (_) {
        return new Response('Not found', { status: 404 });
      }
    });
  }

  // ==== DOCUMENT STORE (T-AI1) ====
  // Transactional repository: atomic, encoding-preserving, conflict-aware writes.
  const docStore = createDocumentStore({ fs, path, crypto });
  let vaultWatcher = null; // T-B9: fs.watch handle for the currently-open vault

  // ==== PERSISTENT SETTINGS (T-B5 / T-F8) ====
  // Versioned, fail-safe settings store under <userData>/settings.json. Loaded
  // on app.whenReady (so app.getPath('userData') is valid); the renderer reads
  // and writes it via settings:get / settings:set; window geometry is persisted
  // on window close / app quit and restored (clamped to a visible display) on
  // the next launch (EC-D1/EC-D2).
  let settingsStore = null;
  let currentSettings = null;
  const approvedCloseWindows = new WeakSet();

  function windowForEvent(event) {
    if (BrowserWindow && typeof BrowserWindow.fromWebContents === 'function' && event && event.sender) {
      const owned = BrowserWindow.fromWebContents(event.sender);
      if (owned) return owned;
    }
    return BrowserWindow.getFocusedWindow();
  }

  // Capture the live window geometry into settings and flush to disk. Never
  // throws — a persistence failure must not block window close or app quit.
  function persistWindowState(win) {
    if (!win || win.isDestroyed()) return;
    try {
      const b = win.getNormalBounds();
      const window = { x: b.x, y: b.y, w: b.width, h: b.height, maximized: win.isMaximized() };
      currentSettings = migrate({ ...currentSettings, window });
      settingsStore.save(currentSettings);
    } catch (_) { /* never let persistence block teardown */ }
  }

  // ==== FILE ASSOCIATION ====
  let pendingFileToOpen = null;
  let vaultReadGeneration = 0;

  function readDocumentCapability(documentId) {
    const record = capabilityRegistry && capabilityRegistry.resolveDocument(documentId);
    if (!record) return { error: 'unauthorized-capability' };
    try {
      const stat = fs.statSync(record.path);
      if (!stat.isFile()) return { error: 'not-regular-file' };
      if (isOversizedFile(stat.size)) return { error: 'file-too-large' };
      const { content, meta } = docStore.read(record.path);
      return { documentId: record.id, vaultId: record.vaultId, name: path.basename(record.path), content, meta };
    } catch (_) {
      return { error: 'read-failed' };
    }
  }

  function deliverPendingFile(win) {
    if (!pendingFileToOpen || !win || win.isDestroyed()) return;
    const filePath = pendingFileToOpen;
    pendingFileToOpen = null;
    try {
      const capability = capabilityRegistry.grantDocument(filePath);
      const snapshot = readDocumentCapability(capability.id);
      if (!snapshot.error) win.webContents.send('open-external-file', snapshot);
    } catch (_) { /* silent */ }
  }

  // ==== IPC HANDLERS ====
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
        title: 'Open Folder'
      });
      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }
      const selected = result.filePaths[0];
      if (isNetworkPath(selected)) return { error: 'network-path-not-allowed' };
      try {
        return { canceled: false, vault: capabilityRegistry.grantVault(selected) };
      } catch (_) {
        return { error: 'invalid-vault' };
      }
    });

    // ==== dialog:openFile ====
    // Native open-file picker for a single .md file. Returns the ABSOLUTE path (the
    // browser File System Access picker only yields a basename + a non-persistable
    // handle, which is why single-file recents couldn't be reopened). The chosen path
    // is allow-listed so fs:readFile can reopen it later from Recent.
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
        if (!stat.isFile() || !/\.(md|markdown)$/i.test(filePath)) return { error: 'invalid-file' };
        if (isOversizedFile(stat.size)) return { error: 'file-too-large' };
        const capability = capabilityRegistry.grantDocument(filePath);
        return { canceled: false, ...readDocumentCapability(capability.id) };
      } catch (_) {
        return { error: 'read-failed' };
      }
    });

    // ==== fs:readFile ====
    // Reopen a single recent file by its absolute path. Allow-list gated (the path must
    // have been opened via dialog:openFile this session OR restored from recents on
    // launch — see seedAllowedFoldersFromSettings). Symlinks, network paths and oversized
    // files are rejected, mirroring the readVault guards.
    ipcMain.handle('fs:readFile', async (_event, documentId) => readDocumentCapability(documentId));

    ipcMain.handle('fs:readVault', async (event, vaultId) => {
      const vault = capabilityRegistry && capabilityRegistry.resolveVault(vaultId);
      if (!vault) return { error: 'unauthorized-capability' };
      const folderPath = vault.path;
      const requestGeneration = ++vaultReadGeneration;
      let topEntries;
      try { topEntries = await fs.promises.readdir(folderPath, { withFileTypes: true }); }
      catch (_) { return { error: 'read-failed' }; }

      // Gather markdown files recursively (T-B2). Top-level md files first, then
      // descend into subdirectories (depth-bounded). The isDirectory check is
      // defensive so flat callers / simple mocks issue exactly one readdir.
      const relPaths = [];
      let truncated = false;
      const appendMarkdown = (entries, baseRel = '') => {
        for (const name of filterAndSortMdFiles(entries)) {
          if (relPaths.length >= 5000) { truncated = true; return false; }
          relPaths.push(baseRel ? `${baseRel}/${name}` : name);
        }
        return true;
      };
      appendMarkdown(topEntries);
      const isDir = (e) => typeof e.isDirectory === 'function' && e.isDirectory();
      async function collectSub(dir, baseRel, depth) {
        if (depth > 12 || truncated) return;
        let entries;
        try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
        catch (_) { return; }
        if (!appendMarkdown(entries, baseRel)) return;
        for (const s of entries.filter(isDir)) {
          if (truncated) return;
          await collectSub(path.join(dir, s.name), `${baseRel}/${s.name}`, depth + 1);
        }
      }
      for (const s of topEntries.filter(isDir)) {
        await collectSub(path.join(folderPath, s.name), s.name, 1);
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
            if (isSymlinkEscape(canonical, folderPath, path)) { skipped.escaped++; continue; }
            stat = await fs.promises.stat(canonical);
          }
          if (typeof stat.isFile === 'function' && !stat.isFile()) { skipped.special++; continue; }
          if (isOversizedFile(stat.size)) { skipped.oversized++; continue; }
          if (wouldExceedCumulative(cumulativeBytes, stat.size)) { truncated = true; break; }
          cumulativeBytes += stat.size;
          const capability = capabilityRegistry.grantDocument(canonical, { vaultId, persistGrant: false });
          const snapshot = readDocumentCapability(capability.id);
          if (snapshot.error) { skipped.unreadable++; continue; }
          results.push({ ...snapshot, relPath });
        } catch (_) { skipped.unreadable++; }
      }

      try { capabilityRegistry.flush(); } catch (_) { return { error: 'capability-persist-failed' }; }

      if (requestGeneration !== vaultReadGeneration) return { error: 'stale-read' };

      // T-B9: watch the opened vault for EXTERNAL changes and notify this renderer
      // (debounced). The renderer refreshes the tree and surfaces an EC-A2 conflict for
      // the open file if it changed on disk while dirty. Replaces any prior watcher.
      try { if (vaultWatcher) vaultWatcher.close(); } catch (_) { /* ignore */ }
      const sender = event.sender;
      activeVault = { ...vault, generation: requestGeneration };
      vaultWatcher = docStore.watch(folderPath, ({ files }) => {
        if (sender && !sender.isDestroyed()) sender.send('vault:changed', { vaultId, generation: requestGeneration, files });
      });

      return {
        vault: { id: vaultId, name: path.basename(folderPath), generation: requestGeneration },
        entries: results,
        skipped,
        truncated,
      };
    });

    // ==== fs:writeFile (T-B1) ====
    // Atomic, allow-listed, conflict-aware write backed by the DocumentStore.
    ipcMain.handle('fs:writeFile', async (_event, payload) => {
      if (!payload || typeof payload !== 'object') return { error: 'invalid' };
      const { documentId, content, baseHash, bom, eol, finalNewline, revision } = payload;
      if (typeof content !== 'string') return { error: 'invalid' };
      if (Buffer.byteLength(content, 'utf8') > 10 * 1024 * 1024) return { error: 'file-too-large' };
      const document = capabilityRegistry && capabilityRegistry.resolveDocument(documentId);
      if (!document) return { error: 'unauthorized-capability' };
      const vault = document.vaultId ? capabilityRegistry.resolveVault(document.vaultId) : null;
      const result = docStore.write(document.path, content, {
        root: vault && vault.path, baseHash, bom, eol, finalNewline,
      });
      return result.ok ? { ...result, revision } : result;
    });

    ipcMain.handle('dialog:saveFile', async (_event, payload) => {
      if (!payload || typeof payload.content !== 'string') return { error: 'invalid' };
      if (Buffer.byteLength(payload.content, 'utf8') > 10 * 1024 * 1024) return { error: 'file-too-large' };
      const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), {
        title: 'Save Markdown File',
        defaultPath: typeof payload.suggestedName === 'string' ? payload.suggestedName : 'Untitled.md',
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
        const capability = capabilityRegistry.grantDocument(result.filePath);
        return { ok: true, documentId: capability.id, name: capability.name, meta: written.meta, revision: payload.revision };
      } catch (_) { return { error: 'write-failed' }; }
    });

    // ==== settings:get / settings:set (T-B5 / T-F8) ====
    // The renderer restores theme/zoom/mode/panels/recents from settings:get on
    // launch and writes changes back via settings:set. settings:set accepts a
    // partial patch, merges it into the current settings, migrates (coerces to a
    // valid, versioned shape — EC-D1), and atomically persists it.
    ipcMain.handle('settings:get', async () => {
      if (!currentSettings) currentSettings = settingsStore ? settingsStore.load() : null;
      return currentSettings;
    });

    ipcMain.handle('settings:set', async (_event, patch) => {
      if (!patch || typeof patch !== 'object') return { error: 'invalid' };
      const merged = migrate({ ...currentSettings, ...patch });
      const res = settingsStore.save(merged);
      if (res && res.ok) currentSettings = merged;
      return res;
    });

    // ==== export:pdf (T-B6) ====
    // The renderer (T-F6) builds the same standalone, bidi-aware note HTML it uses for
    // HTML export and hands it here. We render it in a HIDDEN, sandboxed, JS-disabled
    // window and printToPDF → a clean note document (no app chrome), independent of the
    // live editor mode.
    //
    // SC2 (0 runtime network) is a HARD requirement, so the offscreen window renders on
    // an ISOLATED session whose webRequest hard-blocks every non-local request: a note
    // with a remote <img> must not phone home at export time (javascript:false blocks
    // scripts but NOT passive subresource fetches — the session block is what enforces it).
    // The HTML is written to a temp file and loadFile'd (no data:-URL size cliff, so even
    // large Arabic notes export); the temp is always cleaned up.
    ipcMain.handle('export:pdf', async (_event, payload) => {
      if (!payload || typeof payload.html !== 'string') return { error: 'invalid' };
      const parent = BrowserWindow.getFocusedWindow();
      const defaultPath = (typeof payload.defaultName === 'string' && payload.defaultName) || 'document.pdf';
      const result = await dialog.showSaveDialog(parent, {
        title: 'Export PDF',
        defaultPath,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };

      // Isolated, offline session — cancel anything that isn't the local file/data we load.
      const ses = session.fromPartition('pdf-export');
      ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^(file:|data:|about:)/i.test(details.url) }));

      const tmpHtml = path.join(app.getPath('temp'), `bpmd-export-${Date.now()}-${pdfExportSeq++}.html`);
      let pdfWin = null;
      try {
        await fs.promises.writeFile(tmpHtml, payload.html, 'utf8');
        pdfWin = new BrowserWindow({
          show: false,
          webPreferences: { partition: 'pdf-export', sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
        });
        pdfWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        await withTimeout(pdfWin.loadFile(tmpHtml), 30000);
        const data = await withTimeout(pdfWin.webContents.printToPDF({ printBackground: true }), 30000);
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

    // ==== update:check (T-Q6) — OPT-IN only, privacy-preserving ====
    // Invoked SOLELY by an explicit user action ("Check for Updates…"). There is no
    // auto-check on launch, no auto-download, and no identifiers/telemetry are sent — just
    // a GET of the public releases manifest + a version compare. (The only outbound request
    // the app ever makes, and only when the user asks.) Returns whether a newer release exists.
    ipcMain.handle('update:check', async () => {
      const current = app.getVersion();
      if (typeof fetchFn !== 'function') return { error: 'unsupported', current };
      let res;
      try {
        res = await fetchFn(UPDATE_MANIFEST_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BP-MD-RTL-Reader' } });
      } catch (_) {
        return { error: 'network', current };
      }
      if (!res || !res.ok) return { error: 'http', current };
      let data;
      try { data = await res.json(); } catch (_) { return { error: 'parse', current }; }
      const latest = String((data && (data.tag_name || data.version)) || '').replace(/^v/i, '');
      if (!latest) return { error: 'no-version', current };
      const comparison = compareVersions(latest, current);
      if (comparison === null) return { error: 'invalid-version', current };
      return { current, latest, updateAvailable: comparison > 0, url: (data && data.html_url) || '' };
    });

    ipcMain.on('edit:command', (event, cmd) => {
      const wc = event.sender;
      if (!wc || wc.isDestroyed()) return;
      try {
        if (cmd === 'copy')           wc.copy();
        else if (cmd === 'cut')       wc.cut();
        else if (cmd === 'paste')     wc.paste();
        else if (cmd === 'undo')      wc.undo();
        else if (cmd === 'redo')      wc.redo();
        else if (cmd === 'selectAll') wc.selectAll();
      } catch (_) { /* no-op */ }
    });

    // Renderer-side errors (window.onerror, unhandledrejection) → local log.
    // Rate-limited (audit #27): a renderer error in a hot loop must not flood
    // the main process. Counter resets every minute; over-cap messages are
    // dropped, and a single "dropped N" summary is logged at the next rollover.
    const LOG_RATE_LIMIT_PER_MIN = 100;
    let logWindowStart = Date.now();
    let logCount = 0;
    let logDropped = 0;
    ipcMain.on('log:error', (_event, payload) => {
      if (!payload || typeof payload !== 'object') return;
      const now = Date.now();
      if (now - logWindowStart > 60_000) {
        if (logDropped > 0) {
          writeLog('warn', 'main:rateLimit',
            `dropped ${logDropped} renderer log entries (cap ${LOG_RATE_LIMIT_PER_MIN}/min)`);
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

  function createWindow() {
    // Restore the saved window geometry, clamped to a currently-visible display
    // (EC-D2). Falls back to the default 1280x820 when nothing is saved or no
    // display info is available.
    const displays = (screen && typeof screen.getAllDisplays === 'function') ? screen.getAllDisplays() : [];
    const bounds = clampWindowBounds(currentSettings && currentSettings.window, displays);

    const win = new BrowserWindow({
      width: bounds.w,
      height: bounds.h,
      ...(bounds.x != null ? { x: bounds.x } : {}),
      ...(bounds.y != null ? { y: bounds.y } : {}),
      minWidth: 800,
      minHeight: 600,
      title: 'BP MD RTL Reader',
      icon: path.join(__dirname, 'assets', 'icon.ico'),
      backgroundColor: '#1A1713',
      frame: false,
      transparent: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    if (bounds.maximized) win.maximize();
    // Persist geometry when the user closes the window (covers app quit too,
    // which closes the window first).
    if (typeof win.on === 'function') win.on('close', (event) => {
      if (!approvedCloseWindows.has(win)) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (!win.webContents.isDestroyed()) win.webContents.send('app:request-close');
        return;
      }
      approvedCloseWindows.delete(win);
      persistWindowState(win);
      try { if (vaultWatcher) { vaultWatcher.close(); vaultWatcher = null; } } catch (_) { /* ignore */ } // T-B9: close the vault watcher with the window
    });

    win.loadFile('index.html');
    const appUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
    win.webContents.on('did-finish-load', () => deliverPendingFile(win));

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternallyOpenable(url)) shell.openExternal(url);
      return { action: 'deny' };
    });

    // ==== NAVIGATION GUARD (T-B11) ====
    // The app is a single local page. A click on a rendered http(s) link would
    // otherwise navigate the renderer AWAY from the app (replacing the UI with the
    // website, with no back button on this frameless window). Block ALL top-level
    // navigation; route external http(s)/mailto/tel to the OS browser.
    const guardNavigation = (event, url) => {
      const { action } = classifyNavigation(url, appUrl);
      if (action === 'allow') return;
      event.preventDefault();
      if (action === 'external' && isExternallyOpenable(url)) shell.openExternal(url);
    };
    win.webContents.on('will-navigate', guardNavigation);
    win.webContents.on('will-redirect', guardNavigation);

    // ==== RIGHT-CLICK CONTEXT MENU (T-B12) ====
    // Template is built by a pure, unit-tested function; main attaches the
    // side-effecting click handlers (shell/clipboard/webContents). A relevant
    // menu appears for every right-click: links, images, selection, editable,
    // and bare/empty areas.
    win.webContents.on('context-menu', (_event, params) => {
      const descriptors = buildContextMenuTemplate(params, { isExternallyOpenable });
      const template = descriptors.map((d) => {
        if (d.kind === 'separator') return { type: 'separator' };
        if (d.kind === 'role') return { role: d.role, enabled: d.enabled };
        return { label: d.label, click: () => runContextAction(d, params, win) };
      });
      if (template.length === 0) return;
      Menu.buildFromTemplate(template).popup({ window: win });
    });

    return win;
  }

  // ==== SINGLE-INSTANCE LOCK ====
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', (_event, argv) => {
      const file = parseFileArg(argv, fs);
      const wins = BrowserWindow.getAllWindows();
      if (wins.length === 0) return;
      const win = wins[0];
      if (win.isMinimized()) win.restore();
      win.focus();
      if (file) {
        pendingFileToOpen = file;
        deliverPendingFile(win);
      }
    });

    app.whenReady().then(() => {
      // Load persisted settings now that userData path is valid (EC-D1: corrupt
      // file degrades to defaults rather than crashing).
      settingsStore = createSettingsStore({ fs, path, userDataDir: app.getPath('userData') });
      capabilityRegistry = createCapabilityRegistry({ fs, path, userDataDir: app.getPath('userData') });
      currentSettings = settingsStore.load();
      pendingFileToOpen = parseFileArg(proc.argv, fs);
      registerIpcHandlers();
      registerBpmdProtocol(); // T-AI2: attach the bpmd:// asset handler (scheme privileged above)
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('open-file', (event, filePath) => {
      event.preventDefault();
      if (!filePath) return;
      const validated = parseFileArg(['electron', filePath], fs);
      if (!validated) return;
      pendingFileToOpen = validated;
      const wins = BrowserWindow.getAllWindows();
      if (wins.length > 0) deliverPendingFile(wins[0]);
    });
  }

  // Persist window geometry on quit (in addition to per-window close). Settings
  // changed by the renderer are already flushed eagerly via settings:set.
  app.on('before-quit', () => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) persistWindowState(wins[0]);
    try { if (vaultWatcher) { vaultWatcher.close(); vaultWatcher = null; } } catch (_) { /* ignore */ } // T-B9: don't leak the fs.watch
  });

  app.on('window-all-closed', () => {
    try { if (vaultWatcher) { vaultWatcher.close(); vaultWatcher = null; } } catch (_) { /* ignore */ } // T-B9
    if (proc.platform !== 'darwin') app.quit();
  });

  return { createWindow, registerIpcHandlers };
}

module.exports = { bootstrap };

// ==== REAL APP ENTRY ====
// Run only inside the Electron main process. Playwright's Electron harness
// preloads an instrumentation module, so require.main is not reliably this
// file there; process.versions.electron remains the authoritative runtime
// discriminator. Plain Node/Vitest/Stryker imports do not expose that value.
// Stryker disable all — this guard is unreachable in the Node unit runner.
if (process.versions && process.versions.electron) {
  bootstrap({ electron: require('electron'), fs: require('fs') });
}
// Stryker restore all
