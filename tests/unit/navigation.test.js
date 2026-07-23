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
  test('exact app URL → allow', () => {
    expect(classifyNavigation(APP, APP)).toEqual({ action: 'allow' });
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
import { classifyNavigation as _cn, isExternallyOpenable as _ico } from '../../src/main/navigation.js';
describe('classifyNavigation — guard clauses (mutation kills)', () => {
  const APP = 'file:///app/index.html';
  test('non-string OR empty url → block (both clauses of the OR)', () => {
    expect(_cn(42, APP)).toEqual({ action: 'block' });
    expect(_cn(null, APP)).toEqual({ action: 'block' });
    expect(_cn('', APP)).toEqual({ action: 'block' });
    expect(_cn({ toString: () => 'https://example.com' }, APP)).toEqual({ action: 'block' });
  });
  test('allow ONLY on exact app-url match (all three clauses matter)', () => {
    expect(_cn(APP, APP)).toEqual({ action: 'allow' });
    expect(_cn(APP + '#x', APP)).not.toEqual({ action: 'allow' }); // not exact
    expect(_cn('https://x', '')).toEqual({ action: 'external' });   // empty appUrl ⇒ no allow
    expect(_cn('https://x', 42)).toEqual({ action: 'external' });   // non-string appUrl ⇒ no allow
    expect(_cn(APP, '')).not.toEqual({ action: 'allow' });          // appUrl '' must not allow
  });
  test('external schemes route external; everything else blocks', () => {
    for (const u of ['https://x', 'http://x', 'mailto:a@b', 'tel:+1']) expect(_cn(u, APP)).toEqual({ action: 'external' });
    for (const u of ['file:///other', 'data:x', 'javascript:x', 'blob:x', 'custom:x']) expect(_cn(u, APP)).toEqual({ action: 'block' });
  });
  test('scheme must be ANCHORED at the start (^) — embedded scheme blocks', () => {
    expect(_cn('xhttps://evil', APP)).toEqual({ action: 'block' });
    expect(_cn('  https://x', APP)).toEqual({ action: 'block' });
  });
});
describe('isExternallyOpenable — guard + anchoring', () => {
  test('non-string → false (typeof guard)', () => {
    expect(_ico(42)).toBe(false);
    expect(_ico(null)).toBe(false);
    expect(_ico(undefined)).toBe(false);
    expect(_ico({ toString: () => 'https://example.com' })).toBe(false);
  });
  test('only anchored http(s)/mailto/tel → true', () => {
    expect(_ico('https://x')).toBe(true);
    expect(_ico('mailto:a@b')).toBe(true);
    expect(_ico('xhttps://x')).toBe(false); // anchoring
    expect(_ico('javascript:x')).toBe(false);
  });
});
