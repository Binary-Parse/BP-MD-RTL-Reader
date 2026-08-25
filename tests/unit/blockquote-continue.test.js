/**
 * blockquote-continue.test.js — the PURE Obsidian-style list/blockquote continuation logic
 * (listContinuation) used by the CM6 Enter keymap (T-F13). Tests the helper WITHOUT a real
 * editor: given a line, decide whether/what marker continues, and whether an empty item exits.
 */
import { describe, test, expect } from 'vitest';
import { listContinuation } from '../../src/renderer/editor/list-continuation.js';

describe('[T-F13] listContinuation — pure continuation logic', () => {
  test('plain prose lines do not continue', () => {
    expect(listContinuation('just some text')).toBe(null);
    expect(listContinuation('')).toBe(null);
    expect(listContinuation('# a heading')).toBe(null);
    expect(listContinuation('-no space after dash')).toBe(null);
  });

  test('non-string / nullish input is coerced and does not continue (no throw)', () => {
    expect(listContinuation(null)).toBe(null);
    expect(listContinuation(undefined)).toBe(null);
    expect(listContinuation(123)).toBe(null);     // String(123) = "123" → not a marker
    expect(listContinuation('- 7')).toEqual({ empty: false, prefix: '- ' }); // a numeric-looking bullet still continues
  });

  describe('blockquotes', () => {
    test('continues a non-empty quote', () => {
      expect(listContinuation('> quoted text')).toEqual({ empty: false, prefix: '> ' });
    });
    test('continues nested quotes', () => {
      expect(listContinuation('> > deep quote')).toEqual({ empty: false, prefix: '> > ' });
    });
    test('exits on an empty quote', () => {
      expect(listContinuation('> ')).toEqual({ empty: true, marker: '> ' });
      expect(listContinuation('> > ')).toEqual({ empty: true, marker: '> > ' });
    });
  });

  describe('unordered bullets', () => {
    test('continues "- "', () => {
      expect(listContinuation('- item')).toEqual({ empty: false, prefix: '- ' });
    });
    test('continues "* "', () => {
      expect(listContinuation('* item')).toEqual({ empty: false, prefix: '* ' });
    });
    test('continues "+ "', () => {
      expect(listContinuation('+ item')).toEqual({ empty: false, prefix: '+ ' });
    });
    test('exits on an empty bullet', () => {
      expect(listContinuation('- ')).toEqual({ empty: true, marker: '- ' });
      expect(listContinuation('* ')).toEqual({ empty: true, marker: '* ' });
      expect(listContinuation('+ ')).toEqual({ empty: true, marker: '+ ' });
    });
    test('preserves indentation', () => {
      expect(listContinuation('    - nested')).toEqual({ empty: false, prefix: '    - ' });
      expect(listContinuation('\t- tabbed')).toEqual({ empty: false, prefix: '\t- ' });
    });
  });

  describe('ordered lists', () => {
    test('increments "1. " → "2. "', () => {
      expect(listContinuation('1. first')).toEqual({ empty: false, prefix: '2. ' });
    });
    test('increments "9. " → "10. "', () => {
      expect(listContinuation('9. ninth')).toEqual({ empty: false, prefix: '10. ' });
    });
    test('supports the ")" delimiter', () => {
      expect(listContinuation('3) third')).toEqual({ empty: false, prefix: '4) ' });
    });
    test('exits on an empty ordered item', () => {
      expect(listContinuation('1. ')).toEqual({ empty: true, marker: '1. ' });
      expect(listContinuation('5) ')).toEqual({ empty: true, marker: '5) ' });
    });
  });

  describe('task list items', () => {
    test('continues an unchecked task with a fresh unchecked box', () => {
      expect(listContinuation('- [ ] todo')).toEqual({ empty: false, prefix: '- [ ] ' });
    });
    test('continues a CHECKED task with a fresh UNCHECKED box', () => {
      expect(listContinuation('- [x] done')).toEqual({ empty: false, prefix: '- [ ] ' });
    });
    test('exits on an empty task item', () => {
      expect(listContinuation('- [ ] ')).toEqual({ empty: true, marker: '- [ ] ' });
      expect(listContinuation('- [x] ')).toEqual({ empty: true, marker: '- [x] ' });
    });
    test('preserves indentation on tasks', () => {
      expect(listContinuation('  - [ ] sub')).toEqual({ empty: false, prefix: '  - [ ] ' });
    });
  });
});
