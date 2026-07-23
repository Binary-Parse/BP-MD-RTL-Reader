/**
 * Unit tests for the markdown pipeline and wikilink extension.
 */

import { describe, test, expect, vi } from 'vitest';
import {
  wikilinkTokenizer,
  wikilinkRenderer,
  parseMarkdown,
  configureMarked,
} from '../../src/renderer/markdown/markdown.js';
import { escapeHtml } from '../../src/renderer/i18n.js';

describe('parseMarkdown pipeline', () => {
  test('uses marked.parse when available', () => {
    const marked = { parse: vi.fn(() => '<p>hello</p>') };
    const result = parseMarkdown('hello', { marked, escapeHtml });
    expect(marked.parse).toHaveBeenCalledWith('hello');
    expect(result).toBe('<p>hello</p>');
  });

  test('routes through the hardened sanitizeHtml stage (AI2/B4)', () => {
    const marked = { parse: vi.fn(() => '<p>hello</p>') };
    const DOMPurify = { sanitize: vi.fn((html) => `sanitized:${html}`) };
    const result = parseMarkdown('hello', { marked, DOMPurify, escapeHtml });
    // Delegates to trusted.js sanitizeHtml: forbids style/iframe/active handlers,
    // keeps id/data-target (outline+wikilinks) and dir/lang (bidi) — NOT the old
    // loose `{ADD_ATTR:['id','data-target']}` config.
    expect(DOMPurify.sanitize).toHaveBeenCalledWith('<p>hello</p>', expect.objectContaining({
      ADD_ATTR: expect.arrayContaining(['id', 'data-target', 'dir', 'lang']),
      FORBID_TAGS: expect.arrayContaining(['style', 'iframe', 'script']),
      FORBID_ATTR: expect.arrayContaining(['style', 'onerror', 'onload', 'onclick']),
    }));
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
  test('registers wikilink + footnote extensions on marked instance', () => {
    const useFn = vi.fn();
    const marked = { use: useFn };
    configureMarked(marked);
    // Two use() calls now: the gfm+wikilink config, then the footnote bundle (R11).
    expect(useFn).toHaveBeenCalledTimes(2);
    const config = useFn.mock.calls[0][0];
    expect(config.extensions[0].name).toBe('wikilink');
    const fnConfig = useFn.mock.calls[1][0];
    expect(fnConfig.extensions.map(e => e.name)).toEqual(['footnoteRef', 'footnoteDef']);
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

describe('configureMarked — integration with real marked (audit #29)', () => {
  // Exercises the wikilink extension's inner start/tokenizer/renderer that
  // only run when an actual marked instance parses input. Mock-based tests
  // can verify marked.use was called with the right config object, but the
  // 24 NoCoverage mutants in src/renderer/markdown/markdown.js L32-L40 only die when
  // a real marked instance walks through those inner functions.
  //
  // Uses marked@^18.0.4 (matches the CDN version loaded by index.html).
  let MarkedClass;
  beforeAll(async () => {
    const m = await import('marked');
    MarkedClass = m.Marked; // class so each test gets a fresh, isolated instance
  });

  function freshMarked() {
    const inst = new MarkedClass();
    configureMarked(inst);
    return inst;
  }

  test('start(src): returns indexOf("[[") so marked knows where to scan', () => {
    const m = freshMarked();
    const out = m.parse('hello [[Note]] world');
    // If start() returned -1 (no scan), the [[Note]] would never be detected.
    expect(out).toContain('class="wikilink"');
    expect(out).toContain('data-target="Note"');
    expect(out).toContain('>Note</a>');
  });

  test('start(src): returns indexOf result (kills L32 StringLiteral mutant on "[[")', () => {
    // Mutant L32 replaces "[[" with "" → indexOf("") always returns 0
    // → marked tries to tokenize at every char, but the regex (anchored ^)
    // would never match plain text. Bottom line: wikilink would still render
    // here, BUT a non-wikilink string should NOT be wrongly handled.
    const m = freshMarked();
    const plainOut = m.parse('just plain text, no wikilinks');
    expect(plainOut).not.toContain('class="wikilink"');
    // And input where the [[ is at the end should still find it
    const tailOut = m.parse('preamble [[End]]');
    expect(tailOut).toContain('data-target="End"');
  });

  test('tokenizer + renderer: target-only wikilink → <a class="wikilink" data-target="X">X</a>', () => {
    const m = freshMarked();
    const out = m.parse('[[Apple]]');
    expect(out).toMatch(/<a[^>]*class="wikilink"[^>]*data-target="Apple"[^>]*>Apple<\/a>/);
  });

  test('tokenizer + renderer: target|alias wikilink', () => {
    const m = freshMarked();
    const out = m.parse('[[Apple|red fruit]]');
    expect(out).toMatch(/data-target="Apple"/);
    expect(out).toMatch(/>red fruit</);
  });

  test('tokenizer: regex anchor prevents mid-token match — "abc[[X]]" tokenises [[X]] correctly', () => {
    // The inner tokenizer uses /^\[\[.../ — only matches at scan position.
    // Combined with start(), this means [[X]] inside "abc[[X]]" IS rendered.
    const m = freshMarked();
    const out = m.parse('abc[[X]]');
    expect(out).toContain('data-target="X"');
  });

  test('renderer: quotes in target are stripped (XSS guard, kills any string-mutation on the replace pattern)', () => {
    const m = freshMarked();
    const out = m.parse(`[[evil"name|safe]]`);
    // The renderer at line 37 in markdown.js strips ' and " from target.
    // Mutant that breaks the replace would leak the quote into data-target.
    const dataTarget = out.match(/data-target="([^"]*)"/)[1];
    expect(dataTarget).toBe('evilname');
  });

  test('renderer: target is .trim()-ed via the inner extension too', () => {
    const m = freshMarked();
    const out = m.parse('[[  Spaced  ]]');
    expect(out).toMatch(/data-target="Spaced"/);
  });

  test('alias fallback (no pipe): alias uses .trim()-ed target (kills inner-fallback L35 mutant)', () => {
    const m = freshMarked();
    const out = m.parse('[[  Plain  ]]');
    // text content of the <a> should be 'Plain', not '  Plain  '
    expect(out).toMatch(/>Plain<\/a>/);
  });

  test('multiple wikilinks in one document are all tokenised', () => {
    const m = freshMarked();
    const out = m.parse('[[A]] then [[B|two]] then [[C]]');
    const targets = [...out.matchAll(/data-target="([^"]+)"/g)].map(x => x[1]);
    expect(targets).toEqual(['A', 'B', 'C']);
  });

  test('non-wikilink markdown still parses normally (gfm tables, code, headings)', () => {
    const m = freshMarked();
    expect(m.parse('# Heading')).toMatch(/<h1[^>]*>Heading<\/h1>/);
    expect(m.parse('**bold**')).toMatch(/<strong>bold<\/strong>/);
    expect(m.parse('`code`')).toMatch(/<code>code<\/code>/);
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

  test('configureMarked passes breaks: true (kills L28 BooleanLiteral mutant)', () => {
    const useFn = vi.fn();
    configureMarked({ use: useFn });
    const opts = useFn.mock.calls[0][0];
    expect(opts.breaks).toBe(true);
  });

  test('configureMarked wikilink extension has level: "inline" (kills L31 StringLiteral mutant)', () => {
    const useFn = vi.fn();
    configureMarked({ use: useFn });
    const ext = useFn.mock.calls[0][0].extensions[0];
    expect(ext.level).toBe('inline');
  });

  // ── inner extension start()/tokenizer() killers (L32, L35) ─────────
  // These target the functions defined *inside* configureMarked's extension
  // config (not the standalone wikilinkTokenizer). We pull them off the
  // captured config object and call them directly so the mutants die
  // deterministically — independent of how a real marked instance scans.
  function innerExtension() {
    const useFn = vi.fn();
    configureMarked({ use: useFn });
    return useFn.mock.calls[0][0].extensions[0];
  }

  test('inner start(src) returns indexOf("[[") (kills L32 indexOf("")/empty-body mutants)', () => {
    const ext = innerExtension();
    // Original: src.indexOf('[[') === 3 for 'abc[[X]]'.
    //   • Mutant indexOf('') would return 0 (3 !== 0 → fails).
    //   • Empty-body mutant would return undefined (3 !== undefined → fails).
    expect(ext.start('abc[[X]]')).toBe(3);
    // Wikilink right at the start → index 0 (genuine match position, not
    // the spurious 0 that indexOf('') always yields — disambiguated above).
    expect(ext.start('[[X]]')).toBe(0);
    // No "[[" at all → indexOf returns -1; indexOf('') would wrongly return 0.
    expect(ext.start('no wikilink here')).toBe(-1);
  });

  test('inner tokenizer trims an explicit alias (kills L35 m[2]?.trim() → m[2] mutant)', () => {
    const ext = innerExtension();
    // Original: alias: m[2]?.trim() → '  spaced  ' becomes 'spaced'.
    //   Mutant m[2] (no trim) keeps the surrounding whitespace → fails.
    const tok = ext.tokenizer('[[Target|  spaced  ]]');
    expect(tok).toBeDefined();
    expect(tok.type).toBe('wikilink');
    expect(tok.target).toBe('Target');
    expect(tok.alias).toBe('spaced');
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

describe('configureMarked inline extensions — boundary semantics', () => {
  function extensions() {
    const use = vi.fn();
    configureMarked({ use });
    return Object.fromEntries(use.mock.calls[0][0].extensions.map(extension => [extension.name, extension]));
  }

  function tokenize(extension, source) {
    return extension.tokenizer.call({ lexer: { inlineTokens: text => [`token:${text}`] } }, source);
  }

  test('highlight requires anchored, non-space-bounded content and preserves multiline text', () => {
    const extension = extensions().highlight;
    expect(extension.start('abc==x==')).toBe(3);
    expect(extension.start('plain')).toBe(-1);
    expect(tokenize(extension, '==x==')).toEqual({ type: 'highlight', raw: '==x==', text: 'x', tokens: ['token:x'] });
    expect(tokenize(extension, '==a\nb==')).toMatchObject({ raw: '==a\nb==', text: 'a\nb' });
    for (const invalid of ['x==a==', '== x==', '==x ==', '====']) expect(tokenize(extension, invalid)).toBeUndefined();
    expect(extension.renderer.call({ parser: { parseInline: tokens => tokens.join('|') } }, { tokens: ['safe'] }))
      .toBe('<mark>safe</mark>');
  });

  test('subscript excludes escapes, strike syntax, spaces, newlines, and unclosed markers', () => {
    const extension = extensions().subscript;
    expect(extension.start('a ~x~')).toBe(2);
    // The escaped opener is skipped; the closing tilde remains a later scan hint.
    expect(extension.start('a \\~x~')).toBe(5);
    expect(extension.start('~~x~~')).toBeUndefined();
    expect(tokenize(extension, '~x~')).toEqual({ type: 'subscript', raw: '~x~', text: 'x', tokens: ['token:x'] });
    expect(tokenize(extension, '~ab cd~')).toMatchObject({ raw: '~ab cd~', text: 'ab cd' });
    for (const invalid of ['x~a~', '~~a~~', '~ a~', '~a\nb~', '~a']) expect(tokenize(extension, invalid)).toBeUndefined();
    expect(extension.renderer.call({ parser: { parseInline: tokens => tokens[0] } }, { tokens: ['safe'] }))
      .toBe('<sub>safe</sub>');
  });

  test('superscript is anchored, non-empty, and contains no spaces or carets', () => {
    const extension = extensions().superscript;
    expect(extension.start('a^2^')).toBe(1);
    expect(extension.start('plain')).toBe(-1);
    expect(tokenize(extension, '^2^')).toEqual({ type: 'superscript', raw: '^2^', text: '2', tokens: ['token:2'] });
    for (const invalid of ['x^2^', '^two words^', '^^', '^a\nb^']) expect(tokenize(extension, invalid)).toBeUndefined();
    expect(extension.renderer.call({ parser: { parseInline: tokens => tokens[0] } }, { tokens: ['safe'] }))
      .toBe('<sup>safe</sup>');
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
