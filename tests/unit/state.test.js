/**
 * Unit tests for Proxy-based State management
 */

import { describe, test, expect } from 'vitest';
import { createState } from '../../src/renderer/state.js';

function toggleDirectionLogic(current) {
  return current === 'rtl' ? 'ltr' : 'rtl';
}

describe('Proxy State store', () => {
  test('subscriber fires when State.theme is mutated', () => {
    const { state, subscribe } = createState({ theme: 'paper', direction: 'ltr' });
    const calls = [];
    subscribe((key, val) => calls.push({ key, val }));
    state.theme = 'ink';
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ key: 'theme', val: 'ink' });
  });

  test('subscribe returns unsubscribe function', () => {
    const { state, subscribe } = createState({ theme: 'paper' });
    const calls = [];
    const unsub = subscribe((key, val) => calls.push(val));
    state.theme = 'ink';
    expect(calls).toHaveLength(1);
    unsub();
    state.theme = 'sepia';
    expect(calls).toHaveLength(1);
  });

  test('multiple subscribers all receive notification', () => {
    const { state, subscribe } = createState({ count: 0 });
    const results = [];
    subscribe(() => results.push('A'));
    subscribe(() => results.push('B'));
    subscribe(() => results.push('C'));
    state.count = 1;
    expect(results).toEqual(['A', 'B', 'C']);
  });

  test('state retains mutated value', () => {
    const { state } = createState({ files: [], activeFile: null });
    state.activeFile = 2;
    expect(state.activeFile).toBe(2);
  });

  test('subscriber fires for zoomFactor change', () => {
    const { state, subscribe } = createState({ zoomFactor: 1 });
    const calls = [];
    subscribe((key, val) => calls.push({ key, val }));
    state.zoomFactor = 1.5;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ key: 'zoomFactor', val: 1.5 });
    expect(state.zoomFactor).toBe(1.5);
  });
});

describe('direction toggle logic', () => {
  test('toggles ltr -> rtl and back', () => {
    expect(toggleDirectionLogic('ltr')).toBe('rtl');
    expect(toggleDirectionLogic('rtl')).toBe('ltr');
  });
});
