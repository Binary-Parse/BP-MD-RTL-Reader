/**
 * live-preview.test.js — T-F13: the CM6 live-preview decoration logic.
 *
 * createLivePreview(CM6) takes an INJECTED CodeMirror namespace, so we exercise its core
 * buildDecorations behaviour with a minimal fake CM6 + fake view — no heavy engine, no DOM.
 * It must hide markdown MARKER nodes on inactive lines while leaving the active line's
 * markers visible (so the raw markdown stays editable under the cursor).
 */
import { describe, test, expect } from 'vitest';
import { createLivePreview } from '../../src/renderer/editor/live-preview.js';

// A fake CM6 just rich enough for buildDecorations: ViewPlugin.fromClass captures the class
// (and its provide/decorations spec) so we can instantiate it; Decoration records the ranges
// it is asked to replace; EditorView.atomicRanges captures the facet provider.
function fakeCM6() {
  const Decoration = {
    replace: (spec) => ({ range: (from, to) => ({ from, to, spec, kind: 'replace' }) }),
    set: (ranges) => ({ ranges }),
  };
  const EditorView = {
    atomicRanges: { of: (fn) => ({ facet: 'atomicRanges', fn }) },
  };
  const ViewPlugin = {
    fromClass: (cls, opts) => ({ cls, opts }),
  };
  const syntaxTree = (state) => ({
    iterate: ({ from, to, enter }) => {
      for (const n of state._nodes) {
        if (n.from >= from && n.to <= to) enter(n);
      }
    },
  });
  return { ViewPlugin, Decoration, syntaxTree, EditorView };
}

// Build a fake view over `docText` with the given Lezer-style `nodes` and a selection.
function fakeView(docText, nodes, selFrom, selTo = selFrom) {
  const lines = [];
  let off = 0;
  for (const part of docText.split('\n')) {
    lines.push({ from: off, to: off + part.length });
    off += part.length + 1; // + the newline
  }
  const lineAt = (pos) => lines.find((l) => pos >= l.from && pos <= l.to) || lines[lines.length - 1];
  return {
    visibleRanges: [{ from: 0, to: docText.length }],
    state: {
      selection: { main: { from: selFrom, to: selTo } },
      doc: { length: docText.length, lineAt },
      _nodes: nodes,
    },
  };
}

// 'plain line one\n**bold**' — the two ** marks live on line 2 at [15,17] and [21,23].
// IMPORTANT: @lezer/markdown names BOTH emphasis and strong delimiters 'EmphasisMark' (there
// is NO 'StrongEmphasisMark' node) — these fixtures use the names the REAL engine emits, so
// the unit logic is exercised against node names that can actually occur in production.
const DOC = 'plain line one\n**bold**';
const MARKS = [
  { name: 'EmphasisMark', from: 15, to: 17 },
  { name: 'EmphasisMark', from: 21, to: 23 },
];

function instantiate(CM6, view) {
  const plugin = createLivePreview(CM6);
  return new plugin.cls(view);
}

describe('createLivePreview', () => {
  test('hides marker nodes that are NOT on the active line', () => {
    const CM6 = fakeCM6();
    const inst = instantiate(CM6, fakeView(DOC, MARKS, 0)); // cursor on line 1
    expect(inst.decorations.ranges.map((r) => [r.from, r.to])).toEqual([[15, 17], [21, 23]]);
  });

  test('keeps markers visible on the active (cursor) line', () => {
    const CM6 = fakeCM6();
    const inst = instantiate(CM6, fakeView(DOC, MARKS, 16)); // cursor inside the bold on line 2
    expect(inst.decorations.ranges).toEqual([]);
  });

  test('a multi-line selection keeps markers on every spanned line', () => {
    const CM6 = fakeCM6();
    const inst = instantiate(CM6, fakeView(DOC, MARKS, 0, 16)); // line 1 → line 2
    expect(inst.decorations.ranges).toEqual([]);
  });

  test('ignores zero-width nodes and non-marker nodes', () => {
    const CM6 = fakeCM6();
    const nodes = [
      { name: 'EmphasisMark', from: 15, to: 15 }, // zero-width → skipped
      { name: 'Paragraph', from: 15, to: 23 },    // not a marker → skipped
    ];
    const inst = instantiate(CM6, fakeView(DOC, nodes, 0));
    expect(inst.decorations.ranges).toEqual([]);
  });

  test('hides HeaderMark and CodeMark on inactive lines (the other prose-rendering markers)', () => {
    const CM6 = fakeCM6();
    // 'inactive\n# Heading\n`code`' — HeaderMark '# ' on line 2, CodeMark backticks on line 3.
    const doc = 'inactive\n# Heading\n`code`';
    const l2 = 'inactive\n'.length;           // 9 — start of '# Heading'
    const l3 = 'inactive\n# Heading\n'.length; // 19 — start of '`code`'
    const nodes = [
      { name: 'HeaderMark', from: l2, to: l2 + 1 },     // '#'
      { name: 'CodeMark', from: l3, to: l3 + 1 },       // opening '`'
      { name: 'CodeMark', from: l3 + 5, to: l3 + 6 },   // closing '`'
    ];
    const inst = instantiate(CM6, fakeView(doc, nodes, 0)); // cursor on line 1 → all inactive
    expect(inst.decorations.ranges.map((r) => [r.from, r.to])).toEqual([
      [l2, l2 + 1], [l3, l3 + 1], [l3 + 5, l3 + 6],
    ]);
  });

  test('does NOT hide list / quote / link markers (structure-destroying — left visible by design)', () => {
    const CM6 = fakeCM6();
    const doc = 'inactive\n- item';
    const l2 = 'inactive\n'.length;
    const nodes = [{ name: 'ListMark', from: l2, to: l2 + 1 }]; // '-'
    const inst = instantiate(CM6, fakeView(doc, nodes, 0));
    expect(inst.decorations.ranges).toEqual([]); // ListMark not in the hidden set
  });

  test('provides an atomicRanges facet so the caret steps over hidden markers', () => {
    const CM6 = fakeCM6();
    const plugin = createLivePreview(CM6);
    expect(typeof plugin.opts.provide).toBe('function');
    const inst = new plugin.cls(fakeView(DOC, MARKS, 0)); // line 1 active → both marks hidden
    const facet = plugin.opts.provide(plugin);
    expect(facet.facet).toBe('atomicRanges');
    const ranges = facet.fn({ plugin: () => inst });      // fake view.plugin(plugin) → the instance
    expect(ranges.ranges.map((r) => [r.from, r.to])).toEqual([[15, 17], [21, 23]]);
  });

  test('rebuilds decorations on doc/selection/viewport change, not otherwise', () => {
    const CM6 = fakeCM6();
    const view0 = fakeView(DOC, MARKS, 16); // active line 2 → no hidden marks
    const inst = instantiate(CM6, view0);
    expect(inst.decorations.ranges).toEqual([]);

    // selectionSet moves the cursor to line 1 → both marks now hidden.
    const view1 = fakeView(DOC, MARKS, 0);
    inst.update({ docChanged: false, selectionSet: true, viewportChanged: false, view: view1 });
    expect(inst.decorations.ranges.length).toBe(2);

    // a no-op update (nothing relevant changed) must NOT rebuild.
    const before = inst.decorations;
    inst.update({ docChanged: false, selectionSet: false, viewportChanged: false, view: view0 });
    expect(inst.decorations).toBe(before);
  });
});
