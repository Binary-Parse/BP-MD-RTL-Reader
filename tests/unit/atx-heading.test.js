import { describe, test, expect } from 'vitest';
import fc from 'fast-check';
import { parseAtxHeading, isFenceLine, sourceHeadingPositions } from '../../src/renderer/components/outline.js';
import { docTitle } from '../../src/renderer/components/inspector-ui.js';

// audit H9: `# Title` followed by ~2500 spaces froze the renderer for 13.6 s. The heading regex
// `(.+?)[ \t]*#*[ \t]*$` backtracks cubically on trailing whitespace. parseAtxHeading() is the one
// shared linear scanner (CommonMark ATX headings, spec 0.31.2 §4.2).

describe('parseAtxHeading — CommonMark ATX headings', () => {
  test.each([
    ['# foo', { level: 1, text: 'foo' }],
    ['## foo', { level: 2, text: 'foo' }],
    ['###### foo', { level: 6, text: 'foo' }],
    ['#\tfoo', { level: 1, text: 'foo' }],
    ['#    foo   ', { level: 1, text: 'foo' }],
    ['# foo bar baz', { level: 1, text: 'foo bar baz' }],
  ])('%j', (line, expected) => {
    expect(parseAtxHeading(line)).toEqual(expected);
  });

  test.each([
    ['# foo #', 'foo'],
    ['## foo ##', 'foo'],
    ['### foo ###     ', 'foo'],
    ['# foo ##################################', 'foo'],
    ['##### foo ##', 'foo'],
    ['# foo \t#', 'foo'],
    ['# foo   #   ', 'foo'],
  ])('a closing # run is dropped when a space precedes it: %j', (line, text) => {
    expect(parseAtxHeading(line).text).toBe(text);
  });

  test.each([
    ['# foo#', 'foo#'],
    ['# foo ### b', 'foo ### b'],
    ['# foo \\#', 'foo \\#'],
    ['# C#', 'C#'],
    ['## #hashtag', '#hashtag'],
  ])('a # without a preceding space is part of the text: %j', (line, text) => {
    expect(parseAtxHeading(line).text).toBe(text);
  });

  test('empty headings', () => {
    expect(parseAtxHeading('#')).toEqual({ level: 1, text: '' });
    expect(parseAtxHeading('## ')).toEqual({ level: 2, text: '' });
    expect(parseAtxHeading('# #')).toEqual({ level: 1, text: '' });
    expect(parseAtxHeading('### ###')).toEqual({ level: 3, text: '' });
    expect(parseAtxHeading('#   \t ')).toEqual({ level: 1, text: '' });
  });

  test.each([
    '#5 bolt', '#hashtag', '####### x', '#######', '', ' ', 'text', 'a # b', '\\# foo', '>  # foo', '-  # foo',
  ])('not a heading: %j', (line) => {
    expect(parseAtxHeading(line)).toBeNull();
  });

  test('up to three spaces of indentation are allowed, four are not (that is code)', () => {
    expect(parseAtxHeading(' # foo')).toEqual({ level: 1, text: 'foo' });
    expect(parseAtxHeading('  ## foo')).toEqual({ level: 2, text: 'foo' });
    expect(parseAtxHeading('   ### foo')).toEqual({ level: 3, text: 'foo' });
    expect(parseAtxHeading('    # foo')).toBeNull();
    expect(parseAtxHeading('\t# foo')).toBeNull();
  });

  test('a trailing carriage return (CRLF source) is not part of the heading', () => {
    expect(parseAtxHeading('# foo\r')).toEqual({ level: 1, text: 'foo' });
    expect(parseAtxHeading('# foo #\r')).toEqual({ level: 1, text: 'foo' });
    expect(parseAtxHeading('#\r')).toEqual({ level: 1, text: '' });
  });

  test('Arabic, emphasis markers and inner markup are kept verbatim', () => {
    expect(parseAtxHeading('## القراءة حِرفة ##')).toEqual({ level: 2, text: 'القراءة حِرفة' });
    expect(parseAtxHeading('# **Bold** `code` title ##')).toEqual({ level: 1, text: '**Bold** `code` title' });
  });

  test('non-strings are not headings (not even an array that would stringify into one)', () => {
    expect(parseAtxHeading(undefined)).toBeNull();
    expect(parseAtxHeading(null)).toBeNull();
    expect(parseAtxHeading(7)).toBeNull();
    expect(parseAtxHeading(['# foo'])).toBeNull();
  });
});

