/**
 * footnotes.test.js — GFM footnotes extension (R11).
 *
 * Exercises footnoteExtension() through a REAL marked instance (marked@^18, the
 * vendored version), since the ref/def tokenizers + numbering + postprocess hook
 * only run when marked actually parses. Asserts concrete output, not tautologies.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { footnoteExtension } from '../../src/renderer/markdown/footnotes.js';
import { configureMarked } from '../../src/renderer/markdown/markdown.js';

describe('footnoteExtension via real marked', () => {
  let MarkedClass;
  beforeAll(async () => { MarkedClass = (await import('marked')).Marked; });

  function fresh() {
    const inst = new MarkedClass();
    inst.use(footnoteExtension());
    return inst;
  }

  test('a reference + definition render a numbered ref and an end-of-doc list', () => {
    const m = fresh();
    const out = m.parse('Text with a note.[^1]\n\n[^1]: The footnote body.');
    // ref: a superscript anchor to #fn-1
    expect(out).toMatch(/<sup class="fn-ref" id="fnref-1"><a href="#fn-1">1<\/a><\/sup>/);
    // The literal [^1] marker must NOT survive as text
    expect(out).not.toContain('[^1]');
    // definition list with the body + backlink
    expect(out).toMatch(/<section class="footnotes">/);
    expect(out).toMatch(/<li id="fn-1"[^>]*>The footnote body\./);
    expect(out).toMatch(/<a href="#fnref-1"[^>]*>↩<\/a>/);
  });

  test('numbering follows first-reference order, not definition order', () => {
    const m = fresh();
    const out = m.parse('First[^a] then second[^b].\n\n[^b]: Bee.\n\n[^a]: Ay.');
    // [^a] referenced first → 1, [^b] → 2, regardless of def order
    expect(out).toMatch(/id="fnref-1"><a href="#fn-1">1/);
    expect(out).toMatch(/id="fnref-2"><a href="#fn-2">2/);
    // list item 1 is "Ay." (the first-referenced one)
    expect(out).toMatch(/<li id="fn-1"[^>]*>Ay\./);
    expect(out).toMatch(/<li id="fn-2"[^>]*>Bee\./);
  });

  test('no footnotes → no <section> appended', () => {
    const m = fresh();
    const out = m.parse('Just a plain paragraph.');
    expect(out).not.toContain('class="footnotes"');
  });

  test('definition body is HTML-escaped (XSS-safe)', () => {
    const m = fresh();
    const out = m.parse('ref[^x]\n\n[^x]: <img src=x onerror=alert(1)>');
    expect(out).not.toContain('<img src=x onerror');
    expect(out).toContain('&lt;img');
  });

  test('state resets between parses (preprocess hook)', () => {
    const m = fresh();
    m.parse('one[^1]\n\n[^1]: first');
    const out2 = m.parse('two[^9]\n\n[^9]: second');
    // numbering restarts at 1 for the second document
    expect(out2).toMatch(/id="fnref-1"><a href="#fn-1">1/);
    expect(out2).toMatch(/<li id="fn-1"[^>]*>second/);
    // and the first doc's note didn't leak in
    expect(out2).not.toContain('first');
  });

  test('a multi-line definition is joined into one body (continuation lines)', () => {
    const m = fresh();
    const out = m.parse('ref[^1]\n\n[^1]: first line\n   second line');
    // continuation line is folded in with a single space, leading indent collapsed
    expect(out).toMatch(/<li id="fn-1"[^>]*>first line second line/);
  });

  test('a definition with no space after the colon still parses', () => {
    const m = fresh();
    const out = m.parse('ref[^1]\n\n[^1]:tight');
    expect(out).toMatch(/<li id="fn-1"[^>]*>tight/);
  });

  test('repeated references to the same id reuse one number', () => {
    const m = fresh();
    const out = m.parse('a[^1] b[^1]\n\n[^1]: once');
    // both refs are numbered 1; exactly one list item exists
    expect(out.match(/href="#fn-1"/g)).toHaveLength(2);
    expect(out.match(/<li id="fn-/g)).toHaveLength(1);
  });

  test('esc() escapes &, <, >, and "', () => {
    const m = fresh();
    const out = m.parse('r[^1]\n\n[^1]: a & b < c > d "e"');
    expect(out).toContain('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  test('the backlink markup is exact (↩ glyph, aria-label, href)', () => {
    const m = fresh();
    const out = m.parse('r[^1]\n\n[^1]: body');
    expect(out).toContain('<a href="#fnref-1" class="fn-back" aria-label="Back to reference 1">↩</a>');
  });

  test('multi-character ids are matched in full (ref + def)', () => {
    const m = fresh();
    const out = m.parse('see[^note-12] here\n\n[^note-12]: multi char id body');
    // the WHOLE id is consumed (a regex that dropped the + would only take one char,
    // leaving "ote-12]" as raw text and losing the definition)
    expect(out).not.toContain('ote-12]');
    expect(out).toMatch(/id="fnref-1"><a href="#fn-1">1<\/a>/);
    expect(out).toMatch(/<li id="fn-1"[^>]*>multi char id body/);
  });

  test('the empty footnoteDef renderer emits nothing at the definition position', () => {
    const m = fresh();
    const out = m.parse('text[^1] more\n\n[^1]: the body');
    // The def line must NOT render its own paragraph before the footnotes section;
    // "the body" appears ONLY inside the <li>, not as inline/standalone content.
    const beforeSection = out.split('<section class="footnotes">')[0];
    expect(beforeSection).not.toContain('the body');
  });

  test('a reference NOT at the start of a line is still detected', () => {
    const m = fresh();
    const out = m.parse('lots of text before the marker[^1] here\n\n[^1]: body');
    expect(out).toMatch(/id="fnref-1"><a href="#fn-1">1<\/a>/);
  });

  test('configureMarked wires footnotes into the standard pipeline', () => {
    const inst = new MarkedClass();
    configureMarked(inst);
    const out = inst.parse('hi[^1]\n\n[^1]: there');
    expect(out).toMatch(/id="fnref-1"/);
    expect(out).toMatch(/<li id="fn-1"[^>]*>there/);
  });
});
