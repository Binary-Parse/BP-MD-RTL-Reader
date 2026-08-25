/**
 * table-edit.test.js — the pure GFM-table editing engine (interactive table controls).
 */
import { describe, test, expect } from 'vitest';
import { tableAt, serializeTable, tableEdit } from '../../src/renderer/components/table-edit.js';

const T = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |';
// offsets: header line 0..8, delim 9..., body1, body2
const posIn = (text, needle) => text.indexOf(needle);

describe('tableAt', () => {
  test('retains escaped content pipes and maps caret columns without edge pipes', () => {
    const escaped = '| A \\| B | C |\n| --- | --- |\n| 1 | 2 |';
    const parsedEscaped = tableAt(escaped, escaped.indexOf('C'));
    expect(parsedEscaped.header).toEqual(['A \\| B', 'C']);
    expect(serializeTable(parsedEscaped)).toBe(escaped);

    const noEdges = 'A | B\n--- | ---\n1 | 2';
    expect(tableAt(noEdges, noEdges.indexOf('B')).caret.col).toBe(1);
    expect(serializeTable(tableAt(noEdges, noEdges.indexOf('B')))).toBe(noEdges);
  });
  test('parses header / aligns / body around a caret in the body', () => {
    const t = tableAt(T, posIn(T, '3'));
    expect(t).toBeTruthy();
    expect(t.header).toEqual(['A', 'B']);
    expect(t.body).toEqual([['1', '2'], ['3', '4']]);
    expect(t.cols).toBe(2);
    expect(t.caret).toEqual({ rowKind: 'body', row: 1, col: 0 }); // "3" is body row 1, col 0
  });
  test('returns null when not in a table', () => {
    expect(tableAt('just text\n', 2)).toBeNull();
    expect(tableAt('| only one line |\n', 3)).toBeNull(); // no delimiter row
  });
  test('round-trips through serializeTable', () => {
    const t = tableAt(T, posIn(T, 'A'));
    expect(serializeTable(t)).toBe(T);
  });
  test('finds an embedded table with exact replacement bounds and uneven row widths', () => {
    const text = 'before\n\n| A | B |\n| :--- | ---: |\n| 1 |\n| 2 | 3 | 4 |\n\nafter';
    const t = tableAt(text, text.indexOf('3'));
    expect(t.from).toBe(text.indexOf('| A'));
    expect(t.to).toBe(text.indexOf('\n\nafter'));
    expect(t.cols).toBe(3);
    expect(t.header).toEqual(['A', 'B', '']);
    expect(t.aligns).toEqual(['left', 'right', 'none']);
    expect(t.body).toEqual([['1', '', ''], ['2', '3', '4']]);
  });
  test('delimiter syntax and line boundaries are strict', () => {
    expect(tableAt('| A |\n| - |\n| 1 |', 0)).toBeTruthy();
    for (const text of [
      '| A |\n| x- |\n| 1 |',
      '| A |\n| --- x |\n| 1 |',
      '| A |\n| |\n| 1 |',
    ]) expect(tableAt(text, 0)).toBeNull();
    expect(tableAt(T, T.indexOf('\n'))?.caret.rowKind).toBe('header');
  });
  test('an even backslash run does not escape a pipe; an odd run does', () => {
    const even = '| A \\\\| B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    expect(tableAt(even, even.indexOf('C')).header).toEqual(['A \\\\', 'B', 'C']);
    const odd = '| A \\\\\\| B | C |\n| --- | --- |\n| 1 | 2 |';
    expect(tableAt(odd, odd.indexOf('C')).header).toEqual(['A \\\\\\| B', 'C']);
  });
});

