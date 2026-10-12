'use strict';

const { createAnnotationsStore } = require('./annotations-store');
const { createReadingStatsStore } = require('./reading-stats-store');
const {
  hashContent, decodeBuffer, detectEol, hasMixedEol, normalize, sweepStaleTempFiles, REOPEN_ENCODINGS,
} = require('./document-store');
const { createOwnWriteTracker } = require('./own-write-tracker');
const { turnSpellcheckOff } = require('./spellcheck-off');
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
// A standalone HTML export carries its images inline, so it gets the EPUB ceiling.
const MAX_HTML_EXPORT_BYTES = 64 * 1024 * 1024;

// H15 step 3: fs:readVaultChanges limits. 50 notes per call (the renderer falls back to a full
// read above that), and the same nesting depth the full walk goes to.
const MAX_CHANGED_PATHS = 50;
const MAX_CHANGED_PATH_CHARS = 1024;
const MAX_VAULT_DEPTH = 12;

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
    // B3: nothing is pruned here. Annotations used to be dropped on first use when the
    // capability registry no longer knew their id; see bootstrapSessionGrants for the rule
    // that replaced it (the registry keeps what annotations name).
    if (!annotationsStore) {
      annotationsStore = createAnnotationsStore({ fs, path, userDataDir: app.getPath('userData') });
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
      void runUpdateCheck().then((result) => notifyAutoCheckResult(result));
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
  // audit M37: the automatic check is silent when it fails, except for this one case, said
  // once per run: the certificate was not one this version knows, so no later check will
  // work either and the user has to look at the releases page.
  let unverifiedNotified = false;
  function notifyAutoCheckResult(result) {
    if (result && result.error === 'untrusted' && !unverifiedNotified) {
      unverifiedNotified = true;
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          if (win && !win.isDestroyed() && win.webContents) win.webContents.send('update:unverified');
        } catch (_) { /* a window tearing down mid-send must not break the check */ }
      }
    }
    return notifyUpdateAvailable(result);
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
    } catch (error) {
      // audit M37: a chain that matches no pin is not "offline". The renderer tells the user
      // that the check was not made and points at the releases page.
      const untrusted = !!error && error.message === 'tls-pin-mismatch';
      return { error: untrusted ? 'untrusted' : 'network', current };
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
  // audit M7 (decision D10): documents whose encoding main only guessed at its last read.
  // Such a document is not written until the user confirms or changes the encoding
  // (fs:confirmEncoding): a save in a wrong guess destroys the file.
  const unconfirmedEncodings = new Set(); // documentId
  // The user's answers of this run: documentId → { encoding, hash of the bytes answered for }.
  const confirmedEncodings = new Map();
  function noteEncodingCertainty(documentId, meta) {
    if (meta && meta.encodingUncertain) unconfirmedEncodings.add(documentId);
    else unconfirmedEncodings.delete(documentId);
  }
  // A later read of an answered document (the folder watcher re-reads on every change) must
  // not ask again: the answer holds for the same bytes, and for new bytes that the chosen
  // encoding reads without loss.
  function withConfirmedEncoding(documentId, absPath, read) {
    const confirmed = confirmedEncodings.get(documentId);
    if (!confirmed || !read.meta || !read.meta.encodingUncertain) return read;
    try {
      const again = docStore.read(absPath, { encoding: confirmed.encoding });
      if (again.error) return read;
      if (again.meta.encodingUncertain && again.meta.hash !== confirmed.hash) return read;
      const meta = { ...again.meta };
      delete meta.encodingUncertain;
      delete meta.encodingInvalidBytes;
      return { content: again.content, meta };
    } catch (_) {
      return read;
    }
  }
  // H15 step 2: what the app itself just wrote, so the vault watcher does not echo it back.
  const ownWrites = createOwnWriteTracker();

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
      return hashContent(raw, nodeCrypto);
    } catch (_) {
      return null;
    }
  }

  function readDocumentCapability(documentId, { encoding } = {}) {
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
      const read = encoding == null
        ? withConfirmedEncoding(record.id, realPath, docStore.read(realPath))
        : docStore.read(realPath, { encoding });
      if (read.error) return { error: read.error };
      const { content, meta } = read;
      if (meta && meta.hash) lastReadHashes.set(record.id, meta.hash);
      noteEncodingCertainty(record.id, meta);
      const snapshot = {
        documentId: record.id,
        vaultId: record.vaultId,
        name: path.basename(record.path),
        content,
        meta,
      };
      // audit M9: a document that belongs to a folder is identified in the renderer by
      // (vaultId, path inside the folder). Without the path, sub/README.md opened by
      // "Open with" took the identity of the folder's root README.md and replaced its tab.
      // The path is relative to the folder, in the form readVault uses; no absolute path.
      const vault = record.vaultId ? capabilityRegistry.resolveVault(record.vaultId) : null;
      if (vault && vault.path) {
        const rel = path.relative(vault.path, record.path);
        if (rel && !path.isAbsolute(rel) && !rel.split(path.sep).includes('..')) {
          snapshot.relPath = rel.split(path.sep).join('/');
        }
      }
      return snapshot;
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
      const { content, meta } = withConfirmedEncoding(record.id, record.path, await docStore.readAsync(record.path, stat));
      if (meta && meta.hash) lastReadHashes.set(record.id, meta.hash);
      noteEncodingCertainty(record.id, meta);
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
  let resetRecoveryForReload = () => {}; // set once the recovery handlers exist (audit M11)
  function closeVaultWatcher() {
    for (const vaultId of [...openVaults.keys()]) closeVault(vaultId);
  }

  // H15 step 3: the three pieces fs:readVault and fs:readVaultChanges share, so the
  // incremental channel is exactly as strict as the full read and the two cannot drift.

  // A vault id is a main-issued capability that must be granted for THIS session and still
  // point at an allowed folder. Raw paths and forged ids stop here.
  function authorizeVault(vaultId) {
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
    return { capabilityRegistry, folderPath };
  }

  // The per-note body of the vault read: lstat, symlink containment, type/size caps, grant,
  // decode. Returns one of
  //   { entry, size }                 the note, ready for the renderer
  //   { skipped, size? }              'escaped' | 'special' | 'oversized' | 'unreadable'
  //   { truncated: true }             the batch byte cap would be exceeded
  // `size` is what the caller adds to its running byte total (a skipped-after-counted note
  // still counts, as it always did).
  async function readVaultFile({ capabilityRegistry, vaultId, folderPath, relPath, cumulativeBytes }) {
    let counted = 0;
    try {
      const fullPath = path.join(folderPath, relPath);
      const lstat = await fs.promises.lstat(fullPath);
      let canonical = fullPath;
      let stat = lstat;
      if (lstat.isSymbolicLink()) {
        canonical = await fs.promises.realpath(fullPath);
        if (isSymlinkEscape(canonical, folderPath, path)) return { skipped: 'escaped' };
        stat = await fs.promises.stat(canonical);
      }
      if (!stat || typeof stat.isFile !== 'function' || !stat.isFile()) return { skipped: 'special' };
      if (isOversizedFile(stat.size)) return { skipped: 'oversized' };
      if (wouldExceedCumulative(cumulativeBytes, stat.size)) return { truncated: true };
      counted = stat.size;
      const capability = capabilityRegistry.grantDocument(canonical, {
        vaultId,
        persistGrant: false,
      });
      const record = capabilityRegistry.resolveDocument(capability.id);
      const snapshot = record ? await readSnapshot(record, stat) : { error: 'read-failed' };
      if (snapshot.error) return { skipped: 'unreadable', size: counted };
      return { entry: { ...snapshot, relPath }, size: counted };
    } catch (_) {
      return { skipped: 'unreadable', size: counted };
    }
  }

  // fs:readVaultChanges input check. The renderer names notes by vault-relative path; each is
  // resolved against the vault root and must stay inside it (no absolute, drive, UNC, empty or
  // "." segments; ".." only if it still lands inside) and be a Markdown file no deeper than the
  // full walk goes. Backslashes count as separators only where they are (Windows): elsewhere
  // they are part of a file name and are refused, which makes the renderer do a full read.
  // The first bad entry refuses the whole call. Returns { relPaths } (normalised, de-duplicated,
  // '/'-separated like the full read's) or { error }.
  function checkChangedPaths(rawPaths, folderPath) {
    if (!Array.isArray(rawPaths) || rawPaths.length === 0) return { error: 'invalid-paths' };
    if (rawPaths.length > MAX_CHANGED_PATHS) return { error: 'too-many-paths' };
    const winSeparators = path.sep === '\\';
    const clean = new Set();
    for (const raw of rawPaths) {
      if (typeof raw !== 'string' || raw.length > MAX_CHANGED_PATH_CHARS) return { error: 'invalid-paths' };
      if (raw.includes('\0') || (winSeparators ? raw.includes(':') : raw.includes('\\'))) return { error: 'invalid-paths' };
      const segments = (winSeparators ? raw.replace(/\\/g, '/') : raw).split('/');
      if (segments.some((segment) => segment === '' || segment === '.')) return { error: 'invalid-paths' };
      const resolved = path.resolve(folderPath, ...segments);
      if (isSymlinkEscape(resolved, folderPath, path)) return { error: 'invalid-paths' };
      const relative = path.relative(folderPath, resolved).split(path.sep).join('/');
      if (!/\.(md|markdown)$/i.test(relative) || relative.split('/').length - 1 > MAX_VAULT_DEPTH) {
        return { error: 'invalid-paths' };
      }
      clean.add(relative);
    }
    return { relPaths: [...clean] };
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

    // audit M7 (decision D10): the user's answer to "the encoding of this note is a guess".
    // reopen: false — keep the guess: only lifts the hold on saving.
    // reopen: true  — read the document again with the chosen encoding and return it like
    //                 fs:readFile; the hold stays when that reading loses bytes (UTF-8 with
    //                 invalid bytes), until it is confirmed in turn.
    ipcMain.handle('fs:confirmEncoding', async (_event, payload) => {
      const { documentId, encoding, reopen } = payload || {};
      if (typeof documentId !== 'string' || !REOPEN_ENCODINGS.includes(encoding)) return { error: 'invalid' };
      if (reopen === true) {
        const snapshot = readDocumentCapability(documentId, { encoding });
        if (!snapshot.error && !snapshot.meta.encodingUncertain) {
          confirmedEncodings.set(documentId, { encoding, hash: snapshot.meta.hash });
        }
        return snapshot;
      }
      const capabilityRegistry = getCapabilityRegistry();
      const record = capabilityRegistry && capabilityRegistry.resolveDocument(documentId);
      if (!record || !documentGrantActive(record)) return { error: 'unauthorized-capability' };
      confirmedEncodings.set(documentId, { encoding, hash: lastReadHashes.get(documentId) });
      unconfirmedEncodings.delete(documentId);
      return { ok: true };
    });

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
          eolMixed: hasMixedEol(dec.text),
          finalNewline: /\n$/.test(dec.text),
          encoding: dec.encoding,
        },
      };
    });

    ipcMain.handle('fs:readVault', async (event, vaultId) => {
      const authorized = authorizeVault(vaultId);
      if (authorized.error) return authorized;
      const { capabilityRegistry, folderPath } = authorized;
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
        const outcome = await readVaultFile({
          capabilityRegistry, vaultId, folderPath, relPath, cumulativeBytes,
        });
        if (outcome.truncated) {
          truncated = true;
          break;
        }
        cumulativeBytes += outcome.size || 0;
        if (outcome.skipped) {
          skipped[outcome.skipped]++;
          continue;
        }
        results.push(outcome.entry);
      }

      if (requestGeneration !== readGenerations.get(vaultId)) return { error: 'stale-read' };

      // Crash-orphaned `<note>.tmp-<uuid>` siblings from an interrupted atomic write
      // would otherwise sit in the user's vault forever; sweep stale ones (1h+) once
      // per open. Best-effort — never fail the read over cleanup.
      try { sweepStaleTempFiles(fs, path, folderPath); } catch (_) { /* best-effort */ }

      closeVault(vaultId); // only THIS vault's prior watcher, never another open folder's
      const sender = event.sender;
      const watcher = docStore.watch(folderPath, ({ files }) => {
        // H15 step 2: drop only the files whose content is, byte for byte, what this app just
        // wrote. Everything else (an external edit, even one made seconds after our save to the
        // same file) is forwarded. See own-write-tracker.js for the rule.
        const external = files.filter((rel) => {
          const abs = path.join(folderPath, rel);
          return !ownWrites.isOwnWrite(abs, () => currentDiskHash(abs));
        });
        if (external.length === 0) return;
        if (sender && !sender.isDestroyed()) {
          sender.send('vault:changed', {
            vaultId,
            generation: requestGeneration,
            files: external.map((rel) => rel.split(path.sep).join('/')), // same form as readVault relPaths
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

    // H15 step 3: re-read just the notes the watcher reported. Same authority as fs:readVault
    // (a main-issued vault capability that is open this session), but no folder walk, no new
    // watcher and no new generation: the renderer merges the entries into what it already has.
    // Any refusal ({ error }) makes the renderer fall back to a full fs:readVault.
    ipcMain.handle('fs:readVaultChanges', async (_event, vaultId, relPaths) => {
      const authorized = authorizeVault(vaultId);
      if (authorized.error) return authorized;
      const { capabilityRegistry, folderPath } = authorized;
      const open = openVaults.get(vaultId);
      if (!open) return { error: 'vault-not-open' };
      const checked = checkChangedPaths(relPaths, folderPath);
      if (checked.error) return checked;
      const entries = [];
      let cumulativeBytes = 0;
      const skipped = { unreadable: 0, oversized: 0, escaped: 0, special: 0 };
      for (const relPath of checked.relPaths) {
        const outcome = await readVaultFile({
          capabilityRegistry, vaultId, folderPath, relPath, cumulativeBytes,
        });
        if (outcome.truncated) return { error: 'truncated' };
        cumulativeBytes += outcome.size || 0;
        if (outcome.skipped) {
          skipped[outcome.skipped]++;
          continue;
        }
        entries.push(outcome.entry);
      }
      // The folder was closed or fully re-read while we were reading: this answer is stale.
      if (openVaults.get(vaultId) !== open) return { error: 'stale-read' };
      return {
        vault: { id: vaultId, name: open.name, generation: open.generation },
        entries,
        skipped,
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
      // audit M7: no write while the encoding of this document is an unconfirmed guess.
      if (unconfirmedEncodings.has(documentId)) return { error: 'encoding-unconfirmed' };
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
      if (result.ok && result.meta && result.meta.hash) {
        lastReadHashes.set(documentId, result.meta.hash);
        ownWrites.record(document.path, result.meta.hash);
      }
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
        // audit M38: this session has its own spellchecker settings, so it is turned off
        // here too, before the export window exists.
        turnSpellcheckOff(pdfSession);
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
            spellcheck: false, // audit M38: no dictionary is ever fetched
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

    // audit L3: HTML export used to be a blob download started in the page, which said
    // "Exported" before the save dialog had even opened. Main asks for the path and writes
    // the finished document; the page speaks only after the answer. No window, no network.
    ipcMain.handle('export:html', async (event, payload) => {
      if (!payload || typeof payload.html !== 'string' || payload.html.length === 0) return { error: 'invalid' };
      if (Buffer.byteLength(payload.html, 'utf8') > MAX_HTML_EXPORT_BYTES) return { error: 'too-large' };
      const parent = windowForEvent(event);
      const defaultPath = sanitizeSuggestedName(payload.defaultName, 'document.html');
      const result = await dialog.showSaveDialog(parent, {
        title: 'Export HTML',
        defaultPath,
        filters: [{ name: 'HTML Document', extensions: ['html'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const written = atomicWriteFile(fs, result.filePath, Buffer.from(payload.html, 'utf8'));
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

    // ── v1.2: crash-recovery snapshots (<userData>/recovery/). ──
    // The renderer mirrors its dirty in-memory notes every 10s; a sanctioned close
    // clears the mirror, a crash leaves it for the next launch's recovery prompt.
    //
    // Two files (audit B4, decision D11):
    //   snapshot.json  what is offered back. While an offer is unanswered it is never
    //                  written, so the 10s mirror cannot replace crashed-away work.
    //   live.json      this session's mirror while an offer is unanswered. If this session
    //                  crashes too, the next launch offers both.
    const RECOVERY_MAX_FILES = 20;
    const RECOVERY_MAX_TOTAL_BYTES = 30 * 1024 * 1024;
    const recoveryDir = () => path.join(app.getPath('userData'), 'recovery');
    const recoveryFilePath = () => path.join(recoveryDir(), 'snapshot.json');
    const recoveryLivePath = () => path.join(recoveryDir(), 'live.json');
    const validRecoveryFiles = (parsed) => (parsed && Array.isArray(parsed.files) ? parsed.files : [])
      .filter((f) => f && typeof f.name === 'string' && typeof f.content === 'string');
    /** The recoverable entries of one mirror file; [] when it is absent or unreadable. */
    const readRecoveryFiles = async (file) => {
      try { return validRecoveryFiles(JSON.parse(await fs.promises.readFile(file, 'utf8'))); } catch (_) { return []; }
    };
    const removeRecoveryFile = async (file) => {
      try { await fs.promises.unlink(file); return true; } catch (error) { return !!error && error.code === 'ENOENT'; }
    };
    // True while snapshot.json holds work the user has not answered for.
    let recoveryOfferPending = false;
    let recoveryReady = null;
    // Once per run: a live.json left behind means the previous session also ended without a
    // sanctioned close while an offer was open. Its work joins the offer, so nothing is lost.
    // audit M11: a page reloaded after a crash is a new session over the same disk. Forgetting
    // the memo makes the next recovery call merge live.json into the offer again, exactly as
    // a relaunch does; without it the reloaded page's first (empty) mirror would overwrite it.
    resetRecoveryForReload = () => { recoveryReady = null; };
    const prepareRecovery = () => {
      if (!recoveryReady) {
        recoveryReady = (async () => {
          const live = await readRecoveryFiles(recoveryLivePath());
          const offered = await readRecoveryFiles(recoveryFilePath());
          // A snapshot found at start-up is work from a run that did not close cleanly: it is
          // an offer from this moment, before the renderer has even asked for it.
          recoveryOfferPending = offered.length + live.length > 0;
          if (!live.length) return; // nothing left behind (an empty mirror is simply overwritten)
          const merged = Buffer.from(JSON.stringify({ files: [...offered, ...live] }), 'utf8');
          const written = atomicWriteFile(fs, recoveryFilePath(), merged);
          if (!written || !written.ok) return; // keep live.json; it is read again next launch
          await removeRecoveryFile(recoveryLivePath());
        })().catch(() => { /* recovery is best-effort; never block the handlers */ });
      }
      return recoveryReady;
    };

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
        fs.mkdirSync(recoveryDir(), { recursive: true });
      } catch (_) {
        return { error: 'write-failed' };
      }
      await prepareRecovery();
      const payload = Buffer.from(JSON.stringify({ files: clean }), 'utf8');
      // audit PERF-10: the autosave loop mirrors the recovery snapshot every 10s, and an
      // unchanged document set used to replace identical bytes every time. Compare the
      // STABLE part (name+content) — the per-entry `at` stamp is volatile by design, so a
      // byte-for-byte check could never fire. Absent/unreadable is the normal first-write
      // path; it just falls through to the write.
      const snapshotPath = recoveryOfferPending ? recoveryLivePath() : recoveryFilePath();
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
      await prepareRecovery();
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
        // crash or quit mid-prompt re-offers it next launch). From here until that
        // decision the mirror goes to live.json.
        const offered = validRecoveryFiles(parsed);
        if (offered.length) recoveryOfferPending = true;
        return { ok: true, files: offered };
      } catch (_) {
        return { ok: true, files: [] }; // nothing to recover — the normal launch path
      }
    });

    // Called when the user answered the offer (Restore or Discard) and on a sanctioned
    // close with no offer outstanding. Answering an offer removes what was offered and makes
    // this session's mirror the snapshot; a sanctioned close removes both.
    ipcMain.handle('recovery:clear', async () => {
      await prepareRecovery();
      const answered = recoveryOfferPending;
      const removed = await removeRecoveryFile(recoveryFilePath());
      if (!removed) return { error: 'clear-failed' }; // still on disk: it is offered again next launch
      recoveryOfferPending = false;
      if (answered) {
        try { await fs.promises.rename(recoveryLivePath(), recoveryFilePath()); } catch (_) { /* no live mirror yet */ }
        return { ok: true };
      }
      await removeRecoveryFile(recoveryLivePath());
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
        // B3: the prune DELETES grants, and a note's highlights are keyed by its grant id, so
        // it runs only on solid ground: settings really read from disk (defaults returned for
        // a damaged or missing file name nothing), and an annotations file whose keys are
        // known. Every id annotations name is kept, so reopening that note or folder gives
        // the same id and finds its highlights again. A kept record grants no authority by
        // itself (audit SEC-01: only an open, picked or reopened vault/document does).
        const annotated = annotations();
        const annotationsKnown = ['ok', 'missing'].includes(annotated.loadStatus());
        if (getSettingsStore().loadStatus() === 'ok' && annotationsKnown) {
          const named = annotated.referencedIds();
          for (const id of named.vaultIds) keepVaultIds.add(id);
          for (const id of named.documentIds) {
            keepDocumentIds.add(id);
            // a standalone note that later joined a folder is kept through that folder
            const record = capabilityRegistry.resolveDocument(id);
            if (record && record.vaultId) keepVaultIds.add(record.vaultId);
          }
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
          void runUpdateCheck().then((result) => notifyAutoCheckResult(result));
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
    resetRecoveryForReload: () => resetRecoveryForReload(),
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
