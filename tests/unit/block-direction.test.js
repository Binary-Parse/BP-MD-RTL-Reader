// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  attachSourceLines, dirMarkerExtension, flipEdit, markerDirection, pinEdit, pinnedLines, removeAllMarkers,
  srcLineRenderer, withSourceLines,
} from '../../src/renderer/markdown/block-direction.js';
import { parseMarkdown, configureMarked } from '../../src/renderer/markdown/markdown.js';
import { applyBidi } from '../../src/renderer/bidi-dom.js';

// Design-mock feature 1: one block's direction, pinned by a `<!-- dir: … -->` line in the note.
function render(md, options = {}) {
  const marked = new Marked();
  configureMarked(marked);
  const root = document.createElement('div');
  root.append(parseMarkdown(md, { marked, DOMPurify, fragment: true, ...options }));
  return root;
}

describe('the pin line', () => {
  test('is recognised exactly, with trailing spaces or a CR, and nothing else', () => {
    expect(markerDirection('<!-- dir: rtl -->')).toBe('rtl');
    expect(markerDirection('<!-- dir: ltr -->  \r')).toBe('ltr');
    expect(markerDirection('<!-- dir: auto -->')).toBeNull();
    expect(markerDirection(' <!-- dir: rtl -->')).toBeNull();
    expect(markerDirection('<!-- dir: rtl --> text')).toBeNull();
  });

  test('renders as a hidden placeholder that survives the sanitizer', () => {
    const root = render('<!-- dir: rtl -->\nHello world\n');
    const marker = root.querySelector('p.bpmd-dir');
    expect(marker).not.toBeNull();
    expect(marker.hidden).toBe(true);
    expect(marker.getAttribute('dir')).toBe('rtl');
    expect(root.textContent.trim()).toBe('Hello world');
  });

  test('ends a paragraph above it, so it pins the block below', () => {
    const root = render('first line\n<!-- dir: ltr -->\n# Heading\n');
    expect([...root.children].map((el) => el.nodeName)).toEqual(['P', 'P', 'H1']);
    expect(root.children[1].className).toBe('bpmd-dir');
  });

  test('inside fenced code it stays code', () => {
    const root = render('```\n<!-- dir: rtl -->\n```\n');
    expect(root.querySelector('.bpmd-dir')).toBeNull();
    expect(root.querySelector('code').textContent).toContain('<!-- dir: rtl -->');
  });
});

describe('applyBidi with pins', () => {
  test('a pinned block takes the pin over its own text and over a forced note direction', () => {
    const root = render('<!-- dir: ltr -->\nمرحبا بالعالم\n\nمرحبا مرة أخرى\n');
    applyBidi(root, { baseDir: 'rtl', forceDir: 'rtl' });
    const [first, second] = root.querySelectorAll('p');
    expect(root.querySelector('.bpmd-dir')).toBeNull(); // the placeholder is consumed
    expect(first.getAttribute('dir')).toBe('ltr');
    expect(first.hasAttribute('data-pinned')).toBe(true);
    expect(second.getAttribute('dir')).toBe('rtl');
    expect(second.hasAttribute('data-pinned')).toBe(false);
  });

  test('a pin on a list or a table covers the whole element', () => {
    const root = render('<!-- dir: rtl -->\n- one\n- two\n\n<!-- dir: rtl -->\n| a | b |\n|---|---|\n| c | d |\n');
    applyBidi(root, { baseDir: 'ltr' });
    expect(root.querySelector('ul').getAttribute('dir')).toBe('rtl');
    expect([...root.querySelectorAll('li')].map((li) => li.getAttribute('dir'))).toEqual(['rtl', 'rtl']);
    expect(root.querySelector('table').getAttribute('dir')).toBe('rtl');
    expect([...root.querySelectorAll('td')].map((td) => td.getAttribute('dir'))).toEqual(['rtl', 'rtl']);
  });

  test('a pin above code is ignored: code stays left to right', () => {
    const root = render('<!-- dir: rtl -->\n```\nx = 1\n```\n');
    applyBidi(root, { baseDir: 'ltr' });
    expect(root.querySelector('pre').hasAttribute('data-pinned')).toBe(false);
  });
});

