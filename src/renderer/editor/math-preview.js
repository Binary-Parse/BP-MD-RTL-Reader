/**
 * math-preview.js — CodeMirror 6 live-preview KaTeX MATH widgets (T-F13 × F9 parity).
 *
 * KaTeX math ($…$ / $$…$$) is NOT a markdown syntax-tree node, so (unlike block-preview)
 * this scans the visible LINE text with the same proven regexes the preview pipeline uses
 * (math.js) and replaces each math span with a rendered KaTeX widget — but only on lines the
 * selection doesn't touch, so the active line stays raw + editable. The currency guard
 * ((?=\S)…(?<=\S)) keeps "$5 and $10" from matching. Inline replace decorations (single line)
 * may come from a ViewPlugin; the actual TeX→DOM render is INJECTED (renderMath) + LTR-isolated.
 */

// Block $$…$$ (single line) first, then inline $…$ — both require non-space adjacency so prose
// dollar amounts aren't treated as math.
const MATH_RE = /\$\$(?=\S)([^\n]+?)(?<=\S)\$\$|\$(?!\$)(?=\S)([^$\n]+?)(?<=\S)\$/g;

/** Math spans in a single line of text: [{ start, end, tex, display }]. Exported for tests. */
export function findMath(text) {
  const out = [];
  MATH_RE.lastIndex = 0;
  let m;
  while ((m = MATH_RE.exec(text)) !== null) {
    if (m[1] != null) out.push({ start: m.index, end: m.index + m[0].length, tex: m[1], display: true });
    else out.push({ start: m.index, end: m.index + m[0].length, tex: m[2], display: false });
    if (m.index === MATH_RE.lastIndex) MATH_RE.lastIndex += 1;
  }
  return out;
}

function makeMathWidget(CM6, renderMath) {
  return class MathWidget extends CM6.WidgetType {
    constructor(tex, display) { super(); this.tex = tex; this.display = display; }
    eq(other) { return other.tex === this.tex && other.display === this.display; }
    toDOM() {
      try { const el = renderMath(this.tex, this.display); if (el) return el; } catch (_) { /* fall through */ }
      const span = document.createElement('span'); // render failed → show raw delimiters
      const d = this.display ? '$$' : '$';
      span.textContent = d + this.tex + d;
      return span;
    }
    ignoreEvent() { return false; }
  };
}

/** Pure: the inline math DecorationSet for a view. Exported for unit tests. */
export function buildMathDecorations(CM6, renderMath, view) {
  const { Decoration } = CM6;
  if (!view.visibleRanges || view.visibleRanges.length === 0) return Decoration.set([], true);
  const MathWidget = makeMathWidget(CM6, renderMath);
  const { doc } = view.state;
  const sel = view.state.selection.main;
  const activeFrom = doc.lineAt(sel.from).number;
  const activeTo = doc.lineAt(sel.to).number;
  const ranges = [];
  const seen = new Set();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      // A line the selection touches stays raw; decorate each line once.
      if (!seen.has(line.number) && !(line.number >= activeFrom && line.number <= activeTo)) {
        seen.add(line.number);
        for (const mm of findMath(line.text)) {
          ranges.push(
            Decoration.replace({ widget: new MathWidget(mm.tex, mm.display) })
              .range(line.from + mm.start, line.from + mm.end),
          );
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

export function createMathPreview(CM6, renderMath) {
  const { ViewPlugin, Decoration, EditorView } = CM6;
  return ViewPlugin.fromClass(
    class {
      constructor(view) { this.decorations = buildMathDecorations(CM6, renderMath, view); }
      update(u) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = buildMathDecorations(CM6, renderMath, u.view);
      }
    },
    {
      decorations: (v) => v.decorations,
      // Atomic so the caret steps over a rendered formula instead of into the hidden TeX.
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations || Decoration.set([])),
    },
  );
}
