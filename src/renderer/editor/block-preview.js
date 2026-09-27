/**
 * block-preview.js — CodeMirror 6 live-preview BLOCK widgets (T-F13 parity).
 *
 * The inline live-preview (live-preview.js) only hides inline markers. This renders whole
 * BLOCK constructs (tables, and later math/mermaid/callouts/images) inline as widgets on the
 * lines the selection does NOT touch — so the single CM6 surface matches the rendered preview
 * pane. On a block the cursor is inside, the raw markdown shows (so it stays editable).
 *
 * The actual block→DOM rendering is INJECTED as `renderBlock(type, source) → HTMLElement|null`,
 * so this module reuses the app's existing pipeline (marked + sanitize + bidi) without a hard
 * dependency on it, and `buildBlockDecorations` stays unit-testable with a fake CM6.
 *
 * NOTE: block-level / line-spanning replace decorations must be provided through the editor's
 * decorations FACET computed from state (EditorView.decorations.compute), NOT a ViewPlugin —
 * CM6 needs block heights before the viewport is laid out, so plugin-supplied block decorations
 * throw. (Inline marker hiding in live-preview.js can stay a ViewPlugin; block widgets can't.)
 */

// Classify a lezer-markdown block node into a renderable type tag (or null to leave it as
// editable source). Tables render always; fenced code only when its info string is `mermaid`
// (ordinary code stays highlighted source). More block types are added here over time.
function classifyBlock(node, doc) {
  if (node.name === 'Table') return 'table';
  if (node.name === 'FencedCode') {
    const head = doc.sliceString(node.from, doc.lineAt(node.from).to);
    if (/(```|~~~)\s*mermaid\b/i.test(head)) return 'mermaid';
  }
  if (node.name === 'Blockquote') {
    const head = doc.sliceString(node.from, doc.lineAt(node.from).to);
    // Only a GitHub/Obsidian callout (> [!TYPE]) renders; a plain blockquote stays editable.
    if (/^\s*>\s*\[!(note|tip|important|warning|caution|info)\]/i.test(head)) return 'callout';
  }
  if (node.name === 'Image') {
    // Only a STANDALONE image (a line that is just ![alt](url)) becomes a block widget; an
    // image inline within prose stays raw so we don't replace the surrounding text.
    const line = doc.lineAt(node.from);
    if (doc.sliceString(line.from, line.to).trim() === doc.sliceString(node.from, node.to).trim()) return 'image';
  }
  return null;
}

function makeWidgetClass(CM6, renderBlock) {
  return class BlockWidget extends CM6.WidgetType {
    constructor(type, source, dirKey = '') { super(); this.type = type; this.source = source; this.dirKey = dirKey; }
    // Re-use the same DOM across redraws when the block is unchanged (avoids re-render churn).
    // dirKey participates in identity: a direction flip (toggle / front-matter) must rebuild
    // the widget even when the block source itself did not change.
    eq(other) {
      return other.type === this.type && other.source === this.source && other.dirKey === this.dirKey;
    }
    toDOM() {
      const wrap = document.createElement('div');
      wrap.className = `cm-lp-block cm-lp-${this.type}`;
      wrap.setAttribute('contenteditable', 'false');
      try {
        const el = renderBlock(this.type, this.source);
        if (el) wrap.appendChild(el);
        else wrap.textContent = this.source; // unknown/failed → show raw
      } catch (_) { wrap.textContent = this.source; }
      return wrap;
    }
    // Let clicks through so the editor can place the cursor into the block (reveals raw).
    ignoreEvent() { return false; }
  };
}

/** Pure: the block-widget DecorationSet for a given editor state. Exported for unit tests. */
export function buildBlockDecorations(CM6, renderBlock, state, dirKey = '') {
  const { Decoration, syntaxTree } = CM6;
  const BlockWidget = makeWidgetClass(CM6, renderBlock);
  const { doc } = state;
  const sel = state.selection.main;
  const activeFrom = doc.lineAt(sel.from).number;
  const activeTo = doc.lineAt(sel.to).number;
  const ranges = [];
  // Whole-doc iteration (not viewport-bounded): block widgets must be known before layout,
  // so we walk the full (lazy/incremental) syntax tree from 0..docLength.
  syntaxTree(state).iterate({
    from: 0,
    to: doc.length,
    enter: (node) => {
      const type = classifyBlock(node, doc);
      if (!type) return undefined;
      const startLine = doc.lineAt(node.from);
      const endLine = doc.lineAt(node.to);
      // The selection touches the block → leave it raw so it stays editable.
      if (endLine.number >= activeFrom && startLine.number <= activeTo) return false;
      const source = doc.sliceString(startLine.from, endLine.to);
      ranges.push(
        Decoration.replace({ widget: new BlockWidget(type, source, dirKey), block: true })
          .range(startLine.from, endLine.to),
      );
      return false; // don't descend into the block's children
    },
  });
  return Decoration.set(ranges, true);
}

export function createBlockPreview(CM6, renderBlock, getDirKey = null) {
  const { EditorView, Decoration } = CM6;
  // The direction key is read at compute time, so a recompute after a direction flip
  // (setDirection dispatches an explicit selection for exactly this) rebuilds widgets
  // with the new identity instead of reusing DOM rendered under the old direction.
  const dirKeyOf = () => (typeof getDirKey === 'function' ? String(getDirKey() || '') : '');
  // The full-document syntax-tree walk is the expensive part and BOTH facets below ask
  // for the SAME (state, dirKey) on every update — the decorations facet during the
  // update, atomicRanges again at measure time. Memoize per EditorState (identity key:
  // any doc/selection change produces a new state, so entries never go stale; the
  // dirKey participates so a flip still rebuilds). DecorationSets are immutable, so
  // sharing one instance between the facets is exactly what CM6 expects.
  const cache = new WeakMap();
  const compute = (state) => {
    const dirKey = dirKeyOf();
    const hit = cache.get(state);
    if (hit && hit.dirKey === dirKey) return hit.deco;
    const deco = buildBlockDecorations(CM6, renderBlock, state, dirKey);
    cache.set(state, { dirKey, deco });
    return deco;
  };
  return [
    // State-derived (recomputed on doc/selection change) so block widgets are known before layout.
    EditorView.decorations.compute(['doc', 'selection'], compute),
    // Atomic so the caret steps over a rendered block instead of into the hidden source.
    EditorView.atomicRanges.of((view) => compute(view.state) || Decoration.set([])),
  ];
}
