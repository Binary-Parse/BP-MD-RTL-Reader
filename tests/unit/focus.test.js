/**
 * @vitest-environment jsdom
 *
 * focus.test.js — T-F4/F5 keyboard focus helpers. Pure/DOM-light functions that
 * decide WHAT to focus; the renderer does the focusing. jsdom-tested (no layout,
 * so visibility is filtered by attributes only — real visibility is e2e-covered).
 */
import { describe, test, expect } from 'vitest';
import { getFocusable, trapTab, rovingNext } from '../../src/renderer/components/focus.js';

function frag(html) { const d = document.createElement('div'); d.innerHTML = html; return d; }

describe('getFocusable (T-F4)', () => {
  test('returns natively/explicitly focusable elements in DOM order', () => {
    const root = frag(`
      <a href="#one">a</a>
      <button>b</button>
      <input>
      <select></select>
      <textarea></textarea>
      <div tabindex="0">d</div>
      <span>not focusable</span>
    `);
    const got = getFocusable(root).map(el => el.tagName.toLowerCase());
    expect(got).toEqual(['a', 'button', 'input', 'select', 'textarea', 'div']);
  });

  test('skips disabled, aria-hidden, hidden, and tabindex="-1"', () => {
    const root = frag(`
      <button id="ok">ok</button>
      <button disabled>nope</button>
      <button aria-hidden="true">nope</button>
      <button hidden>nope</button>
      <div tabindex="-1">nope</div>
      <input style="display:none">
    `);
    const ids = getFocusable(root).map(el => el.id || el.tagName.toLowerCase());
    expect(ids).toEqual(['ok']);
  });

  test('skips elements inside a hidden ancestor', () => {
    const root = frag(`<div hidden><button>buried</button></div><button id="visible">v</button>`);
    expect(getFocusable(root).map(el => el.id)).toEqual(['visible']);
  });

  test('skips elements inside a display:none ancestor (walks the chain, not just the leaf)', () => {
    const root = frag(`<div style="display:none"><span><button>buried</button></span></div><button id="visible">v</button>`);
    expect(getFocusable(root).map(el => el.id)).toEqual(['visible']);
  });

  test('skips elements inside an aria-hidden="true" ancestor (inherited, matches hidden/display)', () => {
    const root = frag(`<div aria-hidden="true"><button>buried</button></div><button id="visible">v</button>`);
    expect(getFocusable(root).map(el => el.id)).toEqual(['visible']);
  });

  test('a[href] without href is not focusable; with href is', () => {
    const root = frag(`<a>no href</a><a href="x">yes</a>`);
    expect(getFocusable(root).length).toBe(1);
  });

  test('null / non-element container → []', () => {
    expect(getFocusable(null)).toEqual([]);
    expect(getFocusable({})).toEqual([]);
  });
});

describe('trapTab (T-F4)', () => {
  const make = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));

  test('forward at last element wraps to first', () => {
    const f = make(3);
    expect(trapTab(f, f[2], false)).toBe(f[0]);
  });

  test('backward at first element wraps to last', () => {
    const f = make(3);
    expect(trapTab(f, f[0], true)).toBe(f[2]);
  });

  test('interior forward/backward returns null (browser handles the move)', () => {
    const f = make(3);
    expect(trapTab(f, f[1], false)).toBeNull();
    expect(trapTab(f, f[1], true)).toBeNull();
    expect(trapTab(f, f[0], false)).toBeNull(); // forward from first is interior
    expect(trapTab(f, f[2], true)).toBeNull();  // backward from last is interior
  });

  test('focus escaped outside the trap is pulled back to the first element', () => {
    const f = make(3);
    expect(trapTab(f, { id: 'stranger' }, false)).toBe(f[0]);
    expect(trapTab(f, { id: 'stranger' }, true)).toBe(f[0]);
  });

  test('single focusable: any Tab wraps to itself', () => {
    const f = make(1);
    expect(trapTab(f, f[0], false)).toBe(f[0]);
    expect(trapTab(f, f[0], true)).toBe(f[0]);
  });

  test('empty list → null', () => {
    expect(trapTab([], null, false)).toBeNull();
    expect(trapTab(null, null, false)).toBeNull();
  });
});

describe('rovingNext (T-F5)', () => {
  test('ArrowDown advances and wraps by default', () => {
    expect(rovingNext('ArrowDown', 0, 3)).toBe(1);
    expect(rovingNext('ArrowDown', 2, 3)).toBe(0);
  });

  test('ArrowUp retreats and wraps by default', () => {
    expect(rovingNext('ArrowUp', 1, 3)).toBe(0);
    expect(rovingNext('ArrowUp', 0, 3)).toBe(2);
  });

  test('loop:false clamps at the ends instead of wrapping', () => {
    expect(rovingNext('ArrowDown', 2, 3, { loop: false })).toBe(2);
    expect(rovingNext('ArrowUp', 0, 3, { loop: false })).toBe(0);
  });

  test('no current selection (-1): ArrowDown→first, ArrowUp→last', () => {
    expect(rovingNext('ArrowDown', -1, 3)).toBe(0);
    expect(rovingNext('ArrowUp', -1, 3)).toBe(2);
  });

  test('Home→0, End→last', () => {
    expect(rovingNext('Home', 2, 3)).toBe(0);
    expect(rovingNext('End', 0, 3)).toBe(2);
  });

  test('single-item list: Arrow keys stay on index 0 (no wrap surprises)', () => {
    expect(rovingNext('ArrowDown', 0, 1)).toBe(0);
    expect(rovingNext('ArrowUp', 0, 1)).toBe(0);
    expect(rovingNext('Home', 0, 1)).toBe(0);
    expect(rovingNext('End', 0, 1)).toBe(0);
  });

  test('no current selection (-1) with loop:false still lands on an end', () => {
    expect(rovingNext('ArrowDown', -1, 3, { loop: false })).toBe(0);
    expect(rovingNext('ArrowUp', -1, 3, { loop: false })).toBe(2);
  });

  test('stale/out-of-range current still yields an in-range index', () => {
    const n = rovingNext('ArrowDown', 9, 3); // menu shrank under a stale index
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(3);
  });

  test('non-navigation key → -1', () => {
    expect(rovingNext('Enter', 0, 3)).toBe(-1);
    expect(rovingNext('a', 0, 3)).toBe(-1);
  });

  test('empty list → -1 for every key', () => {
    for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(rovingNext(k, 0, 0)).toBe(-1);
    }
  });
});
