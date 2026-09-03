import { buildSession, pickActiveIndex } from '../session.js';

const noop = () => {};

export function fileFromSnapshot(entry, vaultId = null) {
  return {
    name: entry.name,
    path: entry.relPath || entry.name,
    handle: null,
    content: entry.content,
    dirty: false,
    documentId: entry.documentId || null,
    vaultId: entry.vaultId || vaultId,
    meta: entry.meta || { bom: false, eol: '\n', finalNewline: false, hash: null },
    revision: 0,
    inventory: !!vaultId,
    open: false,
  };
}

export function normalizeVaultRead(result, fallbackVault) {
  if (Array.isArray(result)) return { vault: fallbackVault, entries: result, skipped: {}, truncated: false };
  if (!result || result.error || !Array.isArray(result.entries)) return null;
  return result;
}

/**
 * Merge a fresh vault read into `existing`, scoped to exactly `vaultId` (B3, multi-folder
 * workspaces) — every other open vault's files (and every loose file) pass through
 * untouched, so opening or re-reading one folder never disturbs another folder's files,
 * tabs, or dirty edits. Reconciles the target vault's OWN files by relative path (not
 * fileKey/documentId: a document capability is re-granted, and so changes, on every
 * read, so it cannot be used to recognize "the same file" across two reads).
 *
 * A file the fresh read no longer contains (removed on disk, or a truncated re-read)
 * is kept rather than dropped — matches the pre-existing single-vault reconcile
 * behavior, which never silently closed a tab out from under the user.
 *
 * @param {Array} existing current State.files
 * @param {string} vaultId the vault being opened/re-read
 * @param {Array<{relPath?, name?, content, meta?, documentId?}>} incoming raw readVault() entries
 * @returns {Array} the new State.files
 */
export function mergeVaultSlice(existing, vaultId, incoming) {
  const normalizeText = (value) => String(value == null ? '' : value).replace(/\r\n?/g, '\n');
  const previousByPath = new Map(
    existing.filter((file) => file.vaultId === vaultId).map((file) => [file.path, file]),
  );
  const seenPaths = new Set();
  const merged = incoming.map((entry) => {
    const relPath = entry.relPath || entry.name;
    seenPaths.add(relPath);
    const incomingFile = fileFromSnapshot(entry, vaultId);
    const previous = previousByPath.get(relPath);
    if (!previous) return incomingFile;
    const prevHash = previous.meta && previous.meta.hash;
    const diskHash = incomingFile.meta && incomingFile.meta.hash;
    // Authoritative when both baselines exist: compare on-disk identity, not the
    // (possibly dirty) in-memory buffer. Fall back to a logical content compare only
    // when a hash baseline is missing (browser/legacy paths).
    const diskChanged = (prevHash != null && diskHash != null)
      ? diskHash !== prevHash
      : normalizeText(previous.content) !== normalizeText(incomingFile.content);
    if (!diskChanged) return previous; // app-owned save / unchanged disk → keep in-memory state (incl. dirty edits)
    if (previous.dirty) {
      return { ...previous, conflict: true, diskContent: incomingFile.content, diskMeta: incomingFile.meta };
    }
    return {
      ...previous,
      content: incomingFile.content,
      meta: incomingFile.meta || previous.meta,
      documentId: incomingFile.documentId || previous.documentId,
      conflict: false,
      diskContent: null,
    };
  });
  const keptAbsent = [...previousByPath.values()].filter((file) => !seenPaths.has(file.path));
  const otherVaultFiles = existing.filter((file) => file.vaultId !== vaultId);
  return [...otherVaultFiles, ...merged, ...keptAbsent];
}

