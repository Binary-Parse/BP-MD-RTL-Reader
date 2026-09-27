/**
 * annotations.js — pure highlight application + re-anchoring (T5.1b).
 *
 * A stored highlight is `{ id, text, note, at, anchor: { headingSlug, ordinal } }`:
 *   - `text`        the exact selected text, re-found in the re-rendered document;
 *   - `headingSlug` the id of the nearest preceding heading (buildTOC assigns those ids), so
 *                   the search is scoped to the section the highlight belongs to;
 *   - `ordinal`     WHICH occurrence of `text` inside that section (0-based).
 *
 * Re-anchoring rule (v1): an exact text match wins; the recorded occurrence is preferred, and
 * the first occurrence is the fallback so a highlight survives text being added above it.
 * When the text is gone entirely the highlight is skipped silently — stored data is never
 * deleted.
 *
 * Selections are limited to a single text node in v1: a selection that crosses element
 * boundaries is refused with a reason the UI can surface, which removes the hardest span
 * splitting cases entirely.
 *
 * DOM-only helpers, but every entry point takes its root (and the selection/range)
 * explicitly, so jsdom can drive them — no layout, no app globals, never innerHTML.
 */

export const HL_CLASS = 'user-hl';
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

function docOf(root) {
  return root && (root.ownerDocument || root);
}

function isHeading(el) {
  return !!(el && el.tagName && /^H[1-6]$/.test(el.tagName));
}

