import { buildSession, pickActiveIndex } from './session.js';

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
  getElement = (id) => hostDocument?.getElementById(id),
} = {}) {
  if (!state) throw new TypeError('workspace controller requires state');

  let vaultId = null;
  let vaultGeneration = 0;
  let workspaceEpoch = 0;
  const api = () => hostWindow?.electronAPI;

  function setVaultIdentity(id, generation = 0) {
    vaultId = id || null;
    vaultGeneration = Number.isFinite(generation) ? generation : 0;
  }

  function markUserIntent() {
    workspaceEpoch++;
  }

  function mayAbandonWorkspace() {
    const dirty = state.files.filter((file) => file.dirty).length;
    return dirty === 0 || confirmDiscard(`${dirty} unsaved file${dirty === 1 ? '' : 's'}. Discard changes and continue?`);
  }

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
          showToast('Could not open folder', 'error');
          return;
        }
        if (!mayAbandonWorkspace()) return;
        const folderName = read.vault?.name || result.vault.name || 'folder';
        state.vaultName = folderName;
        setVaultIdentity(read.vault?.id || result.vault.id, read.vault?.generation || 0);
        const files = read.entries.map((entry) => fileFromSnapshot(entry, vaultId));
        state.files = files;
        setVaultUi(folderName);
        if (files.length === 0) {
          renderTree([]);
          state.activeFile = null;
          showWelcome();
          showToast('Folder opened — no .md files found', 'info');
        } else {
          renderTree(files);
          renderFile(0);
          showToast(`Opened "${folderName}" — ${files.length} note${files.length === 1 ? '' : 's'}`);
        }
      } catch (error) {
        if (error.name !== 'AbortError') showToast('Could not open folder', 'error');
      }
      return;
    }

    if ('showDirectoryPicker' in hostWindow) {
      try {
        const handle = await hostWindow.showDirectoryPicker();
        const files = [];
        for await (const entry of handle.values()) {
          if (entry.kind === 'file' && /\.(md|markdown)$/i.test(entry.name)) {
            files.push({ name: entry.name, path: entry.name, handle: entry, content: '', dirty: false });
          }
        }
        files.sort((a, b) => a.name.localeCompare(b.name));
        if (!mayAbandonWorkspace()) return;
        state.vaultName = handle.name;
        state.files = files;
        setVaultIdentity(null);
        setVaultUi(handle.name);
        if (files.length === 0) {
          showToast('Folder opened — no .md files found', 'info');
        } else {
          renderTree(files);
          renderFile(0);
          showToast(`Opened "${handle.name}" — ${files.length} note${files.length === 1 ? '' : 's'}`);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error(error);
          showToast('Could not open folder', 'error');
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
      const files = [];
      for (const file of chosen) {
        files.push({ name: file.name, path: file.name, handle: null, content: await file.text(), dirty: false });
      }
      files.sort((a, b) => a.name.localeCompare(b.name));
      if (!mayAbandonWorkspace()) return;
      const folderName = chosen[0].webkitRelativePath.split('/')[0] || 'folder';
      state.vaultName = folderName;
      state.files = files;
      setVaultIdentity(null);
      setVaultUi(folderName);
      renderTree(files);
      renderFile(0);
      showToast(`Opened "${folderName}" — ${files.length} note${files.length === 1 ? '' : 's'}`);
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
        showToast(`Opened ${result.name}`);
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
        showToast(`Opened ${file.name}`);
      } catch (error) {
        if (error.name !== 'AbortError') console.error(error);
      }
      return;
    }
    fileInput?.click();
  }

  async function saveCurrent() {
    closeMenu();
    if (state.activeFile === null || !state.files[state.activeFile]) {
      showToast('No file to save', 'error');
      return;
    }
    const file = state.files[state.activeFile];
    const submittedContent = file.content;
    const submittedRevision = Number.isInteger(file.revision) ? file.revision : 0;
    if (file.handle && file.handle.createWritable) {
      try {
        const writable = await file.handle.createWritable();
        await writable.write(submittedContent);
        await writable.close();
        if (file.revision === submittedRevision && file.content === submittedContent) file.dirty = false;
        renderTabs();
        showToast(`Saved ${file.name}`);
      } catch (_) {
        showToast('Could not save', 'error');
      }
      return;
    }

    const electronAPI = api();
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
        });
        if (result && result.ok) {
          file.meta = result.meta || file.meta;
          if (file.revision === submittedRevision && file.content === submittedContent) file.dirty = false;
          renderTabs();
          showToast(`Saved ${file.name}`);
        } else {
          showToast(`Could not save ${file.name} (${result?.error || 'unknown'})`, 'error');
        }
      } catch (_) {
        showToast('Could not save', 'error');
      }
      return;
    }
    if (electronAPI && typeof electronAPI.saveFileAs === 'function') {
      await saveAs();
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
    showToast(`Downloaded ${file.name}`);
  }

  async function saveAs() {
    closeMenu();
    if (state.activeFile === null || !state.files[state.activeFile]) {
      showToast('No file to save', 'error');
      return;
    }
    const file = state.files[state.activeFile];
    const submittedContent = file.content;
    const submittedRevision = Number.isInteger(file.revision) ? file.revision : 0;
    const electronAPI = api();
    if (electronAPI && typeof electronAPI.saveFileAs === 'function') {
      try {
        const meta = file.meta || {};
        const result = await electronAPI.saveFileAs({
          suggestedName: file.name,
          content: submittedContent,
          revision: submittedRevision,
          bom: !!meta.bom,
          eol: meta.eol === '\r\n' ? '\r\n' : '\n',
          finalNewline: meta.finalNewline !== false,
        });
        if (!result || result.canceled) return;
        if (!result.ok) {
          showToast(`Could not save (${result.error || 'unknown'})`, 'error');
          return;
        }
        file.documentId = result.documentId;
        file.vaultId = null;
        file.name = result.name;
        file.path = result.name;
        file.meta = result.meta || file.meta;
        if (file.revision === submittedRevision && file.content === submittedContent) file.dirty = false;
        renderTabs();
        renderFile(state.activeFile);
        showToast(`Saved as ${result.name}`);
      } catch (_) {
        showToast('Could not save', 'error');
      }
      return;
    }
    if ('showSaveFilePicker' in hostWindow) {
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
        renderFile(state.activeFile);
        showToast(`Saved as ${handle.name}`);
      } catch (error) {
        if (error.name !== 'AbortError') showToast('Could not save', 'error');
      }
      return;
    }
    await saveCurrent();
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
      vaultId: file.vaultId || vaultId || null,
      documentId: file.documentId || null,
    };
    state.recents = [entry, ...state.recents.filter((recent) => recent.path !== file.path)].slice(0, 5);
    renderRecents();
  }

  async function openRecent(recent) {
    if (!recent) return;
    markUserIntent();
    let index = state.files.findIndex((file) => file.path === recent.path
      && (!recent.vaultId || !file.vaultId || file.vaultId === recent.vaultId));
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
          if (!mayAbandonWorkspace()) return;
          const folderName = read.vault?.name || 'folder';
          state.vaultName = folderName;
          setVaultIdentity(recent.vaultId, read.vault?.generation || 0);
          state.files = read.entries.map((entry) => fileFromSnapshot(entry, recent.vaultId));
          setVaultUi(folderName);
          renderTree(state.files);
          index = state.files.findIndex((file) => file.path === recent.path);
          renderFile(index >= 0 ? index : 0);
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
    const { name, content } = snapshot || {};
    if (!name || typeof content !== 'string') return;
    markUserIntent();
    addFile(fileFromSnapshot({ ...snapshot, relPath: name }));
  }

  async function handleVaultChanged(event = {}) {
    const { vaultId: changedVaultId, generation } = event;
    const electronAPI = api();
    if (!changedVaultId || changedVaultId !== vaultId || generation !== vaultGeneration
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
    if (!read || changedVaultId !== vaultId || generation !== vaultGeneration) return;
    const entries = read.entries;
    vaultGeneration = read.vault?.generation || vaultGeneration;

    const activePath = state.activeFile != null ? state.files[state.activeFile]?.path : null;
    const previousByPath = new Map(state.files.map((file) => [file.path, file]));
    const normalizeText = (value) => String(value == null ? '' : value).replace(/\r\n?/g, '\n');
    let conflictName = null;
    let reloadedActive = false;
    const merged = entries.map((entry) => {
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
    for (const file of state.files) {
      if (!entries.some((entry) => entry.relPath === file.path)) merged.push(file);
    }
    state.files = merged;
    if (activePath != null) {
      const activeIndex = merged.findIndex((file) => file.path === activePath);
      state.activeFile = activeIndex >= 0 ? activeIndex : state.activeFile;
    }
    renderTree(state.files);
    if (reloadedActive || conflictName) renderFile(state.activeFile);
    else renderTabs();
    if (conflictName) {
      showToast(`"${conflictName}" changed on disk — your edits are kept; resolve in the editor.`, 'error');
    }
  }

  async function restoreLastSession(lastSession) {
    if (!lastSession || typeof lastSession.vaultId !== 'string' || !lastSession.vaultId) return;
    const electronAPI = api();
    if (!electronAPI || typeof electronAPI.readVault !== 'function') return;
    const restoreEpoch = workspaceEpoch;
    let read;
    try {
      read = normalizeVaultRead(
        await electronAPI.readVault(lastSession.vaultId),
        { id: lastSession.vaultId, name: 'folder' },
      );
    } catch (_) {
      return;
    }
    if (!read || !read.entries.length || restoreEpoch !== workspaceEpoch
      || state.files.some((file) => file.dirty)) return;
    const folderName = read.vault?.name || 'folder';
    state.vaultName = folderName;
    setVaultIdentity(lastSession.vaultId, read.vault?.generation || 0);
    state.files = read.entries.map((entry) => fileFromSnapshot(entry, lastSession.vaultId));
    setVaultUi(folderName);
    renderTree(state.files);
    renderFile(pickActiveIndex(state.files, lastSession.activePath));
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
    pushRecent,
    renderRecents,
    openRecent,
    openExternalFile,
    handleVaultChanged,
    restoreLastSession,
    bindExternalEvents,
    markUserIntent,
    mayAbandonWorkspace,
    setVaultIdentity,
    clearVaultIdentity: () => setVaultIdentity(null, 0),
    buildSession: () => buildSession(vaultId, state.files, state.activeFile),
    getVaultId: () => vaultId,
    getVaultGeneration: () => vaultGeneration,
    getWorkspaceEpoch: () => workspaceEpoch,
  };
}
