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

describe('markdown.js — mutation killers (audit #7)', () => {
  // ── Wikilink tokenizer .trim() killers (L12, L13×2) ────────────────
  test('target is .trim()-ed (kills L12 MethodExpression mutant)', () => {
    // Original: target: m[1].trim() — leading/trailing space removed
    // Mutant `m[1]`: target keeps the spaces → 'foo' becomes '  foo  '
    const tok = wikilinkTokenizer('[[  foo  ]]');
    expect(tok).toBeDefined();
    expect(tok.target).toBe('foo');
  });

  test('alias (explicit) is .trim()-ed (kills L13:14 MethodExpression mutant)', () => {
    // Original: alias: m[2]?.trim() || ...
    // Mutant `m[2]`: alias keeps the spaces
    const tok = wikilinkTokenizer('[[foo|  bar  ]]');
    expect(tok).toBeDefined();
    expect(tok.alias).toBe('bar');
  });

  test('fallback alias (no pipe) is the .trim()-ed target (kills L13:30 mutant)', () => {
    // Original: alias defaults to m[1].trim() when m[2] is absent or empty
    // Mutant `m[1]` (no trim on fallback path): alias would be '  foo  '
    const tok = wikilinkTokenizer('[[  foo  ]]');
    expect(tok).toBeDefined();
    expect(tok.alias).toBe('foo');
  });

  // ── configureMarked option-value killers (L27, L28, L31) ───────────
  test('configureMarked passes gfm: true (kills L27 BooleanLiteral mutant)', () => {
    const useFn = vi.fn();
    configureMarked({ use: useFn });
    const opts = useFn.mock.calls[0][0];
    expect(opts.gfm).toBe(true);
  });

  test('configureMarked passes breaks: false (kills L28 BooleanLiteral mutant)', () => {
    const useFn = vi.fn();
    configureMarked({ use: useFn });
    const opts = useFn.mock.calls[0][0];
    expect(opts.breaks).toBe(false);
  });

  test('configureMarked wikilink extension has level: "inline" (kills L31 StringLiteral mutant)', () => {
    const useFn = vi.fn();
    configureMarked({ use: useFn });
    const ext = useFn.mock.calls[0][0].extensions[0];
    expect(ext.level).toBe('inline');
  });

  // ── parseMarkdown branch killers (L46, L49, L50) ───────────────────
  test('parseMarkdown calls escapeHtml when marked is absent (kills L46 mutant)', () => {
    // Original: escapeHtml ? escapeHtml(md) : String(md)
    // Mutant `false`: always uses String(md), never invokes escapeHtml.
    // Use a sentinel escapeHtml that returns a distinguishable string.
    const customEscape = vi.fn(() => '__ESCAPED__');
    const result = parseMarkdown('<x>', { escapeHtml: customEscape });
    expect(customEscape).toHaveBeenCalledWith('<x>');
    expect(result).toBe('__ESCAPED__');
  });

  test('parseMarkdown coerces null/undefined md to "" before marked.parse (kills L49 mutant)', () => {
    // Original: marked.parse(md || '')
    // Mutant: md || 'Stryker was here!' — null becomes the sentinel string.
    const marked = { parse: vi.fn(() => '<p></p>') };
    parseMarkdown(null, { marked });
    expect(marked.parse).toHaveBeenCalledWith('');
    parseMarkdown(undefined, { marked });
    expect(marked.parse).toHaveBeenLastCalledWith('');
  });

  test('parseMarkdown does NOT touch DOMPurify when it is absent (kills L50 mutant)', () => {
    // Original: if (DOMPurify && typeof DOMPurify.sanitize === 'function')
    // Mutant `true`: always enters branch → accesses undefined.sanitize → TypeError.
    // Original path returns raw marked output cleanly.
    const marked = { parse: vi.fn(() => '<p>safe</p>') };
    let result;
    expect(() => { result = parseMarkdown('hello', { marked }); }).not.toThrow();
    expect(result).toBe('<p>safe</p>');
  });

  test('parseMarkdown: marked.parse must be a function (kills L46 typeof-clause mutant)', () => {
    // The L46 ConditionalExpression mutant likely replaces the second clause
    // (typeof marked.parse !== 'function') with `false`, making the condition
    // `!marked || false` = `!marked`. With an object whose .parse is NOT a
    // function, original enters early-return; mutant tries to call a string.
    expect(parseMarkdown('hello', { marked: { parse: 'not-a-function' } })).toBe('hello');
  });

  test('parseMarkdown: DOMPurify.sanitize must be a function (kills L50 typeof-clause mutant)', () => {
    // The L50 mutant likely replaces (typeof DOMPurify.sanitize === 'function')
    // with `true`, making `DOMPurify && true` = truthy when DOMPurify exists.
    // With a DOMPurify whose .sanitize is NOT a function, original skips the
    // branch and returns raw; mutant tries to call the string → throws.
    const marked = { parse: vi.fn(() => '<p>raw</p>') };
    expect(parseMarkdown('hello', { marked, DOMPurify: { sanitize: 'not-a-function' } }))
      .toBe('<p>raw</p>');
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