/** True when the node already sits inside an applied highlight (used for idempotence). */
function isInHighlight(node) {
  let el = node && node.nodeType === 3 ? node.parentElement : node;
  while (el) {
    if (el.classList && el.classList.contains(HL_CLASS)) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * True when a highlight with this id is already applied under `root`. Test-and-skip by id is
 * what makes re-applying the SAME stored list idempotent: without it a second pass would find
 * the next unmarked occurrence of the same text and wrap that one instead.
 */
function hasHighlightId(root, id) {
  const wanted = String(id);
  for (const mark of root.querySelectorAll('mark.user-hl')) {
    if (mark.getAttribute('data-hl-id') === wanted) return true;
  }
  return false;
}

/** Text nodes under one element (or the element list), in document order. */
function textNodesOf(elements) {
  const out = [];
  for (const el of elements) {
    const doc = docOf(el);
    if (!doc || typeof doc.createTreeWalker !== 'function') continue;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let node = walker.nextNode();
    while (node) { out.push(node); node = walker.nextNode(); }
  }
  return out;
}

/**
 * The LIVE section for a heading slug: the heading itself plus every following sibling up to
 * the next heading of the same or a higher level. Returns [root] when there is no slug, no
 * such heading, or the document has no headings at all.
 */
export function sectionFor(root, headingSlug) {
  if (!root) return [];
  if (!headingSlug) return [root];
  const heading = docOf(root).getElementById(headingSlug);
  if (!heading || !root.contains(heading)) return [root];
  const nodes = [heading];
  let node = heading.nextElementSibling;
  // ANY following heading re-scopes: the anchor for what comes after it is that heading
  // (see headingSlugFor), so a section never crosses into a following heading's subtree.
  while (node && !isHeading(node)) {
    nodes.push(node);
    node = node.nextElementSibling;
  }
  return nodes;
}

/** The (occurrence+1)-th occurrence of `needle` in the section, or null. */
function findOccurrence(elements, needle, occurrence) {
  if (!needle) return null;
  let seen = 0;
  for (const node of textNodesOf(elements)) {
    if (isInHighlight(node)) continue;
    const haystack = node.nodeValue || '';
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const idx = haystack.indexOf(needle, from);
      if (idx < 0) break;
      if (seen === occurrence) return { node, start: idx, end: idx + needle.length };
      seen += 1;
      from = idx + 1;
    }
  }
  return null;
}

/** How many times `needle` occurs in the section before `range` (its ordinal). */
function occurrenceIndex(elements, needle, range) {
  if (!needle) return 0;
  let seen = 0;
  for (const node of textNodesOf(elements)) {
    const haystack = node.nodeValue || '';
    // Everything before the selection counts in full; the selection's own node counts only
    // up to the caret. Stop there — matches AFTER the range are a different occurrence.
    const isStart = node === range.startContainer;
    const limit = isStart ? range.startOffset : haystack.length;
    let from = 0;
    while (from <= limit - needle.length) {
      const idx = haystack.indexOf(needle, from);
      if (idx < 0 || idx >= limit) break;
      seen += 1;
      from = idx + 1;
    }
    if (isStart) return seen;
  }
  return seen;
}

/**
 * Wrap one occurrence in a <mark class="user-hl">. Range.extractContents + insertNode keeps
 * any inline markup inside the span intact and never uses innerHTML.
 */
function wrapRange(root, node, start, end, id) {
  const doc = docOf(root);
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const mark = doc.createElement('mark');
  mark.className = HL_CLASS;
  mark.dataset.hlId = String(id || '');
  try {
    mark.appendChild(range.extractContents());
    range.insertNode(mark);
  } catch (_) {
    return false; // detached/odd range — skip rather than corrupt the document
  }
  // extractContents splits the text node at both ends and leaves the zero-length husks
  // behind; they carry no content, so drop them to keep the DOM tidy per highlight.
  dropEmptyText(mark.previousSibling);
  dropEmptyText(mark.nextSibling);
  return true;
}

/** Remove a zero-length text node (never one that still holds whitespace or text). */
function dropEmptyText(node) {
  if (node && node.nodeType === 3 && node.nodeValue === '' && node.parentNode) {
    node.parentNode.removeChild(node);
  }
}

/**
 * Apply every stored highlight to a freshly rendered `root`.
 * @returns {number} how many were actually re-anchored (lost ones are skipped, not deleted).
 */
export function applyHighlights(root, highlights) {
  if (!root || !Array.isArray(highlights)) return 0;
  let applied = 0;
  for (const highlight of highlights) {
    if (!highlight || typeof highlight.text !== 'string' || highlight.text === '') continue;
    // Idempotence by id: re-rendering and re-applying the same list must not walk on to the
    // NEXT occurrence of the same text (findOccurrence skips text already inside a mark).
    if (highlight.id && hasHighlightId(root, highlight.id)) continue;
    const ordinal = Number.isInteger(highlight.anchor && highlight.anchor.ordinal)
      ? highlight.anchor.ordinal : 0;
    const elements = sectionFor(root, highlight.anchor && highlight.anchor.headingSlug);
    const hit = findOccurrence(elements, highlight.text, ordinal)
      || (ordinal > 0 ? findOccurrence(elements, highlight.text, 0) : null);
    if (!hit) continue; // changed text → skip silently, keep the data
    if (wrapRange(root, hit.node, hit.start, hit.end, highlight.id)) applied += 1;
  }
  return applied;
}

/** Nearest preceding heading id for a range start, or '' when the document has none. */
export function headingSlugFor(root, range) {
  if (!root || !range) return '';
  let best = '';
  for (const heading of root.querySelectorAll(HEADING_SELECTOR)) {
    if (!heading.id) continue;
    if (heading.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) {
      best = heading.id;
    }
  }
  return best;
}

/** The stored anchor for a selection range: its section plus its occurrence inside it. */
export function extractAnchor(root, range, text) {
  const headingSlug = headingSlugFor(root, range);
  return { headingSlug, ordinal: occurrenceIndex(sectionFor(root, headingSlug), text, range) };
}

/**
 * v1 selection gate: a single, non-empty text-node selection inside `root` that is not
 * already highlighted. Returns {range, text, anchor} or {error} — never throws, so the UI
 * can decide which reasons deserve a message (only 'multi-node' does).
 */
export function findSingleTextNodeSelection(root, selection) {
  const fail = (error) => ({ range: null, text: '', anchor: null, error });
  if (!root || !selection || selection.rangeCount === 0) return fail('none');
  if (selection.isCollapsed) return fail('collapsed');
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return fail('outside');
  if (range.startContainer.nodeType !== 3 || range.startContainer !== range.endContainer) {
    return fail('multi-node');
  }
  const text = range.toString();
  if (text.trim() === '') return fail('empty');
  if (isInHighlight(range.startContainer)) return fail('already');
  return { range, text, anchor: extractAnchor(root, range, text), error: null };
}

/** Stable id for a new highlight: time + a random suffix (no crypto needed in the renderer). */
export function newHighlightId(now = Date.now(), random = Math.random) {
  return `hl-${now.toString(36)}-${Math.floor(random() * 1e9).toString(36)}`;
}

/**
 * One-line excerpt for the Inspector notes list: whitespace collapsed, hard-capped at `max`
 * characters (with an ellipsis). Pure so the list rendering stays unit-testable in jsdom.
 */
export function noteExcerpt(text, max = 60) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${[...flat].slice(0, Math.max(1, max - 1)).join('')}…`;
}
