// @vitest-environment jsdom
/**
 * live-preview-perf.test.js — T-F13: the live-preview decoration build must be bounded by
 * the on-screen VIEWPORT, not the document size, so a 10k-line doc stays cheap.
 *
 * buildDecorations only iterates syntaxTree over view.visibleRanges, so its work is bounded
 * by the visible window. These tests pin that invariant with a FROM/TO-CLIPPING counting fake
 * (the shared fake in live-preview.test.js scans all nodes ignoring from/to, which would make
 * the doc-size-invariance pass for the wrong reason). The one genuine RED→GREEN driver is the
 * empty-visibleRanges guard: with nothing visible, no per-doc-size lineAt work should happen.
 */
import { describe, test, expect } from 'vitest';
import { createLivePreview } from '../../src/renderer/editor/live-preview.js';

// A fake CM6 whose syntaxTree.iterate CLIPS to the requested [from,to] and counts every enter.
function countingCM6() {
  let visited = 0;
  const Decoration = {
    replace: (spec) => ({ range: (from, to) => ({ from, to, spec }) }),
    set: (ranges) => ({ ranges }),
  };
  const EditorView = { atomicRanges: { of: (fn) => ({ fn }) }, theme: (s) => ({ theme: s }) };
  const ViewPlugin = { fromClass: (cls, opts) => ({ cls, opts }) };
  const syntaxTree = (state) => ({
    iterate: ({ from, to, enter }) => {
      for (const n of state._nodes) {
        if (n.from >= from && n.to <= to) { visited += 1; enter(n); }
      }
    },
  });
  class WidgetType {}
  return { CM6: { ViewPlugin, Decoration, syntaxTree, EditorView, WidgetType }, visited: () => visited, reset: () => { visited = 0; } };
}

// Synthetic doc: every line is `**ab**` (6 chars) + newline = LINE_LEN, so offsets align across
// docs of different sizes. Two EmphasisMark nodes per line. doc.lineAt is wrapped in a counter.
const LINE_LEN = 7;
function bigDocView({ lineCount, visibleRanges, sel }) {
  const nodes = [];
  for (let i = 0; i < lineCount; i += 1) {
    const b = i * LINE_LEN;
    nodes.push({ name: 'EmphasisMark', from: b, to: b + 2 }, { name: 'EmphasisMark', from: b + 4, to: b + 6 });
  }
  let lineAtCalls = 0;
  const lineAt = (pos) => {
    lineAtCalls += 1;
    const i = Math.max(0, Math.min(Math.floor(pos / LINE_LEN), lineCount - 1));
    return { from: i * LINE_LEN, to: i * LINE_LEN + (LINE_LEN - 1) };
  };
  const view = {
    visibleRanges,
    state: {
      selection: { main: sel },
      doc: { length: lineCount * LINE_LEN, lineAt, sliceString: () => '' },
      _nodes: nodes,
    },
  };
  return { view, lineAtCalls: () => lineAtCalls };
}

const win = (fromLine, toLine) => [{ from: fromLine * LINE_LEN, to: toLine * LINE_LEN }];

describe('live-preview perf (viewport-bounded)', () => {
  test('RED driver: empty visibleRanges does NO per-doc-size work (no lineAt, no ranges)', () => {
    const c = countingCM6();
    const plugin = createLivePreview(c.CM6);
    const { view, lineAtCalls } = bigDocView({ lineCount: 10000, visibleRanges: [], sel: { from: 0, to: 0 } });
    const inst = new plugin.cls(view);
    expect(lineAtCalls()).toBe(0);          // FAILS today: lineAt(sel.from)/lineAt(sel.to) run before the empty loop
    expect(inst.decorations.ranges).toEqual([]);
    expect(c.visited()).toBe(0);
  });

  test('node-visit count is INVARIANT to total doc size for a fixed viewport', () => {
    const small = countingCM6();
    new (createLivePreview(small.CM6).cls)(bigDocView({ lineCount: 1000, visibleRanges: win(100, 150), sel: { from: 0, to: 0 } }).view);
    const big = countingCM6();
    new (createLivePreview(big.CM6).cls)(bigDocView({ lineCount: 100000, visibleRanges: win(100, 150), sel: { from: 0, to: 0 } }).view);
    expect(big.visited()).toBe(small.visited()); // same window → same work, regardless of 1k vs 100k lines
    expect(small.visited()).toBe(100);            // 50 lines × 2 marks
  });

  test('only nodes inside the viewport are visited (not the whole 10k-line doc)', () => {
    const c = countingCM6();
    const inst = new (createLivePreview(c.CM6).cls)(bigDocView({ lineCount: 10000, visibleRanges: win(100, 150), sel: { from: 0, to: 0 } }).view);
    expect(c.visited()).toBeLessThan(10000);            // not a full-doc scan
    expect(c.visited()).toBeLessThanOrEqual(110);       // ~viewport-sized
    expect(inst.decorations.ranges.length).toBe(c.visited()); // every visited mark hidden (all inactive)
  });

  test('multiple visibleRanges entries are SUMMED (proves the per-range loop)', () => {
    const both = countingCM6();
    new (createLivePreview(both.CM6).cls)(bigDocView({ lineCount: 1000, visibleRanges: [...win(10, 20), ...win(50, 60)], sel: { from: 0, to: 0 } }).view);
    expect(both.visited()).toBe(40); // (10 lines + 10 lines) × 2 marks, no double count
  });

  test('a keystroke (docChanged) rebuild stays viewport-bounded', () => {
    const c = countingCM6();
    const { view } = bigDocView({ lineCount: 10000, visibleRanges: win(500, 550), sel: { from: 0, to: 0 } });
    const inst = new (createLivePreview(c.CM6).cls)(view);
    c.reset();
    const t0 = performance.now();
    inst.update({ docChanged: true, selectionSet: false, viewportChanged: false, view });
    const dt = performance.now() - t0;
    expect(c.visited()).toBeLessThanOrEqual(110); // rebuild touched only the viewport
    expect(dt).toBeLessThan(16);                  // generous keystroke smoke (fake engine ≈ 0 cost)
  });

  test('a no-op update does ZERO work and reuses the prior decorations', () => {
    const c = countingCM6();
    const { view } = bigDocView({ lineCount: 10000, visibleRanges: win(0, 50), sel: { from: 0, to: 0 } });
    const inst = new (createLivePreview(c.CM6).cls)(view);
    const before = inst.decorations;
    c.reset();
    inst.update({ docChanged: false, selectionSet: false, viewportChanged: false, view });
    expect(c.visited()).toBe(0);
    expect(inst.decorations).toBe(before);
  });

  test('SOFT wall-clock ceiling: building a 10k-line doc viewport stays well under 100ms', () => {
    const c = countingCM6();
    const { view } = bigDocView({ lineCount: 10000, visibleRanges: win(0, 80), sel: { from: 0, to: 0 } });
    const t0 = performance.now();
    new (createLivePreview(c.CM6).cls)(view);
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(100); // ceiling against pathological O(n·m) regressions, not a micro-benchmark
  });
});
