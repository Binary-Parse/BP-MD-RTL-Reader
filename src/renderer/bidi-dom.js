/**
 * bidi-dom.js — DOM application layer for the RTL moat (T-R1/R2).
 *
 * Thin, testable bridge between the pure src/renderer/bidi.js core (no DOM) and
 * the rendered Markdown tree. It:
 *   - sets per-block direction (dir + data-dir) on paragraphs, headings, list
 *     items, blockquotes and table cells from each block's first-strong char
 *     (T-R1), tagging Arabic-script blocks without overriding their language; and
 *   - inside RTL blocks, isolates inline opposite/neutral runs (inline code,
 *     links, numbers, #tags) in <bdi> so they cannot reorder surrounding RTL
 *     text (T-R2 / the Obsidian failure set).
 *
 * Operates on an injected root element so it runs under jsdom (unit tests) and
 * the real renderer alike. It replaces the old whole-document isArabicHeavy flip
 * with default-correct per-block direction.
 */

import { resolveBlockDirection, needsIsolation, isolate } from './bidi.js';

const ARABIC = /\p{Script=Arabic}/u;
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, .callout';
// Neutral inline runs to isolate inside RTL blocks: #tags or number groups.
// The number group keeps separator-joined sequences (dates 2026-06-01, ranges
// 10-20, times 12:30, decimals 3.14) as ONE run, so a single <bdi> isolates the
// whole number — splitting it would let the parts reorder under the RTL base.
const RUN = /#[\p{L}\p{N}_-]+|\d+(?:[.,:/-]\d+)*/gu;
const HAS_RUN = /#[\p{L}\p{N}_-]|\d/u;
// Text-node parents whose contents must never be re-isolated. Anchors are deliberately
// NOT skipped wholesale: a wikilink whose text is a neutral date (`[[2026-06-01]]`)
// needs its digit run isolated like any other number — only URL-named anchors are
// rejected below, so visible URLs are never fragmented.
const SKIP_PARENT = new Set(['CODE', 'PRE', 'BDI', 'SCRIPT', 'STYLE']);
// Container blocks (li/blockquote/.callout/td/th) whose text is measured for direction
// must not count the letters inside fenced code / inline code / diagrams / math: an
// Arabic callout explaining a 4-line snippet used to compute as "mostly Latin" and
// flipped to dir="ltr" (audit UX-02). The pre/code elements themselves stay LTR via CSS.
const CODEISH = 'pre, code, .mermaid, .katex';
// What else a container must not count when it measures ITS OWN text:
//  - a list item leaves out its nested lists (audit H6): English sub-items used to out-number a
//    short Arabic parent and flip it to ltr. Each nested item resolves its own direction.
//  - a callout leaves out its DEFAULT title (audit H7): "Warning" is a label the app adds, not
//    content; a custom title is content and still counts.
function excludedFromText(el) {
  if (el.nodeName === 'LI') return `${CODEISH}, ul, ol`;
  if (el.classList.contains('callout')) return `${CODEISH}, .callout-title[data-default-title]`;
  return CODEISH;
}
function blockText(el) {
  const excluded = excludedFromText(el);
  if (!el.querySelector(excluded)) return el.textContent || '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll(excluded).forEach((node) => node.remove());
  return clone.textContent || '';
}

/**
 * Per-block direction + Arabic script tagging (T-R1, EC-C6). When `forceDir` is set
 * ('rtl'|'ltr'), EVERY block takes it verbatim — the user (toggle) or the note
 * (front-matter `direction:`) has chosen a direction, which must win over per-block
 * auto-detection. When null (default/AUTO), each block resolves its own dominant-script
 * direction as before.
 */
// A block's pin (a `<!-- dir: … -->` line above it in the note) covers the block and all it
// contains, and wins over the note's forced direction.
const pinOf = (el) => el.closest('[data-pinned]')?.getAttribute('data-pinned') || null;

