import { describe, expect, test, vi } from 'vitest';
import {
  createWorkspaceController,
  fileFromSnapshot,
  normalizeVaultRead,
} from '../../src/renderer/workspace-controller.js';

function harness({ state, electronAPI, hostWindow, hostDocument, confirmDiscard } = {}) {
  const activeState = state || { files: [], activeFile: null, vaultName: null, recents: [] };
  const calls = {
    addFile: [], renderFile: [], renderTree: [], renderTabs: 0, vaultUi: [],
    toasts: [], welcome: 0, closeMenu: 0,
  };
  const activeWindow = hostWindow || { electronAPI };
  const activeDocument = hostDocument || { createElement: vi.fn() };
  const controller = createWorkspaceController({
    state: activeState,
    hostWindow: activeWindow,
    hostDocument: activeDocument,
    fileInput: { click: vi.fn() },
    closeMenu: () => { calls.closeMenu++; },
    showToast: (...args) => calls.toasts.push(args),
    showWelcome: () => { calls.welcome++; },
    confirmDiscard: confirmDiscard || vi.fn(() => true),
    addFile: (file) => calls.addFile.push(file),
    renderFile: (index) => calls.renderFile.push(index),
    renderTree: (files) => calls.renderTree.push(files),
    renderTabs: () => { calls.renderTabs++; },
    setVaultUi: (name) => calls.vaultUi.push(name),
  });
  return { controller, state: activeState, calls, hostWindow: activeWindow, hostDocument: activeDocument };
}

