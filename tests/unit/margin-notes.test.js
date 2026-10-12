// @vitest-environment jsdom
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { layoutMarginNotes, createMarginNotes, placeMarginHost } from '../../src/renderer/components/margin-notes.js';

describe('layoutMarginNotes', () => {
  test('keeps non-overlapping notes at their anchors', () => {
    const out = layoutMarginNotes([
      { id: 'a', top: 100, height: 40 },
      { id: 'b', top: 400, height: 30 },
    ], 12);
    expect(out.get('a')).toBe(100);
    expect(out.get('b')).toBe(400);
  });

  test('pushes an overlapping note below the previous one plus the gap', () => {
    const out = layoutMarginNotes([
      { id: 'a', top: 100, height: 50 },
      { id: 'b', top: 110, height: 40 },
      { id: 'c', top: 120, height: 30 },
    ], 12);
    expect(out.get('a')).toBe(100);
    expect(out.get('b')).toBe(162);
    expect(out.get('c')).toBe(214);
  });

  test('orders by anchor, keeping input order for equal anchors', () => {
    const out = layoutMarginNotes([
      { id: 'late', top: 300, height: 20 },
      { id: 'first', top: 50, height: 20 },
      { id: 'tie1', top: 200, height: 20 },
      { id: 'tie2', top: 200, height: 20 },
    ], 10);
    expect([...out.keys()]).toEqual(['first', 'tie1', 'tie2', 'late']);
    expect(out.get('tie1')).toBe(200);
    expect(out.get('tie2')).toBe(230);
    expect(out.get('late')).toBe(300);
  });

  test('uses a 12px gap by default and handles no notes', () => {
    const out = layoutMarginNotes([{ id: 'a', top: 0, height: 10 }, { id: 'b', top: 0, height: 10 }]);
    expect(out.get('b')).toBe(22);
    expect(layoutMarginNotes([]).size).toBe(0);
  });
});

describe('createMarginNotes', () => {
  let host;
  let tops;
  let notes;
  let jump;
  let remove;

  const make = () => createMarginNotes({
    doc: document,
    host,
    getNotes: () => notes,
    getAnchorTop: (id) => (id in tops ? tops[id] : null),
    formatTime: (at) => `t${at}`,
    removeLabel: 'Delete highlight',
    onJump: jump,
    onRemove: remove,
  });

  beforeEach(() => {
    document.body.innerHTML = '<aside id="marginNotes"></aside>';
    host = document.getElementById('marginNotes');
    tops = { n1: 100, n2: 110, n3: 900 };
    notes = [
      { id: 'n1', text: 'quoted one', note: 'first note', at: 1 },
      { id: 'n2', text: 'quoted two', note: '', at: 2 },
      { id: 'n3', text: 'lost passage', note: 'orphan', at: 3 },
    ];
    jump = vi.fn();
    remove = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(50);
  });

  test('renders one card per anchored note with its quote, text and time', () => {
    make().refresh();
    const cards = [...host.querySelectorAll('.mn')];
    expect(cards.map((c) => c.dataset.hl)).toEqual(['n1', 'n2', 'n3']);
    expect(cards[0].querySelector('.mn-t').textContent).toBe('first note');
    expect(cards[0].querySelector('.mn-q').textContent).toBe('quoted one');
    expect(cards[0].querySelector('.mn-m time, .mn-m span').textContent).toBe('t1');
    expect(host.hidden).toBe(false);
  });

  test('a highlight without a note becomes a quote-only card', () => {
    make().refresh();
    const plain = host.querySelector('.mn[data-hl="n2"]');
    expect(plain.classList.contains('hl-only')).toBe(true);
    expect(plain.querySelector('.mn-t')).toBeNull();
    expect(plain.querySelector('.mn-q').textContent).toBe('quoted two');
  });

  test('stacks overlapping cards and keeps distant ones at their anchor', () => {
    make().refresh();
    const top = (id) => host.querySelector(`.mn[data-hl="${id}"]`).style.top;
    expect(top('n1')).toBe('100px');
    expect(top('n2')).toBe('162px');
    expect(top('n3')).toBe('900px');
  });

  test('skips notes whose highlight is no longer in the document', () => {
    delete tops.n3;
    make().refresh();
    expect([...host.querySelectorAll('.mn')].map((c) => c.dataset.hl)).toEqual(['n1', 'n2']);
  });

  test('the delete label may be a function resolved on every render', () => {
    let label = 'Delete one';
    createMarginNotes({
      doc: document, host, getNotes: () => notes, getAnchorTop: (id) => tops[id] ?? null, formatTime: () => '', removeLabel: () => label, onJump: jump, onRemove: remove,
    }).refresh();
    expect(host.querySelector('.mn-rm').getAttribute('aria-label')).toBe('Delete one');
    label = 'Delete two';
  });

  test('the column is visible while the cards are measured', () => {
    host.hidden = true;
    const seen = [];
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => { seen.push(host.hidden); return 40; });
    make().refresh();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((hidden) => hidden === false)).toBe(true);
  });

  test('hides the column when nothing is anchored', () => {
    tops = {};
    make().refresh();
    expect(host.querySelectorAll('.mn').length).toBe(0);
    expect(host.hidden).toBe(true);
  });

  test('re-rendering never duplicates cards', () => {
    const margin = make();
    margin.refresh();
    margin.refresh();
    expect(host.querySelectorAll('.mn').length).toBe(3);
  });

  test('clicking a card jumps to its highlight; the delete button removes it without jumping', () => {
    make().refresh();
    host.querySelector('.mn[data-hl="n1"] .mn-t').click();
    expect(jump).toHaveBeenCalledWith('n1');
    const del = host.querySelector('.mn[data-hl="n2"] .mn-rm');
    expect(del.getAttribute('aria-label')).toBe('Delete highlight');
    del.click();
    expect(remove).toHaveBeenCalledWith('n2');
    expect(jump).toHaveBeenCalledTimes(1);
  });

  test('the active card mirrors the highlighted passage', () => {
    const margin = make();
    margin.refresh();
    margin.setActive('n1');
    expect(host.querySelector('.mn[data-hl="n1"]').classList.contains('on')).toBe(true);
    margin.setActive('n2');
    expect(host.querySelector('.mn[data-hl="n1"]').classList.contains('on')).toBe(false);
    expect(host.querySelector('.mn[data-hl="n2"]').classList.contains('on')).toBe(true);
    margin.setActive(null);
    expect(host.querySelectorAll('.mn.on').length).toBe(0);
  });

  test('clear empties and hides the column', () => {
    const margin = make();
    margin.refresh();
    margin.clear();
    expect(host.children.length).toBe(0);
    expect(host.hidden).toBe(true);
  });
});

