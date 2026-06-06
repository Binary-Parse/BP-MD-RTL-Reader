// @vitest-environment jsdom
/**
 * line-direction.test.js — T-R1/R2 in the CM6 editor (T-F13): each line gets its own
 * direction from its DOMINANT strong-script (bidi.resolveBlockDirection), emitted
 * as a zero-width Decoration.line({attributes:{dir}}) and paired with CM6's
 * perLineTextDirection facet so caret motion becomes logical for free.
 *
 * CM6 is injected, so we drive createLineDirection with a fake CM6 + fake view.
 */
import { describe, test, expect } from 'vitest';
import { createLineDirection } from '../../src/renderer/editor/line-direction.js';

function fakeCM6() {
  const Decoration = {
    line: (spec) => ({ range: (from) => ({ from, to: from, spec, kind: 'line' }) }),
    set: (ranges) => ({ ranges }),
  };
  const EditorView = { perLineTextDirection: { of: (value) => ({ facet: 'perLineTextDirection', value }) } };
  const ViewPlugin = { fromClass: (cls, opts) => ({ cls, opts }) };
  return { Decoration, EditorView, ViewPlugin };
}

// A fake view whose doc.lineAt returns {from,to,text}; visibleRanges defaults to the whole doc.
function fakeView(docText, visibleRanges = null) {
  const lines = [];
  let off = 0;
  for (const text of docText.split('\n')) {
    lines.push({ from: off, to: off + text.length, text });
    off += text.length + 1;
  }
  const lineAt = (pos) => lines.find((l) => pos >= l.from && pos <= l.to) || lines[lines.length - 1];
  return { visibleRanges: visibleRanges || [{ from: 0, to: docText.length }], state: { doc: { length: docText.length, lineAt } } };
}

function build(CM6, view, getBaseDir) {
  const ext = createLineDirection(CM6, getBaseDir);
  const plugin = ext[1];
  return { ext, plugin, inst: new plugin.cls(view) };
}

