'use strict';

const { createAnnotationsStore } = require('./annotations-store');
const { createReadingStatsStore } = require('./reading-stats-store');
const {
  hashContent, decodeBuffer, detectEol, normalize, sweepStaleTempFiles,
} = require('./document-store');
const nodeCrypto = require('crypto');

const DEFAULT_UPDATE_MANIFEST_URL =
  'https://api.github.com/repos/Binary-Parse/BP-MD-RTL-Reader/releases/latest';

// T7.1: the fixed release page. It is a literal HERE (never a network-supplied URL) and the
// channel that opens it takes no parameters, so a compromised renderer can only ever open this
// one page — audit SEC-09's "no network-sourced url" rule, applied to the notice's button.
const RELEASES_PAGE_URL = 'https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases/latest';

// T7.1: opt-in auto update check — notify only, at most once a day.
const AUTO_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const UPDATE_CHECK_MIN_INTERVAL_MS = 60 * 1000;

// T6.1c: an EPUB the renderer built is a few hundred KB at most; anything past this cap is a
// bug or a hostile renderer, and refusing it keeps a single IPC call from filling the disk.
const MAX_EPUB_BYTES = 64 * 1024 * 1024;

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
  // v1.3.0: files to yield the main event loop after during a vault walk (injectable so
  // unit tests can exercise the yield branch with a tiny folder).
  vaultReadYieldEvery = 40,
  // T5.1a: the highlights/margin-notes store (optional so unit harnesses can omit it).
  getAnnotationsStore = null,
  // T8.1: the reading-minutes/streak store (same optional-injection seam).
  getReadingStatsStore = null,
}) {
  // B1 (multi-folder workspaces): one entry per currently-open vault, keyed by the
  // opaque capability id — was a single activeVault/vaultWatcher pair, which made
  // reading a second folder tear down the first folder's watcher (and made bpmd://
  // asset serving resolve against whichever folder was read LAST, regardless of which
  // folder the request's note actually lives in). Maps, not object literals — an
  // object keyed by a renderer-supplied id trips security/detect-object-injection.
  const openVaults = new Map();      // vaultId -> { id, name, path, generation, watcher }
  // T5.1a: the annotations store. Created on FIRST USE (so constructing the controller in a
  // unit harness never touches the real userData path) and injectable via getAnnotationsStore.
  let annotationsStore = null;
  function annotations() {
    if (typeof getAnnotationsStore === 'function') return getAnnotationsStore();
    if (!annotationsStore) {
      annotationsStore = createAnnotationsStore({ fs, path, userDataDir: app.getPath('userData') });
      const capabilityRegistry = getCapabilityRegistry();
      const persistedDocIds = capabilityRegistry
        && typeof capabilityRegistry.listDocuments === 'function'
        ? capabilityRegistry.listDocuments().map((record) => record.id)
        : [];
      const persistedVaultIds = capabilityRegistry
        && typeof capabilityRegistry.listVaults === 'function'
        ? capabilityRegistry.listVaults().map((record) => record.id)
        : null;
      annotationsStore.pruneOrphanDocKeys(persistedDocIds, persistedVaultIds);
    }
    return annotationsStore;
  }
  // T8.1: reading minutes + streak. Same lazy/injectable shape as the annotations store, so a
  // unit harness never touches the real userData path.
  let readingStatsStore = null;
  function readingStats() {
    if (typeof getReadingStatsStore === 'function') return getReadingStatsStore();
    if (!readingStatsStore) {
      readingStatsStore = createReadingStatsStore({ fs, path, userDataDir: app.getPath('userData') });
    }
    return readingStatsStore;
  }
  // T7.1: the opt-in auto update check. Notify-only, at most once a day, and only while the
  // saved setting says 'auto' — the timer and the first check are both re-validated against
  // the live settings, so flipping the switch back to 'manual' really does stop the traffic.
  let autoUpdateTimer = null;
  let bootCheckPending = false;
  function autoUpdateEnabled() {
    const settings = typeof getCurrentSettings === 'function' ? getCurrentSettings() : null;
    return !!(settings && settings.updateCheck === 'auto');
  }
  /** Arm the daily timer once (idempotent). Unref'd so it can never hold the process open. */
  function armAutoUpdateTimer() {
    if (autoUpdateTimer) return autoUpdateTimer;
    autoUpdateTimer = setInterval(() => {
      if (!autoUpdateEnabled()) return;
      void runUpdateCheck().then((result) => notifyUpdateAvailable(result));
    }, AUTO_UPDATE_INTERVAL_MS);
    if (typeof autoUpdateTimer.unref === 'function') autoUpdateTimer.unref();
    return autoUpdateTimer;
  }
  function stopAutoUpdateCheck() {
    if (autoUpdateTimer) clearInterval(autoUpdateTimer);
    autoUpdateTimer = null;
  }
  /** Tell every open window (normally exactly one) that a newer release exists. */
  function notifyUpdateAvailable(result) {
    if (!result || !result.updateAvailable || !result.latest) return false;
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send('update:available', { latest: result.latest, current: result.current });
        }
      } catch (_) { /* a window tearing down mid-send must not break the check */ }
    }
    return true;
  }
  /** The one network call behind both the manual and the automatic check. */
  async function performUpdateCheck() {
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
    // audit SEC-09: the release page URL is a network-sourced string the renderer never
    // uses (it shows `latest`/`current` only). Echoing it widened the IPC surface for no
    // gain, so it is no longer returned.
    return {
      current,
      latest,
      updateAvailable: comparison > 0,
    };
  }
  let lastNetworkedUpdateCheck = null;
  async function runUpdateCheck() {
    if (lastNetworkedUpdateCheck && Date.now() - lastNetworkedUpdateCheck.at < UPDATE_CHECK_MIN_INTERVAL_MS) {
      return lastNetworkedUpdateCheck.result;
    }
    const result = await performUpdateCheck();
    if (result.error !== 'network' && result.error !== 'unsupported') {
      lastNetworkedUpdateCheck = { at: Date.now(), result };
    }
    return result;
  }
  // Audit SEC-01 — authority is SESSION-scoped. A persisted grant alone no longer
  // authorizes reads/writes: the vault must be open, granted via a dialog this run,
  // or bootstrapped from lastSession (re-validated against disk) at startup.
  const sessionVaultGrants = new Set();
  const sessionDocumentGrants = new Set();
  const bootstrapVaultGrants = new Set();
  function vaultGrantActive(vaultId) {
    return openVaults.has(vaultId) || sessionVaultGrants.has(vaultId) || bootstrapVaultGrants.has(vaultId);
  }
  // v1.3.0 (S-M1): a document grant is active when EITHER lane grants it. A standalone
  // record whose folder was later opened gets vaultId merged in memory; when that vault
  // closes, the record must fall back to its own session document grant (fs:reopenDocument
  // re-adds one) instead of losing ALL authority — its still-open tab used to autosave
  // into 'unauthorized-capability' forever after the folder closed.
  function documentGrantActive(record) {
    if (!record) return false;
    if (record.vaultId && vaultGrantActive(record.vaultId)) return true;
    return sessionDocumentGrants.has(record.id);
  }
  // Main-initiated grants (CLI argument / open-with / second-instance delivery) carry the
  // same session authority as a picker dialog, so src/main/index.js registers them here.
  function sessionGrantDocument(documentId) {
    if (typeof documentId === 'string' && documentId) sessionDocumentGrants.add(documentId);
  }
  const readGenerations = new Map(); // vaultId -> last-issued read generation
  const pdfFilteredSessions = new WeakSet();
  // T14 (post-review MED-1): file: URLs the pdf-export session may load — exactly the temp
  // HTML of each in-flight export, never the filesystem at large.
  const activePdfSourceUrls = new Set();

  // T14 (post-review LOW-3): a renderer-supplied save-dialog name must stay a NAME. Passing it
  // through unsanitized let a compromised renderer pre-position the dialog inside any directory
  // (the user still confirms, but the scaffold is attacker-chosen). basename strips every path
  // component on both separator styles; a name that collapses to nothing falls back.
  function sanitizeSuggestedName(value, fallback) {
    const base = typeof value === 'string' ? path.basename(value) : '';
    return base && base !== '.' && base !== '..' ? base : fallback;
  }

  function withTimeout(promise, ms) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // audit SEC-02: the write conflict check used to accept whatever baseHash the renderer
  // sent (or none). Main now remembers the hash from its own last read and requires a
  // match — an omitted or tampered hash is a conflict, not a silent overwrite.
  const lastReadHashes = new Map(); // documentId → meta.hash at last main-side read

  // Hash of the file as it sits on disk right now, computed exactly the way
  // document-store.read computes meta.hash, so it is comparable with a renderer-held
  // baseHash even when main has never read this document this session.
  // SEC-01 (2026-09-26): stat before reading — a grant path swapped for a multi-GB
  // file used to be read whole into main here (freeze/OOM) just to compute a hash.
  // Returns null when the target is oversized or unreadable; the conflict check then
  // simply skips the never-read-this-session fast path.
  function currentDiskHash(absPath) {
    try {
      if (isOversizedFile(fs.statSync(absPath).size)) return null;
    } catch (_) { return null; }
    try {
      const raw = fs.readFileSync(absPath);
      return hashContent(typeof raw === 'string' ? raw : raw.toString('utf8'), nodeCrypto);
    } catch (_) {
      return null;
    }
  }

  function readDocumentCapability(documentId) {
    const capabilityRegistry = getCapabilityRegistry();
    const record = capabilityRegistry && capabilityRegistry.resolveDocument(documentId);
    if (!record) return { error: 'unauthorized-capability' };
    if (!documentGrantActive(record)) return { error: 'unauthorized-capability' };
    const allowedFiles = new Set(
      typeof capabilityRegistry.listDocuments === 'function'
        ? capabilityRegistry.listDocuments().map((item) => item.path)
        : [record.path],
    );
    if (!isAuthorizedPath(record.path, allowedFiles)) return { error: 'unauthorized-path' };
    // SEC-01 (2026-09-26, S-H2 residue): these single-document lanes used to read
    // whatever the granted path NOW points at, with no extension re-test and no
    // symlink check — a recent replaced by a symlink to any file read that file into
    // the renderer. Re-test the markdown extension, and refuse when the path resolves
    // elsewhere: vault documents must still sit inside their vault root; standalone
    // documents must resolve to exactly their granted path (a real rename leaves the
    // old name missing, not pointing somewhere new).
    if (!/\.(md|markdown)$/i.test(record.path)) return { error: 'invalid-file' };
    let realPath = record.path;
    try {
      realPath = fs.realpathSync(record.path);
    } catch (_) {
      return { error: 'read-failed' };
    }
    if (realPath !== record.path) {
      if (record.vaultId) {
        const vault = capabilityRegistry.resolveVault(record.vaultId);
        if (!vault || isSymlinkEscape(realPath, vault.path, path)) {
          return { error: 'unauthorized-path' };
        }
      } else {
        return { error: 'moved-document' };
      }
    }
    try {
      const stat = fs.statSync(realPath);
      if (!stat.isFile()) return { error: 'not-regular-file' };
      if (isOversizedFile(stat.size)) return { error: 'file-too-large' };
      const { content, meta } = docStore.read(realPath);
      if (meta && meta.hash) lastReadHashes.set(record.id, meta.hash);
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

  // readVault fast path (audit PERF-03): authorization already happened at the VAULT
  // level, the stat is already in hand from the walk, and the record was just granted
  // by us — no per-file registry scan, Set build, or extra statSync. Async so a large
  // folder's decode work never blocks the main event loop.
  async function readSnapshot(record, stat) {
    // Strict isFile (audit follow-up): a stat that cannot say "regular file" is NOT one —
    // the same rule as the walk guard, which classifies that shape as special and skips it.
    if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) return { error: 'not-regular-file' };
    if (isOversizedFile(stat.size)) return { error: 'file-too-large' };
    try {
      const { content, meta } = await docStore.readAsync(record.path, stat);
      if (meta && meta.hash) lastReadHashes.set(record.id, meta.hash);
      return { documentId: record.id, vaultId: record.vaultId, name: path.basename(record.path), content, meta };
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
        const granted = getCapabilityRegistry().grantVault(selected);
        sessionVaultGrants.add(granted.id);
        return {
          canceled: false,
          vault: granted,
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
        sessionDocumentGrants.add(capability.id);
        return { canceled: false, ...readDocumentCapability(capability.id) };
      } catch (_) {
        return { error: 'read-failed' };
      }
    });

    ipcMain.handle('fs:readFile', async (_event, documentId) => (
      readDocumentCapability(documentId)
    ));

    // v1.3.0: decode raw bytes for the drag-drop / <input type=file> lanes. The renderer
    // holds a File object, not a path, so it cannot route through fs:readFile — instead
    // it ships the BYTES and main runs the exact document-store detector, making a
    // dropped cp1256/UTF-16 note open identically to a picker-opened one (and save back
    // in its original encoding via Save As). No paths, no fs authority.
    ipcMain.handle('text:decode', async (_event, bytes) => {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return { error: 'invalid' };
      if (bytes.byteLength > 10 * 1024 * 1024) return { error: 'file-too-large' };
      const dec = decodeBuffer(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
      return {
        ok: true,
        text: normalize(dec.text),
        meta: {
          bom: dec.bom,
          eol: detectEol(dec.text),
          finalNewline: /\n$/.test(dec.text),
          encoding: dec.encoding,
        },
      };
    });

    ipcMain.handle('fs:readVault', async (event, vaultId) => {
      const capabilityRegistry = getCapabilityRegistry();
      const vault = capabilityRegistry && capabilityRegistry.resolveVault(vaultId);
      if (!vault) return { error: 'unauthorized-capability' };
      if (!vaultGrantActive(vaultId)) return { error: 'unknown-vault' };
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

      for (let fileIndex = 0; fileIndex < relPaths.length; fileIndex++) {
        const relPath = relPaths[fileIndex];
        // Yield to the event loop periodically: a 5000-file vault must not freeze
        // main (and with it the watcher, timers and second-instance handling) for
        // the whole decode pass.
        if (fileIndex > 0 && fileIndex % vaultReadYieldEvery === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        try {
          const fullPath = path.join(folderPath, relPath);
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
          if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) {
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
          const record = capabilityRegistry.resolveDocument(capability.id);
          const snapshot = record ? await readSnapshot(record, stat) : { error: 'read-failed' };
          if (snapshot.error) {
            skipped.unreadable++;
            continue;
          }
          results.push({ ...snapshot, relPath });
        } catch (_) {
          skipped.unreadable++;
        }
      }

      if (requestGeneration !== readGenerations.get(vaultId)) return { error: 'stale-read' };

      // Crash-orphaned `<note>.tmp-<uuid>` siblings from an interrupted atomic write
      // would otherwise sit in the user's vault forever; sweep stale ones (1h+) once
      // per open. Best-effort — never fail the read over cleanup.
      try { sweepStaleTempFiles(fs, path, folderPath); } catch (_) { /* best-effort */ }

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

    // Audit SEC-01: re-opening a recent re-validates the persisted record against disk
    // (following a moved folder) and only THEN confers session authority.
    ipcMain.handle('fs:reopenVault', (_event, vaultId) => {
      const capabilityRegistry = getCapabilityRegistry();
      const record = capabilityRegistry && capabilityRegistry.resolveVault(vaultId);
      if (!record) return { error: 'unknown-vault' };
      try {
        const real = fs.realpathSync(record.path);
        if (!fs.statSync(real).isDirectory()) return { error: 'missing-folder' };
        if (real !== record.path) {
          // Folder moved since the grant: follow it, and re-pin the canonical path
          // (relocate mutates the registry record — resolveVault hands out a copy).
          capabilityRegistry.relocateVault(record.id, real);
          capabilityRegistry.flush();
        }
        sessionVaultGrants.add(record.id);
        return { ok: true, name: path.basename(real) };
      } catch (_) {
        return { error: 'missing-folder' };
      }
    });
    ipcMain.handle('fs:reopenDocument', (_event, documentId) => {
      const capabilityRegistry = getCapabilityRegistry();
      const record = capabilityRegistry && capabilityRegistry.resolveDocument(documentId);
      if (!record) return { error: 'unknown-capability' };
      try {
        const real = fs.realpathSync(record.path);
        if (!fs.statSync(real).isFile()) return { error: 'missing-file' };
        // SEC-01 (2026-09-26, S-H2): the re-pin used to accept ANY target — a granted
        // path replaced by a symlink re-pinned (and persisted) authority over whatever
        // it pointed at, extension unchecked. Vault documents may only re-pin inside
        // their vault root; standalone documents must resolve to their own exact path
        // (a rename leaves the old name missing — that is the 'missing-file' case),
        // and the resolved target must still be markdown.
        if (!/\.(md|markdown)$/i.test(real)) return { error: 'invalid-file' };
        if (real !== record.path) {
          if (record.vaultId) {
            const vault = capabilityRegistry.resolveVault(record.vaultId);
            if (!vault || isSymlinkEscape(real, vault.path, path)) {
              return { error: 'unauthorized-path' };
            }
          } else {
            return { error: 'moved-document' };
          }
          capabilityRegistry.relocateDocument(record.id, real);
          capabilityRegistry.flush();
        }
        sessionDocumentGrants.add(record.id);
        return { ok: true };
      } catch (_) {
        return { error: 'missing-file' };
      }
    });

    // Closing one folder must never touch another open folder's watcher. Only a vault
    // this session granted may be closed: an unchecked id let a compromised renderer
    // silently disarm every watcher (and with it the external-change safety net).
    // Closing also REVOKES the session authority (dialog + bootstrap grants): a folder
    // the user closed stays closed for the rest of the run — persisted records still
    // exist, but re-opening goes through fs:reopenVault's disk re-validation.
    ipcMain.handle('fs:closeVault', async (_event, vaultId) => {
      if (!vaultGrantActive(vaultId)) return { error: 'unauthorized-capability' };
      closeVault(vaultId);
      sessionVaultGrants.delete(vaultId);
      bootstrapVaultGrants.delete(vaultId);
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
      if (!documentGrantActive(document)) return { error: 'unauthorized-capability' };
      // audit SEC-02: only a hash MAIN itself read counts. An omitted (or tampered) baseHash
      // for a document main already read is a conflict, never a silent overwrite. When main
      // has not read the document this session, hash the disk state here so the check can
      // never be skipped — a grant without a read confers no overwrite authority.
      let expectedHash = lastReadHashes.get(documentId);
      if (expectedHash == null && fs.existsSync(document.path)) {
        try {
          expectedHash = currentDiskHash(document.path);
          lastReadHashes.set(documentId, expectedHash);
        } catch (_) {
          return { error: 'read-failed' };
        }
      }
      if (expectedHash != null && baseHash !== expectedHash) {
        return { error: 'conflict' };
      }
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
      if (result.ok && result.meta && result.meta.hash) lastReadHashes.set(documentId, result.meta.hash);
      return result.ok ? { ...result, revision } : result;
    });

    ipcMain.handle('dialog:saveFile', async (event, payload) => {
      if (!payload || typeof payload.content !== 'string') return { error: 'invalid' };
      if (Buffer.byteLength(payload.content, 'utf8') > 10 * 1024 * 1024) {
        return { error: 'file-too-large' };
      }
      const result = await dialog.showSaveDialog(windowForEvent(event), {
        title: 'Save Markdown File',
        defaultPath: sanitizeSuggestedName(payload.suggestedName, 'Untitled.md'),
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
        sessionDocumentGrants.add(capability.id);
        // audit SEC-02: Save As establishes the new document's baseline hash too.
        if (written.meta && written.meta.hash) lastReadHashes.set(capability.id, written.meta.hash);
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

    // T5.1a: highlights + margin notes. The channel carries TEXT ONLY (an opaque docKey and
    // the highlight records) — no paths and no file authority, so this does not widen the
    // capability model. Validation and the caps live in annotations-store.js.
    ipcMain.handle('annotations:get', async (_event, docKey) => annotations().get(docKey));

    ipcMain.handle('annotations:put', async (_event, payload) => {
      // Envelope first (typed errors below come from the store's own validation).
      if (!payload || typeof payload !== 'object'
        || typeof payload.docKey !== 'string' || !Array.isArray(payload.highlights)) {
        return { error: 'invalid' };
      }
      return annotations().put(payload.docKey, payload.highlights);
    });

    // HYG-01 (2026-09-26): the only cleanup for the PDF export temp was the handler's
    // finally-unlink — a crash between write and finally left the exported note's full
    // HTML in %TEMP% forever (the vault/JSON temp lanes both have sweepers; this lane
    // had none). Hour-old orphans are swept on every export.
    function sweepStaleExportHtmls() {
      try {
        const dir = app.getPath('temp');
        const cutoff = Date.now() - 60 * 60 * 1000;
        for (const name of fs.readdirSync(dir)) {
          if (!/^bpmd-export-[0-9a-f-]{36}\.html$/.test(name)) continue;
          try {
            const full = path.join(dir, name);
            if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
          } catch (_) { /* raced away — fine */ }
        }
      } catch (_) { /* temp dir unreadable — skip the sweep */ }
    }

    ipcMain.handle('export:pdf', async (event, payload) => {
      if (!payload || typeof payload.html !== 'string') return { error: 'invalid' };
      // SEC-04 (2026-09-26): every sibling content channel caps its payload; this was
      // the one unbounded string — a multi-hundred-MB html would be cloned into main,
      // written to %TEMP% and loaded into the print window before anything refused it.
      if (Buffer.byteLength(payload.html, 'utf8') > 10 * 1024 * 1024) {
        return { error: 'file-too-large' };
      }
      sweepStaleExportHtmls();
      const parent = windowForEvent(event);
      const defaultPath = sanitizeSuggestedName(payload.defaultName, 'document.pdf');
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
          // T14 (post-review MED-1): `file:` used to be allowed wholesale, so an export
          // document could pull in arbitrary local files by path and bake them into the PDF.
          // Only THIS export's own temp HTML may load from disk now; everything else must be
          // inline (data:) or about:blank.
          const allowed = /^(data:|about:)/i.test(details.url)
            || activePdfSourceUrls.has(details.url);
          callback({ cancel: !allowed });
        });
      }

      // audit SEC-04: the temp name used to be `Date.now()` + a process-local counter —
      // predictable enough to pre-plant. A random UUID plus an O_EXCL create means a
      // squatted name/symlink can never win, and the write either owns the file or fails.
      const tmpHtml = path.join(
        app.getPath('temp'),
        `bpmd-export-${require('crypto').randomUUID()}.html`,
      );
      activePdfSourceUrls.add(require('url').pathToFileURL(tmpHtml).href);
      let pdfWin = null;
      try {
        const handle = await fs.promises.open(tmpHtml, 'wx');
        try { await handle.writeFile(payload.html, 'utf8'); } finally { await handle.close(); }
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
        activePdfSourceUrls.delete(require('url').pathToFileURL(tmpHtml).href);
        if (pdfWin && !pdfWin.isDestroyed()) pdfWin.close();
        fs.promises.unlink(tmpHtml).catch(() => { /* best-effort temp cleanup */ });
      }
    });

    // T6.1c: EPUB export. The renderer hands over the finished archive as opaque BYTES —
    // there is nothing to render and nothing to fetch, so unlike export:pdf this handler has
    // no window, no session and no network filter: it validates the payload, asks where to
    // put the file, and writes it atomically.
    ipcMain.handle('export:epub', async (event, payload) => {
      const bytes = payload && payload.bytes;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return { error: 'invalid' };
      if (bytes.byteLength > MAX_EPUB_BYTES) return { error: 'too-large' };
      const parent = windowForEvent(event);
      const defaultPath = sanitizeSuggestedName(payload.defaultName, 'document.epub');
      const result = await dialog.showSaveDialog(parent, {
        title: 'Export EPUB',
        defaultPath,
        filters: [{ name: 'EPUB Book', extensions: ['epub'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const written = atomicWriteFile(
        fs,
        result.filePath,
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
      if (!written.ok) return { error: 'write-failed' };
      return { ok: true };
    });

    // T8.1: reading minutes. The renderer sends 1 once a minute while a note is open in
    // Reading mode; main owns the DATE KEY (its local calendar), the caps and the file, so the
    // renderer can never write a wrong day or an arbitrary amount. Local-only, no network.
    ipcMain.handle('stats:get', async () => readingStats().get());
    ipcMain.handle('stats:addMinutes', async (_event, minutes) => readingStats().addMinutes(minutes));

    ipcMain.handle('update:check', async () => runUpdateCheck());

    // The About dialog's version line. Main owns the truth (app.getVersion()), so a
    // version bump can never leave a stale literal in the renderer.
    ipcMain.handle('app:version', async () => app.getVersion());

    // T7.1: the opt-in auto check. Main re-reads the setting itself and refuses unless it is
    // 'auto', so the channel can never turn the default-on privacy promise into a network
    // call: it takes no parameters and returns the same shape as update:check.
    ipcMain.handle('update:auto-check', async () => {
      const settings = typeof getCurrentSettings === 'function' ? getCurrentSettings() : null;
      if (!settings || settings.updateCheck !== 'auto') return { checked: false };
      armAutoUpdateTimer();
      return runUpdateCheck();
    });

    // T7.1: the notice's "View release" button. The URL is a literal in this file and the
    // channel accepts no argument, so the renderer cannot ask main to open anything else.
    ipcMain.handle('update:release-page', async () => {
      if (!shell || typeof shell.openExternal !== 'function') return { error: 'unsupported' };
      try {
        await shell.openExternal(RELEASES_PAGE_URL);
        return { ok: true };
      } catch (_) {
        return { error: 'open-failed' };
      }
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
      if (!documentGrantActive(record)) return { error: 'unauthorized-capability' };
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
      if (!documentGrantActive(record)) return { error: 'unauthorized-capability' };
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
      const payload = Buffer.from(JSON.stringify({ files: clean }), 'utf8');
      // audit PERF-10: the autosave loop mirrors the recovery snapshot every 10s, and an
      // unchanged document set used to replace identical bytes every time. Compare the
      // STABLE part (name+content) — the per-entry `at` stamp is volatile by design, so a
      // byte-for-byte check could never fire. Absent/unreadable is the normal first-write
      // path; it just falls through to the write.
      const snapshotPath = recoveryFilePath();
      const stable = JSON.stringify(clean.map((entry) => [entry.name, entry.content]));
      try {
        const existing = JSON.parse(await fs.promises.readFile(snapshotPath, 'utf8'));
        const existingFiles = existing && Array.isArray(existing.files) ? existing.files : [];
        const existingStable = JSON.stringify(existingFiles.map((entry) => [entry.name, entry.content]));
        if (existingStable === stable) return { ok: true, unchanged: true, count: clean.length };
      } catch (_) { /* no snapshot yet, or unreadable — write it */ }
      const result = atomicWriteFile(
        fs,
        snapshotPath,
        payload,
      );
      return result && result.ok ? { ok: true, count: clean.length } : { error: 'write-failed' };
    });

    ipcMain.handle('recovery:pop', async () => {
      const snapshotPath = recoveryFilePath();
      try {
        const raw = await fs.promises.readFile(snapshotPath, 'utf8');
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {
          // audit QA-06: a torn write (the exact crash this feature exists for) must not
          // DESTROY the snapshot. Keep it aside as .corrupt and tell the renderer, so the
          // user can salvage text from it manually.
          try { await fs.promises.rename(snapshotPath, `${snapshotPath}.corrupt`); } catch (_) { /* keep in place */ }
          return { ok: true, files: [], unreadable: 1 };
        }
        // Peek, never delete: the snapshot is the only copy of crashed-away work, so it
        // survives until the user decides (offerRecovery clears on restore/discard; a
        // crash or quit mid-prompt re-offers it next launch).
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

    function readSettingsForBootstrap() {
      const current = getCurrentSettings();
      if (current) return current;
      const settingsStore = getSettingsStore();
      return settingsStore ? settingsStore.load() : null;
    }

    function bootstrapSessionGrants() {
      // Audit SEC-01: (1) re-validate + activate ONLY the vaults lastSession names, so
      // restore keeps working without opening every old grant; (2) prune the registry
      // to what settings reference (recents + lastSession) so it stops growing forever.
      try {
        const s = readSettingsForBootstrap();
        // Without settings there is nothing to bootstrap FROM, and pruning with empty keep
        // sets would wipe the whole registry — bail out entirely.
        if (!s) return;
        const keepVaultIds = new Set();
        const keepDocumentIds = new Set();
        for (const recent of (Array.isArray(s.recents) ? s.recents : [])) {
          if (recent && typeof recent.vaultId === 'string' && recent.vaultId) keepVaultIds.add(recent.vaultId);
          if (recent && typeof recent.documentId === 'string' && recent.documentId) keepDocumentIds.add(recent.documentId);
        }
        const ls = (s && s.lastSession) || {};
        const sessionVaultIds = Array.isArray(ls.vaults)
          ? ls.vaults.map((v) => v && v.vaultId).filter((id) => typeof id === 'string' && id)
          : (typeof ls.vaultId === 'string' && ls.vaultId ? [ls.vaultId] : []);
        for (const id of sessionVaultIds) keepVaultIds.add(id);
        const capabilityRegistry = getCapabilityRegistry();
        // ONLY lastSession's vaults are re-activated; recents are merely KEPT by prune
        // (a recent must go through fs:reopenVault to regain authority).
        for (const id of sessionVaultIds) {
          const record = capabilityRegistry && capabilityRegistry.resolveVault(id);
          if (!record) continue;
          try {
            if (fs.realpathSync(record.path) !== record.path) continue; // moved — require an explicit picker grant
            if (!fs.statSync(record.path).isDirectory()) continue;
            bootstrapVaultGrants.add(id);
          } catch (_) { /* gone from disk — skip */ }
        }
        if (capabilityRegistry && typeof capabilityRegistry.prune === 'function') {
          try { capabilityRegistry.prune({ keepVaultIds, keepDocumentIds }); } catch (_) { /* best-effort */ }
        }
      } catch (_) { /* settings unavailable — no bootstrap, no prune */ }
    }
    bootstrapSessionGrants();

    // T7.1: opt-in boot check. registerIpcHandlers() runs BEFORE the first window exists, so
    // the check waits for that window to finish loading — the renderer registers its
    // update:available listener during init, and a send before that would simply be lost.
    // With the default 'manual' nothing is armed here and no network call is ever made.
    if (autoUpdateEnabled()) {
      armAutoUpdateTimer();
      bootCheckPending = true;
      app.on('browser-window-created', (_event, win) => {
        if (!bootCheckPending) return;
        bootCheckPending = false;
        const contents = win && win.webContents;
        if (!contents || typeof contents.once !== 'function') return;
        contents.once('did-finish-load', () => {
          if (!autoUpdateEnabled()) return; // the switch may have been turned off while loading
          void runUpdateCheck().then((result) => notifyUpdateAvailable(result));
        });
      });
    }
  }

  return {
    registerIpcHandlers,
    readDocumentCapability,
    sessionGrantDocument,
    closeVaultWatcher,
    closeVault,
    // Full teardown for app quit / last-window-closed: the vault watchers AND the daily update
    // timer, so a quit can never leave a pending timer (or a network call) behind.
    dispose: () => { closeVaultWatcher(); stopAutoUpdateCheck(); },
    getOpenVault: (vaultId) => openVaults.get(vaultId) || null,
    listOpenVaultRoots: () => [...openVaults.values()].map((entry) => entry.path),
  };
}

module.exports = {
  createIpcController,
  DEFAULT_UPDATE_MANIFEST_URL,
};
