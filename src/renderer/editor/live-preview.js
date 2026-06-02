/**
 * live-preview.js — CodeMirror 6 live-preview decorations (T-F13).
 *
 * Hides the markdown SYNTAX MARKERS (the `#` of headings, the `*`/`**`/`~~`/`` ` `` of
 * inline emphasis/code) on every line EXCEPT the one(s) the cursor/selection touches —
 * so inactive lines read as formatted prose (the content is already styled by the
 * syntax-highlight extension) while the active line shows raw, editable tokens.
 *
 * CM6 is injected so this stays decoupled from the heavy vendored engine and testable.
 */

// Lezer (lang-markdown) node names for the marker tokens we hide on inactive lines.
// We ONLY hide markers whose surrounding text the syntax-highlight extension still styles,
// so the line reads as formatted prose once the glyph is gone:
//   • HeaderMark  '#'  → heading text stays styled as a heading
//   • EmphasisMark '*'/'_'/'**'/'__' → bold/italic inner text stays styled (this single node
//     covers BOTH emphasis and strong; @lezer/markdown has no separate 'StrongEmphasisMark')
//   • CodeMark    '`'/'```' → code stays styled monospace
// Deliberately NOT hidden (an empty replace would DESTROY their affordance, not render prose):
//   • ListMark/QuoteMark — removing '- '/'> ' collapses the bullet + indent into flat text
//   • LinkMark — hiding the brackets leaves a bare "texturl" (the URL itself stays visible)
//   • Strikethrough — needs GFM (markdown() runs commonmark-only), so '~~' isn't even parsed
// Those are follow-ups requiring WidgetType replacements / GFM, not a plain replace.
const MARKER_NODES = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark']);

export function createLivePreview(CM6) {
  const { ViewPlugin, Decoration, syntaxTree, EditorView } = CM6;

  function buildDecorations(view) {
    const ranges = [];
    const sel = view.state.selection.main;
    // The active region = every line the selection spans (inclusive). Markers on these
    // lines stay visible so the user can edit the raw markdown.
    const activeFrom = view.state.doc.lineAt(sel.from).from;
    const activeTo = view.state.doc.lineAt(sel.to).to;
    const onActiveLine = (from, to) => to >= activeFrom && from <= activeTo;

    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from, to,
        enter: (node) => {
          if (node.from === node.to) return;
          if (MARKER_NODES.has(node.name) && !onActiveLine(node.from, node.to)) {
            ranges.push(Decoration.replace({}).range(node.from, node.to));
          }
        },
      });
    }
    ranges.sort((a, b) => a.from - b.from || a.to - b.to);
    return Decoration.set(ranges, true);
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) { this.decorations = buildDecorations(view); }
      update(u) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          this.decorations = buildDecorations(u.view);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      // Make the hidden markers atomic so the caret / shift-arrow selection step OVER a
      // collapsed glyph instead of landing inside it (the standard companion to a
      // replace-based live preview — keeps offset-based commands like wrapSelection sane).
      provide: (plugin) => EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations || Decoration.set([]),
      ),
    },
  );
}
