/**
 * Unit tests for sourceHeadingPositions() — the outline of the editor source in
 * src/renderer/components/outline.js. (Heading ids come from bidi.headingSlugs,
 * tested in bidi.test.js.)
 */

import { describe, test, expect } from 'vitest';
import { sourceHeadingPositions } from '../../src/renderer/components/outline.js';

describe('sourceHeadingPositions()', () => {
  test('source positions include Setext headings and keep duplicate text identities', () => {
    const md = 'Same\n====\n\n# Same\n\nSub\n---\n';
    expect(sourceHeadingPositions(md)).toEqual([
      { pos: 0, level: 1, text: 'Same' },
      { pos: 11, level: 1, text: 'Same' },
      { pos: 19, level: 2, text: 'Sub' },
    ]);
  });
});
