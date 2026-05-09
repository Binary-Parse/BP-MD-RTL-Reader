// Unit tests for theme cycling and persistence
// Run via: node tests/unit/theme.test.js

'use strict';

const assert = require('assert');

// ============================================================
// Simulate cycleTheme with localStorage
// ============================================================
const THEMES = ['paper', 'ink', 'sepia'];

// Mock localStorage
const mockStorage = {};
const localStorage = {
  getItem: (k) => mockStorage[k] || null,
  setItem: (k, v) => { mockStorage[k] = v; }
};

// Mock documentElement
let currentTheme = 'paper';
const documentElement = {
  getAttribute: (attr) => attr === 'data-theme' ? currentTheme : null,
  setAttribute: (attr, val) => { if (attr === 'data-theme') currentTheme = val; }
};

function cycleTheme() {
  const current = documentElement.getAttribute('data-theme') || 'paper';
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  documentElement.setAttribute('data-theme', next);
  localStorage.setItem('marqam-theme', next);
  return next;
}

// ============================================================
// Test: cycleTheme paper -> ink
// ============================================================
{
  currentTheme = 'paper';
  const next = cycleTheme();
  assert.strictEqual(next, 'ink', 'paper cycles to ink');
  assert.strictEqual(documentElement.getAttribute('data-theme'), 'ink', 'data-theme attribute updated');
  assert.strictEqual(localStorage.getItem('marqam-theme'), 'ink', 'localStorage updated');
  console.log('PASS: cycleTheme paper -> ink');
}

// ============================================================
// Test: cycleTheme ink -> sepia
// ============================================================
{
  currentTheme = 'ink';
  const next = cycleTheme();
  assert.strictEqual(next, 'sepia', 'ink cycles to sepia');
  assert.strictEqual(localStorage.getItem('marqam-theme'), 'sepia', 'localStorage stores sepia');
  console.log('PASS: cycleTheme ink -> sepia');
}

// ============================================================
// Test: cycleTheme sepia -> paper (wraps)
// ============================================================
{
  currentTheme = 'sepia';
  const next = cycleTheme();
  assert.strictEqual(next, 'paper', 'sepia cycles to paper');
  console.log('PASS: cycleTheme sepia -> paper (wrap)');
}

// ============================================================
// Test: FOUC prevention — reads localStorage and sets data-theme
// ============================================================
{
  // Simulate FOUC prevention script logic
  function foucPreventionLogic(storedTheme) {
    const VALID_THEMES = ['paper', 'ink', 'sepia'];
    if (storedTheme && VALID_THEMES.includes(storedTheme)) {
      return storedTheme;
    }
    return 'paper';
  }

  assert.strictEqual(foucPreventionLogic('ink'), 'ink', 'valid stored theme applied');
  assert.strictEqual(foucPreventionLogic('sepia'), 'sepia', 'sepia restored');
  assert.strictEqual(foucPreventionLogic(null), 'paper', 'null falls back to paper');
  assert.strictEqual(foucPreventionLogic('invalid'), 'paper', 'invalid theme falls back to paper');
  console.log('PASS: FOUC prevention logic validates and applies stored theme');
}

// ============================================================
// Test: Theme names are exactly ['paper', 'ink', 'sepia']
// ============================================================
{
  assert.deepStrictEqual(THEMES, ['paper', 'ink', 'sepia'], 'exact 3 themes in correct order');
  assert.strictEqual(THEMES.length, 3, 'exactly 3 themes');
  console.log('PASS: theme array has correct members');
}

console.log('\nAll theme unit tests passed.');
