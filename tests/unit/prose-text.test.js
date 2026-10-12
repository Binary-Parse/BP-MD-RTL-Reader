import { describe, test, expect } from 'vitest';
import { proseText, resolveBlockDirection } from '../../src/renderer/bidi.js';

// audit H8: the document direction (and the export's <html lang dir>) was measured on the raw
// Markdown, so code fences, inline code and math out-voted the prose. proseText() is the text a
// reader actually reads: it drops fenced code, inline code spans and $…$ / $$…$$ math.

describe('proseText — fenced code', () => {
  test('drops a backtick fence including its info string and delimiters', () => {
    expect(proseText('# عنوان\n\n```js\nconst a = 1;\n```\nنص')).toBe('# عنوان\n\nنص');
  });

  test('drops a tilde fence', () => {
    expect(proseText('قبل\n~~~\ncode\n~~~\nبعد')).toBe('قبل\nبعد');
  });

  test('a fence is closed only by the same character and at least as many marks', () => {
    // inside a 4-backtick fence a 3-backtick line and a tilde line are content
    const md = 'a\n````\n```\n~~~\nstill code\n````\nb';
    expect(proseText(md)).toBe('a\nb');
    // inside a backtick fence a tilde fence does not close it
    expect(proseText('a\n```\n~~~\nx\n```\nb')).toBe('a\nb');
    // a shorter closing run does not close it
    expect(proseText('a\n````\nx\n```\ny\n````\nb')).toBe('a\nb');
  });

  test('up to three spaces of indentation still open and close a fence; four do not', () => {
    expect(proseText('a\n   ```\ncode\n   ```\nb')).toBe('a\nb');
    expect(proseText('a\n    ```\nstays\n    ```\nb')).toBe('a\n    ```\nstays\n    ```\nb');
  });

  test('a closing fence may be followed by spaces, an unclosed fence runs to the end', () => {
    expect(proseText('a\n```\nx\n```   \nb')).toBe('a\nb');
    expect(proseText('a\n```\nx\ny')).toBe('a');
  });

  test('only a line that IS a fence closes it, not a content line that ends with backticks', () => {
    expect(proseText('a\n```\nx ```\ny\n```\nb')).toBe('a\nb');
  });

  test('a closing fence may not carry an info string', () => {
    expect(proseText('a\n```\nx\n```js\ny\n```\nb')).toBe('a\nb');
  });

  test('a backtick fence info string may not contain a backtick (that line is inline code)', () => {
    expect(proseText('``` not a fence ```\nنص')).toBe('\nنص');
  });

  test('CRLF line endings are handled', () => {
    expect(proseText('a\r\n```\r\ncode\r\n```\r\nb')).toBe('a\r\nb');
  });
});

describe('proseText — inline code', () => {
  test('removes a code span', () => {
    expect(proseText('استخدم `const x` هنا')).toBe('استخدم  هنا');
  });

  test('a longer delimiter run can contain shorter backtick runs', () => {
    expect(proseText('a ``b ` c`` d')).toBe('a  d');
  });

  test('unmatched backticks and mismatched run lengths stay as text', () => {
    expect(proseText('a ` b')).toBe('a ` b');
    expect(proseText('a ``b` c')).toBe('a ``b` c');
    expect(proseText('a `b`` c')).toBe('a `b`` c');
  });

  test('two spans on one line are both removed', () => {
    expect(proseText('x `a` y `b` z')).toBe('x  y  z');
  });

  test('an escaped backtick does not open a span', () => {
    expect(proseText('a \\`b` c')).toBe('a \\`b` c');
    expect(proseText('a \\` b \\` c')).toBe('a \\` b \\` c'); // two escaped ones never pair up
  });

  test('only ONE backtick of a run is escaped: the rest of the run still opens a span', () => {
    // "\``y`" = a literal backtick, then the span `y`
    expect(proseText('x \\``y` z')).toBe('x \\` z');
  });

  test('a run with no closer does not stop later runs from pairing up', () => {
    expect(proseText('a ``b c `d` e')).toBe('a ``b c  e');
  });

  test('a span never reaches into the next line', () => {
    expect(proseText('a `b\nc` d')).toBe('a `b\nc` d');
  });
});

describe('proseText — math', () => {
  test('removes inline math', () => {
    expect(proseText('القيمة $x^2 + y$ هنا')).toBe('القيمة  هنا');
  });

  test('"$5 and $10" is currency, not math (same rule as the renderer)', () => {
    expect(proseText('costs $5 and $10 today')).toBe('costs $5 and $10 today');
  });

  test('an escaped dollar does not open math', () => {
    expect(proseText('a \\$x$ b')).toBe('a \\$x$ b');
  });

  test('"$$" is not inline math', () => {
    expect(proseText('a $$ b')).toBe('a $$ b');
  });

  test('removes a multi-line display block and a one-line display block', () => {
    expect(proseText('قبل\n$$\nE = mc^2\n$$\nبعد')).toBe('قبل\nبعد');
    expect(proseText('قبل\n$$a + b$$\nبعد')).toBe('قبل\nبعد');
  });

  test('an unclosed $$ is just text, nothing after it is swallowed', () => {
    expect(proseText('a\n$$ price\nb')).toBe('a\n$$ price\nb');
  });

  test('a display block may be indented and may open with text after the $$', () => {
    expect(proseText('a\n  $$\nx\n$$\nb')).toBe('a\nb');
    expect(proseText('a\n$$ E = mc^2\nx\n$$\nb')).toBe('a\nb');
  });

  test('a tilde fence may carry a backtick in its info string', () => {
    expect(proseText('a\n~~~ info`x\ncode\n~~~\nb')).toBe('a\nb');
  });

  test('code inside math and math inside code do not confuse each other', () => {
    expect(proseText('a `$x$` b $y$ c')).toBe('a  b  c');
  });
});

