/**
 * editor-port.test.js — T-AI3 ports & adapters + caret stepping.
 */
import { describe, test, expect, vi } from 'vitest';
import { isEditorPort, createTextareaAdapter } from '../../src/renderer/editor/editor-port.js';
import { stepCaret } from '../../src/renderer/bidi.js';

function fakeTextarea(value = '') {
  return { value, selectionStart: value.length, selectionEnd: value.length };
}

describe('isEditorPort', () => {
  test('true for a conforming adapter, false otherwise', () => {
    expect(isEditorPort(createTextareaAdapter(fakeTextarea()))).toBe(true);
    expect(isEditorPort({})).toBe(false);
    expect(isEditorPort(null)).toBe(false);
  });
});

describe('TextareaAdapter', () => {
  test('load / getValue', () => {
    const el = fakeTextarea();
    const ed = createTextareaAdapter(el);
    ed.load('hello');
    expect(ed.getValue()).toBe('hello');
  });
  test('selection get/set + replaceSelection', () => {
    const el = fakeTextarea('abcdef');
    const ed = createTextareaAdapter(el);
    ed.setSelection({ start: 1, end: 3 });
    expect(ed.getSelection()).toEqual({ start: 1, end: 3 });
    ed.replaceSelection('X');
    expect(ed.getValue()).toBe('aXdef');
    expect(ed.getSelection()).toEqual({ start: 2, end: 2 });
  });
  test('onChange fires + unsubscribe', () => {
    const ed = createTextareaAdapter(fakeTextarea('hi'));
    const cb = vi.fn();
    const off = ed.onChange(cb);
    ed.load('x');
    expect(cb).toHaveBeenCalledWith('x');
    off();
    ed.load('y');
    expect(cb).toHaveBeenCalledTimes(1);
  });
  test('find returns match ranges, case-insensitive by default (EC-C4)', () => {
    const ed = createTextareaAdapter(fakeTextarea('Foo foo FOO'));
    expect(ed.find('foo')).toEqual([{ start: 0, end: 3 }, { start: 4, end: 7 }, { start: 8, end: 11 }]);
    expect(ed.find('foo', { caseSensitive: true })).toEqual([{ start: 4, end: 7 }]);
  });
});

describe('stepCaret (EC-C2/C3)', () => {
  test('skips Arabic combining marks (base+harakat as one cluster)', () => {
    const text = 'اَب'; // alef + fatha + beh
    expect(stepCaret(text, 0, 1)).toBe(2);  // over the cluster, not into the mark
    expect(stepCaret(text, 2, -1)).toBe(0);
  });
  test('plain LTR steps by one and clamps', () => {
    expect(stepCaret('abc', 0, 1)).toBe(1);
    expect(stepCaret('abc', 0, -1)).toBe(0);
    expect(stepCaret('abc', 3, 1)).toBe(3);
  });
});
