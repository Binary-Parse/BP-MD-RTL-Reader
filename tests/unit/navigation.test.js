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
