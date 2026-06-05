// @vitest-environment jsdom
/**
 * math-preview.test.js — T-F13 × F9 CM6 inline math widgets. Covers the line scanner
 * (findMath: inline / display / currency guard) and the decoration build (rendered off the
 * active line, raw on it; widget DOM from the injected renderMath).
 */
import { describe, test, expect } from 'vitest';
import { findMath, buildMathDecorations } from '../../src/renderer/editor/math-preview.js';

describe('findMath', () => {
  test('inline $x$ → one span, display:false', () => {
    expect(findMath('a $x+1$ b')).toEqual([{ start: 2, end: 7, tex: 'x+1', display: false }]);
  });
  test('display $$…$$ → display:true', () => {
    const r = findMath('$$E=mc^2$$');
    expect(r.length).toBe(1);
    expect(r[0].display).toBe(true);
    expect(r[0].tex).toBe('E=mc^2');
  });
  test('currency "$5 and $10" is NOT treated as math', () => {
    expect(findMath('$5 and $10 today')).toEqual([]);
  });
  test('two inline spans on a line', () => {
    expect(findMath('$a$ and $b$').length).toBe(2);
  });
});

function fakeCM6() {
  const Decoration = {
    replace: (spec) => ({ range: (from, to) => ({ from, to, spec, kind: 'replace' }) }),
    set: (ranges) => ({ ranges }),
  };
  const EditorView = { atomicRanges: { of: (fn) => ({ facet: 'atomicRanges', fn }) } };
  const ViewPlugin = { fromClass: (cls, opts) => ({ cls, opts }) };
  class WidgetType {}
  return { Decoration, EditorView, ViewPlugin, WidgetType };
}

function fakeView(docText, selFrom, selTo = selFrom) {
  const lines = [];
  let off = 0;
  docText.split('\n').forEach((text, i) => { lines.push({ number: i + 1, from: off, to: off + text.length, text }); off += text.length + 1; });
  const lineAt = (pos) => lines.find((l) => pos >= l.from && pos <= l.to) || lines[lines.length - 1];
  return {
    visibleRanges: [{ from: 0, to: docText.length }],
    state: { selection: { main: { from: selFrom, to: selTo } }, doc: { length: docText.length, lineAt } },
  };
}

describe('buildMathDecorations', () => {
  const DOC = 'heading\nsee $x+1$ here\nend';
  const mathFrom = DOC.indexOf('$x+1$');

  test('renders math as a widget when the line is OFF the selection', () => {
    const r = buildMathDecorations(fakeCM6(), () => document.createElement('span'), fakeView(DOC, 0));
    expect(r.ranges.length).toBe(1);
    expect([r.ranges[0].from, r.ranges[0].to]).toEqual([mathFrom, mathFrom + 5]);
  });

  test('leaves math RAW on the active line (editable)', () => {
    expect(buildMathDecorations(fakeCM6(), () => document.createElement('span'), fakeView(DOC, mathFrom)).ranges).toEqual([]);
  });

  test('widget DOM comes from the injected renderMath (tex + display passed through)', () => {
    const calls = [];
    const renderMath = (tex, display) => { calls.push({ tex, display }); const s = document.createElement('span'); s.className = 'katex'; return s; };
    const r = buildMathDecorations(fakeCM6(), renderMath, fakeView(DOC, 0));
    const dom = r.ranges[0].spec.widget.toDOM();
    expect(dom.className).toBe('katex');
    expect(calls[0]).toEqual({ tex: 'x+1', display: false });
  });

  test('falls back to raw $…$ when renderMath returns null', () => {
    const dom = buildMathDecorations(fakeCM6(), () => null, fakeView(DOC, 0)).ranges[0].spec.widget.toDOM();
    expect(dom.textContent).toBe('$x+1$');
  });
});

import { createMathPreview } from '../../src/renderer/editor/math-preview.js';

describe('createMathPreview (ViewPlugin) + widget methods', () => {
  const DOC = 'heading\nsee $x+1$ here\nend';
  test('plugin constructor builds decorations; update rebuilds on doc/selection/viewport change', () => {
    const CM6 = fakeCM6();
    const plugin = createMathPreview(CM6, () => document.createElement('span'));
    const view = fakeView(DOC, 0);
    const inst = new plugin.cls(view);
    expect(inst.decorations.ranges.length).toBe(1);
    // update with a no-op change set → still rebuilds (branch true)
    inst.update({ docChanged: true, selectionSet: false, viewportChanged: false, view });
    expect(inst.decorations.ranges.length).toBe(1);
    // update with nothing changed → keeps decorations, no crash (branch false)
    const before = inst.decorations;
    inst.update({ docChanged: false, selectionSet: false, viewportChanged: false, view });
    expect(inst.decorations).toBe(before);
  });

  test('plugin opts.decorations accessor returns the instance decorations; provide builds atomicRanges', () => {
    const CM6 = fakeCM6();
    const plugin = createMathPreview(CM6, () => document.createElement('span'));
    const inst = new plugin.cls(fakeView(DOC, 0));
    expect(plugin.opts.decorations(inst)).toBe(inst.decorations);
    const facet = plugin.opts.provide(plugin);
    expect(facet.facet).toBe('atomicRanges');
    // the atomicRanges fn reads view.plugin(plugin)?.decorations, falling back to empty set
    expect(facet.fn({ plugin: () => inst }).ranges.length).toBe(1);
    expect(facet.fn({ plugin: () => null }).ranges).toEqual([]); // fallback branch
  });

  test('widget eq() compares tex+display; ignoreEvent() is false', () => {
    const r = buildMathDecorations(fakeCM6(), () => document.createElement('span'), fakeView(DOC, 0));
    const w = r.ranges[0].spec.widget;
    expect(w.ignoreEvent()).toBe(false);
    expect(w.eq({ tex: 'x+1', display: false })).toBe(true);
    expect(w.eq({ tex: 'x+1', display: true })).toBe(false);
    expect(w.eq({ tex: 'zzz', display: false })).toBe(false);
  });

  test('toDOM falls back to raw delimiters when renderMath THROWS', () => {
    const renderMath = () => { throw new Error('katex boom'); };
    const r = buildMathDecorations(fakeCM6(), renderMath, fakeView(DOC, 0));
    expect(r.ranges[0].spec.widget.toDOM().textContent).toBe('$x+1$');
  });

  test('display-math toDOM throw fallback uses $$ delimiters', () => {
    const r = buildMathDecorations(fakeCM6(), () => { throw new Error('x'); }, fakeView('a\n$$E=mc^2$$\nb', 0));
    expect(r.ranges[0].spec.widget.toDOM().textContent).toBe('$$E=mc^2$$');
  });

  test('empty visibleRanges → empty decoration set', () => {
    const v = fakeView(DOC, 0); v.visibleRanges = [];
    expect(buildMathDecorations(fakeCM6(), () => document.createElement('span'), v).ranges).toEqual([]);
  });
});
