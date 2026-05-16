// Unit tests for vaultSearch() pure function
// Run via: node tests/unit/search.test.js
'use strict';

const assert = require('assert');

// ===========================================================================
// Minimal re-implementation of vaultSearch() for isolated unit testing.
// Must stay in sync with the version in marqam.html.
// ===========================================================================
function escapeHtml(s) {
  return String(s)
    .replace(/&amp;/g, '&amp;amp;')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createVaultSearch(files) {
  function vaultSearch(query) {
    if (!query || query.length < 2 || !files.length) return [];
    const lower = query.toLowerCase();
    const escaped = escapeHtml(query);
    const results = [];
    files.forEach((f, fileIdx) => {
      const c = f.content || '';
      const cl = c.toLowerCase();
      const nameMatch = f.name.toLowerCase().includes(lower);
      const hits = [];
      let searchFrom = 0;
      while (hits.length < 5) {
        const idx = cl.indexOf(lower, searchFrom);
        if (idx < 0) break;
        const a = Math.max(0, idx - 40);
        const b = Math.min(c.length, idx + query.length + 40);
        const raw = c.slice(a, b).replace(/\n+/g, ' ');
        const safeFull = escapeHtml(raw);
        const safeQuery = escaped.toLowerCase();
        const matchStart = safeFull.toLowerCase().indexOf(safeQuery);
        let snippet;
        if (matchStart >= 0) {
          snippet =
            (a > 0 ? '… ' : '') +
            safeFull.slice(0, matchStart) +
            '<mark>' + safeFull.slice(matchStart, matchStart + escaped.length) + '</mark>' +
            safeFull.slice(matchStart + escaped.length) +
            (b < c.length ? ' …' : '');
        } else {
          snippet = (a > 0 ? '… ' : '') + safeFull + (b < c.length ? ' …' : '');
        }
        hits.push({ snippet });
        searchFrom = idx + query.length;
      }
      if (hits.length > 0 || nameMatch) {
        results.push({ name: f.name, fileIdx, hits: hits.length > 0 ? hits : [] });
      }
    });
    return results;
  }
  return vaultSearch;
}

// ===========================================================================
// Test: empty query returns []
// ===========================================================================
{
  const search = createVaultSearch([{ name: 'a.md', content: 'hello world' }]);
  assert.deepStrictEqual(search(''), [], 'empty query returns []');
  assert.deepStrictEqual(search('a'), [], 'single-char query returns []');
  console.log('PASS: empty/short query returns []');
}

// ===========================================================================
// Test: empty files returns []
// ===========================================================================
{
  const search = createVaultSearch([]);
  assert.deepStrictEqual(search('hello'), [], 'empty files returns []');
  console.log('PASS: empty files returns []');
}

// ===========================================================================
// Test: match in file content returns result with snippet containing <mark>
// ===========================================================================
{
  const files = [{ name: 'note.md', content: 'This is a test note with hello inside.' }];
  const search = createVaultSearch(files);
  const results = search('hello');
  assert.strictEqual(results.length, 1, 'one file matches');
  assert.strictEqual(results[0].fileIdx, 0, 'fileIdx is 0');
  assert.strictEqual(results[0].hits.length, 1, 'one hit found');
  assert.ok(results[0].hits[0].snippet.includes('<mark>'), 'snippet contains <mark>');
  assert.ok(results[0].hits[0].snippet.includes('hello'), 'snippet contains match text');
  console.log('PASS: match produces snippet with <mark>');
}

// ===========================================================================
// Test: two-file vault — both files match, returns 2 results
// ===========================================================================
{
  const files = [
    { name: 'alpha.md', content: 'The quick brown fox jumps over the lazy dog' },
    { name: 'beta.md',  content: 'Another quick reference for testing purposes' }
  ];
  const search = createVaultSearch(files);
  const results = search('quick');
  assert.strictEqual(results.length, 2, 'both files returned');
  assert.ok(results.some(r => r.name === 'alpha.md'), 'alpha.md in results');
  assert.ok(results.some(r => r.name === 'beta.md'),  'beta.md in results');
  console.log('PASS: two-file vault returns 2 results');
}

// ===========================================================================
// Test: 5-hit cap per file enforced
// ===========================================================================
{
  const content = Array.from({ length: 10 }, (_, i) => `hit${i} target`).join('\n\n');
  const files = [{ name: 'many.md', content }];
  const search = createVaultSearch(files);
  const results = search('target');
  assert.strictEqual(results.length, 1, 'one file result');
  assert.ok(results[0].hits.length <= 5, `hits capped at 5 (got ${results[0].hits.length})`);
  console.log('PASS: 5-hit cap per file enforced');
}

// ===========================================================================
// Test: XSS — raw HTML in content is escaped in snippet; <mark> tags are literal
// ===========================================================================
{
  const files = [{ name: 'xss.md', content: 'test <script>alert(1)</script> test' }];
  const search = createVaultSearch(files);
  const results = search('test');
  assert.strictEqual(results.length, 1, 'match found');
  const snip = results[0].hits[0].snippet;
  assert.ok(!snip.includes('<script>'), 'raw <script> not in snippet');
  assert.ok(snip.includes('&lt;script'), 'script tag is HTML-escaped in snippet');
  assert.ok(snip.includes('<mark>'), '<mark> wrapper is present');
  console.log('PASS: XSS — HTML in content is escaped, <mark> is literal');
}

// ===========================================================================
// Test: name-only match (query not in content but in filename)
// ===========================================================================
{
  const files = [
    { name: 'project-notes.md', content: 'Something unrelated entirely.' },
    { name: 'recipes.md',       content: 'More unrelated content.' }
  ];
  const search = createVaultSearch(files);
  const results = search('project');
  assert.strictEqual(results.length, 1, 'only filename-match file returned');
  assert.strictEqual(results[0].name, 'project-notes.md', 'correct file returned');
  assert.strictEqual(results[0].hits.length, 0, 'no content hits, only name match');
  console.log('PASS: name-only match returns file with empty hits array');
}

// ===========================================================================
// Test: case-insensitive matching
// ===========================================================================
{
  const files = [{ name: 'case.md', content: 'Hello WORLD hello World' }];
  const search = createVaultSearch(files);
  const results = search('hello');
  assert.strictEqual(results.length, 1, 'case-insensitive match');
  assert.strictEqual(results[0].hits.length, 2, 'two occurrences found (Hello + hello)');
  console.log('PASS: case-insensitive matching works');
}

// ===========================================================================
// Test: no match returns []
// ===========================================================================
{
  const files = [{ name: 'a.md', content: 'cats and dogs' }];
  const search = createVaultSearch(files);
  const results = search('zzznomatch');
  assert.deepStrictEqual(results, [], 'no match returns []');
  console.log('PASS: no match returns []');
}

console.log('\nAll vaultSearch unit tests passed.');
