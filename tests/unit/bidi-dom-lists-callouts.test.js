/**
 * @vitest-environment jsdom
 *
 * bidi-dom-lists-callouts.test.js — audit H5 / H6 / H7: list containers follow their items, a list
 * item measures only its own text, and the default callout title is not content.
 */
import { describe, test, expect } from 'vitest';
import { applyBlockDirection, applyBidi } from '../../src/renderer/bidi-dom.js';
import { escapeHtml } from '../../src/renderer/i18n.js';

function frag(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

// audit H5: only the <li> carried a dir, so an Arabic <ul> stayed LTR: padding-inline-start (the
// marker gutter) sat on the wrong side and the bullets landed outside the text column.
describe('list containers follow the direction of their items (audit H5)', () => {
  const AR = (n) => `<li>عنصر عربي ${n}</li>`;
  const EN = (n) => `<li>English item ${n}</li>`;

  test('an all-Arabic bullet list and ordered list are rtl', () => {
    const root = frag(`<ul>${AR(1)}${AR(2)}</ul><ol>${AR(3)}${AR(4)}</ol>`);
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('ul').getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('ol').getAttribute('dir')).toBe('rtl');
  });

  test('an all-English list is ltr, also under an rtl base', () => {
    const root = frag(`<ul>${EN(1)}${EN(2)}</ul>`);
    applyBlockDirection(root, 'rtl');
    expect(root.querySelector('ul').getAttribute('dir')).toBe('ltr');
  });

  test('a nested English list inside an Arabic item is ltr while the outer list is rtl', () => {
    const root = frag(`<ul><li>عنصر عربي<ul>${EN(1)}${EN(2)}</ul></li>${AR(2)}</ul>`);
    applyBlockDirection(root, 'ltr');
    const [outer, inner] = root.querySelectorAll('ul');
    expect(outer.getAttribute('dir')).toBe('rtl');
    expect(inner.getAttribute('dir')).toBe('ltr');
  });

  test('the majority of the DIRECT items decides', () => {
    const rtlMajority = frag(`<ul>${AR(1)}${AR(2)}${EN(1)}</ul>`);
    applyBlockDirection(rtlMajority, 'ltr');
    expect(rtlMajority.querySelector('ul').getAttribute('dir')).toBe('rtl');
    const ltrMajority = frag(`<ul>${AR(1)}${EN(1)}${EN(2)}</ul>`);
    applyBlockDirection(ltrMajority, 'rtl');
    expect(ltrMajority.querySelector('ul').getAttribute('dir')).toBe('ltr');
  });

  test('an exact tie takes the base direction', () => {
    const a = frag(`<ul>${AR(1)}${EN(1)}</ul>`);
    applyBlockDirection(a, 'rtl');
    expect(a.querySelector('ul').getAttribute('dir')).toBe('rtl');
    const b = frag(`<ul>${AR(1)}${EN(1)}</ul>`);
    applyBlockDirection(b, 'ltr');
    expect(b.querySelector('ul').getAttribute('dir')).toBe('ltr');
  });

  test('items of nested lists do not vote in the outer list', () => {
    // one Arabic direct item, three English grandchildren: the outer list is still rtl
    const root = frag(`<ul><li>عنصر عربي<ul>${EN(1)}${EN(2)}${EN(3)}</ul></li></ul>`);
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('ul').getAttribute('dir')).toBe('rtl');
  });

  test('a forced direction wins for lists, like for every other block', () => {
    const root = frag(`<ul>${AR(1)}${AR(2)}</ul><ol>${EN(1)}</ol>`);
    applyBlockDirection(root, 'rtl', 'ltr');
    expect(root.querySelector('ul').getAttribute('dir')).toBe('ltr');
    expect(root.querySelector('ol').getAttribute('dir')).toBe('ltr');
    const root2 = frag(`<ul>${EN(1)}</ul>`);
    applyBlockDirection(root2, 'ltr', 'rtl');
    expect(root2.querySelector('ul').getAttribute('dir')).toBe('rtl');
  });

  test('only <li> children vote: a stray element directly inside the list does not', () => {
    const root = frag('<ul><li>عنصر عربي</li><ul><li>English child</li></ul></ul>');
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('ul').getAttribute('dir')).toBe('rtl'); // one rtl item, no ltr voter
  });

  test('empty blocks inherit the base direction', () => {
    const root = frag('<p></p><ul><li></li></ul>');
    applyBlockDirection(root, 'rtl');
    expect(root.querySelector('p').getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('li').getAttribute('dir')).toBe('rtl');
    expect(root.querySelector('ul').getAttribute('dir')).toBe('rtl');
  });

  test('a list without items is left alone', () => {
    const root = frag('<ul></ul>');
    applyBlockDirection(root, 'rtl');
    expect(root.querySelector('ul').hasAttribute('dir')).toBe(false);
  });

  test('a list inside a blockquote resolves through the combined applyBidi pass too', () => {
    const root = frag(`<blockquote><ul>${AR(1)}${AR(2)}</ul></blockquote>`);
    applyBidi(root, { baseDir: 'ltr', escape: escapeHtml });
    expect(root.querySelector('ul').getAttribute('dir')).toBe('rtl');
  });
});

