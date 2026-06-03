/**
 * live-preview.js — CodeMirror 6 live-preview decorations (T-F13).
 *
 * On every line EXCEPT the one(s) the cursor/selection touches, rewrite the markdown
 * SYNTAX MARKERS so inactive lines read as formatted prose while the active line shows
 * raw, editable tokens. Two strategies, by marker:
 *   • PROSE markers (#, *, **, `) → an empty replace HIDES them; the syntax-highlight
 *     extension still styles the surviving text (heading / bold-italic / monospace).
 *   • STRUCTURAL markers (list bullets, blockquote '>') → a WIDGET replace swaps the raw
 *     glyph for a decorative one (• / ▌), preserving the bullet/quote AFFORDANCE and the
 *     leading indent (an empty replace here would collapse the line to flat text).
 *
 * CM6 is injected so this stays decoupled from the heavy vendored engine and testable.
 */

// Prose markers hidden by an empty replace. EmphasisMark covers BOTH emphasis and strong
// (@lezer/markdown has no separate 'StrongEmphasisMark'); CodeMark covers inline + fences;
// StrikethroughMark is the GFM '~~' marker (the editor parses GFM via base: markdownLanguage).
const HIDE_NODES = new Set(['HeaderMark', 'EmphasisMark', 'CodeMark', 'StrikethroughMark']);
// Link parts ([ ] ( ), the url, the "title"). These collapse an inline [text](url "title")
// down to its styled label ONLY when the parent is a real Link (decorationFor checks parentName):
// an angle-bracket autolink <url> (parent Autolink) has no separate label and would vanish, and
// an image ![alt](url) (parent Image) would collapse to bare alt — both stay raw instead.
// Reference links [text][ref] use LinkLabel (not in this set) so the label stays readable.
const LINK_PARTS = new Set(['LinkMark', 'URL', 'LinkTitle']);
// Unordered list bullets we swap for a single bullet glyph. Ordered markers ('1.', '2)')
// are left raw — the number IS content.
const BULLET_MARKERS = new Set(['-', '*', '+']);

// The enclosing node's name. Real engine: node.node.parent.name; the flat unit-test harness
// supplies node.parent.name directly. Undefined when there is no parent (a top-level node).
function parentName(node) {
  return node.node?.parent?.name ?? node.parent?.name;
}

export function createLivePreview(CM6) {
  const { ViewPlugin, Decoration, syntaxTree, EditorView, WidgetType } = CM6;

  // A decorative inline glyph that stands in for a structural marker. aria-hidden because
  // it is purely visual — the real marker text is untouched in the document.
  class MarkerWidget extends WidgetType {
    constructor(glyph, cls) { super(); this.glyph = glyph; this.cls = cls; }
    eq(other) { return other.glyph === this.glyph && other.cls === this.cls; }
    toDOM() {
      const span = document.createElement('span');
      span.className = this.cls;
      span.textContent = this.glyph;
      span.setAttribute('aria-hidden', 'true');
      return span;
    }
  }

  // Reusable decoration values (a single RangeValue can back many ranges).
  const HIDE = Decoration.replace({});
  const BULLET = Decoration.replace({ widget: new MarkerWidget('•', 'cm-lp-bullet') });
  const QUOTE = Decoration.replace({ widget: new MarkerWidget('▌', 'cm-lp-quote') });

  // Which decoration (if any) applies to a marker node off the active line.
  function decorationFor(view, node) {
    const { name } = node;
    // Collapse the [ ] ( ) / url / "title" to the styled label ONLY inside a real inline Link.
    // An Image (![alt](url)) or angle-bracket Autolink (<url>) parent has no separate visible
    // label to fall back to, so leave those raw rather than collapse them to nothing/bare alt.
    if (LINK_PARTS.has(name)) return parentName(node) === 'Link' ? HIDE : null;
    if (HIDE_NODES.has(name)) return HIDE;
    if (name === 'ListMark') {
      const text = view.state.doc.sliceString(node.from, node.to).trim();
      return BULLET_MARKERS.has(text) ? BULLET : null; // ordered ('1.') stays raw
    }
    if (name === 'QuoteMark') return QUOTE;
    return null;
  }

  function buildDecorations(view) {
    // Nothing on screen (collapsed/unfocused editor) → skip even the two doc.lineAt calls below.
    if (view.visibleRanges.length === 0) return Decoration.set([], true);
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
          if (onActiveLine(node.from, node.to)) return;
          const deco = decorationFor(view, node);
          if (deco) ranges.push(deco.range(node.from, node.to));
        },
      });
    }
    // Decoration.set(ranges, /* sort */ true) sorts internally (by from, then startSide),
    // so we don't hand-sort — iterate() already yields nodes in document order anyway.
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

// Muted styling for the structural marker widgets. Returned separately so the adapter can
// add it alongside the plugin; kept optional/cosmetic (the glyphs render without it).
export function livePreviewTheme(CM6) {
  return CM6.EditorView.theme({
    '.cm-lp-bullet': { color: 'var(--muted-fg, #8a8a8a)' },
    '.cm-lp-quote': { color: 'var(--muted-fg, #8a8a8a)', marginInlineEnd: '0.35em' },
  });
}
