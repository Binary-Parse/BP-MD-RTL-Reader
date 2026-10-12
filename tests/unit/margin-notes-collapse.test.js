// @vitest-environment jsdom
import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  layoutMarginNotes, createMarginNotes, placeMarginHost, pickMarginMode, MARGIN_MARKER_REM,
} from '../../src/renderer/components/margin-notes.js';

describe('layoutMarginNotes (floor under the toggle)', () => {
  test('no note is placed above the minimum top, and the next note stacks below it', () => {
    const out = layoutMarginNotes([
      { id: 'a', top: 10, height: 20 },
      { id: 'b', top: 20, height: 20 },
    ], 10, 60);
    expect(out.get('a')).toBe(60);
    expect(out.get('b')).toBe(90);
  });

  test('a note already below the minimum keeps its anchor', () => {
    expect(layoutMarginNotes([{ id: 'a', top: 200, height: 20 }], 10, 60).get('a')).toBe(200);
  });

  test('without a minimum the first note keeps its anchor even at 0', () => {
    expect(layoutMarginNotes([{ id: 'a', top: 0, height: 20 }], 10).get('a')).toBe(0);
  });
});

describe('pickMarginMode (collapsed preference + gutter room)', () => {
  const fitsOnly = (...modes) => (mode) => modes.includes(mode);

  test('expanded and the cards fit: cards, not forced', () => {
    expect(pickMarginMode({ collapsed: false, fits: fitsOnly('cards', 'markers') })).toEqual({ mode: 'cards', forced: false });
  });

  test('expanded but only markers fit: markers, forced by the narrow gutter', () => {
    expect(pickMarginMode({ collapsed: false, fits: fitsOnly('markers') })).toEqual({ mode: 'markers', forced: true });
  });

  test('collapsed by choice: markers, not forced, and the cards are never measured', () => {
    const fits = vi.fn((mode) => mode === 'markers');
    expect(pickMarginMode({ collapsed: true, fits })).toEqual({ mode: 'markers', forced: false });
    expect(fits).toHaveBeenCalledTimes(1);
    expect(fits).toHaveBeenCalledWith('markers');
  });

  test('not even markers fit: null in both states', () => {
    expect(pickMarginMode({ collapsed: false, fits: fitsOnly() })).toBeNull();
    expect(pickMarginMode({ collapsed: true, fits: fitsOnly() })).toBeNull();
  });
});

describe('placeMarginHost (markers mode)', () => {
  let host; let pane; let column;
  const rect = (left, width) => ({ left, right: left + width, top: 0, bottom: 0, width, height: 0 });

  beforeEach(() => {
    document.body.innerHTML = '<div id="pane"></div><div id="col"></div><aside id="marginNotes"></aside>';
    host = document.getElementById('marginNotes');
    pane = document.getElementById('pane');
    column = document.getElementById('col');
    pane.getBoundingClientRect = () => rect(0, 1000);
    Object.defineProperty(pane, 'clientWidth', { value: 1000, configurable: true });
    Object.defineProperty(pane, 'clientLeft', { value: 0, configurable: true });
  });

  test('a marker column is 1.75rem wide', () => {
    expect(MARGIN_MARKER_REM).toBe(1.75);
  });

  test('LTR: a gutter of exactly 28px fits markers but not a card', () => {
    column.getBoundingClientRect = () => rect(0, 1000 - 90 - 28);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: false, mode: 'markers' })).toBe(true);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: false })).toBe(false);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: false, mode: 'cards' })).toBe(false);
  });

  test('LTR: one pixel under a marker plus the gap does not fit', () => {
    column.getBoundingClientRect = () => rect(0, 1000 - 90 - 27);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: false, mode: 'markers' })).toBe(false);
  });

  test('RTL: markers mirror into the left gutter', () => {
    column.getBoundingClientRect = () => rect(118, 700);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: true, mode: 'markers' })).toBe(true);
    expect(host.style.right).toBe(`${1000 - 118 + 90}px`);
    expect(host.style.left).toBe('auto');
  });

  test('RTL: one pixel under a marker plus the gap does not fit', () => {
    column.getBoundingClientRect = () => rect(117, 700);
    expect(placeMarginHost({ host, pane, column, gap: 90, rootFontSize: 16, rtl: true, mode: 'markers' })).toBe(false);
  });

  test('the host direction follows the reading column so inline sides face the page', () => {
    column.getBoundingClientRect = () => rect(100, 400);
    placeMarginHost({ host, pane, column, gap: 20, rootFontSize: 16, rtl: false });
    expect(host.getAttribute('dir')).toBe('ltr');
    column.getBoundingClientRect = () => rect(500, 400);
    placeMarginHost({ host, pane, column, gap: 20, rootFontSize: 16, rtl: true });
    expect(host.getAttribute('dir')).toBe('rtl');
  });
});