describe('proseText — passthrough', () => {
  test('plain prose is returned unchanged, non-strings give an empty string', () => {
    expect(proseText('مرحبا\nhello')).toBe('مرحبا\nhello');
    expect(proseText('')).toBe('');
    expect(proseText(null)).toBe('');
    expect(proseText(undefined)).toBe('');
    expect(proseText(42)).toBe('42');
  });

  test('headings, lists and URLs are not touched', () => {
    const md = '# عنوان\n- بند https://example.com/a_b\n> اقتباس';
    expect(proseText(md)).toBe(md);
  });
});

describe('proseText — document direction (audit H8)', () => {
  const jsFence = ['```js', ...Array.from({ length: 30 }, (_, i) => `const value${i} = compute(${i}); // step ${i}`), '```'].join('\n');

  test('an Arabic article with a 30-line JS fence is rtl on prose, not on raw text', () => {
    // Latin-first so the old majority rule is what decides: the code would out-vote the prose.
    const md = `Docker دليل\n\nهذا شرح مختصر لكيفية تثبيت البرنامج وتشغيله\n\n${jsFence}\n`;
    expect(resolveBlockDirection(md, 'ltr')).toBe('ltr'); // raw text: the code wins (the bug)
    expect(resolveBlockDirection(proseText(md), 'ltr')).toBe('rtl');
  });

  test('an English article with an Arabic string inside a fence stays ltr', () => {
    const md = 'Install the package and run it.\n\n```js\nconst title = "مرحبا بالعالم مرحبا بالعالم مرحبا بالعالم مرحبا بالعالم";\n```\n';
    expect(resolveBlockDirection(md, 'ltr')).toBe('rtl'); // raw text: the Arabic string out-votes the prose (the bug)
    expect(resolveBlockDirection(proseText(md), 'ltr')).toBe('ltr');
    const arabicOnlyInCode = 'x\n```\nمرحبا بالعالم مرحبا بالعالم\n```\n';
    expect(resolveBlockDirection(proseText(arabicOnlyInCode), 'ltr')).toBe('ltr');
  });

  test('an Arabic note whose only Arabic is inline code resolves from its other prose', () => {
    const md = 'Use the `مرحبا بالعالم` constant in your config file please';
    expect(resolveBlockDirection(proseText(md), 'ltr')).toBe('ltr');
  });
});

// Wall-clock budgets are unreliable on a loaded runner (and under mutation testing, where the
// code is instrumented and run in parallel). A linear scan takes 4x as long for 4x the input; a
// quadratic one takes 16x. So the test compares two sizes (best of three runs each) and only
// keeps a very generous absolute ceiling for a catastrophic regression.
// 60 s: the runner's default 5 s limit is not the requirement — the ratio below is — and six
// scans of a megabyte can outlast it when the machine is busy or the code is instrumented.
describe('proseText — linear time', { timeout: 60000 }, () => {
  const SMALL = 256 * 1024;
  const LARGE = 1024 * 1024;
  const best = (input) => {
    let min = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      proseText(input);
      min = Math.min(min, performance.now() - t0);
    }
    return min;
  };
  const expectLinear = (build) => {
    const small = Math.max(best(build(SMALL)), 1);
    const large = best(build(LARGE));
    expect(large).toBeLessThan(5000);
    expect(large / small).toBeLessThan(9); // linear = 4, quadratic = 16
  };
  const repeat = (unit) => (n) => unit.repeat(Math.ceil(n / unit.length));

  test('unmatched backticks on many lines', () => expectLinear(repeat('a `b c\n')));
  test('unmatched backticks on ONE line', () => expectLinear(repeat('a `b c ')));
  test('backtick runs of every length on one line', () => expectLinear((n) => {
    let s = '';
    for (let k = 1; s.length < n; k = (k % 1200) + 1) s += '`'.repeat(k) + 'x ';
    return s;
  }));
  test('lone dollar signs', () => expectLinear(repeat('$a ')));
  test('dollar-space pairs', () => expectLinear(repeat('$ ')));
  test('display-math fence lines', () => expectLinear(repeat('$$\n')));
  test('unclosed display-math openers', () => expectLinear(repeat('$$ x\n')));
  test('fence-looking lines', () => expectLinear(repeat('```\n~~~\n')));
});
