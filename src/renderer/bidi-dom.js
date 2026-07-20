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

import { resolveDirection, resolveBlockDirection, needsIsolation, isolate } from './bidi.js';

const ARABIC = /\p{Script=Arabic}/u;
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, td, th, .callout';
// Neutral inline runs to isolate inside RTL blocks: #tags or number groups.
// The number group keeps separator-joined sequences (dates 2026-06-01, ranges
// 10-20, times 12:30, decimals 3.14) as ONE run, so a single <bdi> isolates the
// whole number — splitting it would let the parts reorder under the RTL base.
const RUN = /#[\p{L}\p{N}_-]+|\d+(?:[.,:\/-]\d+)*/gu;
const HAS_RUN = /#[\p{L}\p{N}_-]|\d/u;
// Text-node parents whose contents must never be re-isolated.
const SKIP_PARENT = new Set(['CODE', 'PRE', 'A', 'BDI', 'SCRIPT', 'STYLE']);

/**
 * Per-block direction + Arabic script tagging (T-R1, EC-C6). When `forceDir` is set
 * ('rtl'|'ltr'), EVERY block takes it verbatim — the user (toggle) or the note
 * (front-matter `direction:`) has chosen a direction, which must win over per-block
 * auto-detection. When null (default/AUTO), each block resolves its own dominant-script
 * direction as before.
 */
export function applyBlockDirection(root, baseDir = 'ltr', forceDir = null) {
  if (!root || typeof root.querySelectorAll !== 'function') return root;
  root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => {
    const text = el.textContent || '';
    // Forced direction wins for the dir attribute; otherwise dominant-script (T-R1 fix): an
    // Arabic heading/para that opens with an English word/number must stay RTL.
    const autoDir = resolveBlockDirection(text, baseDir);
    const dir = forceDir || autoDir;
    el.setAttribute('dir', dir);
    el.setAttribute('data-dir', dir);
    // Font selection is script-driven. Never invent or overwrite `lang`: Arabic,
    // Persian and Urdu share a script but require different language metadata.
    if (autoDir === 'rtl' && ARABIC.test(text)) el.setAttribute('data-script', 'arabic');
    else el.removeAttribute('data-script');
  });
  return root;
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
    const dir = forceDir || resolveBlockDirection(t.textContent || '', baseDir);
    t.setAttribute('dir', dir);
    t.setAttribute('data-dir', dir);
  });
  return root;
}

function wrapInBdi(el) {
  const bdi = el.ownerDocument.createElement('bdi');
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
    // Inline code is conventionally LTR/neutral → always isolate; links only when
    // their text runs opposite the block (uses the tested needsIsolation core).
    if (el.nodeName === 'CODE' || needsIsolation(el.textContent || '', blockDir)) wrapInBdi(el);
  });
}

/** Wrap neutral number/#tag runs (in text) inside RTL blocks, via isolate(). */
function isolateTextRuns(root, escape) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentNode;
      if (!p || SKIP_PARENT.has(p.nodeName) || typeof p.closest !== 'function') return NodeFilter.FILTER_REJECT;
      if (p.closest('.katex, .mermaid')) return NodeFilter.FILTER_REJECT; // never isolate inside KaTeX/Mermaid (T-F9/F16)
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
      html += isolate(m[0], escape);          // <bdi>…</bdi> from the pure core
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
  applyBlockDirection(root, baseDir, forceDir);
  applyTableDirection(root, baseDir, forceDir); // T-R9: mirror RTL table columns (after cells get their dir)
  isolateInlineRuns(root, baseDir, escape);
  return root;
}