describe('createMarginNotes (collapse toggle and markers)', () => {
  let host; let tops; let notes; let jump; let toggle; let marker;

  const make = () => createMarginNotes({
    doc: document,
    host,
    getNotes: () => notes,
    getAnchorTop: (id) => (id in tops ? tops[id] : null),
    formatTime: (at) => `t${at}`,
    removeLabel: 'Delete highlight',
    toggleLabel: (expanded) => (expanded ? 'Collapse margin notes' : 'Expand margin notes'),
    onJump: jump,
    onRemove: vi.fn(),
    onToggle: toggle,
    onMarker: marker,
  });

  beforeEach(() => {
    document.body.innerHTML = '<aside id="marginNotes"></aside>';
    host = document.getElementById('marginNotes');
    tops = { n1: 300, n2: 310 }; // n3 is lost (no highlight in the document)
    notes = [
      { id: 'n1', text: 'quoted one', note: 'first note', at: 1 },
      { id: 'n2', text: 'quoted two', note: '', at: 2 },
      { id: 'n3', text: 'lost passage', note: 'orphan', at: 3 },
    ];
    jump = vi.fn(); toggle = vi.fn(); marker = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
  });

  test('cards mode: a toggle button comes first, expanded, labelled to collapse', () => {
    make().refresh({ mode: 'cards' });
    const btn = host.firstElementChild;
    expect(btn.classList.contains('mn-toggle')).toBe(true);
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-label')).toBe('Collapse margin notes');
    expect(btn.getAttribute('title')).toBe('Collapse margin notes');
    expect(host.querySelectorAll('.mn')).toHaveLength(2);
    expect(host.querySelectorAll('.mn-dot')).toHaveLength(0);
    expect(host.dataset.mode).toBe('cards');
    expect(host.classList.contains('collapsed')).toBe(false);
  });

  test('refresh with no argument behaves as cards mode', () => {
    make().refresh();
    expect(host.dataset.mode).toBe('cards');
    expect(host.querySelectorAll('.mn')).toHaveLength(2);
  });

  test('markers mode by choice: no cards, one marker per anchored note at its anchor, toggle says expand', () => {
    make().refresh({ mode: 'markers', forced: false });
    expect(host.querySelectorAll('.mn')).toHaveLength(0);
    const dots = [...host.querySelectorAll('.mn-dot')];
    expect(dots.map((d) => d.dataset.hl)).toEqual(['n1', 'n2']);
    expect(dots[0].style.top).toBe('300px');
    expect(dots[1].style.top).toBe('332px'); // 300 + marker height 20 + 12 gap
    const btn = host.querySelector('.mn-toggle');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Expand margin notes');
    expect(host.dataset.mode).toBe('markers');
    expect(host.classList.contains('collapsed')).toBe(true);
    expect(host.hasAttribute('data-forced')).toBe(false);
  });

  test('markers are buttons labelled with the note text, falling back to the quote', () => {
    make().refresh({ mode: 'markers' });
    const [a, b] = host.querySelectorAll('.mn-dot');
    expect(a.tagName).toBe('BUTTON');
    expect(a.getAttribute('type')).toBe('button');
    expect(a.getAttribute('aria-label')).toBe('first note');
    expect(a.getAttribute('title')).toBe('first note');
    expect(b.getAttribute('aria-label')).toBe('quoted two');
  });

  test('forced markers: no toggle (nothing to expand into) and the host is flagged', () => {
    make().refresh({ mode: 'markers', forced: true });
    expect(host.querySelector('.mn-toggle')).toBeNull();
    expect(host.querySelectorAll('.mn-dot')).toHaveLength(2);
    expect(host.dataset.forced).toBe('1');
  });

  test('a later non-forced refresh drops the forced flag', () => {
    const notesUi = make();
    notesUi.refresh({ mode: 'markers', forced: true });
    notesUi.refresh({ mode: 'cards', forced: false });
    expect(host.hasAttribute('data-forced')).toBe(false);
    expect(host.querySelector('.mn-toggle')).not.toBeNull();
  });

  test('the toggle calls onToggle; a marker calls onMarker with its id and the forced flag', () => {
    const notesUi = make();
    notesUi.refresh({ mode: 'markers', forced: false });
    host.querySelector('.mn-toggle').click();
    expect(toggle).toHaveBeenCalledTimes(1);
    host.querySelectorAll('.mn-dot')[1].click();
    expect(marker).toHaveBeenCalledWith('n2', false);
    notesUi.refresh({ mode: 'markers', forced: true });
    host.querySelector('.mn-dot').click();
    expect(marker).toHaveBeenLastCalledWith('n1', true);
    expect(jump).not.toHaveBeenCalled();
  });

  test('no note sits above the toggle: the first card is pushed below it plus a gap', () => {
    tops = { n1: 0, n2: 5 };
    make().refresh({ mode: 'cards' });
    const [first, second] = host.querySelectorAll('.mn');
    expect(first.style.top).toBe('32px');  // toggle 20 + 12
    expect(second.style.top).toBe('64px'); // 32 + card 20 + 12
  });

  test('markers also start below the toggle, but not when forced (no toggle)', () => {
    tops = { n1: 0, n2: 500 };
    const notesUi = make();
    notesUi.refresh({ mode: 'markers', forced: false });
    expect(host.querySelector('.mn-dot').style.top).toBe('32px');
    notesUi.refresh({ mode: 'markers', forced: true });
    expect(host.querySelector('.mn-dot').style.top).toBe('0px');
  });

  test('setActive highlights the matching marker as well as a card', () => {
    const notesUi = make();
    notesUi.refresh({ mode: 'markers' });
    notesUi.setActive('n2');
    const [a, b] = host.querySelectorAll('.mn-dot');
    expect(a.classList.contains('on')).toBe(false);
    expect(b.classList.contains('on')).toBe(true);
  });

  test('re-rendering never duplicates the toggle or markers; clear empties and hides', () => {
    const notesUi = make();
    notesUi.refresh({ mode: 'markers', forced: true });
    notesUi.refresh({ mode: 'markers', forced: true });
    expect(host.querySelectorAll('.mn-dot')).toHaveLength(2);
    notesUi.refresh({ mode: 'cards' });
    notesUi.refresh({ mode: 'cards' });
    expect(host.querySelectorAll('.mn-toggle')).toHaveLength(1);
    notesUi.clear();
    expect(host.hidden).toBe(true);
    expect(host.childElementCount).toBe(0);
  });

  test('the host is hidden when nothing is anchored, even in markers mode', () => {
    tops = {};
    make().refresh({ mode: 'markers' });
    expect(host.hidden).toBe(true);
  });

  test('the toggle icon is a decorative 16px chevron hidden from assistive tech', () => {
    make().refresh({ mode: 'cards' });
    const svg = host.querySelector('.mn-toggle svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('path').getAttribute('d')).toBe('M6 3.5 10.5 8 6 12.5');
  });

  test('the toggle label may be a plain string', () => {
    const ui = createMarginNotes({
      doc: document, host, getNotes: () => notes, getAnchorTop: (id) => tops[id] ?? null,
      formatTime: String, removeLabel: 'x', toggleLabel: 'Fold', onJump: jump, onRemove: vi.fn(), onToggle: toggle, onMarker: marker,
    });
    ui.refresh({ mode: 'cards' });
    expect(host.querySelector('.mn-toggle').getAttribute('aria-label')).toBe('Fold');
  });
});
