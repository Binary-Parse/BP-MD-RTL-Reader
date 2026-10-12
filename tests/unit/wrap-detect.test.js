import { describe, it, expect } from 'vitest';
import { isWrappedInside, isWrappedOutside } from '../../src/renderer/editor/wrap-detect.js';

// Requirement (audit H2): Ctrl+I on a bold word makes it bold-italic. The single `*` that is
// half of `**` is NOT an italic marker, so the toolbar must wrap instead of unwrap. The same
// holds for `~` (sub) against `~~` (strike) and for `_`.

describe('isWrappedOutside', () => {
  const at = (v, word, left, right = left) => {
    const start = v.indexOf(word);
    return isWrappedOutside(v, start, start + word.length, left, right);
  };

  it('italic markers around the word are detected', () => {
    expect(at('a *word* b', 'word', '*')).toBe(true);
  });

  it('the two stars of a bold word are not an italic wrap', () => {
    expect(at('**word**', 'word', '*')).toBe(false);
  });

  it('bold-italic (three stars) does contain an italic wrap', () => {
    expect(at('***word***', 'word', '*')).toBe(true);
  });

  it('four stars are two bold layers, not italic', () => {
    expect(at('****word****', 'word', '*')).toBe(false);
  });

  it('one-sided markers are not a wrap', () => {
    expect(at('*word', 'word', '*')).toBe(false);
    expect(at('word*', 'word', '*')).toBe(false);
    expect(at('**word*', 'word', '*')).toBe(false);
    expect(at('*word**', 'word', '*')).toBe(false);
  });

  it('bold markers (two chars) around the word are detected, also inside bold-italic', () => {
    expect(at('**word**', 'word', '**')).toBe(true);
    expect(at('***word***', 'word', '**')).toBe(true);
    expect(at('*word*', 'word', '**')).toBe(false);
  });

  it('same rule for underscore italics', () => {
    expect(at('_word_', 'word', '_')).toBe(true);
    expect(at('__word__', 'word', '_')).toBe(false);
  });

  it('same rule for subscript against strikethrough', () => {
    expect(at('H~2~O', '2', '~')).toBe(true);
    expect(at('~~word~~', 'word', '~')).toBe(false);
    expect(at('~~word~~', 'word', '~~')).toBe(true);
  });

  it('different open and close markers are matched literally, without the parity rule', () => {
    expect(at('*word_', 'word', '*', '_')).toBe(true);
    expect(at('**word_', 'word', '*', '_')).toBe(true);
  });

  it('a missing opening marker is not a wrap even when the closing one is there', () => {
    expect(at('xword*', 'word', '*')).toBe(false);
    expect(at('xword**', 'word', '**')).toBe(false);
  });

  it('asymmetric tags are matched literally', () => {
    expect(at('<u>word</u>', 'word', '<u>', '</u>')).toBe(true);
    expect(at('<u>word', 'word', '<u>', '</u>')).toBe(false);
  });

  it('a word at the very start or end of the text is not a wrap', () => {
    expect(isWrappedOutside('word*', 0, 4, '*', '*')).toBe(false);
    expect(isWrappedOutside('*word', 1, 5, '*', '*')).toBe(false);
  });

  it('a wrap needs room before the word: no negative-index slicing', () => {
    // start=1 with a 2-char marker would otherwise slice(-1, 1) from the END of the string.
    expect(isWrappedOutside('xword**', 1, 5, '**', '**')).toBe(false);
  });
});

describe('isWrappedInside', () => {
  it('a selection that starts and ends with italic markers is wrapped', () => {
    expect(isWrappedInside('*word*', '*', '*')).toBe(true);
  });

  it('a bold selection is not an italic wrap', () => {
    expect(isWrappedInside('**word**', '*', '*')).toBe(false);
  });

  it('a bold-italic selection is an italic wrap', () => {
    expect(isWrappedInside('***word***', '*', '*')).toBe(true);
  });

  it('bold markers are detected in bold and bold-italic selections', () => {
    expect(isWrappedInside('**word**', '**', '**')).toBe(true);
    expect(isWrappedInside('***word***', '**', '**')).toBe(true);
  });

  it('plain text and one-sided markers are not wrapped', () => {
    expect(isWrappedInside('word', '*', '*')).toBe(false);
    expect(isWrappedInside('*word', '*', '*')).toBe(false);
    expect(isWrappedInside('word*', '*', '*')).toBe(false);
  });

  it('the markers must not overlap: a lone marker is not a wrap', () => {
    expect(isWrappedInside('*', '*', '*')).toBe(false);
    expect(isWrappedInside('**', '**', '**')).toBe(false);
  });

  it('asymmetric tags', () => {
    expect(isWrappedInside('<u>x</u>', '<u>', '</u>')).toBe(true);
    expect(isWrappedInside('<u></u>', '<u>', '</u>')).toBe(true); // empty content, markers touch
    expect(isWrappedInside('<u>xxxxxx', '<u>', '</u>')).toBe(false);
    expect(isWrappedInside('xxxxxx</u>', '<u>', '</u>')).toBe(false);
  });

  it('a selection with only one bold marker is not wrapped', () => {
    expect(isWrappedInside('**word', '**', '**')).toBe(false);
    expect(isWrappedInside('word**', '**', '**')).toBe(false);
  });

  it('the opening and the closing star run must both be odd', () => {
    expect(isWrappedInside('*word**', '*', '*')).toBe(false);
    expect(isWrappedInside('**word*', '*', '*')).toBe(false);
  });

  it('underscore and tilde follow the same parity rule', () => {
    expect(isWrappedInside('_a_', '_', '_')).toBe(true);
    expect(isWrappedInside('__a__', '_', '_')).toBe(false);
    expect(isWrappedInside('~a~', '~', '~')).toBe(true);
    expect(isWrappedInside('~~a~~', '~', '~')).toBe(false);
  });
});
