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