describe('createLineDirection', () => {
  test('per-line dir from first-strong char (Latin line ltr, Arabic line rtl)', () => {
    const { inst } = build(fakeCM6(), fakeView('hello\nمرحبا بالعالم'));
    const dirs = inst.decorations.ranges.map((r) => r.spec.attributes.dir);
    expect(dirs).toEqual(['ltr', 'rtl']);
  });

  test('dominant-script: an Arabic-majority line that OPENS with English/number → rtl (the editor header bug)', () => {
    // Strict first-strong would give ['ltr','ltr'] here — this pins the resolveBlockDirection upgrade.
    const { inst } = build(fakeCM6(), fakeView('API دليل المستخدم الكامل\n2024 إصدار جديد من البرنامج'));
    expect(inst.decorations.ranges.map((r) => r.spec.attributes.dir)).toEqual(['rtl', 'rtl']);
  });

  test('dominant-script: an English-majority line that opens with Arabic stays ltr', () => {
    const { inst } = build(fakeCM6(), fakeView('مرحبا this is mostly an english sentence here'));
    expect(inst.decorations.ranges[0].spec.attributes.dir).toBe('ltr');
  });

  test('line decorations are zero-width and anchored at line start', () => {
    const { inst } = build(fakeCM6(), fakeView('hello\nمرحبا'));
    for (const r of inst.decorations.ranges) {
      expect(r.kind).toBe('line');
      expect(r.to).toBe(r.from); // zero-width — CM6 throws otherwise
    }
    expect(inst.decorations.ranges.map((r) => r.from)).toEqual([0, 6]); // each line's .from
  });

  test('a neutral-only line inherits the base direction (EC-C1)', () => {
    expect(build(fakeCM6(), fakeView('12:30'), () => 'rtl').inst.decorations.ranges[0].spec.attributes.dir).toBe('rtl');
    expect(build(fakeCM6(), fakeView('12:30'), () => 'ltr').inst.decorations.ranges[0].spec.attributes.dir).toBe('ltr');
  });

  test('getBaseDir may be a plain string, not only a function', () => {
    expect(build(fakeCM6(), fakeView('12:30'), 'rtl').inst.decorations.ranges[0].spec.attributes.dir).toBe('rtl');
  });

  test('an empty line falls back to the base direction without crashing', () => {
    expect(build(fakeCM6(), fakeView(''), () => 'rtl').inst.decorations.ranges[0].spec.attributes.dir).toBe('rtl');
  });

  test('rebuilds on doc/viewport change but NOT on selection change', () => {
    const CM6 = fakeCM6();
    const view = fakeView('hello\nمرحبا');
    const { inst } = build(CM6, view, () => 'ltr');
    const before = inst.decorations;

    inst.update({ docChanged: false, selectionSet: true, viewportChanged: false, view });
    expect(inst.decorations).toBe(before); // per-line dir is selection-independent

    inst.update({ docChanged: true, selectionSet: false, viewportChanged: false, view });
    expect(inst.decorations).not.toBe(before);
    const afterDoc = inst.decorations;
    inst.update({ docChanged: false, selectionSet: false, viewportChanged: true, view });
    expect(inst.decorations).not.toBe(afterDoc);
  });

  test('exposes decorations via the plugin spec accessor', () => {
    const { plugin, inst } = build(fakeCM6(), fakeView('hi'), () => 'ltr');
    expect(plugin.opts.decorations(inst)).toBe(inst.decorations);
  });

  test('enables CM6 per-line text direction (the facet sentinel is first in the extension array)', () => {
    const { ext } = build(fakeCM6(), fakeView('hi'), () => 'ltr');
    expect(ext[0]).toEqual({ facet: 'perLineTextDirection', value: true });
  });

  // ---- forced direction (toggle / front-matter overrides per-line auto) ----
  function buildForced(view, getBaseDir, getForceDir) {
    const ext = createLineDirection(fakeCM6(), getBaseDir, getForceDir);
    const plugin = ext[1];
    return { ext, plugin, inst: new plugin.cls(view) };
  }

  test('forced direction overrides per-line auto: every line takes the forced dir', () => {
    const { inst } = buildForced(fakeView('API دليل المستخدم\nمرحبا بالعالم\nhello world'), () => 'ltr', () => 'rtl');
    expect(inst.decorations.ranges.map((r) => r.spec.attributes.dir)).toEqual(['rtl', 'rtl', 'rtl']);
  });

  test('forced LTR over an Arabic line yields ltr', () => {
    const { inst } = buildForced(fakeView('مرحبا بالعالم'), () => 'rtl', () => 'ltr');
    expect(inst.decorations.ranges[0].spec.attributes.dir).toBe('ltr');
  });

  test('getForceDir may be a plain string, not only a function', () => {
    const { inst } = buildForced(fakeView('hello world'), () => 'ltr', 'rtl');
    expect(inst.decorations.ranges[0].spec.attributes.dir).toBe('rtl');
  });

  test('rebuilds on any update when the forced direction changed (re-reads the getter, no StateEffect needed)', () => {
    const view = fakeView('hello\nمرحبا');
    let force = null;
    const { inst } = buildForced(view, () => 'ltr', () => force);
    const before = inst.decorations;
    force = 'rtl'; // setDirection mutated the live value; a benign tx fires update()
    inst.update({ docChanged: false, viewportChanged: false, selectionSet: false, view });
    expect(inst.decorations).not.toBe(before);
    expect(inst.decorations.ranges.map((r) => r.spec.attributes.dir)).toEqual(['rtl', 'rtl']);
  });

  test('does NOT rebuild on a selection-only update when the direction is unchanged', () => {
    const view = fakeView('hello\nمرحبا');
    const { inst } = buildForced(view, () => 'ltr', () => null);
    const before = inst.decorations;
    inst.update({ docChanged: false, viewportChanged: false, selectionSet: true, view });
    expect(inst.decorations).toBe(before);
  });
});
