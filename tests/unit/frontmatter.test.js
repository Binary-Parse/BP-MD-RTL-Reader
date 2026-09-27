/**
 * frontmatter.test.js — the minimal YAML front-matter parser (T-R6).
 * Pins the fence grammar, the flat-key rule and the direction directive the
 * export/preview pipelines depend on.
 */
import { describe, test, expect } from 'vitest';
import { parseFrontMatter, frontMatterDirection } from '../../src/renderer/markdown/frontmatter.js';

describe('parseFrontMatter (T-R6)', () => {
  test('parses key: value pairs and strips them from the body', () => {
    const { data, body } = parseFrontMatter('---\ndirection: rtl\ntitle: "Hi"\n---\n# Body\n');
    expect(data).toEqual({ direction: 'rtl', title: 'Hi' });
    expect(body).toBe('# Body\n');
  });

  test('no fence → no data, body untouched', () => {
    expect(parseFrontMatter('# Just text')).toEqual({ data: {}, body: '# Just text' });
    expect(parseFrontMatter('')).toEqual({ data: {}, body: '' });
    expect(parseFrontMatter(null)).toEqual({ data: {}, body: '' });
  });

  test('indented keys are never promoted to top-level directives', () => {
    const { data } = parseFrontMatter('---\nplugin:\n  direction: rtl\ntitle: Note\n---\nBody');
    // the nested "direction:" must not surface as a document directive
    expect(data.direction).toBeUndefined();
    expect(data.title).toBe('Note');
  });

  // Audit 7: a leading UTF-8 BOM must not defeat the fence match — otherwise the
  // metadata renders as body text (an <hr> plus visible keys) and direction:/lang:
  // are silently ignored.
  test('a leading UTF-8 BOM is stripped before the fence match', () => {
    const { data, body } = parseFrontMatter('\uFEFF---\r\ndirection: rtl\r\nlang: ar\r\n---\r\n# نص\n');
    expect(data).toEqual({ direction: 'rtl', lang: 'ar' });
    expect(body).toBe('# نص\n');
    expect(frontMatterDirection(data)).toBe('rtl');
  });

  test('exactly one leading BOM is consumed; a bare BOM is not a fence', () => {
    const { data, body } = parseFrontMatter('\uFEFFno fence here');
    expect(data).toEqual({});
    expect(body).toBe('\uFEFFno fence here');
    expect(parseFrontMatter('---\nkey: val\n---\nB').data).toEqual({ key: 'val' });
  });
});
