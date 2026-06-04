// @vitest-environment jsdom
/**
 * wikilink-preview.test.js — R09: the CM6 [[wikilink]] live-preview decoration.
 *
 * createWikilinkPreview(CM6, onNavigate) takes an INJECTED CodeMirror namespace, so we
 * exercise buildDecorations + the widget with a minimal fake CM6 + fake view — no engine.
 * Off the active line a [[target|alias]] is replaced by a clickable <a class="wikilink">;
 * on the active line it stays raw (editable). Clicking the widget calls onNavigate(target).
 */
import { describe, test, expect, vi } from 'vitest';
import { createWikilinkPreview } from '../../src/renderer/editor/wikilink-preview.js';

function fakeCM6() {
  const Decoration = {
    replace: (spec) => ({ range: (from, to) => ({ from, to, spec, kind: 'replace' }) }),
    set: (ranges) => ({ ranges }),
  };
  const EditorView = { atomicRanges: { of: (fn) => ({ facet: 'atomicRanges', fn }) } };
  const ViewPlugin = { fromClass: (cls, opts) => ({ cls, opts }) };
  class WidgetType {}
  return { ViewPlugin, Decoration, EditorView, WidgetType };
}

function fakeView(docText, selFrom, selTo = selFrom, visibleRanges = null) {
  const lines = [];
  let off = 0;
  for (const part of docText.split('\n')) {
    lines.push({ from: off, to: off + part.length });
    off += part.length + 1;
  }
  const lineAt = (pos) => lines.find((l) => pos >= l.from && pos <= l.to) || lines[lines.length - 1];
  return {
    visibleRanges: visibleRanges || [{ from: 0, to: docText.length }],
    state: {
      selection: { main: { from: selFrom, to: selTo } },
      doc: { length: docText.length, lineAt, sliceString: (from, to) => docText.slice(from, to) },
    },
  };
}

function instantiate(CM6, view, onNav) {
  const plugin = createWikilinkPreview(CM6, onNav);
  return new plugin.cls(view);
}

// 'line one\nsee [[Apple]] here' — the [[Apple]] lives on line 2.
const DOC = 'line one\nsee [[Apple]] here';

describe('createWikilinkPreview', () => {
  test('replaces a wikilink that is NOT on the active line', () => {
    const inst = instantiate(fakeCM6(), fakeView(DOC, 0)); // caret on line 1
    const r = inst.decorations.ranges;
    expect(r).toHaveLength(1);
    expect([r[0].from, r[0].to]).toEqual([13, 22]); // the [[Apple]] span on line 2
    expect(r[0].spec.widget.target).toBe('Apple');
    expect(r[0].spec.widget.alias).toBe('Apple');
  });

  test('leaves a wikilink RAW when the cursor is on its line (editable)', () => {
    const inst = instantiate(fakeCM6(), fakeView(DOC, 13)); // caret inside line 2
    expect(inst.decorations.ranges).toHaveLength(0);
  });

  test('target|alias → widget shows alias, keeps target', () => {
    const doc = 'x\n[[Apple|red fruit]]';
    const inst = instantiate(fakeCM6(), fakeView(doc, 0));
    const w = inst.decorations.ranges[0].spec.widget;
    expect(w.target).toBe('Apple');
    expect(w.alias).toBe('red fruit');
  });

  test('widget.toDOM renders a.wikilink and mousedown navigates to the target', () => {
    const onNav = vi.fn();
    const inst = instantiate(fakeCM6(), fakeView(DOC, 0), onNav);
    const el = inst.decorations.ranges[0].spec.widget.toDOM();
    expect(el.tagName).toBe('A');
    expect(el.className).toBe('wikilink');
    expect(el.getAttribute('data-target')).toBe('Apple');
    expect(el.textContent).toBe('Apple');
    const ev = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(onNav).toHaveBeenCalledWith('Apple');
    expect(ev.defaultPrevented).toBe(true); // does not disturb editor focus/selection
  });

  test('widget eq() compares target + alias', () => {
    const inst = instantiate(fakeCM6(), fakeView(DOC, 0));
    const w = inst.decorations.ranges[0].spec.widget;
    expect(w.eq({ target: 'Apple', alias: 'Apple' })).toBe(true);
    expect(w.eq({ target: 'Apple', alias: 'Other' })).toBe(false);
    expect(w.eq({ target: 'Pear', alias: 'Apple' })).toBe(false);
  });

  test('the update() hook rebuilds on doc/selection/viewport changes', () => {
    const inst = instantiate(fakeCM6(), fakeView(DOC, 0));
    const before = inst.decorations.ranges.length;
    inst.update({ docChanged: false, selectionSet: true, viewportChanged: false, view: fakeView(DOC, 13) });
    expect(before).toBe(1);
    expect(inst.decorations.ranges).toHaveLength(0); // now caret on the link line → raw
  });

  test('no visible ranges → empty decoration set', () => {
    const inst = instantiate(fakeCM6(), fakeView(DOC, 0, 0, []));
    expect(inst.decorations.ranges).toEqual([]);
  });

  test('the widget ignores its own events so the mousedown reaches it', () => {
    const inst = instantiate(fakeCM6(), fakeView(DOC, 0));
    expect(inst.decorations.ranges[0].spec.widget.ignoreEvent()).toBe(false);
  });

  test('plugin spec exposes decorations + an atomicRanges provider (both branches)', () => {
    const CM6 = fakeCM6();
    const plugin = createWikilinkPreview(CM6, () => {});
    const inst = new plugin.cls(fakeView(DOC, 0));
    // decorations accessor returns the instance's decorations
    expect(plugin.opts.decorations(inst)).toBe(inst.decorations);
    // provide() wires EditorView.atomicRanges.of(fn); drive fn with present/absent plugin
    const facet = plugin.opts.provide(plugin);
    expect(facet.facet).toBe('atomicRanges');
    expect(facet.fn({ plugin: () => inst })).toBe(inst.decorations); // plugin present
    const fallback = facet.fn({ plugin: () => undefined });          // plugin absent → empty set
    expect(fallback.ranges).toEqual([]);
  });
});
