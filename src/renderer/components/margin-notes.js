const DEFAULT_GAP = 12;
/** Width of a note card in rem; must match `#marginNotes { width }` in components.css. */
export const MARGIN_CARD_REM = 14.5;
/** Width of the collapsed marker column in rem; must match `#marginNotes.collapsed { width }`. */
export const MARGIN_MARKER_REM = 1.75;

/**
 * Place the notes column in the free gutter beside the reading column, without touching the
 * column's own position (the page stays centred whether or not notes exist).
 * `mode` is 'cards' (default) or 'markers'; markers need far less width.
 * Returns false, and leaves the host untouched, when the gutter on that side cannot hold the
 * column plus `gap`. The host's direction follows the reading column so its inline sides
 * always face the page.
 */
export function placeMarginHost({ host, pane, column, gap, rootFontSize, rtl, mode = 'cards' }) {
  const p = pane.getBoundingClientRect();
  const c = column.getBoundingClientRect();
  // Usable box: a vertical scrollbar (right in LTR, left in RTL) is not gutter.
  const innerLeft = p.left + pane.clientLeft;
  const innerRight = innerLeft + pane.clientWidth;
  const width = (mode === 'markers' ? MARGIN_MARKER_REM : MARGIN_CARD_REM) * rootFontSize;
  if (rtl) {
    if (c.left - innerLeft - gap < width) return false;
    host.setAttribute('dir', 'rtl');
    host.style.left = 'auto';
    host.style.right = `${innerRight - c.left + gap}px`;
    return true;
  }
  if (innerRight - c.right - gap < width) return false;
  host.setAttribute('dir', 'ltr');
  host.style.right = 'auto';
  host.style.left = `${c.right - innerLeft + gap}px`;
  return true;
}

/**
 * Decide how the column shows. `collapsed` is the saved preference; `fits(mode)` reports whether
 * the gutter can hold that mode. Returns { mode, forced } or null when nothing fits. `forced`
 * means the user wanted cards but only markers fit (so there is nothing to expand into).
 */
export function pickMarginMode({ collapsed, fits }) {
  if (collapsed) return fits('markers') ? { mode: 'markers', forced: false } : null;
  if (fits('cards')) return { mode: 'cards', forced: false };
  return fits('markers') ? { mode: 'markers', forced: true } : null;
}

export function layoutMarginNotes(items, gap = DEFAULT_GAP, minTop = -Infinity) {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.top - b.item.top || a.index - b.index);
  const out = new Map();
  let floor = minTop;
  for (const { item } of ordered) {
    const top = Math.max(item.top, floor);
    out.set(item.id, top);
    floor = top + item.height + gap;
  }
  return out;
}

function buildCard(doc, note, handlers) {
  const card = doc.createElement('article');
  card.className = note.note ? 'mn' : 'mn hl-only';
  card.dataset.hl = note.id;
  const quote = doc.createElement('span');
  quote.className = 'mn-q';
  quote.setAttribute('dir', 'auto');
  quote.textContent = note.text;
  card.appendChild(quote);
  if (note.note) {
    const text = doc.createElement('p');
    text.className = 'mn-t';
    text.setAttribute('dir', 'auto');
    text.textContent = note.note;
    card.appendChild(text);
  }
  const meta = doc.createElement('div');
  meta.className = 'mn-m';
  const time = doc.createElement('span');
  time.textContent = handlers.formatTime(note.at);
  const remove = doc.createElement('button');
  remove.type = 'button';
  remove.className = 'mn-rm';
  remove.setAttribute('aria-label', typeof handlers.removeLabel === 'function' ? handlers.removeLabel() : handlers.removeLabel);
  remove.textContent = '×';
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    handlers.onRemove(note.id);
  });
  meta.append(time, remove);
  card.appendChild(meta);
  card.addEventListener('click', () => handlers.onJump(note.id));
  return card;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const resolveLabel = (label, ...args) => (typeof label === 'function' ? label(...args) : label);

function buildToggle(doc, expanded, handlers) {
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'mn-toggle';
  btn.setAttribute('aria-expanded', String(expanded));
  const label = resolveLabel(handlers.toggleLabel, expanded);
  btn.setAttribute('aria-label', label);
  btn.title = label;
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M6 3.5 10.5 8 6 12.5');
  svg.appendChild(path);
  btn.appendChild(svg);
  btn.addEventListener('click', () => handlers.onToggle());
  return btn;
}

function buildMarker(doc, note, forced, handlers) {
  const dot = doc.createElement('button');
  dot.type = 'button';
  dot.className = 'mn-dot';
  dot.dataset.hl = note.id;
  const text = note.note || note.text;
  dot.setAttribute('aria-label', text);
  dot.title = text;
  dot.addEventListener('click', () => handlers.onMarker(note.id, forced));
  return dot;
}

export function createMarginNotes({
  doc, host, getNotes, getAnchorTop, formatTime, removeLabel, toggleLabel, onJump, onRemove, onToggle, onMarker,
}) {
  const handlers = { formatTime, removeLabel, toggleLabel, onJump, onRemove, onToggle, onMarker };

  function clear() {
    host.replaceChildren();
    host.hidden = true;
  }

  function refresh({ mode = 'cards', forced = false } = {}) {
    const markers = mode === 'markers';
    host.replaceChildren();
    host.hidden = false;
    host.dataset.mode = mode;
    host.classList.toggle('collapsed', markers);
    if (forced) host.dataset.forced = '1'; else delete host.dataset.forced;
    // A forced narrow gutter has no room to expand into, so it gets no toggle.
    const toggle = forced ? null : buildToggle(doc, !markers, handlers);
    if (toggle) host.appendChild(toggle);
    const anchored = [];
    for (const note of getNotes()) {
      const top = getAnchorTop(note.id);
      if (top == null) continue;
      const el = markers ? buildMarker(doc, note, forced, handlers) : buildCard(doc, note, handlers);
      host.appendChild(el);
      anchored.push({ id: note.id, top, height: el.offsetHeight, card: el });
    }
    host.hidden = anchored.length === 0;
    const minTop = toggle ? toggle.offsetHeight + DEFAULT_GAP : undefined;
    const placed = layoutMarginNotes(anchored, DEFAULT_GAP, minTop);
    for (const entry of anchored) entry.card.style.top = `${placed.get(entry.id)}px`;
  }

  function setActive(id) {
    for (const el of host.querySelectorAll('.mn, .mn-dot')) el.classList.toggle('on', el.dataset.hl === id);
  }

  return { refresh, clear, setActive };
}
