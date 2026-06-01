/**
 * @vitest-environment jsdom
 *
 * callouts.test.js — T-F14 DOM transformer. Turns rendered blockquotes whose
 * first line is a `[!TYPE]` marker into styled callouts, driven by the pure
 * markdown.parseCalloutHeader core. jsdom-tested like bidi-dom.js.
 */
import { describe, test, expect } from 'vitest';
import { transformCallouts, CALLOUT_ICONS } from '../../src/renderer/callouts.js';
import { parseCalloutHeader } from '../../src/renderer/markdown.js';
import { resolveDirection } from '../../src/renderer/bidi.js';

const opts = { parseCalloutHeader, resolveDirection };
function frag(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

describe('transformCallouts (T-F14)', () => {
  test('transforms a NOTE blockquote into a styled callout (title row + body)', () => {
    const root = frag('<blockquote><p>[!NOTE] Heads up\nBody line.</p></blockquote>');
    transformCallouts(root, opts);
    expect(root.querySelector('blockquote')).toBeNull();
    const c = root.querySelector('.callout');
    expect(c).not.toBeNull();
    expect(c.classList.contains('callout-note')).toBe(true);
    expect(c.getAttribute('data-callout')).toBe('note');
    expect(c.querySelector('.callout-title-text').textContent).toBe('Heads up');
    expect(c.querySelector('.callout-icon').textContent).toBe(CALLOUT_ICONS.note);
    expect(c.querySelector('.callout-icon').getAttribute('aria-hidden')).toBe('true');
    const body = c.querySelector('.callout-body');
    expect(body.textContent).toContain('Body line.');
    expect(body.textContent).not.toContain('[!NOTE]');
  });

  test('all six types map to callout-<type> + data-callout', () => {
    for (const t of ['note', 'tip', 'important', 'warning', 'caution', 'info']) {
      const root = frag(`<blockquote><p>[!${t.toUpperCase()}]\nx</p></blockquote>`);
      transformCallouts(root, opts);
      const c = root.querySelector('.callout');
      expect(c.classList.contains(`callout-${t}`)).toBe(true);
      expect(c.getAttribute('data-callout')).toBe(t);
      expect(c.querySelector('.callout-icon').textContent).toBe(CALLOUT_ICONS[t]);
    }
  });

  test('no title → uses the capitalized type as the title', () => {
    const root = frag('<blockquote><p>[!TIP]\nbody</p></blockquote>');
    transformCallouts(root, opts);
    expect(root.querySelector('.callout-title-text').textContent).toBe('Tip');
  });

  test('marker-only first paragraph removed; body comes from following paragraphs', () => {
    const root = frag('<blockquote><p>[!WARNING]</p><p>First body.</p><p>Second.</p></blockquote>');
    transformCallouts(root, opts);
    const body = root.querySelector('.callout-body');
    expect(body.querySelectorAll('p').length).toBe(2);
    expect(body.textContent).toContain('First body.');
    expect(body.textContent).not.toContain('[!WARNING]');
  });

  test('plain blockquote (not a callout) is left unchanged', () => {
    const root = frag('<blockquote><p>just a normal quote</p></blockquote>');
    transformCallouts(root, opts);
    expect(root.querySelector('blockquote')).not.toBeNull();
    expect(root.querySelector('.callout')).toBeNull();
  });

  test('body preserves inline elements by MOVING nodes (no re-parse)', () => {
    const root = frag('<blockquote><p>[!IMPORTANT] Note\nrun <code>npm test</code> now</p></blockquote>');
    const codeBefore = root.querySelector('code');
    transformCallouts(root, opts);
    const codeAfter = root.querySelector('.callout-body code');
    expect(codeAfter).toBe(codeBefore); // same node moved, not recreated
    expect(codeAfter.textContent).toBe('npm test');
  });

  test('Arabic callout: wrapper resolves rtl (icon does not force ltr); title dir=auto', () => {
    const root = frag('<blockquote><p>[!NOTE] ملاحظة مهمة\nنص عربي.</p></blockquote>');
    transformCallouts(root, opts);
    const c = root.querySelector('.callout');
    expect(c.getAttribute('dir')).toBe('rtl'); // from content, not defeated by the LTR icon glyph
    expect(c.querySelector('.callout-title-text').getAttribute('dir')).toBe('auto');
    expect(c.querySelector('.callout-title-text').textContent).toBe('ملاحظة مهمة');
  });

  test('English callout resolves ltr', () => {
    const root = frag('<blockquote><p>[!TIP] A tip\nbody text.</p></blockquote>');
    transformCallouts(root, opts);
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('ltr');
  });

  test('without injected resolveDirection, wrapper falls back to dir="auto"', () => {
    const root = frag('<blockquote><p>[!NOTE] t\nbody</p></blockquote>');
    transformCallouts(root, { parseCalloutHeader }); // resolveDirection omitted
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('auto');
  });

  test('multiple callouts in one root', () => {
    const root = frag('<blockquote><p>[!NOTE]\na</p></blockquote><blockquote><p>[!TIP]\nb</p></blockquote>');
    transformCallouts(root, opts);
    expect(root.querySelectorAll('.callout').length).toBe(2);
  });

  test('null root / missing parseCalloutHeader → safe no-op', () => {
    expect(() => transformCallouts(null, opts)).not.toThrow();
    expect(transformCallouts(null, opts)).toBeNull();
    const root = frag('<blockquote><p>[!NOTE]\nx</p></blockquote>');
    transformCallouts(root, {}); // no parseCalloutHeader injected
    expect(root.querySelector('blockquote')).not.toBeNull(); // untouched
  });

  test('body content is moved as inert nodes — no script injection', () => {
    // Upstream DOMPurify already sanitized; the transformer only MOVES nodes,
    // never re-serializes a string, so escaped text stays inert text.
    const root = frag('<blockquote><p>[!CAUTION] t\n&lt;script&gt;x&lt;/script&gt; safe</p></blockquote>');
    transformCallouts(root, opts);
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('.callout-body').textContent).toContain('<script>x</script>');
  });
});