// audit H6: a list item's direction comes from its OWN text. Its nested English sub-items used to
// out-number a short Arabic parent and flip it to ltr.
describe('a list item measures only its own text, not its nested lists (audit H6)', () => {
  test('Arabic parent with two English children: parent rtl, children ltr', () => {
    const root = frag('<ul><li>عنصر عربي<ul><li>First English child</li><li>Second English child</li></ul></li></ul>');
    applyBlockDirection(root, 'ltr');
    const [parent, c1, c2] = root.querySelectorAll('li');
    expect(parent.getAttribute('dir')).toBe('rtl');
    expect(c1.getAttribute('dir')).toBe('ltr');
    expect(c2.getAttribute('dir')).toBe('ltr');
  });

  test('Latin-first Arabic parent: English children no longer outvote it', () => {
    // own text "API عنصر عربي طويل" is Arabic-majority -> rtl; with the children counted the
    // Latin letters would win and flip the parent item to ltr.
    const root = frag('<ul><li>API عنصر عربي طويل<ul><li>First English child</li><li>Second English child</li></ul></li></ul>');
    applyBlockDirection(root, 'ltr');
    const [parent, c1] = root.querySelectorAll('li');
    expect(parent.getAttribute('dir')).toBe('rtl');
    expect(c1.getAttribute('dir')).toBe('ltr');
  });

  test('English parent with Arabic children stays ltr (ordered sub-list too)', () => {
    const root = frag('<ul><li>English parent<ol><li>عنصر عربي أول</li><li>عنصر عربي ثان</li></ol></li></ul>');
    applyBlockDirection(root, 'ltr');
    const [parent, c1] = root.querySelectorAll('li');
    expect(parent.getAttribute('dir')).toBe('ltr');
    expect(c1.getAttribute('dir')).toBe('rtl');
  });

  test('a loose item (paragraph + nested list) measures its paragraph', () => {
    const root = frag('<ul><li><p>عنصر عربي</p><ul><li>Child one</li><li>Child two</li></ul></li></ul>');
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('li').getAttribute('dir')).toBe('rtl');
  });

  test('an item that is only a nested list inherits the base direction', () => {
    const root = frag('<ul><li><ul><li>English child</li></ul></li></ul>');
    applyBlockDirection(root, 'rtl');
    expect(root.querySelector('li').getAttribute('dir')).toBe('rtl');
  });

  test('code inside the item and a nested list are both left out of the measurement', () => {
    const root = frag('<ul><li>عنصر عربي <code>const alpha = beta;</code><ul><li>Child one</li></ul></li></ul>');
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('li').getAttribute('dir')).toBe('rtl');
  });

  test('other containers still count their nested lists (blockquote)', () => {
    const root = frag('<blockquote>Quoted<ul><li>عنصر عربي أول</li><li>عنصر عربي ثان</li><li>عنصر عربي ثالث</li></ul></blockquote>');
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('blockquote').getAttribute('dir')).toBe('rtl');
  });
});

// audit H7: a short Arabic callout carrying the DEFAULT title ("Warning") became LTR because the
// Latin title was counted as prose. The default title is not content; a custom title is.
describe('the default callout title is not counted for direction (audit H7)', () => {
  const callout = (titleAttr, title, body) => frag(
    `<aside class="callout callout-warning"><div class="callout-title"${titleAttr}><span class="callout-icon">⚠︎</span><span class="callout-title-text">${title}</span></div><div class="callout-body"><p>${body}</p></div></aside>`,
  );

  test('default title + short Arabic body → rtl', () => {
    const root = callout(' data-default-title', 'Warning', 'انتبه');
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('rtl');
  });

  test('default title + English body → ltr', () => {
    const root = callout(' data-default-title', 'Warning', 'Be careful');
    applyBlockDirection(root, 'rtl');
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('ltr');
  });

  test('a CUSTOM title still counts: Latin custom title + short Arabic body → ltr', () => {
    const root = callout('', 'Warning about deployment', 'انتبه');
    applyBlockDirection(root, 'rtl');
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('ltr');
  });

  test('a custom Arabic title decides for an English body', () => {
    const root = callout('', 'ملاحظة مهمة', 'Body text in English here');
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('rtl');
  });

  test('the default title is only skipped for measurement; it stays in the DOM', () => {
    const root = callout(' data-default-title', 'Warning', 'انتبه');
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('.callout-title-text').textContent).toBe('Warning');
  });

  test('a callout with no body and a default title inherits the base direction', () => {
    const root = frag('<aside class="callout"><div class="callout-title" data-default-title><span>Note</span></div><div class="callout-body"></div></aside>');
    applyBlockDirection(root, 'rtl');
    expect(root.querySelector('.callout').getAttribute('dir')).toBe('rtl');
  });

  test('a default title marker outside a callout is ignored', () => {
    const root = frag('<blockquote><div class="callout-title" data-default-title>Warning</div> انتبه</blockquote>');
    applyBlockDirection(root, 'ltr');
    expect(root.querySelector('blockquote').getAttribute('dir')).toBe('ltr'); // "Warning" still counted
  });
});
