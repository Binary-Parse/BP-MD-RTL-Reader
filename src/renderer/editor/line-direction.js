/**
 * line-direction.js — per-line RTL/LTR in the CodeMirror 6 source editor (T-F13 × R1/R2).
 *
 * Brings the per-block direction model of the rendered preview (bidi.js / bidi-dom.js) into
 * the CM6 editor: each line gets a `dir` from its DOMINANT strong-script (resolveBlockDirection,
 * so an Arabic line that opens with an English word/number stays RTL; neutral-only lines
 * inherit the editor's base dir, EC-C1), emitted
 * as a zero-width Decoration.line({attributes:{dir}}). Paired with CM6's perLineTextDirection
 * facet so the engine reads each line's direction — which makes the already-bound
 * direction-aware defaultKeymap (cursorCharLeft/Right) give LOGICAL caret motion for free.
 *
 * CM6 is injected (vendored window.CM6); decoration work is bounded to the visible ranges.
 */

import { resolveBlockDirection } from '../bidi.js';

// RTL-M6: inline code spans are stripped before the dominant-script count, mirroring
// the rendered preview's blockText() — `` استخدم `Array.prototype.flatMap` هنا `` must
// resolve RTL in the editor exactly as it does in reading view, or the line's caret
// motion and alignment contradict the preview of the same text. Fence markers are
// stripped too; the lines of a code block are handled by codeRanges() below.
const CODE_SPANS = /(```[^`]*```|`[^`]*`)/g;

function stripCodeSpans(text) {
  return text.replace(CODE_SPANS, ' ');
}

// audit M18: the lines of a fenced or indented code block are code, and code is written
// left-to-right. Without this an Arabic comment inside a fence turned its own line
// right-to-left while the code around it stayed left-to-right, and a forced RTL note
// mirrored the whole block. The reading pane already keeps `pre` left-to-right.
const CODE_BLOCKS = new Set(['FencedCode', 'CodeBlock']);

function codeRanges(CM6, view) {
  const ranges = [];
  if (typeof CM6.syntaxTree !== 'function') return ranges;
  const tree = CM6.syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (!CODE_BLOCKS.has(node.name)) return undefined;
        ranges.push({ from: node.from, to: node.to });
        return false;
      },
    });
  }
  return ranges;
}

export function createLineDirection(CM6, getBaseDir = () => 'ltr', getForceDir = () => null) {
  const { ViewPlugin, Decoration, EditorView } = CM6;
  const baseDir = () => (typeof getBaseDir === 'function' ? getBaseDir() : getBaseDir) || 'ltr';
  // Forced direction (toggle / front-matter): when set, every line takes it verbatim instead
  // of resolving its own dominant script — the user's explicit choice must win.
  const forceDir = () => (typeof getForceDir === 'function' ? getForceDir() : getForceDir) || null;

  const treeOf = (state) => (typeof CM6.syntaxTree === 'function' && state ? CM6.syntaxTree(state) : null);

  function buildDecorations(view) {
    const ranges = [];
    const { doc } = view.state;
    const seen = new Set(); // a line can span multiple visibleRanges — decorate it once
    const forced = forceDir();
    const code = codeRanges(CM6, view);
    const inCode = (line) => code.some((r) => line.from >= r.from && line.from <= r.to);
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = doc.lineAt(pos);
        if (!seen.has(line.from)) {
          seen.add(line.from);
          const dir = inCode(line) ? 'ltr'
            : forced || resolveBlockDirection(stripCodeSpans(line.text), baseDir());
          ranges.push(Decoration.line({ attributes: { dir } }).range(line.from));
        }
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges, true);
  }

  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.lastForce = forceDir();
        this.lastBase = baseDir();
        this.lastTree = treeOf(view.state);
        this.decorations = buildDecorations(view);
      }
      update(u) {
        // Rebuild on text/viewport change, OR when the chosen direction changed since the last
        // build. The toggle/front-matter mutate the getters and dispatch a benign transaction
        // (codemirror-adapter setDirection) so this update() runs and repaints per-line dir —
        // without a custom StateEffect (the vendored CM6 bundle doesn't export one).
        const f = forceDir();
        const b = baseDir();
        // The parser works in the background: a fence can become known after the text arrived.
        const tree = treeOf(u.state);
        if (u.docChanged || u.viewportChanged || f !== this.lastForce || b !== this.lastBase || tree !== this.lastTree) {
          this.lastForce = f;
          this.lastBase = b;
          this.lastTree = tree;
          this.decorations = buildDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );

  // The facet first so CM6 reads per-line dir; the plugin supplies the per-line attributes.
  return [EditorView.perLineTextDirection.of(true), plugin];
}
