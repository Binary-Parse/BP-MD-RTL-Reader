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
import fc from 'fast-check';
import { createLineDirection, autoLineDirection, directionSample, MAX_DIRECTION_CHARS } from '../../src/renderer/editor/line-direction.js';
import { resolveBlockDirection } from '../../src/renderer/bidi.js';

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

  test('first strong wins (audit H4): an English-majority line that opens with Arabic is rtl', () => {
    const { inst } = build(fakeCM6(), fakeView('مرحبا this is mostly an english sentence here'));
    expect(inst.decorations.ranges[0].spec.attributes.dir).toBe('rtl');
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

// RTL-M6 (2026-09-26): inline code spans are stripped before the dominant-script count
// so an editor line resolves exactly like the rendered preview of the same text.
describe('createLineDirection inline-code stripping (RTL-M6)', () => {
  test('an Arabic line carrying a Latin inline-code span stays RTL', () => {
    const CM6 = fakeCM6();
    const view = fakeView('استخدم `Array.prototype.flatMap.call(arguments)` هنا');
    const { inst } = build(CM6, view, () => 'ltr');
    expect(inst.decorations.ranges[0].spec.attributes.dir).toBe('rtl');
  });
  test('a genuinely English line (no code) still resolves LTR', () => {
    const CM6 = fakeCM6();
    const view = fakeView('call the API endpoint for details');
    const { inst } = build(CM6, view, () => 'ltr');
    expect(inst.decorations.ranges[0].spec.attributes.dir).toBe('ltr');
  });
});

describe('createLineDirection inside a code block (audit M18)', () => {
  const DOC = 'فقرة عربية\n```js\n// تعليق عربي\nconst a = 1;\n```\nفقرة أخرى';
  // A fake syntax tree that reports one FencedCode node over lines 2 to 5 of DOC.
  function withFence(CM6, name = 'FencedCode') {
    const from = DOC.indexOf('```js');
    const to = DOC.lastIndexOf('```') + 3;
    CM6.syntaxTree = () => ({
      iterate({ enter }) {
        if (enter({ name: 'Paragraph', from: 0, to: from - 1 }) !== false) { /* no children */ }
        enter({ name, from, to });
      },
    });
    return CM6;
  }
  const dirsOf = (inst) => inst.decorations.ranges.map((r) => r.spec.attributes.dir);

  test('every line of a fence is ltr, the Arabic comment too; the paragraphs keep their own direction', () => {
    const { inst } = build(withFence(fakeCM6()), fakeView(DOC));
    expect(dirsOf(inst)).toEqual(['rtl', 'ltr', 'ltr', 'ltr', 'ltr', 'rtl']);
  });

  test('an indented code block is treated the same way', () => {
    const { inst } = build(withFence(fakeCM6(), 'CodeBlock'), fakeView(DOC));
    expect(dirsOf(inst)).toEqual(['rtl', 'ltr', 'ltr', 'ltr', 'ltr', 'rtl']);
  });

  test('a forced right-to-left note does not mirror the code', () => {
    const plugin = createLineDirection(withFence(fakeCM6()), 'ltr', 'rtl')[1];
    const inst = new plugin.cls(fakeView(DOC));
    expect(dirsOf(inst)).toEqual(['rtl', 'ltr', 'ltr', 'ltr', 'ltr', 'rtl']);
  });

  test('without a syntax tree each line still gets the direction of its own text', () => {
    const { inst } = build(fakeCM6(), fakeView(DOC));
    expect(dirsOf(inst)[2]).toBe('rtl');
  });

  test('rebuilds when the parser delivers a new tree without a change of text', () => {
    const CM6 = fakeCM6();
    let tree = { iterate() {} };
    CM6.syntaxTree = () => tree;
    const view = fakeView(DOC);
    const { inst } = build(CM6, view);
    const before = inst.decorations;
    inst.update({ docChanged: false, viewportChanged: false, view, state: view.state });
    expect(inst.decorations).toBe(before);
    tree = { iterate() {} };
    inst.update({ docChanged: false, viewportChanged: false, view, state: view.state });
    expect(inst.decorations).not.toBe(before);
  });
});

// Design-mock feature 1: `<!-- dir: … -->` pins the block under it in the editor too.
describe('pinned blocks', () => {
  function numberedView(docText, visibleFrom = 0) {
    const view = fakeView(docText, [{ from: visibleFrom, to: docText.length }]);
    const lines = docText.split('\n');
    let off = 0;
    const numbered = lines.map((text, i) => { const l = { from: off, to: off + text.length, text, number: i + 1 }; off += text.length + 1; return l; });
    view.state.doc.lineAt = (pos) => numbered.find((l) => pos >= l.from && pos <= l.to) || numbered[numbered.length - 1];
    view.state.doc.line = (n) => numbered[n - 1];
    return view;
  }
  const dirs = (inst) => inst.decorations.ranges.map((r) => r.spec.attributes.dir);

  test('a pin line pins its block up to the blank line, over a forced direction; the pin line is LTR markup', () => {
    const ext = createLineDirection(fakeCM6(), () => 'ltr', () => 'rtl');
    const inst = new ext[1].cls(numberedView('<!-- dir: ltr -->\nمرحبا\nبالعالم\n\nمرحبا'));
    expect(dirs(inst)).toEqual(['ltr', 'ltr', 'ltr', 'rtl', 'rtl']);
    expect(inst.decorations.ranges[0].spec.attributes.class).toBe('cm-dir-pin');
  });

  test('a view that opens in the middle of a pinned block still knows the pin', () => {
    const text = '<!-- dir: rtl -->\nhello\nworld\n\nhello';
    const { inst } = build(fakeCM6(), numberedView(text, text.indexOf('world')));
    expect(dirs(inst)).toEqual(['rtl', 'ltr', 'ltr']); // world (pinned), the blank line, hello
  });
});

// A line's direction is decided by its leading text. Reading every character of a 25-million-
// character line on each keystroke cost 1.2-2 s (measured); the cap keeps it to a fixed amount.
describe('direction work is bounded per line', () => {
  // The rule before the cap: the whole line, inline code spans stripped.
  const before = (text, base) => resolveBlockDirection(text.replace(/(```[^`]*```|`[^`]*`)/g, ' '), base);
  const alphabet = [
    'a', 'b', 'z', 'ا', 'ب', 'م', 'ح', '1', '2', ' ', ' ', '.', '،', '`', '``', '```', '$', '[', ']', '(', ')',
    'https://x.example/', 'user@mail.example', '	', 'مرحبا', 'hello', '<!-- dir: rtl -->', '*',
  ];
  const lineArb = fc.array(fc.constantFrom(...alphabet), { maxLength: 400 }).map((parts) => parts.join(''));

  test('lines shorter than the cap get exactly the direction they had before', () => {
    fc.assert(fc.property(lineArb, fc.constantFrom('ltr', 'rtl'), (text, base) => {
      expect(text.length).toBeLessThan(MAX_DIRECTION_CHARS);
      expect(autoLineDirection(text, base)).toBe(before(text, base));
    }), { numRuns: 2000 });
  });

  test('a line of exactly the cap is read whole; one more character is cut', () => {
    const exact = 'a'.repeat(MAX_DIRECTION_CHARS);
    expect(directionSample(exact)).toBe(exact);
    expect(directionSample(`${exact}b`)).toHaveLength(MAX_DIRECTION_CHARS);
    expect(directionSample('short')).toBe('short');
  });

  test('the same holds through the editor plugin, line by line', () => {
    fc.assert(fc.property(fc.array(lineArb, { minLength: 1, maxLength: 6 }), (lines) => {
      const { inst } = build(fakeCM6(), fakeView(lines.join('\n')), () => 'ltr');
      const got = inst.decorations.ranges.map((r) => r.spec.attributes.dir);
      expect(got).toHaveLength(lines.length);
      lines.forEach((text, i) => {
        // pins are decided by the pin rule, not by script: leave those lines to their own tests
        if (/^<!-- dir: (rtl|ltr) -->[ 	]*$/.test(text)) return;
        const expected = before(text, 'ltr');
        if (i === 0 || lines[i - 1].trim() === '') expect(got[i]).toBe(expected);
      });
    }), { numRuns: 300 });
  });

  test('a long line is judged by its leading text, not by a count over all of it', () => {
    // Latin for the first screenful, then a great deal of Arabic: counted whole it is "mostly
    // Arabic" (rtl); judged by what the reader meets first it is Latin (ltr).
    const head = 'hello '.repeat(Math.ceil(MAX_DIRECTION_CHARS / 6));
    const text = head + 'مرحبا '.repeat(200000);
    expect(before(text, 'ltr')).toBe('rtl');
    const { inst } = build(fakeCM6(), fakeView(text), () => 'ltr');
    expect(inst.decorations.ranges[0].spec.attributes.dir).toBe('ltr');
  });

  test('a 25-million-character line is decorated in a fraction of a second', () => {
    const text = 'word '.repeat(5_000_000);
    const view = fakeView(text);
    const started = performance.now();
    const { inst } = build(fakeCM6(), view, () => 'ltr');
    const elapsed = performance.now() - started;
    expect(inst.decorations.ranges).toHaveLength(1);
    expect(elapsed).toBeLessThan(250); // 1.2 s and more before the cap
  });
});
