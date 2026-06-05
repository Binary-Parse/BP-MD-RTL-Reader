/**
 * line-direction.js — per-line RTL/LTR in the CodeMirror 6 source editor (T-F13 × R1/R2).
 *
 * Brings the per-block direction model of the rendered preview (bidi.js / bidi-dom.js) into
 * the CM6 editor: each line gets a `dir` from its own first-strong character (reusing the
 * pure resolveDirection — neutral-only lines inherit the editor's base dir, EC-C1), emitted
 * as a zero-width Decoration.line({attributes:{dir}}). Paired with CM6's perLineTextDirection
 * facet so the engine reads each line's direction — which makes the already-bound
 * direction-aware defaultKeymap (cursorCharLeft/Right) give LOGICAL caret motion for free.
 *
 * CM6 is injected (vendored window.CM6); decoration work is bounded to the visible ranges.
 */

import { resolveDirection } from '../bidi.js';

export function createLineDirection(CM6, getBaseDir = () => 'ltr') {
  const { ViewPlugin, Decoration, EditorView } = CM6;
  const baseDir = () => (typeof getBaseDir === 'function' ? getBaseDir() : getBaseDir) || 'ltr';

  function buildDecorations(view) {
    const ranges = [];
    const { doc } = view.state;
    const seen = new Set(); // a line can span multiple visibleRanges — decorate it once
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = doc.lineAt(pos);
        if (!seen.has(line.from)) {
          seen.add(line.from);
          const dir = resolveDirection(line.text, baseDir());
          ranges.push(Decoration.line({ attributes: { dir } }).range(line.from));
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges, true);
  }

  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) { this.decorations = buildDecorations(view); }
      update(u) {
        // Per-line dir depends only on text + viewport, NOT the selection — so (unlike
        // live-preview) we skip selectionSet-only updates.
        if (u.docChanged || u.viewportChanged) this.decorations = buildDecorations(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );

  // The facet first so CM6 reads per-line dir; the plugin supplies the per-line attributes.
  return [EditorView.perLineTextDirection.of(true), plugin];
}
