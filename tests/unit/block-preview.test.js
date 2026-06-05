// @vitest-environment jsdom
/**
 * block-preview.test.js — T-F13 CM6 live-preview BLOCK widgets. Exercises the decoration
 * logic with a fake CM6 + fake view: a Table renders as a block widget on lines the selection
 * doesn't touch, stays raw when the cursor is inside it, and the widget DOM comes from the
 * injected renderBlock (falling back to raw text when it returns null).
 */
import { describe, test, expect } from 'vitest';
import { buildBlockDecorations } from '../../src/renderer/editor/block-preview.js';

function fakeCM6() {
  const Decoration = {
    replace: (spec) => ({ range: (from, to) => ({ from, to, spec, kind: 'replace' }) }),
    set: (ranges) => ({ ranges }),
  };
  const EditorView = { atomicRanges: { of: (fn) => ({ facet: 'atomicRanges', fn }) } };
  const ViewPlugin = { fromClass: (cls, opts) => ({ cls, opts }) };
  const syntaxTree = (state) => ({
    iterate: ({ from, to, enter }) => { for (const n of state._nodes) { if (n.from >= from && n.to <= to) enter(n); } },
  });
  class WidgetType {}
  return { ViewPlugin, Decoration, syntaxTree, EditorView, WidgetType };
}

function fakeView(docText, nodes, selFrom, selTo = selFrom) {
  const lines = [];
  let off = 0;
  docText.split('\n').forEach((part, i) => { lines.push({ number: i + 1, from: off, to: off + part.length }); off += part.length + 1; });
  const lineAt = (pos) => lines.find((l) => pos >= l.from && pos <= l.to) || lines[lines.length - 1];
  return {
    visibleRanges: [{ from: 0, to: docText.length }],
    state: {
      selection: { main: { from: selFrom, to: selTo } },
      doc: { length: docText.length, lineAt, sliceString: (a, b) => docText.slice(a, b) },
      _nodes: nodes,
    },
  };
}

function build(CM6, view, renderBlock = () => null) {
  return { decorations: buildBlockDecorations(CM6, renderBlock, view.state) };
}

describe('createBlockPreview (T-F13 block widgets)', () => {
  const DOC = 'intro\n| A | B |\n| - | - |\n| 1 | 2 |\noutro';
  const tableFrom = DOC.indexOf('| A | B |');
  const tableTo = DOC.indexOf('\noutro');
  const NODES = [{ name: 'Table', from: tableFrom, to: tableTo }];

  test('renders a Table as a block widget when the selection is OFF the table', () => {
    const inst = build(fakeCM6(), fakeView(DOC, NODES, 0)); // cursor on line 1 (intro)
    expect(inst.decorations.ranges.length).toBe(1);
    const r = inst.decorations.ranges[0];
    expect(r.spec.block).toBe(true);            // block-level replacement (spans whole lines)
    expect(r.spec.widget.type).toBe('table');
    expect([r.from, r.to]).toEqual([tableFrom, tableTo]); // covers exactly the table's lines
  });

  test('leaves the table RAW when the selection is inside it (editable)', () => {
    const inst = build(fakeCM6(), fakeView(DOC, NODES, tableFrom + 2));
    expect(inst.decorations.ranges).toEqual([]);
  });

  test('the widget DOM comes from the injected renderBlock (type + source passed through)', () => {
    const calls = [];
    const renderBlock = (type, source) => { calls.push({ type, source }); return document.createElement('table'); };
    const inst = build(fakeCM6(), fakeView(DOC, NODES, 0), renderBlock);
    const dom = inst.decorations.ranges[0].spec.widget.toDOM();
    expect(dom.querySelector('table')).toBeTruthy();
    expect(dom.getAttribute('contenteditable')).toBe('false');
    expect(calls[0].type).toBe('table');
    expect(calls[0].source).toContain('| A | B |');
  });

  test('falls back to raw text when renderBlock returns null or throws', () => {
    expect(build(fakeCM6(), fakeView(DOC, NODES, 0), () => null)
      .decorations.ranges[0].spec.widget.toDOM().textContent).toContain('| A | B |');
    expect(build(fakeCM6(), fakeView(DOC, NODES, 0), () => { throw new Error('x'); })
      .decorations.ranges[0].spec.widget.toDOM().textContent).toContain('| 1 | 2 |');
  });

  test('block vs raw is selection-dependent (recomputed per state)', () => {
    const CM6 = fakeCM6();
    expect(build(CM6, fakeView(DOC, NODES, 0)).decorations.ranges.length).toBe(1);       // cursor off → rendered
    expect(build(CM6, fakeView(DOC, NODES, tableFrom + 2)).decorations.ranges).toEqual([]); // cursor in → raw
  });
});

