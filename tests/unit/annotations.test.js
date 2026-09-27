// @vitest-environment jsdom
/**
 * annotations.test.js — T5.1b pure highlight application + anchoring.
 * jsdom: no layout, so every entry point is driven with an explicit root/range/selection.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  HL_CLASS,
  applyHighlights,
  sectionFor,
  headingSlugFor,
  extractAnchor,
  findSingleTextNodeSelection,
  newHighlightId,
  noteExcerpt,
} from '../../src/renderer/markdown/annotations.js';

const DOC_HTML = `
  <h1 id="intro">Intro</h1>
  <p id="p1">Alpha beta gamma.</p>
  <p id="p2">Alpha again, and beta once more.</p>
  <h2 id="details">Details</h2>
  <p id="p3">Alpha in the details section.</p>
`;

function root() {
  const div = document.createElement('div');
  div.innerHTML = DOC_HTML;
  document.body.appendChild(div);
  return div;
}

/** A collapsed-to-one-text-node selection over the first occurrence of `needle`. */
function selectText(container, needle, occurrence = 0) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let seen = 0;
  let node = walker.nextNode();
  while (node) {
    const hay = node.nodeValue || '';
    let from = 0;
    while (from <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, from);
      if (idx < 0) break;
      if (seen === occurrence) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return selection;
      }
      seen += 1;
      from = idx + 1;
    }
    node = walker.nextNode();
  }
  throw new Error(`text not found: ${needle}`);
}

const marks = (el) => [...el.querySelectorAll(`mark.${HL_CLASS}`)];

beforeEach(() => { document.body.innerHTML = ''; });

describe('sectionFor', () => {
  test('scopes a slug to its heading plus the siblings before the next same-level heading', () => {
    const r = root();
    const intro = sectionFor(r, 'intro');
    expect(intro.map((el) => el.id)).toEqual(['intro', 'p1', 'p2']);
    const details = sectionFor(r, 'details');
    expect(details.map((el) => el.id)).toEqual(['details', 'p3']);
  });

  test('falls back to the whole root for an unknown slug or none at all', () => {
    const r = root();
    expect(sectionFor(r, 'nope')).toEqual([r]);
    expect(sectionFor(r, '')).toEqual([r]);
    expect(sectionFor(r, null)).toEqual([r]);
  });
});

describe('headingSlugFor', () => {
  test('returns the nearest preceding heading; a selection inside a heading belongs to it', () => {
    const r = root();
    const inP3 = document.getElementById('p3').firstChild;
    const range = document.createRange();
    range.setStart(inP3, 0);
    range.setEnd(inP3, 5);
    expect(headingSlugFor(r, range)).toBe('details');
    // A selection in the heading's own text anchors to that heading (its section includes
    // the heading text), which is what applyHighlights then searches.
    const h1Text = document.getElementById('intro').firstChild;
    const inHeading = document.createRange();
    inHeading.setStart(h1Text, 0);
    inHeading.setEnd(h1Text, 5);
    expect(headingSlugFor(r, inHeading)).toBe('intro');
    expect(headingSlugFor(r, null)).toBe('');
  });
});

describe('extractAnchor', () => {
  test('records the section and the occurrence index inside it', () => {
    const r = root();
    const first = selectText(r, 'beta', 0);
    expect(extractAnchor(r, first.getRangeAt(0), 'beta')).toEqual({ headingSlug: 'intro', ordinal: 0 });
    const second = selectText(r, 'beta', 1); // the one in #p2
    expect(extractAnchor(r, second.getRangeAt(0), 'beta')).toEqual({ headingSlug: 'intro', ordinal: 1 });
    const inDetails = selectText(r, 'Alpha', 2); // p3 is the third occurrence in the document
    expect(extractAnchor(r, inDetails.getRangeAt(0), 'Alpha')).toEqual({ headingSlug: 'details', ordinal: 0 });
  });
});

