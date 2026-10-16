/**
 * rendering.test.js — T-F14 callouts, T-F7 outline, T-F15 task lists.
 * Uses the real `marked` (devDependency) for integration-level confidence.
 */
import { describe, test, expect } from 'vitest';
import { marked } from 'marked';
import { Marked } from 'marked';
import { parseCalloutHeader, CALLOUT_TYPES, parseMarkdown, configureMarked, lastRenderLimited } from '../../src/renderer/markdown/markdown.js';
import { activeHeading } from '../../src/renderer/components/outline.js';

describe('callouts (T-F14)', () => {
  test('parses [!TYPE] with and without title', () => {
    expect(parseCalloutHeader('[!NOTE]')).toEqual({ type: 'note', title: 'Note' });
    expect(parseCalloutHeader('[!warning] Careful!')).toEqual({ type: 'warning', title: 'Careful!' });
  });
  test('rejects unknown type / plain text', () => {
    expect(parseCalloutHeader('[!bogus]')).toBeNull();
    expect(parseCalloutHeader('just a quote')).toBeNull();
  });
  test('all five GFM alert types recognized', () => {
    for (const t of ['note', 'tip', 'important', 'warning', 'caution']) {
      expect(CALLOUT_TYPES).toContain(t);
      expect(parseCalloutHeader(`[!${t.toUpperCase()}]`).type).toBe(t);
    }
  });
});

describe('outline (T-F7)', () => {
  test('activeHeading scroll-sync', () => {
    const offsets = [0, 200, 600];
    expect(activeHeading(0, offsets)).toBe(0);
    expect(activeHeading(250, offsets)).toBe(1);
    expect(activeHeading(10000, offsets)).toBe(2);
    expect(activeHeading(0, [])).toBe(-1);
  });
});

describe('task lists (T-F15)', () => {
  test('GFM checkboxes render as inputs', () => {
    configureMarked(marked);
    const html = parseMarkdown('- [ ] todo\n- [x] done', { marked, DOMPurify: { sanitize: (s) => s } });
    expect(html).toMatch(/type="checkbox"/);
    expect(html).toMatch(/checked/);
  });
});

// audit M4. Real marked, the app's extensions, and the guard that configureMarked installs.
describe('M4: one render cannot stall the window', () => {
  const guarded = new Marked();
  configureMarked(guarded);
  const passThrough = { sanitize: (html) => html };
  const render = (text) => parseMarkdown(text, { marked: guarded, DOMPurify: passThrough });
  const repeat = (unit, bytes) => unit.repeat(Math.ceil(bytes / unit.length));
  const timed = (text) => { const start = performance.now(); const html = render(text); return { html, ms: performance.now() - start }; };

  // Each of these took between 2 and 60 seconds at this size before the guard.
  test.each(['*a ', '_a ', '**a ', '~~a ', 'a_', '!a', '*a\n'])('64 KB of %j is cut short and shown as literal text', (unit) => {
    const { html, ms } = timed(repeat(unit, 64 * 1024));
    expect(ms).toBeLessThan(5000);
    expect(lastRenderLimited()).toBe(true);
    expect(html).toContain(unit.trim().slice(0, 2));
    expect(html).not.toMatch(/<script/i);
  }, 30000);

  test('the text that could not be formatted keeps its line breaks and is escaped', () => {
    const { html } = timed(repeat('*a <b>\n', 64 * 1024));
    expect(lastRenderLimited()).toBe(true);
    const tail = html.slice(-400);
    expect(tail).toContain('*a &lt;b&gt;<br>');
    expect(tail).not.toContain('<b>');
  }, 30000);

  test('thousands of nested quotes fall back to the plain text instead of throwing', () => {
    const html = render('>'.repeat(20000) + ' deep');
    expect(lastRenderLimited()).toBe(true);
    expect(html).toContain('<pre>');
    expect(html).toContain('deep');
  }, 30000);

  test('a limited render does not mark the next one', () => {
    render(repeat('*a ', 64 * 1024));
    expect(lastRenderLimited()).toBe(true);
    expect(render('plain **bold** text')).toBe('<p>plain <strong>bold</strong> text</p>\n');
    expect(lastRenderLimited()).toBe(false);
  }, 30000);

  test('an honest long note is not limited and renders in linear time', () => {
    const paragraph = 'Some **bold** words, a [link](http://x.y), ~sub~ and ==mark== and `code`.\n\n';
    const best = (text) => Math.min(...[0, 1, 2].map(() => timed(text).ms));
    const small = best(repeat(paragraph, 128 * 1024));
    expect(lastRenderLimited()).toBe(false);
    const large = best(repeat(paragraph, 512 * 1024));
    expect(lastRenderLimited()).toBe(false);
    // linear = 4. Before the start hints were cached this ratio was about 16.
    expect(large / Math.max(small, 1)).toBeLessThan(9);
  }, 60000);

  test('a long log with single line breaks (one inline context) renders in linear time', () => {
    const line = 'name: some **bold** text and more words here\n';
    // Sizes large enough that the small run is not lost in timer noise; best of five.
    const best = (text) => Math.min(...[0, 1, 2, 3, 4].map(() => timed(text).ms));
    const small = best(repeat(line, 256 * 1024));
    const large = best(repeat(line, 1024 * 1024));
    expect(lastRenderLimited()).toBe(false);
    expect(large / Math.max(small, 1)).toBeLessThan(9);
  }, 60000);

  // The cached start hints must not change what is rendered: these are the outputs of the
  // version before the guard, for the inputs where a hint decides where a text token ends.
  test.each([
    ['H~2~O and x^2^ and ==mark== and ~~strike~~ and ~~~x~ and a~~b~c~\n',
      '<p>H<sub>2</sub>O and x<sup>2</sup> and <mark>mark</mark> and <del>strike</del> and ~~~x~ and a~<sub>b</sub>c~</p>\n'],
    ['a~b~c ~~d~~ ~e~~f~ ~g~ ~~h~ i~ ~j\n~k~\n',
      '<p>a<sub>b</sub>c <del>d</del> <del>e~~f</del> <sub>g</sub> ~<sub>h</sub> i~ ~j<br><sub>k</sub></p>\n'],
    ['Line one\nline **two**\n', '<p>Line one<br>line <strong>two</strong></p>\n'],
    ['x[^a]: not a line start\n\n[^a]: real\n\nuse[^a]\n',
      '<p>x</p>\n<p>use<sup class="fn-ref" id="fnref-1"><a href="#fn-1">1</a></sup></p>\n\n<section class="footnotes"><hr><ol><li id="fn-1" class="fn-item">real <a href="#fnref-1" class="fn-back" aria-label="Back to reference 1">↩</a></li></ol></section>'],
  ])('unchanged output for %j', (text, expected) => {
    expect(render(text)).toBe(expected);
    expect(lastRenderLimited()).toBe(false);
  });
});
