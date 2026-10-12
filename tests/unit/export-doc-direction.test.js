/**
 * @vitest-environment jsdom
 *
 * export-doc-direction.test.js — audit H8: the exported document's <html lang dir> is decided by
 * the prose of the note, not by the code in it.
 */
import { describe, test, expect } from 'vitest';
import { buildExportDoc } from '../../src/renderer/markdown/export.js';

const md = (s) => `<p>${s}</p>`; // a trivial fake parseMarkdown (direction is decided from the source)

const JS_FENCE = ['```js', ...Array.from({ length: 30 }, (_, i) => `const value${i} = compute(${i}); // step ${i}`), '```'].join('\n');

describe('export <html lang dir> counts prose, not code (audit H8)', () => {
  test('an Arabic article with a 30-line JS fence exports as lang="ar" dir="rtl"', () => {
    const content = `Docker دليل\n\nهذا شرح مختصر لكيفية تثبيت البرنامج وتشغيله\n\n${JS_FENCE}\n`;
    const { fullHtml } = buildExportDoc({ name: 'a.md', content }, { parseMarkdown: md });
    expect(fullHtml).toContain('<html lang="ar" dir="rtl">');
  });

  test('an English article with an Arabic string inside a fence exports as lang="en" dir="ltr"', () => {
    const content = 'Install the package and run it.\n\n```js\nconst title = "مرحبا بالعالم مرحبا بالعالم مرحبا بالعالم مرحبا بالعالم";\n```\n';
    const { fullHtml } = buildExportDoc({ name: 'a.md', content }, { parseMarkdown: md });
    expect(fullHtml).toContain('<html lang="en" dir="ltr">');
  });

  test('inline code and math are ignored too', () => {
    const content = 'Use the `مرحبا بالعالم مرحبا بالعالم` constant and $مرحبا بالعالم مرحبا بالعالم$ here please';
    const { fullHtml } = buildExportDoc({ name: 'a.md', content }, { parseMarkdown: md });
    expect(fullHtml).toContain('<html lang="en" dir="ltr">');
  });

  test('an explicit direction and a front-matter direction still win over the content', () => {
    const forced = buildExportDoc({ name: 'a.md', content: 'Docker\n\n```\nx\n```' }, { parseMarkdown: md, direction: 'rtl' });
    expect(forced.fullHtml).toContain('<html lang="ar" dir="rtl">');
    const fm = buildExportDoc({ name: 'a.md', content: '---\ndirection: rtl\n---\nEnglish only text here' }, { parseMarkdown: md });
    expect(fm.fullHtml).toContain('dir="rtl"');
  });
});