describe('tableEdit ops', () => {
  function apply(text, needle, op) {
    const r = tableEdit(text, posIn(text, needle), op);
    expect(r).toBeTruthy();
    return text.slice(0, r.from) + r.md + text.slice(r.to);
  }
  test('rowAfter inserts a blank row below the caret row', () => {
    expect(apply(T, '1', 'rowAfter')).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n|  |  |\n| 3 | 4 |');
  });
  test('rowDelete removes the caret row', () => {
    expect(apply(T, '3', 'rowDelete')).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });
  test('rowDelete on the header is a no-op (returns null)', () => {
    expect(tableEdit(T, posIn(T, 'A'), 'rowDelete')).toBeNull();
  });
  test('colAfter inserts a blank column after the caret column', () => {
    expect(apply(T, 'A', 'colAfter')).toBe('| A |  | B |\n| --- | --- | --- |\n| 1 |  | 2 |\n| 3 |  | 4 |');
  });
  test('colDelete removes the caret column', () => {
    expect(apply(T, '2', 'colDelete')).toBe('| A |\n| --- |\n| 1 |\n| 3 |');
  });
  test('colDelete on a single-column table is a no-op', () => {
    const one = '| A |\n| --- |\n| 1 |';
    expect(tableEdit(one, posIn(one, '1'), 'colDelete')).toBeNull();
  });
  test('nextCell at the last cell appends a new row', () => {
    const out = apply(T, '4', 'nextCell'); // caret at last cell → Tab adds a row
    expect(out).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n|  |  |');
  });
  test('preserves column alignments', () => {
    const A = '| A | B |\n| :--- | ---: |\n| 1 | 2 |';
    const out = apply(A, '1', 'rowAfter');
    expect(out).toContain('| :--- | ---: |'); // alignment row intact
  });
  test('rowBefore inserts above; colBefore inserts left', () => {
    expect(apply(T, '1', 'rowBefore')).toBe('| A | B |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n| 3 | 4 |');
    expect(apply(T, 'B', 'colBefore')).toBe('| A |  | B |\n| --- | --- | --- |\n| 1 |  | 2 |\n| 3 |  | 4 |');
  });
  test('prevCell moves backward', () => {
    const r = tableEdit(T, posIn(T, '2'), 'prevCell');
    const full = T.slice(0, r.from) + r.md + T.slice(r.to);
    expect(full[r.caret]).toBe('1'); // from "2" (col1) back to "1" (col0)
  });
  test('an unknown op returns null', () => {
    expect(tableEdit(T, posIn(T, '1'), 'bogus')).toBeNull();
  });
  test('rowAfter from the header inserts the first body row', () => {
    expect(apply(T, 'A', 'rowAfter')).toBe('| A | B |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n| 3 | 4 |');
  });
  test('caret lands inside the target cell', () => {
    const r = tableEdit(T, posIn(T, '1'), 'rowAfter');
    // caret should be within the new blank row
    const full = T.slice(0, r.from) + r.md + T.slice(r.to);
    expect(r.caret).toBeGreaterThan(0);
    expect(full[r.caret - 1]).toBe(' '); // just after "| " of the new row's first cell
  });
  test('caret after colAfter lands in the new (second) column of the caret row', () => {
    const r = tableEdit(T, posIn(T, '3'), 'colAfter'); // caret in body row 1, col 0 → new col 1
    const full = T.slice(0, r.from) + r.md + T.slice(r.to);
    // the target row is "| 3 |  | 4 |"; caret sits at the empty new cell (a '|' follows after a space)
    expect(full.slice(r.caret, r.caret + 1)).toMatch(/[|\s]/);
    expect(full).toContain('| 3 |  | 4 |');
  });
  test('nextCell from the header advances into the header row, then into the body', () => {
    // caret in header cell A (col 0) → nextCell → header col 1 (B)
    const r1 = tableEdit(T, posIn(T, 'A'), 'nextCell');
    const f1 = T.slice(0, r1.from) + r1.md + T.slice(r1.to);
    expect(f1[r1.caret]).toBe('B');
    // caret in header last cell B → nextCell wraps to body row 0 col 0 ("1")
    const r2 = tableEdit(T, posIn(T, 'B'), 'nextCell');
    const f2 = T.slice(0, r2.from) + r2.md + T.slice(r2.to);
    expect(f2[r2.caret]).toBe('1');
  });
  test('navigation never rewrites escaped pipes or adds missing edge pipes', () => {
    const input = 'A \\| B | C\n--- | ---\n1 | 2';
    const result = tableEdit(input, input.indexOf('C'), 'nextCell');
    expect(result.md).toBe(input);
    expect(result.md).toContain('A \\| B');
    expect(result.md.startsWith('|')).toBe(false);
  });
  test('colDelete on the last column moves the caret to the new last column', () => {
    const wide = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |';
    const r = tableEdit(wide, wide.indexOf('C'), 'colDelete');
    expect(r.md).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    const full = wide.slice(0, r.from) + r.md + wide.slice(r.to);
    expect(full[r.caret]).toBe('B'); // caret clamped to the new last header cell
  });
  test('deleting the only body row leaves one blank row', () => {
    const one = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(apply(one, '1', 'rowDelete')).toBe('| A | B |\n| --- | --- |\n|  |  |');
  });
  test('previous-cell navigation crosses into the header and clamps before its first cell', () => {
    const fromBody = tableEdit(T, T.indexOf('1'), 'prevCell');
    expect(fromBody.md[fromBody.caret]).toBe('B');
    const fromHeader = tableEdit(T, T.indexOf('A'), 'prevCell');
    expect(fromHeader.md[fromHeader.caret]).toBe('A');
  });
  test('rowBefore from the header inserts at the first body position', () => {
    expect(apply(T, 'A', 'rowBefore')).toBe('| A | B |\n| --- | --- |\n|  |  |\n| 1 | 2 |\n| 3 | 4 |');
  });
  test('colBefore at the first column inserts at index zero and moves the caret there', () => {
    const result = tableEdit(T, T.indexOf('A'), 'colBefore');
    expect(result.md).toBe('|  | A | B |\n| --- | --- | --- |\n|  | 1 | 2 |\n|  | 3 | 4 |');
    expect(result.caret).toBe(3);
    expect(result.md[result.caret]).toBe('|');
  });
});
