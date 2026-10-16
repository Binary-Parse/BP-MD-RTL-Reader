import { describe, it, expect } from 'vitest';
import { createHistoryStore, historyKeyOf } from '../../src/renderer/editor/history-store.js';

// A stand-in for a CodeMirror EditorState: the store only needs the document text.
const st = (text, tag = text) => ({ text, tag });
const textOf = (s) => s.text;

describe('history-store (audit B1: one undo history per file)', () => {
  it('hands back the parked state for a key when the file text is unchanged, and no longer holds it', () => {
    const store = createHistoryStore(textOf);
    const a = st('AAA more');
    store.put('a', a);
    expect(store.size()).toBe(1);
    expect(store.take('a', 'AAA more')).toBe(a);
    expect(store.size()).toBe(0); // it is live in the editor now, not parked
    expect(store.take('a', 'AAA more')).toBeNull();
  });

  it('returns null for a key that was never parked', () => {
    const store = createHistoryStore(textOf);
    expect(store.take('nope', 'x')).toBeNull();
  });

  it('keeps each key separate', () => {
    const store = createHistoryStore(textOf);
    const a = st('AAA');
    const b = st('BBB');
    store.put('a', a);
    store.put('b', b);
    expect(store.take('b', 'BBB')).toBe(b);
    expect(store.take('a', 'AAA')).toBe(a);
  });

  it('drops a parked state whose text no longer matches the file (content replaced from disk)', () => {
    const store = createHistoryStore(textOf);
    store.put('a', st('AAA more'));
    expect(store.take('a', 'DISK')).toBeNull();
    expect(store.size()).toBe(0);
    // the stale history must not come back later, even if the old text returns
    expect(store.take('a', 'AAA more')).toBeNull();
  });

  it('treats whitespace and case differences as a different text', () => {
    const store = createHistoryStore(textOf);
    store.put('a', st('AAA'));
    expect(store.take('a', 'AAA ')).toBeNull();
    store.put('a', st('AAA'));
    expect(store.take('a', 'aaa')).toBeNull();
  });

  it('accepts an empty document', () => {
    const store = createHistoryStore(textOf);
    const e = st('');
    store.put('e', e);
    expect(store.take('e', '')).toBe(e);
  });

  it('a second put for the same key replaces the first', () => {
    const store = createHistoryStore(textOf);
    const first = st('v1');
    const second = st('v2');
    store.put('a', first);
    store.put('a', second);
    expect(store.size()).toBe(1);
    expect(store.take('a', 'v2')).toBe(second);
  });

  it('ignores a missing key (a file with no identity gets no history)', () => {
    const store = createHistoryStore(textOf);
    store.put(null, st('x'));
    store.put(undefined, st('x'));
    expect(store.size()).toBe(0);
    expect(store.take(null, 'x')).toBeNull();
    expect(store.take(undefined, 'x')).toBeNull();
  });

  it('accepts the number 0 as a key', () => {
    const store = createHistoryStore(textOf);
    const z = st('z');
    store.put(0, z);
    expect(store.size()).toBe(1);
    expect(store.take(0, 'z')).toBe(z);
  });

  it('release frees only that key and tolerates an unknown key', () => {
    const store = createHistoryStore(textOf);
    store.put('a', st('A'));
    store.put('b', st('B'));
    store.release('a');
    expect(store.size()).toBe(1);
    expect(store.take('a', 'A')).toBeNull();
    store.release('missing');
    expect(store.size()).toBe(1);
    expect(store.take('b', 'B')).not.toBeNull();
  });

  it('retain keeps exactly the listed keys', () => {
    const store = createHistoryStore(textOf);
    store.put('a', st('A'));
    store.put('b', st('B'));
    store.put('c', st('C'));
    store.retain(['a', 'c']);
    expect(store.size()).toBe(2);
    expect(store.take('b', 'B')).toBeNull();
    expect(store.take('a', 'A')).not.toBeNull();
    expect(store.take('c', 'C')).not.toBeNull();
  });

  it('QA-N2: a reload with exactly the parked text keeps that history (nothing was replaced)', () => {
    const store = createHistoryStore(textOf);
    const edited = st('same text', 'with undo steps');
    store.put('a', edited);
    expect(store.take('a', 'same text')).toBe(edited);
  });

  it('retain accepts a Set and an empty list frees everything', () => {
    const store = createHistoryStore(textOf);
    store.put('a', st('A'));
    store.put('b', st('B'));
    store.retain(new Set(['b']));
    expect(store.size()).toBe(1);
    store.retain([]);
    expect(store.size()).toBe(0);
  });
});

describe('historyKeyOf (audit B1: a stable identity per open file)', () => {
  it('gives the same key for the same file every time', () => {
    const f = { name: 'a.md' };
    const k = historyKeyOf(f);
    expect(k).not.toBeNull();
    expect(historyKeyOf(f)).toBe(k);
  });

  it('gives different files different keys', () => {
    const keys = new Set([{}, {}, {}, {}].map(historyKeyOf));
    expect(keys.size).toBe(4);
  });

  it('survives the shallow copy the vault merge makes of a file object', () => {
    const f = { name: 'a.md', content: 'x' };
    const k = historyKeyOf(f);
    const merged = { ...f, conflict: true };
    expect(historyKeyOf(merged)).toBe(k);
  });

  it('has no key for no file', () => {
    expect(historyKeyOf(null)).toBeNull();
    expect(historyKeyOf(undefined)).toBeNull();
  });

  it('never returns a falsy key for a real file', () => {
    expect(historyKeyOf({})).toBeGreaterThan(0);
  });
});
