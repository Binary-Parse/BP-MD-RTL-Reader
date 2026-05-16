// Unit tests for Proxy-based State management
// These tests use Node.js built-in assert since we have no test runner for unit tests
// Run via: node tests/unit/state.test.js

'use strict';

const assert = require('assert');

// ============================================================
// Minimal State implementation to test in isolation
// ============================================================
function createStore(initial) {
  const listeners = new Set();
  const store = new Proxy({ ...initial }, {
    set(target, key, value) {
      target[key] = value;
      listeners.forEach(fn => fn(key, value, target));
      return true;
    }
  });
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  return { store, subscribe };
}

// ============================================================
// Test: subscriber fires when State.theme is mutated
// ============================================================
{
  const { store, subscribe } = createStore({ theme: 'paper', direction: 'ltr' });
  const calls = [];
  subscribe((key, val) => calls.push({ key, val }));

  store.theme = 'ink';
  assert.strictEqual(calls.length, 1, 'subscriber should fire once');
  assert.strictEqual(calls[0].key, 'theme', 'key should be "theme"');
  assert.strictEqual(calls[0].val, 'ink', 'value should be "ink"');
  console.log('PASS: subscriber fires when State.theme mutated');
}

// ============================================================
// Test: subscribe returns unsubscribe function
// ============================================================
{
  const { store, subscribe } = createStore({ theme: 'paper' });
  const calls = [];
  const unsub = subscribe((key, val) => calls.push(val));

  store.theme = 'ink';
  assert.strictEqual(calls.length, 1, 'fires before unsub');

  unsub();
  store.theme = 'sepia';
  assert.strictEqual(calls.length, 1, 'should not fire after unsubscribe');
  console.log('PASS: unsubscribe function works');
}

// ============================================================
// Test: multiple subscribers all receive notification
// ============================================================
{
  const { store, subscribe } = createStore({ count: 0 });
  const results = [];
  subscribe(() => results.push('A'));
  subscribe(() => results.push('B'));
  subscribe(() => results.push('C'));

  store.count = 1;
  assert.deepStrictEqual(results, ['A', 'B', 'C'], 'all subscribers receive notification');
  console.log('PASS: multiple subscribers all notified');
}

// ============================================================
// Test: cycleTheme logic
// ============================================================
{
  const THEMES = ['paper', 'ink', 'sepia'];
  function cycleThemeLogic(currentTheme) {
    const i = THEMES.indexOf(currentTheme);
    return THEMES[(i + 1) % THEMES.length];
  }

  assert.strictEqual(cycleThemeLogic('paper'), 'ink', 'paper -> ink');
  assert.strictEqual(cycleThemeLogic('ink'), 'sepia', 'ink -> sepia');
  assert.strictEqual(cycleThemeLogic('sepia'), 'paper', 'sepia -> paper (wraps)');
  console.log('PASS: cycleTheme cycles through 3 themes correctly');
}

// ============================================================
// Test: State retains value after mutation
// ============================================================
{
  const { store } = createStore({ files: [], activeFile: null });
  store.activeFile = 2;
  assert.strictEqual(store.activeFile, 2, 'mutated value retained in state');
  console.log('PASS: state retains mutated value');
}

// ============================================================
// Test: direction toggle logic
// ============================================================
{
  function toggleDirectionLogic(current) {
    return current === 'rtl' ? 'ltr' : 'rtl';
  }
  assert.strictEqual(toggleDirectionLogic('ltr'), 'rtl', 'ltr -> rtl');
  assert.strictEqual(toggleDirectionLogic('rtl'), 'ltr', 'rtl -> ltr');
  console.log('PASS: direction toggle logic correct');
}

// ============================================================
// Test: State.zoomFactor — mutation and subscriber notification
// ============================================================
{
  const { store, subscribe } = createStore({ zoomFactor: 1 });
  const calls = [];
  subscribe((key, val) => calls.push({ key, val }));

  store.zoomFactor = 1.5;
  assert.strictEqual(calls.length, 1, 'subscriber fires once for zoomFactor change');
  assert.strictEqual(calls[0].key, 'zoomFactor', 'key is "zoomFactor"');
  assert.strictEqual(calls[0].val, 1.5, 'value is 1.5');
  assert.strictEqual(store.zoomFactor, 1.5, 'value retained in state');
  console.log('PASS: State.zoomFactor mutation fires subscriber and retains value');
}

// ============================================================
// Test: setZoom clamp logic
// ============================================================
{
  function clampZoom(factor) {
    return Math.min(2.0, Math.max(0.6, factor));
  }
  assert.strictEqual(clampZoom(0.1), 0.6,  'clamp below min returns 0.6');
  assert.strictEqual(clampZoom(5.0), 2.0,  'clamp above max returns 2.0');
  assert.strictEqual(clampZoom(1.0), 1.0,  'value in range returned as-is');
  assert.strictEqual(clampZoom(1.5), 1.5,  'value in range returned as-is');
  console.log('PASS: setZoom clamp logic [0.6, 2.0] correct');
}

console.log('\nAll state unit tests passed.');