describe('workspace controller', () => {
  test('normalizes main-process snapshots without exposing absolute paths', () => {
    expect(fileFromSnapshot({
      name: 'note.md', relPath: 'folder/note.md', content: '# Note', documentId: 'doc-1',
      vaultId: 'vault-1', meta: { eol: '\r\n' }, abs: 'C:\\private\\note.md',
    })).toMatchObject({
      name: 'note.md', path: 'folder/note.md', content: '# Note', documentId: 'doc-1',
      vaultId: 'vault-1', dirty: false, inventory: false, open: false,
    });
  });

  test('normalizes legacy reads and rejects malformed main-process reads', () => {
    const fallback = { id: 'vault', name: 'Fallback' };
    expect(normalizeVaultRead([{ name: 'a.md' }], fallback)).toEqual({
      vault: fallback, entries: [{ name: 'a.md' }], skipped: {}, truncated: false,
    });
    expect(normalizeVaultRead(null, fallback)).toBeNull();
    expect(normalizeVaultRead({ error: 'denied' }, fallback)).toBeNull();
    expect(normalizeVaultRead({ entries: 'invalid' }, fallback)).toBeNull();
    expect(fileFromSnapshot({ name: 'a.md', content: '' }, 'fallback')).toMatchObject({
      path: 'a.md',
      vaultId: 'fallback',
      documentId: null,
      meta: { bom: false, eol: '\n', finalNewline: false, hash: null },
      revision: 0,
      inventory: true,
    });
  });

  test('requires state and tracks identity, session, and discard intent', () => {
    expect(() => createWorkspaceController()).toThrow('workspace controller requires state');
    const confirmDiscard = vi.fn(() => false);
    const activeState = {
      files: [{ name: 'a.md', path: 'a.md', dirty: true }, { name: 'b.md', path: 'b.md', dirty: true }],
      activeFile: 1, vaultName: 'Vault', recents: [],
    };
    const { controller } = harness({ state: activeState, confirmDiscard });
    controller.setVaultIdentity('vault', Number.NaN);
    expect(controller.getVaultId()).toBe('vault');
    expect(controller.getVaultGeneration()).toBe(0);
    expect(controller.mayAbandonWorkspace()).toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith('2 unsaved files. Discard changes and continue?');
    expect(controller.buildSession()).toEqual({
      vaultId: 'vault', activePath: 'b.md', openPaths: ['a.md', 'b.md'],
    });
    controller.clearVaultIdentity();
    expect(controller.getVaultId()).toBeNull();

    activeState.files.forEach((file) => { file.dirty = false; });
    expect(controller.mayAbandonWorkspace()).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledTimes(1);
  });

  test('opens an Electron vault and replaces the workspace after confirmation', async () => {
    const electronAPI = {
      openFolder: vi.fn(async () => ({ vault: { id: 'vault', name: 'Picked' } })),
      readVault: vi.fn(async () => ({
        vault: { id: 'vault', name: 'Read', generation: 7 },
        entries: [
          { name: 'a.md', relPath: 'a.md', content: 'a' },
          { name: 'b.md', relPath: 'b.md', content: 'b' },
        ],
      })),
    };
    const activeState = {
      files: [{ name: 'dirty.md', path: 'dirty.md', dirty: true }],
      activeFile: 0, vaultName: 'Old', recents: [],
    };
    const confirmDiscard = vi.fn(() => true);
    const { controller, state: current, calls } = harness({ state: activeState, electronAPI, confirmDiscard });
    await controller.openVault();
    expect(electronAPI.readVault).toHaveBeenCalledWith('vault');
    expect(confirmDiscard).toHaveBeenCalledWith('1 unsaved file. Discard changes and continue?');
    expect(current.vaultName).toBe('Read');
    expect(current.files.map((file) => file.path)).toEqual(['a.md', 'b.md']);
    expect(controller.getVaultGeneration()).toBe(7);
    expect(calls.vaultUi).toEqual(['Read']);
    expect(calls.renderTree).toHaveLength(1);
    expect(calls.renderFile).toEqual([0]);
    expect(calls.toasts).toContainEqual(['Opened "Read" — 2 notes']);
    expect(calls.closeMenu).toBe(1);
    expect(controller.getWorkspaceEpoch()).toBe(1);
  });

  test('handles empty, canceled, malformed, rejected, and abandoned Electron vault opens', async () => {
    const empty = harness({ electronAPI: {
      openFolder: vi.fn(async () => ({ vault: { id: 'v', name: 'Empty' } })),
      readVault: vi.fn(async () => ({ vault: { id: 'v', name: 'Empty' }, entries: [] })),
    } });
    await empty.controller.openVault();
    expect(empty.state.activeFile).toBeNull();
    expect(empty.calls.renderTree).toEqual([[]]);
    expect(empty.calls.welcome).toBe(1);
    expect(empty.calls.toasts).toContainEqual(['Folder opened — no .md files found', 'info']);

    for (const openFolder of [
      vi.fn(async () => null),
      vi.fn(async () => ({ canceled: true })),
      vi.fn(async () => ({ error: 'denied' })),
    ]) {
      const current = harness({ electronAPI: { openFolder, readVault: vi.fn() } });
      await current.controller.openVault();
      expect(current.calls.renderFile).toEqual([]);
    }

    const malformed = harness({ electronAPI: {
      openFolder: vi.fn(async () => ({ vault: { id: 'v', name: 'Vault' } })),
      readVault: vi.fn(async () => ({ error: 'bad' })),
    } });
    await malformed.controller.openVault();
    expect(malformed.calls.toasts).toContainEqual(['Could not open folder', 'error']);

    const failed = harness({ electronAPI: {
      openFolder: vi.fn(async () => { throw new Error('failed'); }),
    } });
    await failed.controller.openVault();
    expect(failed.calls.toasts).toContainEqual(['Could not open folder', 'error']);

    const abandonedState = {
      files: [{ name: 'dirty.md', path: 'dirty.md', dirty: true }],
      activeFile: 0, vaultName: 'Old', recents: [],
    };
    const abandoned = harness({
      state: abandonedState,
      electronAPI: {
        openFolder: vi.fn(async () => ({ vault: { id: 'v', name: 'New' } })),
        readVault: vi.fn(async () => ({ vault: { id: 'v', name: 'New' }, entries: [{ name: 'n.md', relPath: 'n.md', content: '' }] })),
      },
      confirmDiscard: vi.fn(() => false),
    });
    await abandoned.controller.openVault();
    expect(abandoned.state.vaultName).toBe('Old');
  });

  test('uses fallback folder metadata and singular wording for one Electron note', async () => {
    const current = harness({ electronAPI: {
      openFolder: vi.fn(async () => ({ vault: { id: 'v' } })),
      readVault: vi.fn(async () => [{ name: 'one.md', relPath: 'one.md', content: 'one' }]),
    } });
    await current.controller.openVault();
    expect(current.state.vaultName).toBe('folder');
    expect(current.calls.toasts).toContainEqual(['Opened "folder" — 1 note']);
  });

  test('opens a File System Access vault, filters Markdown, and reports picker errors', async () => {
    const values = async function* entries() {
      yield { kind: 'file', name: 'z.markdown' };
      yield { kind: 'directory', name: 'nested' };
      yield { kind: 'file', name: 'ignore.txt' };
      yield { kind: 'file', name: 'a.md' };
    };
    const hostWindow = { showDirectoryPicker: vi.fn(async () => ({ name: 'Web Vault', values })) };
    const opened = harness({ hostWindow });
    await opened.controller.openVault();
    expect(opened.state.files.map((file) => file.name)).toEqual(['a.md', 'z.markdown']);
    expect(opened.state.vaultName).toBe('Web Vault');
    expect(opened.calls.renderFile).toEqual([0]);
    expect(opened.calls.toasts).toContainEqual(['Opened "Web Vault" — 2 notes']);

    const emptyWindow = {
      showDirectoryPicker: vi.fn(async () => ({
        name: 'Empty',
        values: async function* noMarkdown() { yield { kind: 'file', name: 'x.txt' }; },
      })),
    };
    const empty = harness({ hostWindow: emptyWindow });
    await empty.controller.openVault();
    expect(empty.calls.toasts).toContainEqual(['Folder opened — no .md files found', 'info']);

    const failed = harness({ hostWindow: {
      showDirectoryPicker: vi.fn(async () => { throw new Error('failed'); }),
    } });
    await failed.controller.openVault();
    expect(failed.calls.toasts).toContainEqual(['Could not open folder', 'error']);

    const aborted = harness({ hostWindow: {
      showDirectoryPicker: vi.fn(async () => { throw { name: 'AbortError' }; }),
    } });
    await aborted.controller.openVault();
    expect(aborted.calls.toasts).toEqual([]);
  });

  test('uses the directory-input fallback and reads only chosen Markdown files', async () => {
    let onChange;
    const input = {
      files: [
        { name: 'b.md', webkitRelativePath: 'Folder/b.md', text: vi.fn(async () => 'b') },
        { name: 'skip.txt', webkitRelativePath: 'Folder/skip.txt', text: vi.fn(async () => 'x') },
        { name: 'a.markdown', webkitRelativePath: 'Folder/a.markdown', text: vi.fn(async () => 'a') },
      ],
      style: {},
      setAttribute: vi.fn(),
      addEventListener: vi.fn((event, callback) => { if (event === 'change') onChange = callback; }),
      click: vi.fn(),
    };
    const hostDocument = {
      createElement: vi.fn(() => input),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    };
    const opened = harness({ hostWindow: {}, hostDocument });
    await opened.controller.openVault();
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.md,.markdown');
    expect(input.setAttribute).toHaveBeenCalledWith('webkitdirectory', '');
    expect(input.setAttribute).toHaveBeenCalledWith('multiple', '');
    expect(input.click).toHaveBeenCalledTimes(1);
    await onChange();
    expect(opened.state.vaultName).toBe('Folder');
    expect(opened.state.files.map((file) => [file.name, file.content])).toEqual([
      ['a.markdown', 'a'], ['b.md', 'b'],
    ]);
    expect(hostDocument.body.removeChild).toHaveBeenCalledWith(input);
    expect(opened.calls.renderFile).toEqual([0]);
  });

  test('uses singular wording for one browser-picked note', async () => {
    const hostWindow = {
      showDirectoryPicker: vi.fn(async () => ({
        name: 'One',
        values: async function* oneFile() { yield { kind: 'file', name: 'one.md' }; },
      })),
    };
    const current = harness({ hostWindow });
    await current.controller.openVault();
    expect(current.calls.toasts).toContainEqual(['Opened "One" — 1 note']);
  });

  test('opens one file through Electron, File System Access, and the input fallback', async () => {
    const electron = harness({ electronAPI: {
      openFile: vi.fn(async () => ({
        name: 'one.md', relPath: 'one.md', content: 'one', documentId: 'doc',
      })),
    } });
    await electron.controller.openSingleFile();
    expect(electron.calls.addFile[0]).toMatchObject({ name: 'one.md', content: 'one', documentId: 'doc' });
    expect(electron.calls.toasts).toContainEqual(['Opened one.md']);
    expect(electron.calls.closeMenu).toBe(1);
    expect(electron.controller.getWorkspaceEpoch()).toBe(1);

    const bad = harness({ electronAPI: { openFile: vi.fn(async () => ({ error: 'bad' })) } });
    await bad.controller.openSingleFile();
    expect(bad.calls.toasts).toContainEqual(['Could not open file', 'error']);
    const canceled = harness({ electronAPI: { openFile: vi.fn(async () => ({ canceled: true })) } });
    await canceled.controller.openSingleFile();
    expect(canceled.calls.addFile).toEqual([]);
    const failed = harness({ electronAPI: { openFile: vi.fn(async () => { throw new Error('bad'); }) } });
    await failed.controller.openSingleFile();
    expect(failed.calls.toasts).toContainEqual(['Could not open file', 'error']);

    const handle = {
      getFile: vi.fn(async () => ({ name: 'web.md', text: vi.fn(async () => 'web') })),
    };
    const web = harness({ hostWindow: {
      showOpenFilePicker: vi.fn(async () => [handle]),
    } });
    await web.controller.openSingleFile();
    expect(web.calls.addFile[0]).toMatchObject({ name: 'web.md', handle, content: 'web', dirty: false });
    expect(web.calls.toasts).toContainEqual(['Opened web.md']);

    const aborted = harness({ hostWindow: {
      showOpenFilePicker: vi.fn(async () => { throw { name: 'AbortError' }; }),
    } });
    await aborted.controller.openSingleFile();
    expect(aborted.calls.toasts).toEqual([]);

    const inputClick = vi.fn();
    const fallback = createWorkspaceController({
      state: { files: [], activeFile: null, recents: [] },
      hostWindow: {},
      hostDocument: {},
      fileInput: { click: inputClick },
    });
    await fallback.openSingleFile();
    expect(inputClick).toHaveBeenCalledTimes(1);
  });

  test('opens an external snapshot through the injected add-file boundary', () => {
    const { controller, calls } = harness();
    controller.openExternalFile({ name: 'outside.md', content: 'hello', documentId: 'doc-2' });
    expect(calls.addFile).toHaveLength(1);
    expect(calls.addFile[0]).toMatchObject({ name: 'outside.md', path: 'outside.md', documentId: 'doc-2' });
    expect(controller.getWorkspaceEpoch()).toBe(1);
  });

  test('restores the last session only while no newer user intent supersedes it', async () => {
    let resolveRead;
    const readVault = vi.fn(() => new Promise((resolve) => { resolveRead = resolve; }));
    const first = harness({ electronAPI: { readVault } });
    const pending = first.controller.restoreLastSession({ vaultId: 'vault-1', activePath: 'b.md' });
    first.controller.markUserIntent();
    resolveRead({ vault: { id: 'vault-1', name: 'Vault', generation: 4 }, entries: [
      { name: 'a.md', relPath: 'a.md', content: 'a' },
      { name: 'b.md', relPath: 'b.md', content: 'b' },
    ] });
    await pending;
    expect(first.state.files).toEqual([]);

    const second = harness({ electronAPI: { readVault: vi.fn(async () => ({
      vault: { id: 'vault-1', name: 'Vault', generation: 4 },
      entries: [
        { name: 'a.md', relPath: 'a.md', content: 'a' },
        { name: 'b.md', relPath: 'b.md', content: 'b' },
      ],
    })) } });
    await second.controller.restoreLastSession({ vaultId: 'vault-1', activePath: 'b.md' });
    expect(second.state.files.map((file) => file.path)).toEqual(['a.md', 'b.md']);
    expect(second.calls.renderFile).toEqual([1]);
    expect(second.calls.vaultUi).toEqual(['Vault']);
    expect(second.controller.getVaultId()).toBe('vault-1');
  });

  test('keeps dirty edits and marks a conflict when a watched vault file changes', async () => {
    const state = {
      files: [{ name: 'a.md', path: 'a.md', content: 'local', dirty: true, meta: {}, vaultId: 'v' }],
      activeFile: 0, vaultName: 'Vault', recents: [],
    };
    const readVault = vi.fn(async () => ({
      vault: { id: 'v', name: 'Vault', generation: 8 },
      entries: [{ name: 'a.md', relPath: 'a.md', content: 'disk', meta: { hash: 'new' } }],
    }));
    const { controller, calls } = harness({ state, electronAPI: { readVault } });
    controller.setVaultIdentity('v', 7);
    await controller.handleVaultChanged({ vaultId: 'v', generation: 7 });
    expect(state.files[0]).toMatchObject({ content: 'local', dirty: true, conflict: true, diskContent: 'disk' });
    expect(calls.renderFile).toEqual([0]);
    expect(calls.toasts).toContainEqual([
      '"a.md" changed on disk — your edits are kept; resolve in the editor.', 'error',
    ]);
  });

  test('ISSUE-01: does NOT flag a conflict when a dirty note\'s disk copy is unchanged', async () => {
    const state = {
      files: [
        { name: 'a.md', path: 'a.md', content: 'newer unsaved edits', dirty: true, meta: { hash: 'baseA' }, vaultId: 'v' },
        { name: 'b.md', path: 'b.md', content: 'b', dirty: false, meta: { hash: 'baseB' }, vaultId: 'v' },
      ],
      activeFile: 1, vaultName: 'Vault', recents: [],
    };
    // Watcher fires after an own-save of b.md; readVault re-lists the whole vault.
    // a.md's on-disk hash is UNCHANGED (still baseA) even though its in-memory buffer diverged.
    const readVault = vi.fn(async () => ({
      vault: { id: 'v', name: 'Vault', generation: 2 },
      entries: [
        { name: 'a.md', relPath: 'a.md', content: 'a last saved on disk', meta: { hash: 'baseA' } },
        { name: 'b.md', relPath: 'b.md', content: 'b', meta: { hash: 'baseB' } },
      ],
    }));
    const { controller, calls } = harness({ state, electronAPI: { readVault } });
    controller.setVaultIdentity('v', 1);
    await controller.handleVaultChanged({ vaultId: 'v', generation: 1 });
    expect(state.files[0]).toMatchObject({ content: 'newer unsaved edits', dirty: true });
    expect(!!state.files[0].conflict).toBe(false);
    expect(state.files[0].diskContent == null).toBe(true);
    expect(calls.toasts).toEqual([]);
  });

  test('ISSUE-01 guard: still flags a genuine conflict when the disk hash actually changed', async () => {
    const state = {
      files: [{ name: 'a.md', path: 'a.md', content: 'my edits', dirty: true, meta: { hash: 'baseA' }, vaultId: 'v' }],
      activeFile: 0, vaultName: 'Vault', recents: [],
    };
    const readVault = vi.fn(async () => ({
      vault: { id: 'v', name: 'Vault', generation: 2 },
      entries: [{ name: 'a.md', relPath: 'a.md', content: 'changed externally', meta: { hash: 'extA' } }],
    }));
    const { controller } = harness({ state, electronAPI: { readVault } });
    controller.setVaultIdentity('v', 1);
    await controller.handleVaultChanged({ vaultId: 'v', generation: 1 });
    expect(state.files[0]).toMatchObject({
      content: 'my edits', dirty: true, conflict: true,
      diskContent: 'changed externally', diskMeta: { hash: 'extA' },
    });
  });

  test('saves an authorized document with metadata and clears dirty only for the submitted revision', async () => {
    const writeFile = vi.fn(async () => ({ ok: true, meta: { hash: 'next' } }));
    const state = {
      files: [{
        name: 'a.md', path: 'a.md', content: 'body', dirty: true, revision: 2,
        documentId: 'doc-1', meta: { hash: 'base', bom: true, eol: '\r\n', finalNewline: false },
      }],
      activeFile: 0, vaultName: null, recents: [],
    };
    const { controller, calls } = harness({ state, electronAPI: { writeFile } });
    await controller.saveCurrent();
    expect(writeFile).toHaveBeenCalledWith({
      documentId: 'doc-1', content: 'body', revision: 2, baseHash: 'base',
      bom: true, eol: '\r\n', finalNewline: false,
    });
    expect(state.files[0].dirty).toBe(false);
    expect(state.files[0].meta.hash).toBe('next');
    expect(calls.renderTabs).toBe(1);
  });

  test('keeps an authorized Electron document dirty when edits advance during its save', async () => {
    const file = {
      name: 'a.md', path: 'a.md', content: 'submitted', dirty: true, revision: 1,
      documentId: 'doc', meta: {},
    };
    const writeFile = vi.fn(async () => {
      file.content = 'newer';
      file.revision = 2;
      return { ok: true };
    });
    const current = harness({
      state: { files: [file], activeFile: 0, recents: [] },
      electronAPI: { writeFile },
    });
    await current.controller.saveCurrent();
    expect(file.dirty).toBe(true);
    expect(file.meta).toEqual({});
    expect(current.calls.toasts).toContainEqual(['Saved a.md']);
  });

  test('reports missing and failed saves without losing dirty state', async () => {
    const missing = harness();
    await missing.controller.saveCurrent();
    expect(missing.calls.toasts).toEqual([['No file to save', 'error']]);

    const state = {
      files: [{ name: 'a.md', path: 'a.md', content: 'body', dirty: true, documentId: 'doc' }],
      activeFile: 0, recents: [],
    };
    const rejected = harness({ state, electronAPI: {
      writeFile: vi.fn(async () => ({ ok: false, error: 'conflict' })),
    } });
    await rejected.controller.saveCurrent();
    expect(state.files[0].dirty).toBe(true);
    expect(rejected.calls.toasts).toContainEqual(['Could not save a.md (conflict)', 'error']);

    const failedState = {
      files: [{ name: 'b.md', path: 'b.md', content: 'body', dirty: true, documentId: 'doc' }],
      activeFile: 0, recents: [],
    };
    const failed = harness({ state: failedState, electronAPI: {
      writeFile: vi.fn(async () => { throw new Error('failed'); }),
    } });
    await failed.controller.saveCurrent();
    expect(failed.calls.toasts).toContainEqual(['Could not save', 'error']);
  });

  test('saves through a browser file handle and protects newer edits', async () => {
    const file = {
      name: 'a.md', path: 'a.md', content: 'submitted', dirty: true, revision: 3,
      handle: null,
    };
    const writable = {
      write: vi.fn(async () => { file.content = 'newer'; file.revision = 4; }),
      close: vi.fn(async () => {}),
    };
    file.handle = { createWritable: vi.fn(async () => writable) };
    const current = harness({ state: { files: [file], activeFile: 0, recents: [] } });
    await current.controller.saveCurrent();
    expect(writable.write).toHaveBeenCalledWith('submitted');
    expect(file.dirty).toBe(true);
    expect(current.calls.renderTabs).toBe(1);
    expect(current.calls.toasts).toContainEqual(['Saved a.md']);

    file.handle.createWritable.mockRejectedValueOnce(new Error('failed'));
    await current.controller.saveCurrent();
    expect(current.calls.toasts).toContainEqual(['Could not save', 'error']);
  });

  test('delegates unsaved Electron documents to Save As and updates their capability', async () => {
    const state = {
      files: [{
        name: 'draft.md', path: 'draft.md', content: 'body', dirty: true, revision: 1,
        meta: { bom: false, eol: '\n', finalNewline: true },
      }],
      activeFile: 0, recents: [],
    };
    const saveFileAs = vi.fn(async () => ({
      ok: true, name: 'saved.md', documentId: 'doc-new', meta: { hash: 'hash' },
    }));
    const current = harness({ state, electronAPI: { saveFileAs } });
    await current.controller.saveCurrent();
    expect(saveFileAs).toHaveBeenCalledWith({
      suggestedName: 'draft.md', content: 'body', revision: 1,
      bom: false, eol: '\n', finalNewline: true,
    });
    expect(state.files[0]).toMatchObject({
      name: 'saved.md', path: 'saved.md', documentId: 'doc-new', vaultId: null,
      dirty: false, meta: { hash: 'hash' },
    });
    expect(current.calls.renderFile).toEqual([0]);
    expect(current.calls.toasts).toContainEqual(['Saved as saved.md']);
  });

  test('handles canceled, rejected, and failed Electron Save As results', async () => {
    const makeState = () => ({
      files: [{ name: 'a.md', path: 'a.md', content: 'a', dirty: true }],
      activeFile: 0, recents: [],
    });
    const canceled = harness({ state: makeState(), electronAPI: {
      saveFileAs: vi.fn(async () => ({ canceled: true })),
    } });
    await canceled.controller.saveAs();
    expect(canceled.calls.toasts).toEqual([]);

    const rejected = harness({ state: makeState(), electronAPI: {
      saveFileAs: vi.fn(async () => ({ ok: false, error: 'denied' })),
    } });
    await rejected.controller.saveAs();
    expect(rejected.calls.toasts).toContainEqual(['Could not save (denied)', 'error']);

    const failed = harness({ state: makeState(), electronAPI: {
      saveFileAs: vi.fn(async () => { throw new Error('failed'); }),
    } });
    await failed.controller.saveAs();
    expect(failed.calls.toasts).toContainEqual(['Could not save', 'error']);

    const missing = harness();
    await missing.controller.saveAs();
    expect(missing.calls.toasts).toEqual([['No file to save', 'error']]);
  });

  test('saves with the browser picker and downloads when no writable API exists', async () => {
    const writable = { write: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const handle = { name: 'picked.md', createWritable: vi.fn(async () => writable) };
    const state = {
      files: [{ name: 'a.md', path: 'a.md', content: 'body', dirty: true, revision: 0 }],
      activeFile: 0, recents: [],
    };
    const web = harness({ state, hostWindow: {
      showSaveFilePicker: vi.fn(async () => handle),
    } });
    await web.controller.saveAs();
    expect(writable.write).toHaveBeenCalledWith('body');
    expect(state.files[0]).toMatchObject({ name: 'picked.md', path: 'picked.md', handle, dirty: false });

    const anchor = { click: vi.fn() };
    const urlApi = {
      createObjectURL: vi.fn(() => 'blob:note'),
      revokeObjectURL: vi.fn(),
    };
    const downloadState = {
      files: [{ name: 'download.md', path: 'download.md', content: 'download', dirty: true }],
      activeFile: 0, recents: [],
    };
    const download = harness({
      state: downloadState,
      hostWindow: { URL: urlApi },
      hostDocument: { createElement: vi.fn(() => anchor) },
    });
    await download.controller.saveCurrent();
    expect(anchor).toMatchObject({ href: 'blob:note', download: 'download.md' });
    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:note');
    expect(download.calls.toasts).toContainEqual(['Downloaded download.md']);

    await download.controller.saveAs();
    expect(anchor.click).toHaveBeenCalledTimes(2);
  });

  test('handles browser Save As failures and ignores explicit picker cancellation', async () => {
    const makeState = () => ({
      files: [{ name: 'a.md', path: 'a.md', content: 'a', dirty: true }],
      activeFile: 0, recents: [],
    });
    const failed = harness({
      state: makeState(),
      hostWindow: { showSaveFilePicker: vi.fn(async () => { throw new Error('failed'); }) },
    });
    await failed.controller.saveAs();
    expect(failed.calls.toasts).toContainEqual(['Could not save', 'error']);

    const aborted = harness({
      state: makeState(),
      hostWindow: { showSaveFilePicker: vi.fn(async () => { throw { name: 'AbortError' }; }) },
    });
    await aborted.controller.saveAs();
    expect(aborted.calls.toasts).toEqual([]);
  });

  test('renders, deduplicates, caps, and opens recent entries already in memory', async () => {
    const listeners = [];
    const makeNode = () => ({
      style: {}, dataset: {}, children: [], textContent: '',
      append: vi.fn(function append(...nodes) { this.children.push(...nodes); }),
      appendChild: vi.fn(function appendChild(node) { this.children.push(node); }),
      addEventListener: vi.fn((event, callback) => listeners.push({ event, callback })),
    });
    const list = makeNode();
    const empty = makeNode();
    const hostDocument = {
      getElementById: vi.fn((id) => (id === 'recentList' ? list : empty)),
      createElement: vi.fn(makeNode),
    };
    const state = {
      files: [{ name: 'open.md', path: 'open.md', vaultId: 'v', dirty: false }],
      activeFile: 0,
      recents: [
        { name: 'old', path: 'same.md' },
        { name: 'two', path: '2.md' },
        { name: 'three', path: '3.md' },
        { name: 'four', path: '4.md' },
        { name: 'five', path: '5.md' },
      ],
    };
    const current = harness({ state, hostWindow: {}, hostDocument });
    current.controller.pushRecent({ name: 'new', path: 'same.md', vaultId: 'v', documentId: 'd' });
    expect(state.recents).toHaveLength(5);
    expect(state.recents[0]).toEqual({
      name: 'new', path: 'same.md', vaultId: 'v', documentId: 'd',
    });
    expect(list.children).toHaveLength(5);
    expect(empty.style.display).toBe('none');
    expect(listeners.every(({ event }) => event === 'click')).toBe(true);
    await listeners[0].callback();
    expect(current.calls.toasts).toContainEqual(['Could not open "new"', 'error']);

    await current.controller.openRecent({ name: 'open', path: 'open.md', vaultId: 'v' });
    expect(current.calls.renderFile).toEqual([0]);

    state.recents = [];
    current.controller.renderRecents();
    expect(empty.style.display).toBe('block');
    expect(list.textContent).toBe('');
  });

  test('restores recent vaults and document capabilities and reports unavailable legacy entries', async () => {
    const readVault = vi.fn(async () => ({
      vault: { id: 'v', name: 'Recent Vault', generation: 9 },
      entries: [
        { name: 'a.md', relPath: 'a.md', content: 'a' },
        { name: 'target.md', relPath: 'target.md', content: 'target' },
      ],
    }));
    const vault = harness({ electronAPI: { readVault } });
    await vault.controller.openRecent({ name: 'target', path: 'target.md', vaultId: 'v' });
    expect(vault.state.vaultName).toBe('Recent Vault');
    expect(vault.calls.renderFile).toEqual([1]);
    expect(vault.controller.getVaultGeneration()).toBe(9);

    const document = harness({ electronAPI: {
      readFile: vi.fn(async () => ({ name: 'restored.md', content: 'body', documentId: 'doc' })),
    } });
    await document.controller.openRecent({
      name: 'old-name.md', path: 'old-path.md', documentId: 'doc',
    });
    expect(document.calls.addFile[0]).toMatchObject({
      name: 'restored.md', path: 'old-path.md', content: 'body', documentId: 'doc',
    });

    const legacy = harness();
    await legacy.controller.openRecent({ name: 'legacy.md', path: 'legacy.md' });
    expect(legacy.calls.toasts).toContainEqual([
      '"legacy.md" was saved by an older version — open it once to restore it', 'info',
    ]);

    const missing = harness({ electronAPI: {
      readVault: vi.fn(async () => ({ entries: [] })),
      readFile: vi.fn(async () => ({ error: 'missing' })),
    } });
    await missing.controller.openRecent({
      name: 'missing.md', path: 'missing.md', vaultId: 'v', documentId: 'd',
    });
    expect(missing.calls.toasts).toContainEqual(['Could not open "missing.md"', 'error']);
    await missing.controller.openRecent(null);
  });

  test('ignores unrelated vault notifications and cleanly reconciles changed files', async () => {
    const state = {
      files: [
        { name: 'a.md', path: 'a.md', content: 'old\r\n', dirty: false, meta: { hash: 'old' }, documentId: 'old-doc' },
        { name: 'removed.md', path: 'removed.md', content: 'kept', dirty: false },
      ],
      activeFile: 0, vaultName: 'Vault', recents: [],
    };
    const readVault = vi.fn(async () => ({
      vault: { id: 'v', name: 'Vault', generation: 8 },
      entries: [
        { name: 'a.md', relPath: 'a.md', content: 'new', meta: { hash: 'new' }, documentId: 'new-doc' },
        { name: 'new.md', relPath: 'new.md', content: 'created' },
      ],
    }));
    const current = harness({ state, electronAPI: { readVault } });
    current.controller.setVaultIdentity('v', 7);
    await current.controller.handleVaultChanged({ vaultId: 'other', generation: 7 });
    await current.controller.handleVaultChanged({ vaultId: 'v', generation: 6 });
    expect(readVault).not.toHaveBeenCalled();

    await current.controller.handleVaultChanged({ vaultId: 'v', generation: 7 });
    expect(state.files.map((file) => file.path)).toEqual(['a.md', 'new.md', 'removed.md']);
    expect(state.files[0]).toMatchObject({
      content: 'new', dirty: false, conflict: false, diskContent: null,
      meta: { hash: 'new' }, documentId: 'new-doc',
    });
    expect(current.controller.getVaultGeneration()).toBe(8);
    expect(current.calls.renderFile).toEqual([0]);
  });

  test('preserves newline-equivalent files and renders tabs when no active file changed', async () => {
    const unchanged = { name: 'same.md', path: 'same.md', content: 'same\r\n', dirty: false };
    const state = {
      files: [unchanged],
      activeFile: null,
      vaultName: 'Vault',
      recents: [],
    };
    const current = harness({ state, electronAPI: {
      readVault: vi.fn(async () => ({
        vault: { id: 'v', name: 'Vault', generation: 2 },
        entries: [{ name: 'same.md', relPath: 'same.md', content: 'same\n' }],
      })),
    } });
    current.controller.setVaultIdentity('v', 1);
    await current.controller.handleVaultChanged({ vaultId: 'v', generation: 1 });
    expect(state.files[0]).toBe(unchanged);
    expect(state.activeFile).toBeNull();
    expect(current.calls.renderFile).toEqual([]);
    expect(current.calls.renderTabs).toBe(1);
    expect(current.calls.toasts).toEqual([]);
  });

  test('marks non-active dirty changes without showing an active-file conflict toast', async () => {
    const state = {
      files: [
        { name: 'active.md', path: 'active.md', content: 'same', dirty: false },
        { name: 'dirty.md', path: 'dirty.md', content: 'local', dirty: true },
      ],
      activeFile: 0,
      vaultName: 'Vault',
      recents: [],
    };
    const current = harness({ state, electronAPI: {
      readVault: vi.fn(async () => ({
        vault: { id: 'v', name: 'Vault', generation: 2 },
        entries: [
          { name: 'active.md', relPath: 'active.md', content: 'same' },
          { name: 'dirty.md', relPath: 'dirty.md', content: 'disk' },
        ],
      })),
    } });
    current.controller.setVaultIdentity('v', 1);
    await current.controller.handleVaultChanged({ vaultId: 'v', generation: 1 });
    expect(state.files[1]).toMatchObject({ conflict: true, diskContent: 'disk', content: 'local' });
    expect(current.calls.renderTabs).toBe(1);
    expect(current.calls.renderFile).toEqual([]);
    expect(current.calls.toasts).toEqual([]);
  });

  test('rejects invalid, empty, unavailable, and dirty session restores', async () => {
    const noApi = harness();
    await noApi.controller.restoreLastSession({ vaultId: 'v' });
    expect(noApi.state.files).toEqual([]);

    const empty = harness({ electronAPI: {
      readVault: vi.fn(async () => ({ vault: { id: 'v' }, entries: [] })),
    } });
    await empty.controller.restoreLastSession({ vaultId: 'v' });
    expect(empty.state.files).toEqual([]);
    await empty.controller.restoreLastSession({ vaultId: 7 });
    expect(empty.state.files).toEqual([]);

    const dirtyState = {
      files: [{ name: 'dirty.md', path: 'dirty.md', dirty: true }],
      activeFile: 0, recents: [],
    };
    const dirty = harness({ state: dirtyState, electronAPI: {
      readVault: vi.fn(async () => ({
        vault: { id: 'v', name: 'Vault' },
        entries: [{ name: 'new.md', relPath: 'new.md', content: 'new' }],
      })),
    } });
    await dirty.controller.restoreLastSession({ vaultId: 'v' });
    expect(dirty.state.files).toBe(dirtyState.files);
  });

  test('binds external bridge events and retains restore state on invalid reads', async () => {
    let openHandler;
    let vaultHandler;
    const electronAPI = {
      onOpenFile: vi.fn((handler) => { openHandler = handler; }),
      onVaultChanged: vi.fn((handler) => { vaultHandler = handler; }),
      readVault: vi.fn(async () => { throw new Error('failed'); }),
    };
    const current = harness({ electronAPI });
    current.controller.bindExternalEvents();
    expect(openHandler).toBe(current.controller.openExternalFile);
    expect(vaultHandler).toBe(current.controller.handleVaultChanged);
    openHandler({ name: 'event.md', content: 'event' });
    expect(current.calls.addFile[0]).toMatchObject({ name: 'event.md', content: 'event' });
    current.controller.openExternalFile({ name: '', content: 'ignored' });
    current.controller.openExternalFile({ name: 'ignored.md', content: null });
    expect(current.calls.addFile).toHaveLength(1);

    current.controller.setVaultIdentity('v', 1);
    await vaultHandler({ vaultId: 'v', generation: 1 });
    expect(current.state.files).toEqual([]);
    await expect(current.controller.restoreLastSession({ vaultId: 'v' })).resolves.toBeUndefined();
    expect(current.state.files).toEqual([]);
    await expect(current.controller.restoreLastSession(null)).resolves.toBeUndefined();

    const noBridge = harness();
    expect(() => noBridge.controller.bindExternalEvents()).not.toThrow();
  });
});