describe('card markup and stacking ties', () => {
  test('equal anchors stack in input order using each note height', () => {
    const out = layoutMarginNotes([
      { id: 'x', top: 100, height: 50 },
      { id: 'y', top: 100, height: 20 },
    ], 12);
    expect(out.get('x')).toBe(100);
    expect(out.get('y')).toBe(162);
  });

  test('cards carry auto direction, a button-typed delete control and the cross glyph', () => {
    document.body.innerHTML = '<aside id="marginNotes"></aside>';
    const host = document.getElementById('marginNotes');
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(50);
    createMarginNotes({
      doc: document,
      host,
      getNotes: () => [{ id: 'n1', text: 'quoted', note: 'noted', at: 1 }],
      getAnchorTop: () => 10,
      formatTime: () => 't',
      removeLabel: 'Remove',
      onJump: () => {},
      onRemove: () => {},
    }).refresh();
    expect(host.querySelector('.mn-q').getAttribute('dir')).toBe('auto');
    expect(host.querySelector('.mn-t').getAttribute('dir')).toBe('auto');
    const rm = host.querySelector('.mn-rm');
    expect(rm.getAttribute('type')).toBe('button');
    expect(rm.textContent).toBe('×');
  });
});

describe('placeMarginHost (gutter placement)', () => {
  // Pane 2000px wide, no scrollbar; the reading column (text edge) spans 640..1360.
  // Gap 90px from the column edge to the notes; a card is 14.5rem = 232px at 16px root.
  let host;
  let pane;
  let column;

  const rect = (left, width) => ({ left, right: left + width, top: 0, bottom: 0, width, height: 0 });

  beforeEach(() => {
    document.body.innerHTML = '<div id="pane"></div><div id="col"></div><aside id="marginNotes"></aside>';
    host = document.getElementById('marginNotes');
    pane = document.getElementById('pane');
    column = document.getElementById('col');
    pane.getBoundingClientRect = () => rect(0, 2000);
    Object.defineProperty(pane, 'clientWidth', { value: 2000, configurable: true });
    Object.defineProperty(pane, 'clientLeft', { value: 0, configurable: true });
    column.getBoundingClientRect = () => rect(640, 720);
  });

  test('LTR: the notes sit just past the right edge of the column, without moving it', () => {
    const fits = placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: false });
    expect(fits).toBe(true);
    expect(host.style.left).toBe('1450px');
    expect(host.style.right).toBe('auto');
  });

  test('RTL: the notes mirror to the left gutter and the column stays put', () => {
    const fits = placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: true });
    expect(fits).toBe(true);
    expect(host.style.right).toBe('1450px');
    expect(host.style.left).toBe('auto');
  });

  test('a gutter narrower than one card (14.5rem + gap) reports no fit and leaves the column alone', () => {
    pane.getBoundingClientRect = () => rect(0, 1024);
    Object.defineProperty(pane, 'clientWidth', { value: 1024, configurable: true });
    column.getBoundingClientRect = () => rect(152, 720);
    host.style.left = '';
    const fits = placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: false });
    expect(fits).toBe(false);
    expect(host.style.left).toBe('');
  });

  test('a gutter exactly one card plus the gap wide still fits', () => {
    // free = 2000 - 1678 - 90 = 232, exactly the card width.
    column.getBoundingClientRect = () => ({ left: 0, right: 1678, top: 0, bottom: 0, width: 1678, height: 0 });
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: false })).toBe(true);
  });

  test('a pane scrollbar on the right is not counted as gutter', () => {
    Object.defineProperty(pane, 'clientWidth', { value: 1989, configurable: true });
    column.getBoundingClientRect = () => ({ left: 640, right: 1360, top: 0, bottom: 0, width: 720, height: 0 });
    // free = 1989 - 1360 - 90 = 539 (fits); the 11px scrollbar is excluded from the pane width.
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: false })).toBe(true);
    expect(host.style.left).toBe('1450px');
  });
});