/**
 * Moves each pin placeholder (`p.bpmd-dir`, block-direction.js) onto the block after it as
 * `data-pinned` and removes the placeholder. Code keeps its own direction (left to right).
 */
export function applyPins(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return root;
  for (const marker of root.querySelectorAll('p.bpmd-dir')) {
    const dir = marker.getAttribute('dir');
    let next = marker.nextElementSibling;
    while (next && next.matches('p.bpmd-dir')) next = next.nextElementSibling;
    if (next && (dir === 'rtl' || dir === 'ltr') && !next.matches('pre, .mermaid')) {
      next.setAttribute('data-pinned', dir);
      next.setAttribute('dir', dir);
    }
    marker.remove();
  }
  return root;
}

export function applyBlockDirection(root, baseDir = 'ltr', forceDir = null) {
  if (!root || typeof root.querySelectorAll !== 'function') return root;
  root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => {
    const text = blockText(el);
    // A pin wins, then a forced direction; otherwise dominant-script (T-R1 fix): an
    // Arabic heading/para that opens with an English word/number must stay RTL.
    const autoDir = resolveBlockDirection(text, baseDir);
    const dir = pinOf(el) || forceDir || autoDir;
    el.setAttribute('dir', dir);
    el.setAttribute('data-dir', dir);
    // Font selection is script-driven. Never invent or overwrite `lang`: Arabic,
    // Persian and Urdu share a script but require different language metadata.
    if (autoDir === 'rtl' && ARABIC.test(text)) el.setAttribute('data-script', 'arabic');
    else el.removeAttribute('data-script');
  });
  applyListDirection(root, baseDir, forceDir);
  return root;
}

/**
 * List containers follow their items (audit H5). Only the <li> carried a dir, so an Arabic
 * <ul>/<ol> stayed LTR: its padding-inline-start (the marker gutter) sat on the wrong side and the
 * bullets landed outside the text column. The marker side follows the container's direction.
 * A list takes the direction of the majority of its DIRECT items (they were just resolved by the
 * block pass); an exact tie takes the base direction; a forced direction wins.
 */
function applyListDirection(root, baseDir, forceDir) {
  root.querySelectorAll('ul, ol').forEach((list) => {
    const items = [...list.children].filter((child) => child.nodeName === 'LI');
    if (items.length === 0) return;
    let rtl = 0;
    for (const item of items) if (item.getAttribute('dir') === 'rtl') rtl++;
    const ltr = items.length - rtl;
    const dir = pinOf(list) || forceDir || (rtl > ltr ? 'rtl' : rtl < ltr ? 'ltr' : baseDir);
    list.setAttribute('dir', dir);
  });
}

/**
 * Table-level direction (T-R9): set dir on each <table> from its first-strong char so
 * RTL tables MIRROR their column order. Done as a SEPARATE pass (not via BLOCK_SELECTOR,
 * which drives the .closest() isolation scoping — adding 'table' there would corrupt it).
 * Per-cell dir is left to applyBlockDirection (td/th stay explicit, not "auto", so the
 * Arabic-font CSS keyed on td[dir="rtl"]/th[dir="rtl"] keeps matching).
 */
export function applyTableDirection(root, baseDir = 'ltr', forceDir = null) {
  if (!root || typeof root.querySelectorAll !== 'function') return root;
  root.querySelectorAll('table').forEach((t) => {
    // RTL-M1: count the SAME text the per-block pass counts — blockText strips
    // pre/code/.mermaid/.katex, so a Latin identifier in one cell no longer flips an
    // otherwise-Arabic table to LTR (unmirrored columns, unswapped arrow traversal).
    const dir = pinOf(t) || forceDir || resolveBlockDirection(blockText(t) || t.textContent || '', baseDir);
    t.setAttribute('dir', dir);
    t.setAttribute('data-dir', dir);
  });
  return root;
}

function wrapInBdi(el, dir = null) {
  const bdi = el.ownerDocument.createElement('bdi');
  if (dir) bdi.setAttribute('dir', dir);
  el.parentNode.insertBefore(bdi, el);
  bdi.appendChild(el);
}

