// @vitest-environment jsdom
/**
 * live-preview.test.js — T-F13: the CM6 live-preview decoration logic.
 *
 * createLivePreview(CM6) takes an INJECTED CodeMirror namespace, so we exercise its core
 * buildDecorations behaviour with a minimal fake CM6 + fake view — no heavy engine.
 * It hides prose markers (#, *, `) on inactive lines and replaces list/quote markers with
 * a structural WIDGET glyph (a real DOM node — hence the jsdom env), while the active
 * line's markers stay raw (so the markdown stays editable under the cursor).
 */
import { describe, test, expect } from 'vitest';
import { createLivePreview, livePreviewTheme } from '../../src/renderer/editor/live-preview.js';

// A fake CM6 just rich enough for buildDecorations: ViewPlugin.fromClass captures the class
// (and its provide/decorations spec) so we can instantiate it; Decoration records the ranges
// (and their replace spec, incl. any widget) it is asked to build; EditorView.atomicRanges
// captures the facet provider; WidgetType is the base class the marker widget extends.
function fakeCM6() {
  const Decoration = {
    replace: (spec) => ({ range: (from, to) => ({ from, to, spec, kind: 'replace' }) }),
    set: (ranges) => ({ ranges }),
  };
  const EditorView = {
    atomicRanges: { of: (fn) => ({ facet: 'atomicRanges', fn }) },
    theme: (spec) => ({ theme: spec }),
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
  class WidgetType {}
  return { ViewPlugin, Decoration, syntaxTree, EditorView, WidgetType };
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
      doc: { length: docText.length, lineAt, sliceString: (from, to) => docText.slice(from, to) },
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

  test('hides StrikethroughMark on inactive lines (GFM parity)', () => {
    const CM6 = fakeCM6();
    // 'inactive\n~~gone~~' — the two ~~ marks live on line 2 at [9,11] and [15,17].
    const doc = 'inactive\n~~gone~~';
    const nodes = [
      { name: 'StrikethroughMark', from: 9, to: 11 },
      { name: 'StrikethroughMark', from: 15, to: 17 },
    ];
    const inst = instantiate(CM6, fakeView(doc, nodes, 0)); // cursor on line 1 → line 2 inactive
    expect(inst.decorations.ranges.map((r) => [r.from, r.to])).toEqual([[9, 11], [15, 17]]);
  });

  test('keeps StrikethroughMark raw on the active line', () => {
    const CM6 = fakeCM6();
    const doc = 'inactive\n~~gone~~';
    const nodes = [
      { name: 'StrikethroughMark', from: 9, to: 11 },
      { name: 'StrikethroughMark', from: 15, to: 17 },
    ];
    const inst = instantiate(CM6, fakeView(doc, nodes, 12)); // cursor inside line 2
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

  test('replaces an unordered ListMark with a bullet WIDGET on inactive lines (keeps the affordance)', () => {
    const CM6 = fakeCM6();
    const doc = 'inactive\n- item';
    const l2 = 'inactive\n'.length;
    const nodes = [{ name: 'ListMark', from: l2, to: l2 + 1 }]; // '-'
    const inst = instantiate(CM6, fakeView(doc, nodes, 0));
    expect(inst.decorations.ranges.length).toBe(1);
    const deco = inst.decorations.ranges[0];
    expect([deco.from, deco.to]).toEqual([l2, l2 + 1]);
    const widget = deco.spec.widget;            // a replace WITH a widget, not an empty replace
    expect(widget.toDOM().textContent).toBe('•');
  });

  test('leaves an ORDERED ListMark (1.) visible — the number is the content', () => {
    const CM6 = fakeCM6();
    const doc = 'inactive\n1. item';
    const l2 = 'inactive\n'.length;
    const nodes = [{ name: 'ListMark', from: l2, to: l2 + 2 }]; // '1.'
    const inst = instantiate(CM6, fakeView(doc, nodes, 0));
    expect(inst.decorations.ranges).toEqual([]); // ordered markers are not replaced
  });

  test('replaces a QuoteMark with a bar WIDGET on inactive lines', () => {
    const CM6 = fakeCM6();
    const doc = 'inactive\n> quote';
    const l2 = 'inactive\n'.length;
    const nodes = [{ name: 'QuoteMark', from: l2, to: l2 + 1 }]; // '>'
    const inst = instantiate(CM6, fakeView(doc, nodes, 0));
    expect(inst.decorations.ranges.length).toBe(1);
    expect(inst.decorations.ranges[0].spec.widget.toDOM().textContent).toBe('▌');
  });

  test('list/quote markers stay RAW on the active line (no widget)', () => {
    const CM6 = fakeCM6();
    const doc = '- item\n> quote';
    const q = '- item\n'.length; // 7 — start of line 2 ('>')
    const nodes = [
      { name: 'ListMark', from: 0, to: 1 },        // line 1 (active)
      { name: 'QuoteMark', from: q, to: q + 1 },   // line 2 (inactive)
    ];
    const inst = instantiate(CM6, fakeView(doc, nodes, 0)); // cursor on line 1 (the list)
    // only the inactive line-2 quote is replaced; the active line-1 bullet stays raw
    expect(inst.decorations.ranges.length).toBe(1);
    expect(inst.decorations.ranges[0].spec.widget.toDOM().textContent).toBe('▌');
  });

  test('hides LinkMark + URL on inactive lines so [t](u) renders as just the link text', () => {
    const CM6 = fakeCM6();
    const doc = 'inactive\n[t](u)';
    const l2 = 'inactive\n'.length; // 9
    // document order: Link parent (ignored), then the marker/url children.
    const nodes = [
      { name: 'Link', from: l2, to: l2 + 6 },          // parent — must NOT be hidden
      { name: 'LinkMark', from: l2, to: l2 + 1 },       // '['
      { name: 'LinkMark', from: l2 + 2, to: l2 + 3 },   // ']'
      { name: 'LinkMark', from: l2 + 3, to: l2 + 4 },   // '('
      { name: 'URL', from: l2 + 4, to: l2 + 5 },        // 'u'
      { name: 'LinkMark', from: l2 + 5, to: l2 + 6 },   // ')'
    ];
    const inst = instantiate(CM6, fakeView(doc, nodes, 0)); // cursor line 1 → link inactive
    expect(inst.decorations.ranges.map((r) => [r.from, r.to])).toEqual([
      [l2, l2 + 1], [l2 + 2, l2 + 3], [l2 + 3, l2 + 4], [l2 + 4, l2 + 5], [l2 + 5, l2 + 6],
    ]);
    // the Link PARENT span is never hidden (that would erase the visible link text)
    expect(inst.decorations.ranges.some((r) => r.from === l2 && r.to === l2 + 6)).toBe(false);
  });

  test('keeps the whole link raw on the active line', () => {
    const CM6 = fakeCM6();
    const doc = '[t](u)\nother';
    const nodes = [
      { name: 'LinkMark', from: 0, to: 1 }, { name: 'LinkMark', from: 2, to: 3 },
      { name: 'LinkMark', from: 3, to: 4 }, { name: 'URL', from: 4, to: 5 },
      { name: 'LinkMark', from: 5, to: 6 },
    ];
    const inst = instantiate(CM6, fakeView(doc, nodes, 1)); // cursor inside the link line
    expect(inst.decorations.ranges).toEqual([]);
  });

  test('hides a LinkTitle alongside the url', () => {
    const CM6 = fakeCM6();
    const doc = 'inactive\n[t](u "x")';
    const nodes = [{ name: 'LinkTitle', from: 14, to: 17 }]; // the "x" title
    const inst = instantiate(CM6, fakeView(doc, nodes, 0));
    expect(inst.decorations.ranges.map((r) => [r.from, r.to])).toEqual([[14, 17]]);
  });

  test('the marker widget is decorative (aria-hidden) and compares by glyph (eq)', () => {
    const CM6 = fakeCM6();
    const doc = 'inactive\n- item';
    const l2 = 'inactive\n'.length;
    const inst = instantiate(CM6, fakeView(doc, [{ name: 'ListMark', from: l2, to: l2 + 1 }], 0));
    const widget = inst.decorations.ranges[0].spec.widget;
    expect(widget.toDOM().getAttribute('aria-hidden')).toBe('true');
    expect(widget.eq(widget)).toBe(true);
    expect(widget.eq({ glyph: 'x', cls: 'y' })).toBe(false);
  });

  test('exposes the decorations via the plugin spec accessor', () => {
    const CM6 = fakeCM6();
    const plugin = createLivePreview(CM6);
    const inst = new plugin.cls(fakeView(DOC, MARKS, 0));
    expect(plugin.opts.decorations(inst)).toBe(inst.decorations); // the ViewPlugin decorations getter
  });

  test('livePreviewTheme returns a theme styling the bullet + quote widgets', () => {
    const theme = livePreviewTheme(fakeCM6());
    expect(theme.theme['.cm-lp-bullet']).toBeTruthy();
    expect(theme.theme['.cm-lp-quote']).toBeTruthy();
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
