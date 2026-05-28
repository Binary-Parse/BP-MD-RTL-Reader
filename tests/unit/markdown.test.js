/**
 * Unit tests for the markdown pipeline and wikilink extension.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  wikilinkTokenizer,
  wikilinkRenderer,
  parseMarkdown,
  configureMarked,
} from '../../src/renderer/markdown.js';
import { escapeHtml } from '../../src/renderer/i18n.js';

describe('parseMarkdown pipeline', () => {
  test('uses marked.parse when available', () => {
    const marked = { parse: vi.fn(() => '<p>hello</p>') };
    const result = parseMarkdown('hello', { marked, escapeHtml });
    expect(marked.parse).toHaveBeenCalledWith('hello');
    expect(result).toBe('<p>hello</p>');
  });

  test('sanitizes with DOMPurify when available', () => {
    const marked = { parse: vi.fn(() => '<p>hello</p>') };
    const DOMPurify = { sanitize: vi.fn((html) => `sanitized:${html}`) };
    const result = parseMarkdown('hello', { marked, DOMPurify, escapeHtml });
    expect(DOMPurify.sanitize).toHaveBeenCalledWith('<p>hello</p>', { ADD_ATTR: ['id', 'data-target'] });
    expect(result).toBe('sanitized:<p>hello</p>');
  });

  test('falls back to escapeHtml when marked is absent', () => {
    const result = parseMarkdown('<script>alert(1)</script>', { escapeHtml });
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  test('falls back to String() when neither marked nor escapeHtml provided', () => {
    expect(parseMarkdown('hello', {})).toBe('hello');
  });

  test('empty string handled', () => {
    const marked = { parse: vi.fn(() => '') };
    expect(parseMarkdown('', { marked, escapeHtml })).toBe('');
  });

  test('null/undefined treated as empty string', () => {
    const marked = { parse: vi.fn(() => '') };
    expect(parseMarkdown(null, { marked, escapeHtml })).toBe('');
    expect(parseMarkdown(undefined, { marked, escapeHtml })).toBe('');
  });
});

describe('configureMarked', () => {
  test('registers wikilink extension on marked instance', () => {
    const useFn = vi.fn();
    const marked = { use: useFn };
    configureMarked(marked);
    expect(useFn).toHaveBeenCalledOnce();
    const config = useFn.mock.calls[0][0];
    expect(config.extensions[0].name).toBe('wikilink');
  });

  test('no-op when marked is missing', () => {
    expect(() => configureMarked(null)).not.toThrow();
    expect(() => configureMarked(undefined)).not.toThrow();
  });

  test('no-op when marked.use is not a function', () => {
    expect(() => configureMarked({})).not.toThrow();
  });
});

describe('wikilink tokenizer', () => {
  test('extracts target and alias', () => {
    const tok = wikilinkTokenizer('[[My Note|alias text]]');
    expect(tok).toBeDefined();
    expect(tok.type).toBe('wikilink');
    expect(tok.target).toBe('My Note');
    expect(tok.alias).toBe('alias text');
    expect(tok.raw).toBe('[[My Note|alias text]]');
  });

  test('fallback alias = target when no pipe', () => {
    const tok = wikilinkTokenizer('[[My Note]]');
    expect(tok).toBeDefined();
    expect(tok.alias).toBe('My Note');
  });

  test('anchored regex does not match mid-string', () => {
    expect(wikilinkTokenizer('some text [[link]] more text')).toBeUndefined();
  });

  test('matches at start of string', () => {
    const tok = wikilinkTokenizer('[[link]] more text');
    expect(tok).toBeDefined();
    expect(tok.target).toBe('link');
  });

  test('does not match unclosed bracket', () => {
    expect(wikilinkTokenizer('[[unclosed')).toBeUndefined();
  });
});

describe('wikilink renderer', () => {
  test('produces correct HTML', () => {
    const html = wikilinkRenderer({ target: 'My Note', alias: 'alias' });
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('data-target="My Note"');
    expect(html).toContain('>alias</a>');
  });

  test('sanitizes quotes in target (XSS guard)', () => {
    const html = wikilinkRenderer({ target: "target'with\"quotes", alias: 'safe' });
    const match = html.match(/data-target="([^"]*)"/);
    expect(match).toBeTruthy();
    expect(match[1]).not.toContain("'");
    expect(match[1]).not.toContain('"');
    expect(match[1]).toBe('targetwithquotes');
  });
});

describe('wikilinkTokenizer ReDoS defence (audit #19)', () => {
  // eslint-plugin-security flagged the wikilink regex as detect-unsafe-regex
  // due to lazy quantifiers on negated character classes. The classes exclude
  // the terminators (`]`, `\n`, `|`) so backtracking is bounded — these tests
  // codify that property with a tight wall-clock budget. If a future regex
  // change re-introduces catastrophic backtracking, one of these payloads
  // will blow the budget.
  const BUDGET_MS = 50; // generous; healthy regex completes in < 1 ms

  function measure(fn) {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
  }

  test('only opening brackets, never closes', () => {
    const payload = '['.repeat(20000);
    const dt = measure(() => wikilinkTokenizer(payload));
    expect(dt).toBeLessThan(BUDGET_MS);
  });

  test('open [[ then long inner content with no closing ]]', () => {
    const payload = '[[' + 'a'.repeat(20000);
    const dt = measure(() => wikilinkTokenizer(payload));
    expect(dt).toBeLessThan(BUDGET_MS);
  });

  test('many pipe separators (alias-section backtracking probe)', () => {
    const payload = '[[' + 'a|'.repeat(10000);
    const dt = measure(() => wikilinkTokenizer(payload));
    expect(dt).toBeLessThan(BUDGET_MS);
  });

  test('very long but valid wikilink (matches successfully)', () => {
    const payload = '[[' + 'a'.repeat(10000) + ']]';
    let token;
    const dt = measure(() => { token = wikilinkTokenizer(payload); });
    expect(dt).toBeLessThan(BUDGET_MS);
    expect(token).toBeDefined();
    expect(token.target).toHaveLength(10000);
  });

  test('very long target AND alias', () => {
    const payload = '[[' + 'a'.repeat(10000) + '|' + 'b'.repeat(10000) + ']]';
    let token;
    const dt = measure(() => { token = wikilinkTokenizer(payload); });
    expect(dt).toBeLessThan(BUDGET_MS);
    expect(token).toBeDefined();
    expect(token.target).toHaveLength(10000);
    expect(token.alias).toHaveLength(10000);
  });

  test('audit-suggested payload: nested-open + long inner', () => {
    const payload = '['.repeat(10000) + '[' + 'a'.repeat(10000);
    const dt = measure(() => wikilinkTokenizer(payload));
    expect(dt).toBeLessThan(BUDGET_MS);
  });
});
