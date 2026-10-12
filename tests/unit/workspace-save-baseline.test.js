import { describe, expect, test, vi } from 'vitest';
import { createWorkspaceController, fileFromSnapshot } from '../../src/renderer/components/workspace-controller.js';

function harness({ file, electronAPI, showSaveFilePicker }) {
  const state = { files: [file], activeFile: 0, vaultName: null, recents: [] };
  const controller = createWorkspaceController({
    state,
    hostWindow: { electronAPI, showSaveFilePicker },
    hostDocument: { createElement: vi.fn() },
    fileInput: { click: vi.fn() },
    closeMenu: () => {}, showToast: () => {}, showWelcome: () => {},
    confirmDiscard: vi.fn(() => true), addFile: () => {}, renderFile: () => {},
    renderTree: () => {}, renderTabs: () => {}, setVaultUi: () => {},
  });
  return { controller, state };
}

// A save marks the note clean only if no edit landed while it was in flight, and then the
// submitted text becomes the baseline. Each lane (Electron write, browser handle write,
// Electron Save As, browser Save As) must honour the same contract.
const LANES = [
  {
    name: 'Electron write (writeThrough)',
    make: (during) => {
      const file = { name: 'a.md', path: 'a.md', content: 'submitted', dirty: true, revision: 1, documentId: 'doc', meta: {} };
      const writeFile = vi.fn(async () => { during(file); return { ok: true }; });
      return { file, run: () => harness({ file, electronAPI: { writeFile } }).controller.writeThrough(file) };
    },
  },
  {
    name: 'browser file handle (writeThrough)',
    make: (during) => {
      const file = { name: 'a.md', path: 'a.md', content: 'submitted', dirty: true, revision: 1, handle: null };
      file.handle = { createWritable: async () => ({ write: async () => { during(file); }, close: async () => {} }) };
      return { file, run: () => harness({ file }).controller.writeThrough(file) };
    },
  },
  {
    name: 'Electron Save As',
    make: (during) => {
      const file = { name: 'a.md', path: 'a.md', content: 'submitted', dirty: true, revision: 1, meta: {} };
      const saveFileAs = vi.fn(async () => { during(file); return { ok: true, name: 'b.md', documentId: 'd2', meta: {} }; });
      return { file, run: () => harness({ file, electronAPI: { saveFileAs } }).controller.saveAs() };
    },
  },
  {
    name: 'browser Save As',
    make: (during) => {
      const file = { name: 'a.md', path: 'a.md', content: 'submitted', dirty: true, revision: 1 };
      const handle = { name: 'b.md', createWritable: async () => ({ write: async () => { during(file); }, close: async () => {} }) };
      return { file, run: () => harness({ file, showSaveFilePicker: async () => handle }).controller.saveAs() };
    },
  },
];

for (const lane of LANES) {
  describe(`save baseline — ${lane.name}`, () => {
    test('an undisturbed save clears dirty and stores the submitted text as the baseline', async () => {
      const { file, run } = lane.make(() => {});
      await run();
      expect(file.dirty).toBe(false);
      expect(file.savedContent).toBe('submitted');
    });

    test('an edit that lands mid-save (new text and new revision) keeps the note dirty and the old baseline untouched', async () => {
      const { file, run } = lane.make((f) => { f.content = 'newer'; f.revision = 2; });
      await run();
      expect(file.dirty).toBe(true);
      expect(file.savedContent).toBeUndefined();
    });

    test('a mid-save revision bump alone (text typed and reverted) still keeps the note dirty', async () => {
      const { file, run } = lane.make((f) => { f.revision = 2; });
      await run();
      expect(file.dirty).toBe(true);
    });

    test('mid-save text change alone (revision untouched) still keeps the note dirty', async () => {
      const { file, run } = lane.make((f) => { f.content = 'newer'; });
      await run();
      expect(file.dirty).toBe(true);
    });
  });
}

describe('fileFromSnapshot', () => {
  test('a note loaded from disk starts with its text as the saved baseline', () => {
    const f = fileFromSnapshot({ name: 'a.md', content: 'on disk' });
    expect(f.savedContent).toBe('on disk');
    expect(f.dirty).toBe(false);
  });
});
