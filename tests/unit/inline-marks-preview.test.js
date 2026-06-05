// @vitest-environment jsdom
/**
 * inline-marks-preview.test.js — CM6 live-preview for ==highlight==, <u>, ~sub~, ^sup^.
 * Exercises buildDecorations with a minimal fake CM6 (no engine): off the active line the
 * delimiters are HIDDEN (replace) and the inner text gets a style class (mark); the active
 * line stays raw.
 */
import { describe, test, expect } from 'vitest';
import { createInlineMarksPreview } from '../../src/renderer/editor/inline-marks-preview.js';

function fakeCM6() {
  const Decoration = {
    replace: () => ({ range: (from, to) => ({ from, to, kind: 'replace' }) }),
    mark: (spec) => ({ range: (from, to) => ({ from, to, kind: 'mark', spec }) }),
    set: (ranges) => ({ ranges }),
  };
  const EditorView = { atomicRanges: { of: (fn) => ({ facet: 'atomicRanges', fn }) } };
  const ViewPlugin = { fromClass: (cls, opts) => ({ cls, opts }) };
  class WidgetType {}
  return { ViewPlugin, Decoration, EditorView, WidgetType };
}
function fakeView(docText, selFrom, selTo = selFrom, visibleRanges = null) {
  const lines = []; let off = 0;
  for (const part of docText.split('\n')) { lines.push({ from: off, to: off + part.length }); off += part.length + 1; }
  const lineAt = (pos) => lines.find((l) => pos >= l.from && pos <= l.to) || lines[lines.length - 1];
  return {
    visibleRanges: visibleRanges || [{ from: 0, to: docText.length }],
    state: { selection: { main: { from: selFrom, to: selTo } }, doc: { length: docText.length, lineAt, sliceString: (a, b) => docText.slice(a, b) } },
  };
}
function inst(CM6, view) { const p = createInlineMarksPreview(CM6); return { plugin: p, instance: new p.cls(view) }; }
const classes = (ranges) => ranges.ranges.filter((r) => r.kind === 'mark').map((r) => r.spec.class);

describe('createInlineMarksPreview', () => {
  test('highlight ==x== off the active line → hide markers + cm-hl on the inner', () => {
    const doc = 'line one\nsee ==hi== there';
    const { instance } = inst(fakeCM6(), fakeView(doc, 0)); // caret on line 1
    const r = instance.decorations.ranges;
    expect(classes(instance.decorations)).toEqual(['cm-hl']);
    // 3 ranges for the one mark: hide-open, mark-inner, hide-close
    expect(r.filter((x) => x.kind === 'replace').length).toBe(2);
  });
  test('each mark type is recognized with its class', () => {
    const doc = 'h\n==a== <u>b</u> ~c~ ^d^';
    const { instance } = inst(fakeCM6(), fakeView(doc, 0));
    expect(classes(instance.decorations).sort()).toEqual(['cm-hl', 'cm-sub', 'cm-sup', 'cm-u']);
  });
  test('~~strikethrough~~ is NOT treated as subscript', () => {
    const doc = 'h\nthis ~~strike~~ stays';
    const { instance } = inst(fakeCM6(), fakeView(doc, 0));
    expect(classes(instance.decorations)).toEqual([]); // no cm-sub
  });
  test('the active line stays raw (no decorations)', () => {
    const doc = 'see ==hi== there';
    const { instance } = inst(fakeCM6(), fakeView(doc, 5)); // caret on the only line
    expect(instance.decorations.ranges).toEqual([]);
  });
  test('no visible ranges → empty set', () => {
    const { instance } = inst(fakeCM6(), fakeView('h\n==x==', 0, 0, []));
    expect(instance.decorations.ranges).toEqual([]);
  });
  test('update() rebuilds on selection change; plugin spec exposes decorations + atomicRanges', () => {
    const CM6 = fakeCM6();
    const { plugin, instance } = inst(CM6, fakeView('h\n==x==', 0));
    expect(classes(instance.decorations)).toEqual(['cm-hl']);
    instance.update({ docChanged: false, selectionSet: true, viewportChanged: false, view: fakeView('h\n==x==', 3) });
    expect(instance.decorations.ranges).toEqual([]); // caret now on the mark line → raw
    expect(plugin.opts.decorations(instance)).toBe(instance.decorations);
    const facet = plugin.opts.provide(plugin);
    expect(facet.facet).toBe('atomicRanges');
    expect(facet.fn({ plugin: () => instance })).toBe(instance.decorations);
    expect(facet.fn({ plugin: () => undefined }).ranges).toEqual([]);
  });
});