describe('placeMarginHost (edges and mirrored scrollbar)', () => {
  // Gap 90px and a 232px card (14.5rem at 16px) need 322px between the pane edge and the
  // column edge in RTL, or between the column edge and the pane edge in LTR.
  let host;
  let pane;
  let column;

  const rect = (left, width) => ({ left, right: left + width, top: 0, bottom: 0, width, height: 0 });

  beforeEach(() => {
    document.body.innerHTML = '<div id="pane"></div><div id="col"></div><aside id="marginNotes"></aside>';
    host = document.getElementById('marginNotes');
    pane = document.getElementById('pane');
    column = document.getElementById('col');
    pane.getBoundingClientRect = () => rect(0, 2000);
    Object.defineProperty(pane, 'clientWidth', { value: 2000, configurable: true });
    Object.defineProperty(pane, 'clientLeft', { value: 0, configurable: true });
  });

  test('RTL: a column exactly 322px from the pane edge still fits (232px card + 90px gap)', () => {
    column.getBoundingClientRect = () => rect(322, 720);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: true })).toBe(true);
    expect(host.style.right).toBe(`${2000 - 322 + 90}px`);
  });

  test('RTL: one pixel less than a card plus the gap does not fit, and the host is left alone', () => {
    column.getBoundingClientRect = () => rect(321, 720);
    host.style.right = '';
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: true })).toBe(false);
    expect(host.style.right).toBe('');
  });

  test('RTL: a narrow gutter reports no fit', () => {
    pane.getBoundingClientRect = () => rect(0, 1024);
    Object.defineProperty(pane, 'clientWidth', { value: 1024, configurable: true });
    column.getBoundingClientRect = () => rect(152, 720);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: true })).toBe(false);
  });

  test('LTR: positions are measured from the padding edge, past a 11px scrollbar on the left', () => {
    Object.defineProperty(pane, 'clientLeft', { value: 11, configurable: true });
    Object.defineProperty(pane, 'clientWidth', { value: 1989, configurable: true });
    column.getBoundingClientRect = () => rect(640, 720);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: false })).toBe(true);
    expect(host.style.left).toBe(`${1360 - 11 + 90}px`);
  });

  test('RTL: positions are measured from the padding edge, past a 11px scrollbar on the left', () => {
    Object.defineProperty(pane, 'clientLeft', { value: 11, configurable: true });
    Object.defineProperty(pane, 'clientWidth', { value: 1989, configurable: true });
    column.getBoundingClientRect = () => rect(640, 720);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: true })).toBe(true);
    expect(host.style.right).toBe(`${2000 - 640 + 90}px`);
  });

  test('the card width follows the root font size', () => {
    column.getBoundingClientRect = () => rect(0, 1000);
    // free = 2000 - 1000 - 90 = 910. At 32px root font the card is 464px and still fits.
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 32, rtl: false })).toBe(true);
    // At 80px root font the card is 1160px and does not fit.
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 80, rtl: false })).toBe(false);
  });
});

describe('placeMarginHost (RTL boundary past a left scrollbar)', () => {
  test('the fit check counts from the padding edge, not the pane border edge', () => {
    document.body.innerHTML = '<div id="pane"></div><div id="col"></div><aside id="marginNotes"></aside>';
    const host = document.getElementById('marginNotes');
    const pane = document.getElementById('pane');
    const column = document.getElementById('col');
    const rect = (left, width) => ({ left, right: left + width, top: 0, bottom: 0, width, height: 0 });
    pane.getBoundingClientRect = () => rect(0, 2000);
    Object.defineProperty(pane, 'clientWidth', { value: 1989, configurable: true });
    Object.defineProperty(pane, 'clientLeft', { value: 11, configurable: true });
    // Padding edge at 11px: free = 333 - 11 - 90 = 232, exactly a card.
    column.getBoundingClientRect = () => rect(333, 720);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: true })).toBe(true);
    // free = 332 - 11 - 90 = 231, one short.
    column.getBoundingClientRect = () => rect(332, 720);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: true })).toBe(false);
  });
});
