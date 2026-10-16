/**
 * navigation.test.js — T-B11 pure navigation policy.
 * Mutation-strengthening: pins exact action per scheme + the exact-match rule.
 */
import { describe, test, expect } from 'vitest';
import { classifyNavigation, isExternallyOpenable } from '../../src/main/navigation.js';

const APP = 'file:///home/app/index.html';

describe('classifyNavigation', () => {
  test('https → external', () => {
    expect(classifyNavigation('https://example.com', APP)).toEqual({ action: 'external' });
  });
  test('http → external', () => {
    expect(classifyNavigation('http://example.com/p', APP)).toEqual({ action: 'external' });
  });
  test('mailto / tel → external', () => {
    expect(classifyNavigation('mailto:a@b.com', APP)).toEqual({ action: 'external' });
    expect(classifyNavigation('tel:+15551234', APP)).toEqual({ action: 'external' });
  });
  // B5: a link in a note that resolves to the app's own page must not reload
  // the renderer (unsaved work would be lost). Nothing is ever allowed.
  test('the app URL itself → block (B5)', () => {
    expect(classifyNavigation(APP, APP)).toEqual({ action: 'block' });
    expect(classifyNavigation(APP)).toEqual({ action: 'block' });
  });
  test('no input is ever classified as allow (B5)', () => {
    for (const u of [APP, APP + '#frag', APP + '?x=1', 'https://example.com', 'file:///etc/passwd', '', undefined]) {
      expect(classifyNavigation(u, APP).action).not.toBe('allow');
    }
  });
  test('file:// elsewhere → block', () => {
    expect(classifyNavigation('file:///etc/passwd', APP)).toEqual({ action: 'block' });
  });
  test('substring trap is NOT allowed (EC-B6 exact match)', () => {
    expect(classifyNavigation('file:///home/app/index.html.evil/x', APP)).toEqual({ action: 'block' });
    expect(classifyNavigation(APP + '#frag', APP)).toEqual({ action: 'block' });
  });
  test('javascript:/data:/blob:/custom → block (EC-B5)', () => {
    for (const u of ['javascript:alert(1)', 'data:text/html,x', 'blob:abc', 'obsidian://open']) {
      expect(classifyNavigation(u, APP)).toEqual({ action: 'block' });
    }
  });
  test('non-string / empty → block', () => {
    expect(classifyNavigation(undefined, APP)).toEqual({ action: 'block' });
    expect(classifyNavigation('', APP)).toEqual({ action: 'block' });
  });
});

describe('isExternallyOpenable', () => {
  test('true for http(s)/mailto/tel only', () => {
    for (const u of ['https://x', 'http://x', 'mailto:a@b', 'tel:+1']) {
      expect(isExternallyOpenable(u)).toBe(true);
    }
  });
  test('false for non-http schemes and non-strings', () => {
    for (const u of ['javascript:x', 'data:x', 'blob:x', 'file:///x', 'foo://x', null, 42]) {
      expect(isExternallyOpenable(u)).toBe(false);
    }
  });
});

// ── Mutation-hardening (audit F-3): every guard clause + scheme anchoring. ──
describe('classifyNavigation — guard clauses (mutation kills)', () => {
  const APP = 'file:///app/index.html';
  test('non-string OR empty url → block (both clauses of the OR)', () => {
    expect(classifyNavigation(42, APP)).toEqual({ action: 'block' });
    expect(classifyNavigation(null, APP)).toEqual({ action: 'block' });
    expect(classifyNavigation('', APP)).toEqual({ action: 'block' });
    expect(classifyNavigation({ toString: () => 'https://example.com' }, APP)).toEqual({ action: 'block' });
  });
  test('the app URL is blocked whatever the second argument is (B5)', () => {
    expect(classifyNavigation(APP, APP)).toEqual({ action: 'block' });
    expect(classifyNavigation(APP + '#x', APP)).toEqual({ action: 'block' });
    expect(classifyNavigation(APP, '')).toEqual({ action: 'block' });
    expect(classifyNavigation('https://x', '')).toEqual({ action: 'external' });
    expect(classifyNavigation('https://x', 42)).toEqual({ action: 'external' });
  });
  test('external schemes route external; everything else blocks', () => {
    for (const u of ['https://x', 'http://x', 'mailto:a@b', 'tel:+1']) expect(classifyNavigation(u, APP)).toEqual({ action: 'external' });
    for (const u of ['file:///other', 'data:x', 'javascript:x', 'blob:x', 'custom:x']) expect(classifyNavigation(u, APP)).toEqual({ action: 'block' });
  });
  test('scheme must be ANCHORED at the start (^) — embedded scheme blocks', () => {
    expect(classifyNavigation('xhttps://evil', APP)).toEqual({ action: 'block' });
    expect(classifyNavigation('  https://x', APP)).toEqual({ action: 'block' });
  });
});
describe('isExternallyOpenable — guard + anchoring', () => {
  test('non-string → false (typeof guard)', () => {
    expect(isExternallyOpenable(42)).toBe(false);
    expect(isExternallyOpenable(null)).toBe(false);
    expect(isExternallyOpenable(undefined)).toBe(false);
    expect(isExternallyOpenable({ toString: () => 'https://example.com' })).toBe(false);
  });
  test('only anchored http(s)/mailto/tel → true', () => {
    expect(isExternallyOpenable('https://x')).toBe(true);
    expect(isExternallyOpenable('mailto:a@b')).toBe(true);
    expect(isExternallyOpenable('xhttps://x')).toBe(false); // anchoring
    expect(isExternallyOpenable('javascript:x')).toBe(false);
  });
});
