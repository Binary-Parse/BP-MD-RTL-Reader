/**
 * history-store.js — one editor state (and so one undo history) per open file (audit B1).
 *
 * The CodeMirror undo history lives inside the EditorState. The editor used to keep a single
 * state for every file, so Ctrl+Z after a tab switch put the previous file's text into the
 * current one and autosave wrote it to disk. The adapter now parks the state of the file it
 * leaves here and takes it back when that file comes back.
 *
 * A parked state is only handed back while the file's text is EXACTLY the text the state holds.
 * If the file was replaced from disk in the meantime (external change, "Reload from disk") the
 * state is dropped, so undo can never bring back text from before the reload.
 *
 * Pure and CodeMirror-free (the state is opaque; `textOf` reads its document) so the coverage
 * and mutation gates see it — the adapter itself is e2e-only.
 */

/**
 * @param {(state: any) => string} textOf  the document text of a parked state
 */
export function createHistoryStore(textOf) {
  const parked = new Map();
  return {
    /** Park `state` for `key`. A missing key (a file with no identity) gets no history. */
    put(key, state) {
      if (key == null) return;
      parked.set(key, state);
    },
    /**
     * The parked state for `key` if its document is exactly `text`, else null. Either way the
     * entry leaves the store: a match is live in the editor from now on, a mismatch is stale.
     */
    take(key, text) {
      if (!parked.has(key)) return null;
      const state = parked.get(key);
      parked.delete(key);
      return textOf(state) === text ? state : null;
    },
    /** Free the history of a closed file. */
    release(key) {
      parked.delete(key);
    },
    /** Free every history whose key is not in `keys` (files that are gone). */
    retain(keys) {
      const keep = new Set(keys);
      for (const key of [...parked.keys()]) {
        if (!keep.has(key)) parked.delete(key);
      }
    },
    size() {
      return parked.size;
    },
  };
}

let nextKey = 1;

/**
 * A stable identity for an open file. Stored on the file object itself, so it survives the
 * shallow copies the vault merge makes ({ ...file, conflict: true }) while a different file
 * always gets a different key. Keys start at 1, so they are always truthy.
 */
export function historyKeyOf(file) {
  if (file == null) return null;
  if (file._historyId == null) file._historyId = nextKey++;
  return file._historyId;
}