describe('source lines', () => {
  test('every rendered top-level block knows its first line; silent tokens are skipped', () => {
    const md = '# Title\n\nPara one\nstill one\n\n<!-- dir: rtl -->\n- item\n\n[x]: https://example.com\n\n> quote\n';
    const root = render(md, { sourceLines: true });
    expect(root.querySelector('.bpmd-src')).toBeNull();
    const lines = [...root.children].filter((el) => el.hasAttribute('data-src-line'))
      .map((el) => [el.nodeName, el.getAttribute('data-src-line')]);
    expect(lines).toEqual([['H1', '0'], ['P', '2'], ['UL', '6'], ['BLOCKQUOTE', '10']]);
  });

  test('CRLF text counts the same lines', () => {
    const root = render('a\r\n\r\nb\r\n', { sourceLines: true });
    expect([...root.querySelectorAll('[data-src-line]')].map((el) => el.getAttribute('data-src-line'))).toEqual(['0', '2']);
  });

  test('without the option nothing is added', () => {
    const root = render('# Title\n', {});
    expect(root.querySelector('[data-src-line]')).toBeNull();
  });

  test('the helpers alone: placeholders before rendered tokens, attached and removed', () => {
    const tokens = withSourceLines([{ type: 'heading', raw: '# a\n' }, { type: 'space', raw: '\n' }, { type: 'paragraph', raw: 'b' }]);
    expect(tokens.filter((t) => t.type === 'srcLine').map((t) => t.line)).toEqual([0, 2]);
    expect(srcLineRenderer({ line: 4 })).toBe('<p hidden class="bpmd-src" title="4"></p>');
    const root = document.createElement('div');
    root.innerHTML = '<p hidden class="bpmd-src" title="3"></p><h2>x</h2><p hidden class="bpmd-src" title="5"></p>';
    attachSourceLines(root);
    expect(root.innerHTML).toBe('<h2 data-src-line="3">x</h2>');
    expect(dirMarkerExtension().tokenizer('no pin')).toBeUndefined();
  });
});

describe('editing the pin', () => {
  test('an unpinned block gets a pin line above it', () => {
    const text = '# A\n\nسطر\n';
    const edit = flipEdit(text, 2, 'ltr');
    expect(edit).toEqual({ from: 5, to: 5, insert: '<!-- dir: ltr -->\n', dir: 'ltr' });
  });

  test('a pinned block loses its pin line (blank lines between are allowed)', () => {
    const text = '<!-- dir: rtl -->\n\nHello\n';
    expect(flipEdit(text, 2, 'ltr')).toEqual({ from: 0, to: 18, insert: '', dir: null });
    expect(flipEdit(text, 9, 'ltr')).toBeNull();
  });

  test('the menu sets any of the three states: a pin is inserted, replaced or removed', () => {
    const text = '# A\n\nسطر\n';
    // Auto -> RTL even when the block is already right to left by its text.
    expect(pinEdit(text, 2, 'rtl')).toEqual({ from: 5, to: 5, insert: '<!-- dir: rtl -->\n', dir: 'rtl', shift: 1 });
    const pinned = '# A\n\n<!-- dir: rtl -->\nسطر\n';
    expect(pinEdit(pinned, 3, 'ltr')).toEqual({ from: 5, to: 22, insert: '<!-- dir: ltr -->', dir: 'ltr', shift: 0 });
    expect(pinEdit(pinned, 3, null)).toEqual({ from: 5, to: 23, insert: '', dir: null, shift: -1 });
  });

  test('choosing the state a block already has is no edit', () => {
    expect(pinEdit('Hello\n', 0, null)).toBeNull();
    expect(pinEdit('<!-- dir: ltr -->\n\nHello\n', 2, 'ltr')).toBeNull();
    expect(pinEdit('Hello\n', 7, 'rtl')).toBeNull();
    expect(pinEdit('Hello\n', -1, 'rtl')).toBeNull();
  });

  test('replacing a pin in a CRLF note keeps the line break', () => {
    const text = '<!-- dir: rtl -->\r\nHello\r\n';
    const edit = pinEdit(text, 1, 'ltr');
    expect(text.slice(0, edit.from) + edit.insert + text.slice(edit.to)).toBe('<!-- dir: ltr -->\r\nHello\r\n');
  });

  test('reset removes every pin line but the ones inside fenced code', () => {
    const text = '<!-- dir: rtl -->\nA\n\n~~~\n<!-- dir: ltr -->\n~~~\n\n<!-- dir: ltr -->\nB\n';
    expect(removeAllMarkers(text)).toEqual({ text: 'A\n\n~~~\n<!-- dir: ltr -->\n~~~\n\nB\n', removed: 2 });
  });

  test('the editor pins the lines of a block up to the next blank line', () => {
    expect(pinnedLines(['<!-- dir: rtl -->', 'one', 'two', '', 'three'])).toEqual(['marker', 'rtl', 'rtl', null, null]);
    expect(pinnedLines(['mid', 'block'], 'ltr')).toEqual(['ltr', 'ltr']);
  });
});
