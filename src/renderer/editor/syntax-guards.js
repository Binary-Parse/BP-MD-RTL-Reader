import { previewChunks } from '../limits.js';

const EXCLUDED_NODE = /(?:Code|Comment|Escape|Invalid|Error)/i;

function hasExcludedAncestor(node) {
  for (let current = node; current; current = current.parent) {
    if (EXCLUDED_NODE.test(current.name || '')) return true;
  }
  return false;
}

/**
 * Keep regex-based custom extensions subordinate to the Markdown syntax tree.
 * Code, comments, escapes, and parse-error nodes must remain literal.
 */
export function syntaxRangeAllowed(CM6, state, from, to) {
  if (!CM6 || typeof CM6.syntaxTree !== 'function') return true;
  const tree = CM6.syntaxTree(state);
  if (!tree || typeof tree.resolveInner !== 'function') return true;
  const points = [from, Math.max(from, to - 1), from + Math.floor(Math.max(0, to - from - 1) / 2)];
  return points.every((pos) => !hasExcludedAncestor(tree.resolveInner(pos, -1)));
}

// Shared by the preview plugins (live, inline marks, wikilinks, math).

/** The lines the selection spans: markers there stay raw so the user can edit them. */
export function activeLineSpan(view) {
  const { doc, selection } = view.state;
  return { activeFrom: doc.lineAt(selection.main.from).from, activeTo: doc.lineAt(selection.main.to).to };
}

/** Calls visit(docOffset, text) for each size-capped chunk of the visible text. */
export function forEachVisibleChunk(view, visit) {
  for (const range of view.visibleRanges) {
    for (const chunk of previewChunks(view.state.doc.sliceString(range.from, range.to))) {
      visit(range.from + chunk.offset, chunk.text);
    }
  }
}

/**
 * A view plugin whose decorations are rebuilt by build(view) on every document, selection or
 * viewport change. They are atomic, so the caret steps over a collapsed range instead of
 * landing inside hidden markdown.
 */
export function atomicDecorationPlugin(CM6, build) {
  const { ViewPlugin, Decoration, EditorView } = CM6;
  return ViewPlugin.fromClass(
    class {
      constructor(view) { this.decorations = build(view); }
      update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view); }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations || Decoration.set([])),
    },
  );
}
