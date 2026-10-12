/**
 * file-predicates.js — renderer-side file-type predicates (T-B10).
 *
 * The strict CSP (B4) loads the renderer as raw ES modules, so it cannot require()
 * the CommonJS main-process `main-logic.js`. This is the renderer's single source of
 * truth for the drag-drop filter; keep the extension sets in lockstep with
 * main-logic.js (covered by paired tests). Drag-drop accepts .md/.markdown/.txt.
 */

const DROPPABLE_EXT = /\.(md|markdown|txt)$/i;

export function isDroppableFile(name) {
  return typeof name === 'string' && DROPPABLE_EXT.test(name);
}

/**
 * Name for a new, unsaved note (Ctrl+N): the first free one of Untitled.md, Untitled-1.md,
 * Untitled-2.md, … (audit H10). Counting open "Untitled*" files instead made the new name collide
 * with a surviving one after a tab was closed. File systems here are case-insensitive, so names
 * are compared in lower case.
 * @param {Iterable<string>} [openNames]  the names of the notes that are open now
 * @returns {string}
 */
export function nextUntitledName(openNames) {
  const taken = new Set();
  if (openNames) for (const name of openNames) if (typeof name === 'string') taken.add(name.toLowerCase());
  let name = 'Untitled.md';
  for (let n = 1; taken.has(name.toLowerCase()); n++) name = `Untitled-${n}.md`;
  return name;
}