describe('parseAtxHeading — agrees with the old regex wherever that was correct', () => {
  const OLD = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
  // text without '#': the old regex and CommonMark can only differ on the closing-run rules,
  // which need a '#' in the text
  const body = fc.stringMatching(/^[a-zA-Z0-9 \t,.!?ا-ي]{0,12}$/);
  const line = fc.record({
    indent: fc.integer({ min: 0, max: 5 }),
    hashes: fc.integer({ min: 1, max: 8 }),
    sep: fc.constantFrom('', ' ', '  ', '\t', ' \t'),
    text: body,
    closing: fc.constantFrom('', ' #', ' ###', '#'),
  }).map((r) => ' '.repeat(r.indent) + '#'.repeat(r.hashes) + r.sep + r.text + r.closing);

  test('same level and text whenever the old regex matched a CommonMark heading', () => {
    fc.assert(fc.property(line, (l) => {
      const old = OLD.exec(l);
      const now = parseAtxHeading(l);
      const indent = /^ */.exec(l)[0].length;
      if (old && indent <= 3 && !l.endsWith('#') ) {
        expect(now).toEqual({ level: old[1].length, text: old[2].trim() });
      }
      if (!old && now) expect(now.text).toBe(''); // the old regex could not express an empty heading
      if (now && indent > 3) throw new Error('indented code parsed as a heading: ' + JSON.stringify(l));
    }), { numRuns: 500 });
  });
});

// 60 s: the runner's default 5 s limit is not the requirement — the ratio below is — and six
// scans of a megabyte can outlast it when the machine is busy or the code is instrumented.
describe('parseAtxHeading — linear time', { timeout: 60000 }, () => {
  const best = (fn) => {
    let min = Infinity;
    for (let i = 0; i < 3; i++) { const t0 = performance.now(); fn(); min = Math.min(min, performance.now() - t0); }
    return min;
  };
  const expectLinear = (build) => {
    const small = Math.max(best(() => parseAtxHeading(build(250_000))), 0.5);
    const large = best(() => parseAtxHeading(build(1_000_000)));
    expect(large).toBeLessThan(500);
    expect(large / small).toBeLessThan(9); // linear = 4, quadratic = 16, the old cubic = 64
  };

  test('100 000 trailing spaces after a title', () => expectLinear((n) => '# Title' + ' '.repeat(n)));
  test('100 000 tabs and spaces mixed', () => expectLinear((n) => '# Title' + ' \t'.repeat(n / 2)));
  test('a long run of hashes', () => expectLinear((n) => '# Title ' + '#'.repeat(n)));
  test('hash-space repeated', () => expectLinear((n) => '# ' + '# '.repeat(n / 2)));
  test('the exact audit input is instant', () => {
    expect(best(() => parseAtxHeading('# Title' + ' '.repeat(2500)))).toBeLessThan(50);
  });
});

describe('isFenceLine', () => {
  test.each([['```', true], ['```js', true], ['~~~', true], ['  ```', true], ['   ~~~ x', true], ['    ```', false], ['``', false], ['text ```', false], ['', false]])(
    '%j -> %s', (line, expected) => { expect(isFenceLine(line)).toBe(expected); },
  );
});

describe('sourceHeadingPositions uses the shared scanner', () => {
  test('closing runs, empty headings and hashtags', () => {
    const md = '# One #\n#tag not a heading\n## \n### Three ###\n####### seven\n';
    expect(sourceHeadingPositions(md)).toEqual([
      { pos: 0, level: 1, text: 'One' },
      { pos: 27, level: 2, text: '' },
      { pos: 31, level: 3, text: 'Three' },
    ]);
  });

  test('headings inside fences are skipped, the audit input does not hang', () => {
    const md = '```\n# in fence\n```\n# Title' + ' '.repeat(2500) + '\n';
    const t0 = performance.now();
    const out = sourceHeadingPositions(md);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(out).toEqual([{ pos: 19, level: 1, text: 'Title' }]);
  });
});

describe('docTitle uses the shared scanner', () => {
  test('first H1 outside a fence, closing run removed', () => {
    expect(docTitle('```\n# in fence\n```\n# Real title ##\n# Second', 'x.md')).toBe('Real title');
  });

  test('a ~~~ fence hides headings too, and the fence ends at the next fence line', () => {
    expect(docTitle('~~~\n# hidden\n~~~\n# Shown', 'x.md')).toBe('Shown');
  });

  test('only level 1 counts; an empty first H1 is skipped like before', () => {
    expect(docTitle('## sub\n# \n# Real', 'x.md')).toBe('Real');
    expect(docTitle('## only sub', 'notes.md')).toBe('notes');
  });

  test('front matter is excluded; markup characters are stripped from the title', () => {
    expect(docTitle('---\ntitle: Other\n---\n# **Bold** `code` title ##\n', 'x.md')).toBe('Bold code title');
  });

  test('spaces left next to stripped markup characters are trimmed', () => {
    expect(docTitle('# * Title *\n', 'x.md')).toBe('Title');
  });

  test('a first H1 that is only markup falls back to the file name (does not scan on)', () => {
    expect(docTitle('# **\n# Real', 'name.md')).toBe('name');
  });

  test('# Title followed by 2500 spaces returns at once', () => {
    const t0 = performance.now();
    expect(docTitle('# Title' + ' '.repeat(2500) + '\n\nBody', 'x.md')).toBe('Title');
    expect(performance.now() - t0).toBeLessThan(50);
  });

  test('CRLF documents', () => {
    expect(docTitle('# Title\r\n\r\nBody', 'x.md')).toBe('Title');
  });
});