export function createWorkspaceController({
  state,
  hostWindow = globalThis.window,
  hostDocument = globalThis.document,
  fileInput,
  closeMenu = noop,
  showToast = noop,
  showWelcome = noop,
  confirmDiscard = (message) => globalThis.confirm(message),
  addFile = noop,
  renderFile = noop,
  renderTree = noop,
  renderTabs = noop,
  setVaultUi = noop,
  // v1.2: optional localized-message resolver. When absent (unit tests, browser lane)
  // every message below falls back to the exact English string it has always used.
  tmsg = null,
  getElement = (id) => hostDocument?.getElementById(id),
} = {}) {
  if (!state) throw new TypeError('workspace controller requires state');

  let vaultId = null;
  let vaultGeneration = 0;
  // B3 (multi-folder workspaces): a vault-changed notification for an EARLIER-opened
  // folder must still reconcile once a second folder is open and becomes "the" identity
  // below -- watch generations are tracked per-vault so opening folder B doesn't blind
  // handleVaultChanged to folder A's own disk-watch events. getVaultId()/getVaultGeneration()
  // still surface only the most-recently-opened vault (buildSession's single-vault shape,
  // B2) -- full multi-vault session persistence is B4's job, once the renderer tracks a
  // real State.vaults registry.
  const openVaultGenerations = new Map();
  // B4: every currently-open folder's display name, driving the tree's root labels and
  // setVaultUi's N-folder summary. Removed only on an explicit close (B4) -- it is NOT
  // derived from state.files, since a folder with zero files left open in the tab bar
  // (every tab individually closed) is still an open folder until the user closes IT.
  const openVaultNames = new Map();
  let workspaceEpoch = 0;
  const api = () => hostWindow?.electronAPI;

  function setVaultIdentity(id, generation = 0, name = null) {
    vaultId = id || null;
    vaultGeneration = Number.isFinite(generation) ? generation : 0;
    if (vaultId) {
      openVaultGenerations.set(vaultId, vaultGeneration);
      if (name) openVaultNames.set(vaultId, name);
    }
  }

  function markUserIntent() {
    workspaceEpoch++;
  }

  const L = (key, fallback, vars) => {
    if (tmsg) { const s = tmsg(key, vars); if (s) return s; }
    if (vars) {
      return fallback.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
    }
    return fallback;
  };

  // v1.2: these prompts are now Word-style Save/Don't-Save/Cancel (the renderer injects
  // the themed three-way dialog), so they became async — callers await them.
  async function mayAbandonWorkspace() {
    const dirty = state.files.filter((file) => file.dirty).length;
    if (dirty === 0) return true;
    return !!(await confirmDiscard(L('dlg.saveMany', '{n} unsaved file{s}. Discard changes and continue?', { n: dirty, s: dirty === 1 ? '' : 's' })));
  }

  // B4: the vault-scoped counterpart of mayAbandonWorkspace -- closing ONE folder only
  // prompts about ITS OWN dirty files, never another open folder's.
  async function mayAbandonVault(targetVaultId) {
    const dirty = state.files.filter((file) => file.vaultId === targetVaultId && file.dirty).length;
    if (dirty === 0) return true;
    return !!(await confirmDiscard(L('dlg.saveMany', '{n} unsaved file{s} in this folder. Discard changes and continue?', { n: dirty, s: dirty === 1 ? '' : 's' })));
  }

  function getOpenVaults() {
    return [...openVaultNames.entries()].map(([id, name]) => ({ id, name }));
  }

  // Removes exactly one open folder's files, tells main to release its watcher, and
  // re-activates the nearest surviving file (or the welcome card if nothing survives).
  // Returns false without changing anything if the user declines a dirty-file prompt.
  async function closeVault(targetVaultId) {
    if (!targetVaultId || !openVaultNames.has(targetVaultId)) return false;
    if (!(await mayAbandonVault(targetVaultId))) return false;

    const activeFile = state.activeFile != null ? state.files[state.activeFile] : null;
    const activeWasClosed = !!activeFile && activeFile.vaultId === targetVaultId;
    const survivorPath = !activeWasClosed && activeFile ? activeFile.path : null;
    const survivorVaultId = !activeWasClosed && activeFile ? activeFile.vaultId : undefined;
    const closedIndex = state.activeFile;

    state.files = state.files.filter((file) => file.vaultId !== targetVaultId);
    openVaultNames.delete(targetVaultId);
    openVaultGenerations.delete(targetVaultId);
    if (vaultId === targetVaultId) { vaultId = null; vaultGeneration = 0; }

    const electronAPI = api();
    if (electronAPI && typeof electronAPI.closeVault === 'function') {
      try { await electronAPI.closeVault(targetVaultId); } catch (_) { /* best-effort; the watcher leaks harmlessly */ }
    }

    setVaultUi(state.vaultName);
    renderTree(state.files);
    if (activeWasClosed) {
      if (state.files.length) renderFile(Math.min(closedIndex, state.files.length - 1));
      else { state.activeFile = null; showWelcome(); }
    } else if (survivorPath != null) {
      const idx = state.files.findIndex((file) => file.path === survivorPath && file.vaultId === survivorVaultId);
      state.activeFile = idx >= 0 ? idx : state.activeFile;
      renderTabs();
    } else {
      renderTabs();
    }
    return true;
  }

  // State.activeFile's own object-literal default is 0, not null (app.js) — a fresh
  // boot with zero files never explicitly nulls it out, so `state.activeFile == null`
  // alone reads as "something is active" even on a totally empty workspace. The
  // established idiom elsewhere (closeTab, app.js:1805) is: nothing is really active
  // unless there's an actual file sitting at that index.
  function hasActiveFile() {
    return state.activeFile != null && !!state.files[state.activeFile];
  }

  // Renders the merged tree either way; opens the first newly-added file only when
  // nothing was ALREADY active before this open (never steals focus from a file another
  // folder already had open), otherwise just refreshes the tab bar so the new tabs
  // appear. hadActiveFile must be captured by the caller BEFORE state.files is
  // reassigned — checking it here, after the merge, would see the freshly-added file
  // sitting at the stale default index and wrongly conclude something was active.
  function revealAfterOpen(hadActiveFile, firstNewIndex) {
    renderTree(state.files);
    if (!hadActiveFile && firstNewIndex >= 0) renderFile(firstNewIndex);
    else renderTabs();
  }

  // B3 (multi-folder workspaces, issue 1): opening a folder used to ALWAYS wipe the
  // workspace (state.files = files, gated only by a discard confirm) -- now every path
  // below merges into the existing state.files instead. mayAbandonWorkspace() no longer
  // gates any open path; it survives for closing a folder (B4), where a discard prompt
  // is honest again.
  async function openVault() {
    closeMenu();
    markUserIntent();
    const electronAPI = api();
    if (electronAPI && typeof electronAPI.openFolder === 'function') {
      try {
        const result = await electronAPI.openFolder();
        if (!result || result.canceled || result.error || !result.vault?.id) return;
        const read = normalizeVaultRead(await electronAPI.readVault(result.vault.id), result.vault);
        if (!read) {
          showToast(L('toast.couldNotOpenFolder', 'Could not open folder'), 'error');
          return;
        }
        const folderName = read.vault?.name || result.vault.name || 'folder';
        const targetVaultId = read.vault?.id || result.vault.id;
        const hadActiveFile = hasActiveFile();
        state.vaultName = folderName;
        setVaultIdentity(targetVaultId, read.vault?.generation || 0, folderName);
        // grantVault dedupes by canonical realpath, so re-opening the SAME folder
        // reuses the same targetVaultId -- mergeVaultSlice then reconciles it exactly
        // like a disk-watch tick, refreshing it in place rather than duplicating it.
        state.files = mergeVaultSlice(state.files, targetVaultId, read.entries);
        setVaultUi(folderName);
        const firstNewIndex = state.files.findIndex((file) => file.vaultId === targetVaultId);
        if (read.entries.length === 0) {
          if (!hadActiveFile && firstNewIndex < 0) showWelcome();
          showToast(L('toast.folderNoNotes', 'Folder opened — no .md files found'), 'info');
        } else {
          showToast(L('toast.openedFolder', 'Opened "{name}" — {n} note{s}', { name: folderName, n: read.entries.length, s: read.entries.length === 1 ? '' : 's' }));
        if (read.truncated) showToast(L('toast.vaultTruncated', 'Folder is large — showing the first {n} files', { n: read.entries.length }), 'info');
        }
        revealAfterOpen(hadActiveFile, firstNewIndex);
      } catch (error) {
        if (error.name !== 'AbortError') showToast(L('toast.couldNotOpenFolder', 'Could not open folder'), 'error');
      }
      return;
    }

    if ('showDirectoryPicker' in hostWindow) {
      try {
        const handle = await hostWindow.showDirectoryPicker();
        const picked = [];
        for await (const entry of handle.values()) {
          if (entry.kind === 'file' && /\.(md|markdown)$/i.test(entry.name)) {
            picked.push({ name: entry.name, path: entry.name, handle: entry, content: '', dirty: false });
          }
        }
        picked.sort((a, b) => a.name.localeCompare(b.name));
        const hadActiveFile = hasActiveFile();
        state.vaultName = handle.name;
        // No main-issued capability for a browser-picked folder, so there is no stable
        // id to merge/reconcile by -- these are loose files, simply added alongside
        // whatever is already open (B4's @loose pseudo-root gives them a tree home).
        const firstNewIndex = state.files.length;
        state.files = [...state.files, ...picked];
        setVaultUi(handle.name);
        if (picked.length === 0) {
          showToast(L('toast.folderNoNotes', 'Folder opened — no .md files found'), 'info');
        } else {
          showToast(L('toast.openedFolder', 'Opened "{name}" — {n} note{s}', { name: handle.name, n: picked.length, s: picked.length === 1 ? '' : 's' }));
        }
        revealAfterOpen(hadActiveFile, picked.length ? firstNewIndex : -1);
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error(error);
          showToast(L('toast.couldNotOpenFolder', 'Could not open folder'), 'error');
        }
      }
      return;
    }

    const input = hostDocument.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('multiple', '');
    input.accept = '.md,.markdown';
    input.style.display = 'none';
    hostDocument.body.appendChild(input);
    input.addEventListener('change', async () => {
      const chosen = Array.from(input.files || []).filter((file) => /\.(md|markdown)$/i.test(file.name));
      hostDocument.body.removeChild(input);
      if (chosen.length === 0) return;
      const picked = [];
      for (const file of chosen) {
        picked.push({ name: file.name, path: file.name, handle: null, content: await file.text(), dirty: false });
      }
      picked.sort((a, b) => a.name.localeCompare(b.name));
      const folderName = chosen[0].webkitRelativePath.split('/')[0] || 'folder';
      const hadActiveFile = hasActiveFile();
      const firstNewIndex = state.files.length;
      state.vaultName = folderName;
      state.files = [...state.files, ...picked];
      setVaultUi(folderName);
      showToast(L('toast.openedFolder', 'Opened "{name}" — {n} note{s}', { name: folderName, n: picked.length, s: picked.length === 1 ? '' : 's' }));
      revealAfterOpen(hadActiveFile, firstNewIndex);
    });
    input.click();
  }

  async function openSingleFile() {
    closeMenu();
    markUserIntent();
    const electronAPI = api();
    if (electronAPI && typeof electronAPI.openFile === 'function') {
      try {
        const result = await electronAPI.openFile();
        if (!result || result.canceled) return;
        if (result.error || typeof result.content !== 'string') {
          showToast('Could not open file', 'error');
          return;
        }
        addFile(fileFromSnapshot(result));
        showToast(L('toast.openedFile', 'Opened {name}', { name: result.name }));
      } catch (_) {
        showToast('Could not open file', 'error');
      }
      return;
    }
    if ('showOpenFilePicker' in hostWindow) {
      try {
        const [handle] = await hostWindow.showOpenFilePicker({
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
        });
        const file = await handle.getFile();
        addFile({ name: file.name, path: file.name, handle, content: await file.text(), dirty: false });
        showToast(L('toast.openedFile', 'Opened {name}', { name: file.name }));
      } catch (error) {
        if (error.name !== 'AbortError') console.error(error);
      }
      return;
    }
    fileInput?.click();
  }

  // True when a file has no on-disk identity writeThrough can persist — the exact
  // complement of its two write branches — so it needs the Save As dialog instead.
  // One predicate shared by writeThrough's 'nosave' outcome and the close flow's
  // "this choice will open a native dialog" check, so the two can never drift apart.
  function needsSaveAs(file) {
    const electronAPI = api();
    return !(file.handle && file.handle.createWritable)
      && !(file.documentId && electronAPI && typeof electronAPI.writeFile === 'function');
  }

  // v1.2: the write-through core, split out of saveCurrent so the auto-save timer and
  // the close flow can persist ANY file (not just the active tab). Returns one of:
  //   'ok'       written in place (handle or documentId path)
  //   'conflict' the disk copy changed underneath us — file.conflict is set + disk copy
  //              re-read so the resolve banner can appear (previously a single non-vault
  //              file just got a dead-end toast: the banner was vault-only)
  //   'nosave'   no on-disk identity — caller should fall through to Save As
  //   'error'    the write failed
  async function writeThrough(file) {
    const submittedContent = file.content;
    const submittedRevision = Number.isInteger(file.revision) ? file.revision : 0;
    // Dirty is only cleared when the saved bytes are still exactly what the editor had
    // when the save began — an edit landing mid-save keeps the file dirty (the call
    // sites below re-check the same guard for their toasts).
    const cleanIfUnchanged = () => {
      if (file.revision === submittedRevision && file.content === submittedContent) file.dirty = false;
    };
    const electronAPI = api();
    if (file.handle && file.handle.createWritable) {
      try {
        const writable = await file.handle.createWritable();
        await writable.write(submittedContent);
        await writable.close();
        cleanIfUnchanged();
        return 'ok';
      } catch (_) {
        return 'error';
      }
    }
    if (file.documentId && electronAPI && typeof electronAPI.writeFile === 'function') {
      try {
        const meta = file.meta || {};
        const result = await electronAPI.writeFile({
          documentId: file.documentId,
          content: submittedContent,
          revision: submittedRevision,
          baseHash: meta.hash,
          bom: !!meta.bom,
          eol: meta.eol === '\r\n' ? '\r\n' : '\n',
          finalNewline: meta.finalNewline !== false,
          encoding: typeof meta.encoding === 'string' ? meta.encoding : 'utf8',
        });
        if (result && result.ok) {
          file.meta = result.meta || file.meta;
          cleanIfUnchanged();
          return 'ok';
        }
        if (result && result.error === 'conflict') {
          // Re-read the disk copy so the Keep-mine/Reload banner has something to show.
          file.conflict = true;
          try {
            const fresh = electronAPI && typeof electronAPI.readFile === 'function'
              ? await electronAPI.readFile(file.documentId)
              : null;
            if (fresh && typeof fresh.content === 'string') {
              file.diskContent = fresh.content;
              file.diskMeta = fresh.meta || null;
            }
          } catch (_) { /* banner still renders; reload will just no-op */ }
          return 'conflict';
        }
        file._lastWriteError = (result && result.error) || 'unknown';
        return 'error';
      } catch (_) {
        file._lastWriteError = null;
        return 'error';
      }
    }
    return 'nosave';
  }

  async function saveCurrent(target) {
    closeMenu();
    const file = target
      || (state.activeFile === null ? null : state.files[state.activeFile]);
    if (!file) {
      showToast(L('toast.noFileToSave', 'No file to save'), 'error');
      return;
    }
    const submittedRevision = Number.isInteger(file.revision) ? file.revision : 0;
    const submittedContent = file.content;
    const outcome = await writeThrough(file);
    if (outcome === 'ok') {
      const unchanged = file.revision === submittedRevision && file.content === submittedContent;
      if (unchanged) file.dirty = false;
      renderTabs();
      showToast(L('toast.saved', 'Saved {name}', { name: file.name }));
      return;
    }
    if (outcome === 'conflict') {
      const idx = state.files.indexOf(file);
      if (idx >= 0) renderFile(idx);
      showToast(L('toast.couldNotSaveName', 'Could not save {name} ({reason})', { name: file.name, reason: 'conflict' }), 'error');
      return;
    }
    if (outcome === 'error') {
      renderTabs();
      if (file._lastWriteError) {
        showToast(L('toast.couldNotSaveName', 'Could not save {name} ({reason})', { name: file.name, reason: file._lastWriteError }), 'error');
      } else {
        showToast(L('toast.couldNotSave', 'Could not save'), 'error');
      }
      return;
    }
    // 'nosave': a new/untitled note (or a dragged-in file) has no on-disk identity yet,
    // so saving it means Save As — a dialog. If the user CANCELS that dialog the old
    // code returned in total silence, which read as "Ctrl+S did nothing"; name the fact.
    if (electronAPIHasSaveAs()) { await saveAs(file); return; }
    await browserSaveAs(file);
  }

  function electronAPIHasSaveAs() {
    const electronAPI = api();
    return !!(electronAPI && typeof electronAPI.saveFileAs === 'function');
  }

  async function saveAs(target) {
    closeMenu();
    const file = target
      || (state.activeFile === null ? null : state.files[state.activeFile]);
    if (!file) {
      showToast(L('toast.noFileToSave', 'No file to save'), 'error');
      return;
    }
    const electronAPI = api();
    if (electronAPI && typeof electronAPI.saveFileAs === 'function') {
      const submittedContent = file.content;
      const submittedRevision = Number.isInteger(file.revision) ? file.revision : 0;
      try {
        const meta = file.meta || {};
        const result = await electronAPI.saveFileAs({
          suggestedName: file.name,
          content: file.content,
          revision: submittedRevision,
          bom: !!meta.bom,
          eol: meta.eol === '\r\n' ? '\r\n' : '\n',
          finalNewline: meta.finalNewline !== false,
          encoding: typeof meta.encoding === 'string' ? meta.encoding : 'utf8',
        });
        if (!result || result.canceled) {
          showToast(L('toast.saveCanceled', 'Save canceled — the note is still unsaved'), 'info');
          return;
        }
        if (!result.ok) {
          showToast(L('toast.couldNotSaveName', 'Could not save {name} ({reason})', { name: file.name, reason: result.error || 'unknown' }), 'error');
          return;
        }
        const leftVault = !!file.vaultId;
        file.documentId = result.documentId;
        file.vaultId = null;
        file.name = result.name;
        file.path = result.name;
        file.meta = result.meta || file.meta;
        if (file.revision === submittedRevision && file.content === submittedContent) file.dirty = false;
        renderTabs();
        const idx = state.files.indexOf(file);
        if (idx >= 0) renderFile(idx);
        showToast(L('toast.savedAs', 'Saved as {name}', { name: result.name }));
        // v1.2: Save As can land anywhere on disk; when it moves the note OUT of its
        // open folder it silently lost that folder's watch/conflict protection. Say so.
        if (leftVault) showToast(L('toast.leftVault', '“{name}” was saved outside the open folder', { name: result.name }), 'info');
      } catch (_) {
        showToast(L('toast.couldNotSave', 'Could not save'), 'error');
      }
      return;
    }
    await browserSaveAs(file);
  }

  // Browser-lane Save As: File System Access API when available, else a plain download.
  async function browserSaveAs(file) {
    const submittedContent = file.content;
    const submittedRevision = Number.isInteger(file.revision) ? file.revision : 0;
    if (typeof hostWindow.showSaveFilePicker === 'function') {
      try {
        const handle = await hostWindow.showSaveFilePicker({
          suggestedName: file.name,
          types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(submittedContent);
        await writable.close();
        file.handle = handle;
        file.name = handle.name;
        file.path = handle.name;
        if (file.revision === submittedRevision && file.content === submittedContent) file.dirty = false;
        renderTabs();
        const idx = state.files.indexOf(file);
        if (idx >= 0) renderFile(idx);
        showToast(L('toast.savedAs', 'Saved as {name}', { name: handle.name }));
      } catch (error) {
        if (error.name !== 'AbortError') showToast(L('toast.couldNotSave', 'Could not save'), 'error');
      }
      return;
    }
    const blob = new Blob([file.content], { type: 'text/markdown' });
    const urlApi = hostWindow.URL || globalThis.URL;
    const url = urlApi.createObjectURL(blob);
    const anchor = hostDocument.createElement('a');
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    urlApi.revokeObjectURL(url);
    showToast(L('toast.downloaded', 'Downloaded {name}', { name: file.name }));
  }

  // v1.2: Save-All used by the close flow and the auto-save timer. Saves every dirty
  // file it can (in place); returns false if any file stayed dirty (a Save As dialog
  // was canceled) so the caller can abort the close — Word's behavior. With
  // promptUntitled, untitled notes go through Save As instead of being skipped
  // (choosing Save in the close prompt and watching nothing happen was v1.2.1's bug);
  // the auto-save lane must never pop a dialog, so it leaves them alone.
  async function saveAllDirty({ promptUntitled = false } = {}) {
    const dirty = state.files.filter((file) => file.dirty);
    for (const file of dirty) {
      const outcome = await writeThrough(file);
      if (outcome === 'nosave') {
        if (!promptUntitled) continue;
        await saveAs(file);
        // saveAs clears dirty only when the chosen bytes are still on disk; a canceled
        // or failed Save As keeps the flag, which fails the all-clean check below and
        // aborts the close.
        if (file.dirty) return false;
        continue;
      }
      if (outcome !== 'ok') return false;
      renderTabs();
    }
    renderTabs();
    return state.files.every((file) => !file.dirty);
  }

  function renderRecents() {
    const list = getElement('recentList');
    const empty = getElement('recentEmpty');
    if (!list) return;
    if (state.recents.length === 0) {
      if (empty) empty.style.display = 'block';
      list.textContent = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.textContent = '';
    state.recents.forEach((recent, index) => {
      const button = hostDocument.createElement('button');
      button.type = 'button';
      button.className = 'recent-item';
      button.dataset.idx = String(index);
      const icon = hostDocument.createElement('span');
      icon.className = 'r-ic';
      icon.textContent = '¶';
      const name = hostDocument.createElement('span');
      name.textContent = recent.name;
      const path = hostDocument.createElement('span');
      path.className = 'r-path';
      path.textContent = recent.path;
      button.append(icon, name, path);
      button.addEventListener('click', () => openRecent(recent));
      list.appendChild(button);
    });
  }

  function pushRecent(file) {
    const entry = {
      name: file.name,
      path: file.path,
      // B3: a loose file (no vaultId of its own) must never inherit the AMBIENT
      // single-vault identity — that stamped folder A's id onto a loose recent opened
      // while folder A happened to be the most-recently-opened vault, so reopening the
      // recent later could try to resolve it against the wrong folder entirely.
      vaultId: file.vaultId || null,
      documentId: file.documentId || null,
    };
    state.recents = [entry, ...state.recents.filter((recent) => recent.path !== file.path)].slice(0, 5);
    renderRecents();
  }

  async function openRecent(recent) {
    if (!recent) return;
    markUserIntent();
    // B3: an exact vaultId match (both null counts as "loose == loose") — the old
    // `!recent.vaultId || !file.vaultId` clauses matched ANY same-path file as long as
    // EITHER side lacked a vaultId, so a loose recent could resolve to a same-path file
    // that in fact belongs to a different open folder.
    let index = state.files.findIndex((file) => file.path === recent.path
      && (file.vaultId || null) === (recent.vaultId || null));
    if (index >= 0) {
      renderFile(index);
      return;
    }
    const electronAPI = api();
    if (recent.vaultId && electronAPI && typeof electronAPI.readVault === 'function') {
      try {
        const read = normalizeVaultRead(
          await electronAPI.readVault(recent.vaultId),
          { id: recent.vaultId, name: 'folder' },
        );
        if (read && read.entries.length) {
          const folderName = read.vault?.name || 'folder';
          state.vaultName = folderName;
          setVaultIdentity(recent.vaultId, read.vault?.generation || 0, folderName);
          state.files = mergeVaultSlice(state.files, recent.vaultId, read.entries);
          setVaultUi(folderName);
          renderTree(state.files);
          index = state.files.findIndex((file) => file.vaultId === recent.vaultId && file.path === recent.path);
          renderFile(index >= 0 ? index : state.files.findIndex((file) => file.vaultId === recent.vaultId));
          return;
        }
      } catch (_) { /* fall through */ }
    }
    if (recent.documentId && electronAPI && typeof electronAPI.readFile === 'function') {
      try {
        const result = await electronAPI.readFile(recent.documentId);
        if (result && !result.error && typeof result.content === 'string') {
          addFile(fileFromSnapshot({ ...result, name: result.name || recent.name, relPath: recent.path || result.name }));
          return;
        }
      } catch (_) { /* fall through */ }
    }
    if (!recent.vaultId && !recent.documentId) {
      showToast(`"${recent.name || recent.path}" was saved by an older version — open it once to restore it`, 'info');
      return;
    }
    showToast(`Could not open "${recent.name || recent.path}"`, 'error');
  }

  function openExternalFile(snapshot) {
    // v1.2: main now reports CLI/open-with delivery failures instead of silently
    // dropping them — say so instead of opening with no file and no message.
    if (snapshot && snapshot.error) {
      showToast(
        snapshot.name
          ? L('toast.openFileFailed', 'Could not open “{name}”', { name: snapshot.name })
          : L('toast.couldNotOpenFile', 'Could not open file'),
        'error',
      );
      return;
    }
    const { name, content } = snapshot || {};
    if (!name || typeof content !== 'string') return;
    markUserIntent();
    addFile(fileFromSnapshot({ ...snapshot, relPath: name }));
  }

  // B3 (multi-folder workspaces): scoped to exactly the changed vault's OWN files --
  // previousByPath and the keep-absent loop below used to run over ALL of state.files,
  // so a path collision between two open folders (both have notes/todo.md) would adopt
  // the wrong file's content and hash, and every OTHER open vault's files would get
  // needlessly re-appended (duplicating/reordering them) on every watch tick. The
  // dispatch guard checks openVaultGenerations (a per-vault map) rather than a single
  // global vaultId/vaultGeneration pair, so an earlier-opened folder's own watch events
  // keep reconciling once a second folder becomes "the" most-recently-opened identity.
  async function handleVaultChanged(event = {}) {
    const { vaultId: changedVaultId, generation } = event;
    const electronAPI = api();
    if (!changedVaultId || openVaultGenerations.get(changedVaultId) !== generation
      || !electronAPI || typeof electronAPI.readVault !== 'function') return;
    let read;
    try {
      read = normalizeVaultRead(
        await electronAPI.readVault(changedVaultId),
        { id: changedVaultId, name: state.vaultName },
      );
    } catch (_) {
      return;
    }
    if (!read || openVaultGenerations.get(changedVaultId) !== generation) return;
    const entries = read.entries;
    const newGeneration = read.vault?.generation || generation;
    openVaultGenerations.set(changedVaultId, newGeneration);
    if (changedVaultId === vaultId) vaultGeneration = newGeneration;

    const activeFile = state.activeFile != null ? state.files[state.activeFile] : null;
    const activePath = activeFile && activeFile.vaultId === changedVaultId ? activeFile.path : null;
    const previousByPath = new Map(
      state.files.filter((file) => file.vaultId === changedVaultId).map((file) => [file.path, file]),
    );
    const normalizeText = (value) => String(value == null ? '' : value).replace(/\r\n?/g, '\n');
    let conflictName = null;
    let reloadedActive = false;
    const seenPaths = new Set();
    const merged = entries.map((entry) => {
      seenPaths.add(entry.relPath);
      const previous = previousByPath.get(entry.relPath);
      if (!previous) return fileFromSnapshot(entry, changedVaultId);
      const prevHash = previous.meta && previous.meta.hash;
      const diskHash = entry.meta && entry.meta.hash;
      // Authoritative when both baselines exist: compare on-disk identity, NOT the
      // (possibly dirty) in-memory buffer — an unchanged disk copy must never be a
      // conflict just because the editor has unsaved edits. Fall back to a logical
      // content compare only when a hash baseline is missing (browser/legacy paths).
      const diskChanged = (prevHash != null && diskHash != null)
        ? diskHash !== prevHash
        : normalizeText(previous.content) !== normalizeText(entry.content);
      if (!diskChanged) return previous; // app-owned save / unchanged disk → keep in-memory state (incl. dirty edits)
      if (previous.dirty) {
        if (entry.relPath === activePath) conflictName = previous.name;
        return { ...previous, conflict: true, diskContent: entry.content, diskMeta: entry.meta };
      }
      if (entry.relPath === activePath) reloadedActive = true;
      return {
        ...previous,
        content: entry.content,
        meta: entry.meta || previous.meta,
        documentId: entry.documentId || previous.documentId,
        conflict: false,
        diskContent: null,
      };
    });
    const keptAbsent = [...previousByPath.values()].filter((file) => !seenPaths.has(file.path));
    const otherVaultFiles = state.files.filter((file) => file.vaultId !== changedVaultId);
    state.files = [...otherVaultFiles, ...merged, ...keptAbsent];
    if (activePath != null) {
      const activeIndex = state.files.findIndex((file) => file.vaultId === changedVaultId && file.path === activePath);
      state.activeFile = activeIndex >= 0 ? activeIndex : state.activeFile;
    }
    renderTree(state.files);
    if (reloadedActive || conflictName) renderFile(state.activeFile);
    else renderTabs();
    if (conflictName) {
      showToast(`"${conflictName}" changed on disk — your edits are kept; resolve in the editor.`, 'error');
    }
  }

  // B2 (multi-folder workspaces): lastSession moved from a flat { vaultId, ... } to a
  // forest-ready { vaults: [{vaultId, ...}], activeVaultId, ... }. Reads either shape so
  // an old settings.json still restores. Only vaults[0] is restored today -- Track B3/B4
  // give the renderer somewhere to put more than one open folder at once.
  async function restoreLastSession(lastSession) {
    const restoreVaultId = lastSession
      && (typeof lastSession.vaultId === 'string' ? lastSession.vaultId : lastSession.vaults?.[0]?.vaultId);
    if (typeof restoreVaultId !== 'string' || !restoreVaultId) return;
    const electronAPI = api();
    if (!electronAPI || typeof electronAPI.readVault !== 'function') return;
    const restoreEpoch = workspaceEpoch;
    let read;
    try {
      read = normalizeVaultRead(
        await electronAPI.readVault(restoreVaultId),
        { id: restoreVaultId, name: 'folder' },
      );
    } catch (_) {
      return;
    }
    if (!read || !read.entries.length || restoreEpoch !== workspaceEpoch
      || state.files.some((file) => file.dirty)) return;
    const folderName = read.vault?.name || 'folder';
    state.vaultName = folderName;
    setVaultIdentity(restoreVaultId, read.vault?.generation || 0, folderName);
    state.files = read.entries.map((entry) => fileFromSnapshot(entry, restoreVaultId));
    setVaultUi(folderName);
    renderTree(state.files);
    renderFile(pickActiveIndex(state.files, lastSession.activePath));
    // v1.2: the >5000-file cap used to truncate the restore listing SILENTLY — files
    // beyond the cap just vanished from the tree on relaunch. Name the fact.
    if (read.truncated) {
      showToast(L('toast.vaultTruncated', 'Folder is large — showing the first {n} files', { n: read.entries.length }), 'info');
    }
  }

  function bindExternalEvents() {
    const electronAPI = api();
    if (electronAPI && typeof electronAPI.onOpenFile === 'function') {
      electronAPI.onOpenFile(openExternalFile);
    }
    if (electronAPI && typeof electronAPI.onVaultChanged === 'function') {
      electronAPI.onVaultChanged(handleVaultChanged);
    }
  }

  return {
    openVault,
    openSingleFile,
    saveCurrent,
    saveAs,
    saveAllDirty,
    needsSaveAs,
    writeThrough,
    pushRecent,
    renderRecents,
    openRecent,
    openExternalFile,
    handleVaultChanged,
    restoreLastSession,
    bindExternalEvents,
    markUserIntent,
    mayAbandonWorkspace,
    mayAbandonVault,
    closeVault,
    getOpenVaults,
    setVaultIdentity,
    clearVaultIdentity: () => { openVaultGenerations.clear(); openVaultNames.clear(); setVaultIdentity(null, 0); },
    buildSession: () => buildSession(vaultId, state.files, state.activeFile),
    getVaultId: () => vaultId,
    getVaultGeneration: () => vaultGeneration,
    getWorkspaceEpoch: () => workspaceEpoch,
  };
}
