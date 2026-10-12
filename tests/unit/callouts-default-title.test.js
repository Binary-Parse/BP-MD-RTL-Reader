/**
 * @vitest-environment jsdom
 *
 * callouts-default-title.test.js — audit H7. The default title ("Warning", "Note", …) is a Latin
 * label the app adds, not content. It must not decide the callout's direction, and the DOM pass in
 * bidi-dom.js must be able to see which title row is the default one (data-default-title).
 */
import { describe, test, expect } from 'vitest';
import { transformCallouts } from '../../src/renderer/markdown/callouts.js';
import { parseCalloutHeader } from '../../src/renderer/markdown/markdown.js';
import { resolveDirection } from '../../src/renderer/bidi.js';

const opts = { parseCalloutHeader, resolveDirection };
function frag(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

describe('transformCallouts — default title does not drive direction (audit H7)', () => {
  test('`> [!WARNING]` + short Arabic body → rtl, and the title row is marked default', () => {
    const root = frag('<blockquote><p>[!WARNING]\nانتبه</p></blockquote>');
    transformCallouts(root, opts);
    const c = root.querySelector('.callout');
    expect(c.getAttribute('dir')).toBe('rtl');
    expect(c.querySelector('.callout-title').hasAttribute('data-default-title')).toBe(true);
    // audit M21: the default title of an Arabic callout is the Arabic name of its type.
    expect(c.querySelector('.callout-title-text').textContent).toBe('تحذير');
  });

  test('an English body with the default title is ltr', () => {
    const root = frag('<blockquote><p>[!NOTE]\nRemember to save</p></blockquote>');
    transformCallouts(root, opts);
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('ltr');
  });

  test('`> [!NOTE] ملاحظة مهمة` + English body → by content (the custom title counts) = rtl', () => {
    const root = frag('<blockquote><p>[!NOTE] ملاحظة مهمة\ntext in English</p></blockquote>');
    transformCallouts(root, opts);
    const c = root.querySelector('.callout');
    expect(c.getAttribute('dir')).toBe('rtl');
    expect(c.querySelector('.callout-title').hasAttribute('data-default-title')).toBe(false);
  });

  test('a custom Latin title with an Arabic body keeps the title in the measurement → ltr', () => {
    const root = frag('<blockquote><p>[!NOTE] Deployment\nانتبه</p></blockquote>');
    transformCallouts(root, opts);
    const c = root.querySelector('.callout');
    expect(c.getAttribute('dir')).toBe('ltr');
    expect(c.querySelector('.callout-title').hasAttribute('data-default-title')).toBe(false);
  });

  test('a callout without any body text inherits the surrounding direction', () => {
    const root = frag('<div dir="rtl"><blockquote><p>[!TIP]</p></blockquote></div>');
    transformCallouts(root, opts);
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('rtl');
  });

  test('the aria-label of a default-titled callout is the title it shows', () => {
    const root = frag('<blockquote><p>[!WARNING]\nانتبه</p></blockquote>');
    transformCallouts(root, opts);
    expect(root.querySelector('.callout').getAttribute('aria-label')).toBe('تحذير');
    const en = frag('<blockquote><p>[!WARNING]\nBe careful</p></blockquote>');
    transformCallouts(en, opts);
    expect(en.querySelector('.callout').getAttribute('aria-label')).toBe('Warning');
  });
});

describe('transformCallouts — the default title is in the language of the callout (audit M21)', () => {
  const titleOf = (html) => {
    const root = frag(html);
    transformCallouts(root, opts);
    const c = root.querySelector('.callout');
    return { title: c.querySelector('.callout-title-text').textContent, label: c.getAttribute('aria-label'), dir: c.getAttribute('dir') };
  };

  test('each type has an Arabic name in an Arabic callout and its English name in an English one', () => {
    const arabic = { note: 'ملاحظة', tip: 'نصيحة', important: 'مهم', warning: 'تحذير', caution: 'تنبيه', info: 'معلومة' };
    for (const [type, name] of Object.entries(arabic)) {
      const marker = `[!${type.toUpperCase()}]`;
      expect(titleOf(`<blockquote><p>${marker}\nنص عربي قصير</p></blockquote>`).title).toBe(name);
      const english = type.charAt(0).toUpperCase() + type.slice(1);
      expect(titleOf(`<blockquote><p>${marker}\nShort English text</p></blockquote>`).title).toBe(english);
    }
  });

  test('a title the author wrote is never replaced; the label names the type in the callout language', () => {
    expect(titleOf('<blockquote><p>[!NOTE] عنواني\nنص عربي</p></blockquote>'))
      .toEqual({ title: 'عنواني', label: 'ملاحظة: عنواني', dir: 'rtl' });
    expect(titleOf('<blockquote><p>[!NOTE] My title\nEnglish text</p></blockquote>'))
      .toEqual({ title: 'My title', label: 'Note: My title', dir: 'ltr' });
  });

  test('an empty callout inside a right-to-left note takes the Arabic name', () => {
    expect(titleOf('<div dir="rtl"><blockquote><p>[!TIP]</p></blockquote></div>').title).toBe('نصيحة');
  });

  test('a Hebrew callout is right-to-left and keeps the English name', () => {
    expect(titleOf('<blockquote><p>[!NOTE]\nשלום עולם</p></blockquote>')).toEqual({ title: 'Note', label: 'Note', dir: 'rtl' });
  });

  test('without a direction resolver the English name is used', () => {
    const root = frag('<blockquote><p>[!NOTE]\nنص عربي</p></blockquote>');
    transformCallouts(root, { parseCalloutHeader });
    expect(root.querySelector('.callout-title-text').textContent).toBe('Note');
  });
});
