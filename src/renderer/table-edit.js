/**
 * table-edit.js — pure GFM-table editing engine (interactive table controls).
 *
 * Parses the markdown table containing a caret offset, applies a structural op (insert/delete
 * row or column, navigate to next/previous cell), and re-serializes. No DOM/CM6 dependency, so
 * it's fully unit-testable; the renderer (app.js) wires it to the toolbar + Tab key.
 */

function pipeIsEscaped(line, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && line[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function tokenizeCells(line) {
  const raw = String(line);
  let start = 0; while (start < raw.length && /\s/.test(raw[start])) start++;
  let end = raw.length; while (end > start && /\s/.test(raw[end - 1])) end--;
  const leading = raw[start] === '|';
  const trailing = end > start && raw[end - 1] === '|' && !pipeIsEscaped(raw, end - 1);
  if (leading) start++;
  if (trailing) end--;

  const cells = [];
  const spans = [];
  let cellStart = start;
  const push = (cellEnd) => {
    const value = raw.slice(cellStart, cellEnd).trim();
    let contentStart = cellStart;
    let contentEnd = cellEnd;
    while (contentStart < contentEnd && /\s/.test(raw[contentStart])) contentStart++;
    while (contentEnd > contentStart && /\s/.test(raw[contentEnd - 1])) contentEnd--;
    cells.push(value);
    spans.push({ start: contentStart, end: contentEnd });
  };
  for (let i = start; i < end; i++) {
    if (raw[i] === '|' && !pipeIsEscaped(raw, i)) {
      push(i);
      cellStart = i + 1;
    }
  }
  push(end);
  return { cells, spans, leading, trailing };
}
function splitCells(line) { return tokenizeCells(line).cells; }
function isRow(line) { return typeof line === 'string' && line.includes('|') && line.trim() !== ''; }
function isDelim(line) { return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line || ''); }
function alignOf(cell) { const l = cell.startsWith(':'), r = cell.endsWith(':'); return l && r ? 'center' : r ? 'right' : l ? 'left' : 'none'; }
function delimCell(a) { return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'; }

/** Parse the table around `pos`, or null. Returns model + caret cell {rowKind,row,col}. */
export function tableAt(text, pos) {
  const lines = String(text).split('\n');
  const starts = []; let off = 0;
  for (const l of lines) { starts.push(off); off += l.length + 1; }
  let li = lines.length - 1;
  for (let i = 0; i < lines.length; i++) { if (pos >= starts[i] && pos <= starts[i] + lines[i].length) { li = i; break; } }
  if (!isRow(lines[li])) return null;
  let top = li, bot = li;
  while (top > 0 && isRow(lines[top - 1])) top--;
  while (bot < lines.length - 1 && isRow(lines[bot + 1])) bot++;
  if (bot - top < 1 || !isDelim(lines[top + 1])) return null; // need header + delimiter
  const header = splitCells(lines[top]);
  const headerTokens = tokenizeCells(lines[top]);
  const aligns = splitCells(lines[top + 1]).map(alignOf);
  const body = lines.slice(top + 2, bot + 1).map(splitCells);
  const cols = Math.max(header.length, aligns.length, ...body.map((r) => r.length), 1);
  // normalize widths
  const fit = (r) => { const c = r.slice(); while (c.length < cols) c.push(''); return c.slice(0, cols); };
  const t = { from: starts[top], to: starts[bot] + lines[bot].length, header: fit(header), aligns: fit(aligns).map((a) => a || 'none'), body: body.map(fit), cols, edgeStyle: { leading: headerTokens.leading, trailing: headerTokens.trailing } };
  // caret cell
  const rowIdx = li - top; // 0=header,1=delim,2+=body
  const lineText = lines[li];
  const within = pos - starts[li];
  const rowTokens = tokenizeCells(lineText);
  let col = rowTokens.spans.findIndex((span, index) => within <= span.end || index === rowTokens.spans.length - 1);
  if (col < 0) col = 0;
  t.caret = { rowKind: rowIdx <= 1 ? 'header' : 'body', row: rowIdx <= 1 ? -1 : rowIdx - 2, col: Math.min(col, cols - 1) };
  return t;
}

export function serializeTable(t) {
  const edge = t.edgeStyle || { leading: true, trailing: true };
  const row = (cells) => `${edge.leading ? '| ' : ''}${cells.join(' | ')}${edge.trailing ? ' |' : ''}`;
  return [row(t.header), row(t.aligns.map(delimCell)), ...t.body.map(row)].join('\n');
}

/**
 * Apply a table op given the full doc text + caret offset.
 * op ∈ rowAfter|rowBefore|rowDelete|colAfter|colBefore|colDelete|nextCell|prevCell
 * @returns {{from,to,md,caret}}|null  — replace [from,to) with md; set caret offset.
 */
export function tableEdit(text, pos, op) {
  const t = tableAt(text, pos);
  if (!t) return null;
  const { row, col } = t.caret;
  const blank = () => t.header.map(() => '');
  let caretCell = { row: t.caret.row, col, header: t.caret.rowKind === 'header' };

  if (op === 'rowAfter' || op === 'rowBefore') {
    const at = t.caret.rowKind === 'header' ? 0 : row + (op === 'rowAfter' ? 1 : 0);
    t.body.splice(Math.max(0, at), 0, blank());
    caretCell = { row: Math.max(0, at), col, header: false };
  } else if (op === 'rowDelete') {
    if (t.caret.rowKind === 'header') return null; // header can't be deleted
    t.body.splice(row, 1);
    if (t.body.length === 0) t.body.push(blank());
    caretCell = { row: Math.min(row, t.body.length - 1), col, header: false };
  } else if (op === 'colAfter' || op === 'colBefore') {
    const at = col + (op === 'colAfter' ? 1 : 0);
    t.header.splice(at, 0, ''); t.aligns.splice(at, 0, 'none'); t.body.forEach((r) => r.splice(at, 0, ''));
    t.cols++; caretCell = { ...caretCell, col: at };
  } else if (op === 'colDelete') {
    if (t.cols <= 1) return null;
    t.header.splice(col, 1); t.aligns.splice(col, 1); t.body.forEach((r) => r.splice(col, 1));
    t.cols--; caretCell = { ...caretCell, col: Math.min(col, t.cols - 1) };
  } else if (op === 'nextCell' || op === 'prevCell') {
    const dir = op === 'nextCell' ? 1 : -1;
    // flatten header + body rows for linear navigation
    let r = t.caret.rowKind === 'header' ? -1 : row, c = col + dir;
    if (c >= t.cols) { c = 0; r += 1; }
    if (c < 0) { c = t.cols - 1; r -= 1; }
    if (r > t.body.length - 1) { t.body.push(blank()); } // Tab past the end adds a row
    if (r < -1) { r = -1; c = 0; }
    caretCell = { row: r, col: c, header: r === -1 };
  } else {
    return null;
  }

  const md = serializeTable(t);
  // caret offset: start of the target row's line + offset to the cell start
  const outLines = md.split('\n');
  const targetLineIdx = caretCell.header ? 0 : caretCell.row + 2;
  let lineOff = 0; for (let i = 0; i < targetLineIdx; i++) lineOff += outLines[i].length + 1;
  const lineText = outLines[targetLineIdx] || outLines[0];
  // position caret at the start of the target cell content
  const targetTokens = tokenizeCells(lineText);
  const cellStart = targetTokens.spans[Math.min(caretCell.col, targetTokens.spans.length - 1)]?.start || 0;
  return { from: t.from, to: t.to, md, caret: t.from + lineOff + cellStart };
}
