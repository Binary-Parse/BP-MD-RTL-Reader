// A note is "dirty" only while its text differs from the last text that was loaded from
// or saved to disk. The baseline lives on the file as `savedContent`; a note that was never
// saved (new, copy, restored snapshot) has no baseline and stays dirty.

// Apply an edit: store `nextText` and recompute the dirty flag against the baseline.
// A clean note without a baseline (e.g. built by a path that predates this field) takes
// its pre-edit text as the baseline, so the first edit is judged against what was on disk.
// A note with no baseline at all (never saved) is always dirty: no text equals "undefined".
export function applyEdit(file, nextText) {
  if (file.savedContent === undefined && !file.dirty) file.savedContent = file.content;
  file.content = nextText;
  file.dirty = nextText !== file.savedContent;
}

// A save made `savedText` the on-disk text: move the baseline.
export function markClean(file, savedText = file.content) {
  file.savedContent = savedText;
  file.dirty = false;
}

// "Don't Save" (B2): throw the edits away. The note goes back to exactly its last saved text and
// is clean, so nothing (auto-save, recovery snapshot, dirty count) can carry the discarded text
// any further. A note whose file changed on disk meanwhile (a pending conflict) goes back to the
// disk text instead, the same as "Reload from disk". Returns false, touching nothing, for a note
// with no saved text to go back to (never saved: the caller removes it instead).
export function discardEdits(file) {
  const conflictPending = file.conflict && typeof file.diskContent === 'string';
  const target = conflictPending ? file.diskContent : file.savedContent;
  if (typeof target !== 'string') return false;
  adoptDiskText(file, target);
  if (conflictPending) {
    if (file.diskMeta) file.meta = file.diskMeta;
    file.conflict = false;
    file.diskContent = null;
    file.diskMeta = null;
  }
  return true;
}

// Another program changed the file and the app has taken note of the new on-disk text
// (`diskText`): that text is now the baseline, whatever the note's earlier baseline was.
// Every path that brings disk text into a note goes through here, so the baseline can never
// lag behind the disk (B6: a stale baseline made "typed back to the old text" look clean and
// the edit was never saved).
//   reload (default)  the note shows the disk text and is clean;
//   keepEdits         the user's text stays, and is dirty unless it already equals the disk text.
export function adoptDiskText(file, diskText, { keepEdits = false } = {}) {
  if (!keepEdits) file.content = diskText;
  file.savedContent = diskText;
  file.dirty = file.content !== diskText;
}