/** Wrap inline code/links inside RTL blocks when they run opposite the block. */
function isolateElements(root, baseDir) {
  root.querySelectorAll('code, a').forEach((el) => {
    if (el.closest('pre') || el.closest('bdi')) return;          // skip code blocks / already isolated
    const block = el.closest(BLOCK_SELECTOR);
    const blockDir = (block && block.getAttribute('dir')) || baseDir;
    if (blockDir !== 'rtl') return;                              // only neutralise foreign runs in RTL context
    // Inline code is conventionally LTR/neutral → always isolate, with an explicit
    // dir so neutral-only snippets (a bare date) cannot inherit the RTL base; links
    // only when their text runs opposite the block (their own strong character then
    // drives dir="auto" correctly, so no explicit dir is needed).
    if (el.nodeName === 'CODE') wrapInBdi(el, 'ltr');
    else if (needsIsolation(el.textContent || '', blockDir)) wrapInBdi(el);
  });
}

/** Wrap neutral number/#tag runs (in text) inside RTL blocks, via isolate(). */
function isolateTextRuns(root, escape) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentNode;
      if (!p || SKIP_PARENT.has(p.nodeName) || typeof p.closest !== 'function') return NodeFilter.FILTER_REJECT;
      if (p.closest('bdi')) return NodeFilter.FILTER_REJECT;     // already isolated — never re-isolate
      if (p.closest('.katex, .mermaid')) return NodeFilter.FILTER_REJECT; // never isolate inside KaTeX/Mermaid (T-F9/F16)
      if (p.nodeName === 'A' && /:\/\//i.test(p.textContent || '')) return NodeFilter.FILTER_REJECT; // a visible URL is one identifier
      const block = p.closest(BLOCK_SELECTOR);
      if (!block || block.getAttribute('dir') !== 'rtl') return NodeFilter.FILTER_REJECT;
      return HAS_RUN.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const targets = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n);

  for (const node of targets) {
    const text = node.nodeValue;
    let html = '';
    let last = 0;
    let m;
    RUN.lastIndex = 0;
    while ((m = RUN.exec(text))) {
      html += escape(text.slice(last, m.index));
      // RTL-H1: a digit group carries no strong character, so a bare <bdi>'s dir="auto"
      // would inherit the RTL base and reorder its separators. #tags keep the bare
      // isolate — their # and letters anchor the auto direction.
      html += m[0].startsWith('#') ? isolate(m[0], escape) : isolate(m[0], escape, 'ltr');
      last = m.index + m[0].length;
    }
    html += escape(text.slice(last));
    const tmp = doc.createElement('span');
    tmp.innerHTML = html;
    const parent = node.parentNode;
    while (tmp.firstChild) parent.insertBefore(tmp.firstChild, node);
    parent.removeChild(node);
  }
}

/** Isolate inline opposite/neutral runs inside RTL blocks (T-R2). */
export function isolateInlineRuns(root, baseDir = 'ltr', escape = (s) => s) {
  if (!root || typeof root.querySelectorAll !== 'function') return root;
  isolateElements(root, baseDir);
  isolateTextRuns(root, escape);
  return root;
}

/**
 * Apply both passes: per-block direction then inline isolation. `forceDir` ('rtl'|'ltr'|null)
 * forces every block/table to that direction (toggle / front-matter choice); null = AUTO.
 * NOTE isolation is intentionally NOT forced — it still uses first-strong needsIsolation off
 * each block's applied dir, so English/number runs inside a forced-RTL block stay isolated.
 */
export function applyBidi(root, { baseDir = 'ltr', escape = (s) => s, forceDir = null } = {}) {
  applyPins(root);
  applyBlockDirection(root, baseDir, forceDir);
  applyTableDirection(root, baseDir, forceDir); // T-R9: mirror RTL table columns (after cells get their dir)
  isolateInlineRuns(root, baseDir, escape);
  return root;
}
