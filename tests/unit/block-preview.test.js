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
