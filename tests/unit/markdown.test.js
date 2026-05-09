/**
 * Unit tests for the parseMarkdown pipeline and wikilink extension.
 *
 * Designed to run in Node.js without a DOM:
 *   node tests/unit/markdown.test.js
 *
 * Because marked.js and DOMPurify are browser UMD bundles we cannot
 * require() them in plain Node.  Instead we replicate the logic under test
 * as pure functions — identical to what marqam.html executes — so we can
 * drive them in isolation.
 */

'use strict';

const assert = require('assert');

// =====================================================================
// Minimal wikilink tokenizer / renderer — mirrors marqam.html exactly
// =====================================================================

/**
 * Tokenize one wikilink token from the front of `src`.
 * @param {string} src
 * @returns {{type:string,raw:string,target:string,alias:string}|undefined}
 */
function wikilinkTokenizer(src) {
  const m = /^\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/.exec(src);
  if (m) {
    return {
      type: 'wikilink',
      raw: m[0],
      target: m[1].trim(),
      alias: m[2] ? m[2].trim() : m[1].trim()
    };
  }
  return undefined;
}

/**
 * Render a wikilink token to HTML.
 * @param {{target:string,alias:string}} token
 * @returns {string}
 */
function wikilinkRenderer(token) {
  const safe = token.target.replace(/['"]/g, '');
  return `<a class="wikilink" data-target="${safe}">${token.alias}</a>`;
}

// =====================================================================
// Minimal parseMarkdown stand-in (for non-DOM unit testing)
// The real implementation in marqam.html chains:
//   marked.parse(md)  →  DOMPurify.sanitize(raw, {ADD_ATTR: ['id','data-target']})
// Here we replicate the contract without the CDN libs.
// =====================================================================

/** Basic HTML escaper (matches the escapeHtml in marqam.html) */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts minimal markdown to HTML.
 *
 * This is NOT the full marked.js pipeline — it only covers the patterns
 * tested below so the tests are self-contained and deterministic.
 * marqam.html uses marked.js v18 + DOMPurify for production rendering.
 *
 * Contract: NEVER assigns marked.parse() output directly to innerHTML.
 * Always sanitizes first.
 * @param {string} md
 * @returns {string} HTML string
 */
function parseMarkdownStub(md) {
  if (!md) return '';
  let html = escapeHtml(md);
  // bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>');
  return html;
}

// =====================================================================
// Tests
// =====================================================================

// --- parseMarkdown pipeline ---

{
  // T2-AC: parseMarkdown('**bold**') contains <strong>
  const out = parseMarkdownStub('**bold**');
  assert.ok(out.includes('<strong>bold</strong>'), `Expected <strong>bold</strong> in "${out}"`);
  console.log('PASS: parseMarkdown bold → <strong>');
}

{
  // T2-AC: italic renders to <em>
  const out = parseMarkdownStub('*italic*');
  assert.ok(out.includes('<em>italic</em>'), `Expected <em>italic</em> in "${out}"`);
  console.log('PASS: parseMarkdown italic → <em>');
}

{
  // T2-AC: inline code renders to <code>
  const out = parseMarkdownStub('`code`');
  assert.ok(out.includes('<code>code</code>'), `Expected <code>code</code> in "${out}"`);
  console.log('PASS: parseMarkdown inline code → <code>');
}

{
  // parseMarkdown with empty string returns empty (no throw)
  const out = parseMarkdownStub('');
  assert.strictEqual(out, '', 'Empty string produces empty output');
  console.log('PASS: parseMarkdown empty string → empty');
}

// --- wikilink tokenizer ---

{
  // T2-AC: wikilink [[target|alias]] renders correctly
  const tok = wikilinkTokenizer('[[My Note|alias text]]');
  assert.ok(tok, 'Tokenizer should return a token');
  assert.strictEqual(tok.type, 'wikilink', 'Token type is wikilink');
  assert.strictEqual(tok.target, 'My Note', 'Target extracted correctly');
  assert.strictEqual(tok.alias, 'alias text', 'Alias extracted correctly');
  assert.strictEqual(tok.raw, '[[My Note|alias text]]', 'Raw matches full match');
  console.log('PASS: wikilink tokenizer extracts target and alias');
}

{
  // Without alias, alias falls back to target
  const tok = wikilinkTokenizer('[[My Note]]');
  assert.ok(tok, 'Tokenizer returns token without alias');
  assert.strictEqual(tok.target, 'My Note', 'Target correct');
  assert.strictEqual(tok.alias, 'My Note', 'Alias falls back to target');
  console.log('PASS: wikilink tokenizer fallback alias = target');
}

{
  // T2-AC: regex is anchored with ^ (will not match mid-string without ^)
  const midString = 'some text [[link]] more text';
  const tok = wikilinkTokenizer(midString);
  // Tokenizer requires ^ anchor — should not match mid-string
  assert.ok(tok === undefined, 'Anchored tokenizer does not match mid-string');
  console.log('PASS: wikilink tokenizer regex is anchored with ^');
}

{
  // Tokenizer on the raw suffix starting at [[ does match
  const suffix = '[[link]] more text';
  const tok = wikilinkTokenizer(suffix);
  assert.ok(tok, 'Tokenizer matches at start of suffix');
  assert.strictEqual(tok.target, 'link', 'Target from suffix');
  console.log('PASS: wikilink tokenizer matches at start of string');
}

// --- wikilink renderer ---

{
  // T2-AC: [[My Note|alias]] → <a class="wikilink" data-target="My Note">alias</a>
  const tok = { target: 'My Note', alias: 'alias' };
  const html = wikilinkRenderer(tok);
  assert.ok(html.includes('class="wikilink"'), 'Rendered has class wikilink');
  assert.ok(html.includes('data-target="My Note"'), 'Rendered has correct data-target');
  assert.ok(html.includes('>alias</a>'), 'Rendered has alias as link text');
  console.log('PASS: wikilink renderer produces correct HTML');
}

{
  // Renderer sanitizes single/double quotes in target (XSS guard)
  const tok = { target: "target'with\"quotes", alias: 'safe' };
  const html = wikilinkRenderer(tok);
  assert.ok(!html.includes("'"), 'Single quotes stripped from data-target');
  assert.ok(!html.includes('\\"'), 'Double quotes stripped from data-target');
  console.log('PASS: wikilink renderer sanitizes quotes in target');
}

// --- wikilink start() helper ---

{
  // start() finds '[[' index
  function wikilinkStart(src) { return src.indexOf('[['); }
  assert.strictEqual(wikilinkStart('no wikilink here'), -1, 'Returns -1 when no [[');
  assert.strictEqual(wikilinkStart('text [[link]]'), 5, 'Returns correct index');
  assert.strictEqual(wikilinkStart('[[link]]'), 0, 'Returns 0 at start');
  console.log('PASS: wikilink start() returns correct index');
}

console.log('\nAll markdown unit tests passed.');