describe('applyHighlights', () => {
  test('wraps the stored occurrence in a mark.user-hl and reports how many applied', () => {
    const r = root();
    const applied = applyHighlights(r, [
      { id: 'h1', text: 'beta', anchor: { headingSlug: 'intro', ordinal: 0 } },
      { id: 'h2', text: 'Alpha in the details', anchor: { headingSlug: 'details', ordinal: 0 } },
    ]);
    expect(applied).toBe(2);
    expect(marks(r)).toHaveLength(2);
    expect(marks(r)[0].textContent).toBe('beta');
    expect(marks(r)[0].dataset.hlId).toBe('h1');
    expect(r.querySelector('#p3 mark').textContent).toBe('Alpha in the details');
  });

  test('prefers the recorded occurrence so a second highlight in the same section is exact', () => {
    const r = root();
    applyHighlights(r, [{ id: 'h1', text: 'beta', anchor: { headingSlug: 'intro', ordinal: 1 } }]);
    const mark = marks(r)[0];
    expect(mark.parentElement.id).toBe('p2');
  });

  test('falls back to the first occurrence when the recorded one moved away', () => {
    const r = root();
    applyHighlights(r, [{ id: 'h1', text: 'beta', anchor: { headingSlug: 'intro', ordinal: 9 } }]);
    expect(marks(r)).toHaveLength(1);
    expect(marks(r)[0].parentElement.id).toBe('p1');
  });

  test('skips text that no longer exists, keeping the count honest, and never deletes data', () => {
    const r = root();
    const stored = [
      { id: 'gone', text: 'this sentence was deleted', anchor: { headingSlug: 'intro', ordinal: 0 } },
      { id: 'kep', text: 'gamma', anchor: { headingSlug: 'intro', ordinal: 0 } },
    ];
    expect(applyHighlights(r, stored)).toBe(1);
    expect(marks(r)).toHaveLength(1);
    expect(stored).toHaveLength(2); // untouched
  });

  test('is idempotent: applying the same list twice does not nest or duplicate marks', () => {
    const r = root();
    const list = [{ id: 'h1', text: 'beta', anchor: { headingSlug: 'intro', ordinal: 0 } }];
    expect(applyHighlights(r, list)).toBe(1);
    expect(applyHighlights(r, list)).toBe(0); // already wrapped → not re-found
    expect(marks(r)).toHaveLength(1);
    expect(r.querySelectorAll('mark mark')).toHaveLength(0);
  });

  test('keeps inline markup inside the span (extractContents, not textContent)', () => {
    const r = document.createElement('div');
    r.innerHTML = '<p>plain <em>emphasis here</em> tail</p>';
    document.body.appendChild(r);
    expect(applyHighlights(r, [
      { id: 'h1', text: 'emphasis here', anchor: { headingSlug: '', ordinal: 0 } },
    ])).toBe(1);
    // The selected text lives in one text node INSIDE the <em>, so the minimal wrap is
    // em > mark: the emphasis element survives instead of being flattened into a text node.
    const em = r.querySelector('em');
    expect(em).not.toBeNull();
    expect(em.querySelector('mark.user-hl')).not.toBeNull();
    expect(em.firstChild.tagName).toBe('MARK');
    expect(r.textContent).toBe('plain emphasis here tail'); // no text lost
  });

  test('handles non-arrays, empty text and a missing anchor without throwing', () => {
    const r = root();
    expect(applyHighlights(r, null)).toBe(0);
    expect(applyHighlights(null, [{ text: 'x' }])).toBe(0);
    expect(applyHighlights(r, [{ text: '' }, null, { text: 'gamma' }])).toBe(1);
  });
});

describe('findSingleTextNodeSelection', () => {
  test('accepts a single-text-node selection and returns text + anchor', () => {
    const r = root();
    const sel = selectText(r, 'gamma');
    const out = findSingleTextNodeSelection(r, sel);
    expect(out.error).toBeNull();
    expect(out.text).toBe('gamma');
    expect(out.anchor).toEqual({ headingSlug: 'intro', ordinal: 0 });
  });

  test('refuses a selection that crosses element boundaries (v1)', () => {
    const r = root();
    const range = document.createRange();
    range.setStart(document.getElementById('p1').firstChild, 0);
    range.setEnd(document.getElementById('p2').firstChild, 5);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    expect(findSingleTextNodeSelection(r, sel)).toMatchObject({ error: 'multi-node', range: null });
  });

  test('refuses collapsed, empty, outside and already-highlighted selections', () => {
    const r = root();
    expect(findSingleTextNodeSelection(r, null).error).toBe('none');
    const collapsed = document.createRange();
    collapsed.setStart(document.getElementById('p1').firstChild, 2);
    collapsed.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(collapsed);
    expect(findSingleTextNodeSelection(r, sel).error).toBe('collapsed');

    const space = selectText(r, ' ');
    expect(findSingleTextNodeSelection(r, space).error).toBe('empty');

    const other = root(); // a second, detached-from-r container
    const inOther = selectText(other, 'Alpha');
    expect(findSingleTextNodeSelection(r, inOther).error).toBe('outside');

    applyHighlights(r, [{ id: 'h1', text: 'beta', anchor: { headingSlug: 'intro', ordinal: 0 } }]);
    const inMark = selectText(r, 'beta');
    expect(findSingleTextNodeSelection(r, inMark).error).toBe('already');
  });
});

describe('newHighlightId', () => {
  test('is unique enough and always a string', () => {
    const a = newHighlightId(1000, () => 0.5);
    const b = newHighlightId(1000, () => 0.25);
    expect(typeof a).toBe('string');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^hl-/);
  });
});

describe('noteExcerpt', () => {
  test('collapses whitespace and keeps short text intact', () => {
    expect(noteExcerpt('  hello   world \n')).toBe('hello world');
    expect(noteExcerpt('short')).toBe('short');
  });

  test('caps long text at max with an ellipsis (default 60)', () => {
    const long = 'x'.repeat(200);
    expect(noteExcerpt(long)).toHaveLength(60);
    expect(noteExcerpt(long).endsWith('…')).toBe(true);
    expect(noteExcerpt(long, 10)).toHaveLength(10);
    expect(noteExcerpt(long, 10)).toBe('xxxxxxxxx…');
    // Exactly max is NOT truncated (no pointless ellipsis).
    expect(noteExcerpt('y'.repeat(60))).toBe('y'.repeat(60));
  });

  test('never throws on missing/non-string input', () => {
    expect(noteExcerpt(null)).toBe('');
    expect(noteExcerpt(undefined)).toBe('');
    expect(noteExcerpt(42)).toBe('42');
  });
});
