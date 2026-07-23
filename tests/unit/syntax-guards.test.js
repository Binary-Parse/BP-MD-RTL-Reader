import { describe, expect, test } from 'vitest';
import { syntaxRangeAllowed } from '../../src/renderer/editor/syntax-guards.js';

function node(name, parent = null) { return { name, parent }; }

describe('syntaxRangeAllowed', () => {
  test.each(['InlineCode', 'FencedCode', 'CodeBlock', 'Comment', 'Escape'])(
    'rejects regex preview matches nested in %s',
    (name) => {
      const syntaxTree = () => ({ resolveInner: () => node('Text', node(name)) });
      expect(syntaxRangeAllowed({ syntaxTree }, {}, 4, 8)).toBe(false);
    },
  );

  test('accepts ordinary text and degrades safely when no syntax tree is injected', () => {
    const syntaxTree = () => ({ resolveInner: () => node('Text', node('Paragraph')) });
    expect(syntaxRangeAllowed({ syntaxTree }, {}, 4, 8)).toBe(true);
    expect(syntaxRangeAllowed({}, {}, 4, 8)).toBe(true);
  });
});
