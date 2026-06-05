/**
 * inline-marks-preview.js — CM6 live-preview for the app's custom inline marks that
 * @lezer/markdown doesn't know: ==highlight==, <u>underline</u>, ~sub~, ^sup^.
 *
 * Like live-preview.js for built-in markers, but regex-driven (these aren't in the syntax
 * tree). Off the active line it HIDES the delimiters and styles the inner text with a class so
 * the editor shows the formatted result; on the active line the raw markdown stays editable.
 * Same rendering as the preview pane (markdown.js extensions → <mark>/<sub>/<sup>, <u> raw HTML).
 */

const MARKS = [
  { re: /==(?=\S)([\s\S]*?\S)==/g, open: '==', close: '==', cls: 'cm-hl' },
  { re: /<u>([\s\S]*?)<\/u>/gi, open: '<u>', close: '</u>', cls: 'cm-u' },
  // single-tilde subscript, NOT ~~strikethrough~~ (negative lookarounds)
  { re: /(?<!~)~(?!~)([^~\s][^~\n]*?)~(?!~)/g, open: '~', close: '~', cls: 'cm-sub' },
  { re: /\^([^\^\s]+?)\^/g, open: '^', close: '^', cls: 'cm-sup' },
];

export function createInlineMarksPreview(CM6) {
  const { ViewPlugin, Decoration, EditorView } = CM6;
  const HIDE = Decoration.replace({});

  function build(view) {
    if (view.visibleRanges.length === 0) return Decoration.set([], true);
    const sel = view.state.selection.main;
    const activeFrom = view.state.doc.lineAt(sel.from).from;
    const activeTo = view.state.doc.lineAt(sel.to).to;
    const ranges = [];
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      for (const { re, open, close, cls } of MARKS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          const s = from + m.index, e = s + m[0].length;
          if (e >= activeFrom && s <= activeTo) continue; // active line → leave raw
          const innerS = s + open.length, innerE = e - close.length;
          if (innerE <= innerS) continue;
          ranges.push(HIDE.range(s, innerS));
          ranges.push(Decoration.mark({ class: cls }).range(innerS, innerE));
          ranges.push(HIDE.range(innerE, e));
        }
      }
    }
    return Decoration.set(ranges, true); // true → CM6 sorts the mixed mark/replace ranges
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) { this.decorations = build(view); }
      update(u) { if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view); }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) => EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.decorations || Decoration.set([]),
      ),
    },
  );
}