describe('createBlockPreview — mermaid fenced blocks', () => {
  test('a ```mermaid fenced block becomes a mermaid block widget (off the active line)', () => {
    const DOC = 'intro\n```mermaid\ngraph TD; A-->B;\n```\ntail';
    const nodes = [{ name: 'FencedCode', from: DOC.indexOf('```mermaid'), to: DOC.indexOf('\ntail') }];
    const r = build(fakeCM6(), fakeView(DOC, nodes, 0)).decorations.ranges;
    expect(r.length).toBe(1);
    expect(r[0].spec.widget.type).toBe('mermaid');
  });

  test('an ordinary ```js fenced block is left as editable source (not a widget)', () => {
    const DOC = 'intro\n```js\nconst x = 1;\n```\ntail';
    const nodes = [{ name: 'FencedCode', from: DOC.indexOf('```js'), to: DOC.indexOf('\ntail') }];
    expect(build(fakeCM6(), fakeView(DOC, nodes, 0)).decorations.ranges).toEqual([]);
  });
});

describe('createBlockPreview — callouts', () => {
  test('a > [!NOTE] blockquote becomes a callout block widget', () => {
    const DOC = 'intro\n> [!NOTE] Heads up\n> body line\ntail';
    const nodes = [{ name: 'Blockquote', from: DOC.indexOf('> [!NOTE]'), to: DOC.indexOf('\ntail') }];
    const r = build(fakeCM6(), fakeView(DOC, nodes, 0)).decorations.ranges;
    expect(r.length).toBe(1);
    expect(r[0].spec.widget.type).toBe('callout');
  });

  test('a PLAIN blockquote is left as editable source (not a widget)', () => {
    const DOC = 'intro\n> just a quote\n> more\ntail';
    const nodes = [{ name: 'Blockquote', from: DOC.indexOf('> just'), to: DOC.indexOf('\ntail') }];
    expect(build(fakeCM6(), fakeView(DOC, nodes, 0)).decorations.ranges).toEqual([]);
  });
});

describe('createBlockPreview — standalone images', () => {
  test('a line that is JUST an image becomes an image block widget', () => {
    const DOC = 'intro\n![pic](p.png)\ntail';
    const from = DOC.indexOf('![pic]');
    const nodes = [{ name: 'Image', from, to: from + '![pic](p.png)'.length }];
    const r = build(fakeCM6(), fakeView(DOC, nodes, 0)).decorations.ranges;
    expect(r.length).toBe(1);
    expect(r[0].spec.widget.type).toBe('image');
  });

  test('an INLINE image within prose is left as editable source', () => {
    const DOC = 'intro\nsee ![x](u.png) here\ntail';
    const from = DOC.indexOf('![x]');
    const nodes = [{ name: 'Image', from, to: from + '![x](u.png)'.length }];
    expect(build(fakeCM6(), fakeView(DOC, nodes, 0)).decorations.ranges).toEqual([]);
  });
});

import { createBlockPreview } from '../../src/renderer/editor/block-preview.js';

describe('createBlockPreview (state-derived facet) + widget identity', () => {
  // Fake CM6 extended with EditorView.decorations.compute (the facet block widgets use).
  function fakeCM6Facet() {
    const base = fakeCM6();
    base.EditorView.decorations = { compute: (deps, fn) => ({ facet: 'decorations', deps, fn }) };
    return base;
  }
  const DOC = 'intro\n| A | B |\n| - | - |\n| 1 | 2 |\noutro';
  const NODES = [{ name: 'Table', from: DOC.indexOf('| A | B |'), to: DOC.indexOf('\noutro') }];

  test('returns the decorations.compute facet + an atomicRanges facet', () => {
    const CM6 = fakeCM6Facet();
    const ext = createBlockPreview(CM6, () => null);
    expect(Array.isArray(ext)).toBe(true);
    expect(ext[0].facet).toBe('decorations');
    expect(ext[0].deps).toEqual(['doc', 'selection']);
    expect(ext[1].facet).toBe('atomicRanges');
  });

  test('the compute callback builds block decorations from state', () => {
    const CM6 = fakeCM6Facet();
    const ext = createBlockPreview(CM6, () => null);
    const view = fakeView(DOC, NODES, 0);
    const decoSet = ext[0].fn(view.state);   // decorations.compute callback
    expect(decoSet.ranges.length).toBe(1);
    expect(decoSet.ranges[0].spec.widget.type).toBe('table');
  });

  test('the atomicRanges callback reads view.state (and tolerates empty)', () => {
    const CM6 = fakeCM6Facet();
    const ext = createBlockPreview(CM6, () => null);
    expect(ext[1].fn(fakeView(DOC, NODES, 0)).ranges.length).toBe(1);
    expect(ext[1].fn(fakeView(DOC, [], 0)).ranges).toEqual([]); // no nodes → empty
  });

  test('widget eq() compares type+source; ignoreEvent() is false', () => {
    const r = build(fakeCM6(), fakeView(DOC, NODES, 0)).decorations.ranges[0];
    const w = r.spec.widget;
    expect(w.ignoreEvent()).toBe(false);
    expect(w.eq({ type: w.type, source: w.source })).toBe(true);
    expect(w.eq({ type: 'mermaid', source: w.source })).toBe(false);
    expect(w.eq({ type: w.type, source: 'different' })).toBe(false);
  });
});
