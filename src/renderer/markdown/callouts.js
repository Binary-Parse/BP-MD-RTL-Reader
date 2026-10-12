/**
 * callouts.js — DOM transformer for GitHub/Obsidian callouts (T-F14).
 *
 * Post-processes already-rendered (and DOMPurify-sanitized) blockquotes: when a
 * blockquote's first line is a `[!TYPE]` marker (parsed by the pure
 * markdown.parseCalloutHeader core, injected), it is rewritten into a styled
 * callout — `<aside class="callout callout-<type>">` with a title row (icon +
 * title text) and a body. Body content is MOVED node-by-node (never re-parsed
 * from a string), so the upstream sanitization is preserved and no untrusted
 * HTML is re-introduced. Operates on an injected root so it runs under jsdom and
 * the real renderer alike, and composes with the bidi pass (R1/R2): the wrapper
 * and title carry dir="auto", and applyBidi later resolves the body blocks.
 */

// Monochrome, deterministic glyphs (text presentation forced where an emoji
// variant exists) so per-OS visual baselines stay stable.
export const CALLOUT_ICONS = Object.freeze({
  note: 'ⓘ',
  tip: '✦',
  important: '❖',
  warning: '⚠︎',
  caution: '✖',
  info: 'ⓘ',
});

// audit M21: a callout with no title of its own shows the name of its type. In an Arabic
// callout that name is Arabic: content follows its own direction, not the interface language
// (the same rule as table alignment, decision D9). Hebrew text is right-to-left too and keeps
// the English name.
export const CALLOUT_TITLES_AR = Object.freeze({
  note: 'ملاحظة',
  tip: 'نصيحة',
  important: 'مهم',
  warning: 'تحذير',
  caution: 'تنبيه',
  info: 'معلومة',
});
const HEBREW = /[\u0590-\u05FF]/;

/**
 * Text of the first visual line of `el`: the run of text before the first hard
 * break. A hard break is a literal '\n' (marked `breaks: false` — a soft break)
 * OR a <br> element (marked `breaks: true` — every newline becomes a <br>). Used
 * to read the `[!TYPE]` marker without dragging the body text in with it.
 */
function firstLineText(el) {
  if (!el) return '';
  let out = '';
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeName === 'BR') break;
    const text = node.textContent || '';
    const nl = text.indexOf('\n');
    if (nl !== -1) return out + text.slice(0, nl);
    out += text;
  }
  return out;
}

/**
 * Remove the first line from an element's flow. The line ends at the first top-level
 * <br> (marked `breaks: true`) or the first '\n' in the text flow (`breaks: false`).
 * Returns true if body content remains in the element, false if it held only the
 * first line (caller then drops the whole paragraph).
 */
function removeFirstLine(p) {
  // breaks:true — the first line ends at a top-level <br>. Drop everything up to and
  // including it; the body remains after.
  for (let node = p.firstChild; node; node = node.nextSibling) {
    if (node.nodeName === 'BR') {
      while (node.previousSibling) node.previousSibling.remove();
      node.remove();
      return true;
    }
  }
  // breaks:false — strip up to and including the first '\n' in the text flow.
  const doc = p.ownerDocument;
  const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const tn of nodes) {
    const nl = tn.nodeValue.indexOf('\n');
    if (nl === -1) { tn.nodeValue = ''; continue; }
    tn.nodeValue = tn.nodeValue.slice(nl + 1);
    return true;
  }
  return false;
}

/**
 * The direction a callout INHERITS at its DOM position: the closest [dir] ancestor
 * decides (a forced-RTL note must not silently re-base its neutral callouts to LTR),
 * the computed style is the second opinion, 'ltr' the last resort.
 */
function inheritedDirection(el, computedDirection) {
  for (let node = el; node; node = node.parentElement) {
    const dir = node.getAttribute && node.getAttribute('dir');
    if (dir === 'rtl' || dir === 'ltr') return dir;
  }
  return computedDirection() === 'rtl' ? 'rtl' : 'ltr';
}

/**
 * The computed direction for callouts under `root`, read once per transform and only when a
 * callout has no `dir` ancestor (audit M16). It was read per callout, after each DOM change,
 * which made the browser restyle the whole note every time: 1,300 callouts took 29 seconds.
 * The root's value stands for all of them: between the root and a blockquote, direction
 * comes from `dir` attributes, which the walk in inheritedDirection has already ruled out.
 */
function rootDirectionReader(root) {
  let known = null;
  return () => {
    if (known === null) {
      const view = (root.ownerDocument && root.ownerDocument.defaultView) || null;
      known = (view && typeof view.getComputedStyle === 'function') ? view.getComputedStyle(root).direction : '';
    }
    return known;
  };
}

/**
 * Transform callout blockquotes under `root` in place.
 * @param {Element} root
 * @param {{parseCalloutHeader: (line:string)=>({type:string,title:string}|null),
 *          resolveDirection?: (text:string, inherited?:string)=>('ltr'|'rtl')}} deps
 * @returns {Element} root
 */
export function transformCallouts(root, { parseCalloutHeader, resolveDirection } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function' || typeof parseCalloutHeader !== 'function') return root;
  const doc = root.ownerDocument;
  const computedDirection = rootDirectionReader(root);
  root.querySelectorAll('blockquote').forEach((bq) => {
    const firstP = bq.querySelector(':scope > p');
    const firstLine = firstLineText(firstP || bq);
    const callout = parseCalloutHeader(firstLine);
    if (!callout) return;

    // Drop the marker line: keep the rest of the first paragraph when the body
    // shares it (a newline followed), otherwise remove the whole first paragraph.
    if (firstP) {
      const bodyRemains = removeFirstLine(firstP);
      if (!bodyRemains) firstP.remove();
    }

    const body = doc.createElement('div');
    body.className = 'callout-body';
    while (bq.firstChild) body.appendChild(bq.firstChild); // move sanitized nodes

    const wrap = doc.createElement('aside');
    wrap.className = `callout callout-${callout.type}`;
    wrap.setAttribute('data-callout', callout.type);
    wrap.setAttribute('role', 'note');
    const typeLabel = callout.type.charAt(0).toUpperCase() + callout.type.slice(1);
    // Resolve the callout's own direction from its content (title + body) on top of the
    // INHERITED base (the note's forced direction), so neutral content keeps the note's
    // direction instead of defaulting to LTR. dir="auto" can't be used on the wrapper
    // because the leading icon glyph is strong-LTR and would force ltr; resolveDirection
    // reads the first strong char of the prose.
    // The DEFAULT title ("Warning", "Note", …) is a Latin label the app adds, not content (audit
    // H7): it is left out here and marked for the later bidi pass. A custom title still counts.
    const isDefaultTitle = callout.title === typeLabel;
    const text = `${isDefaultTitle ? '' : callout.title} ${body.textContent || ''}`;
    const dir = (typeof resolveDirection === 'function') ? resolveDirection(text, inheritedDirection(bq, computedDirection)) : 'auto';
    wrap.setAttribute('dir', dir);
    const arabicLabel = dir === 'rtl' && !HEBREW.test(text) ? CALLOUT_TITLES_AR[callout.type] : null;
    const shownType = arabicLabel || typeLabel;
    const shownTitle = isDefaultTitle ? shownType : callout.title;
    wrap.setAttribute('aria-label', isDefaultTitle ? shownType : `${shownType}: ${callout.title}`);

    const titleRow = doc.createElement('div');
    titleRow.className = 'callout-title';
    if (isDefaultTitle) titleRow.setAttribute('data-default-title', '');
    const icon = doc.createElement('span');
    icon.className = 'callout-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = CALLOUT_ICONS[callout.type] || CALLOUT_ICONS.note;
    const titleText = doc.createElement('span');
    titleText.className = 'callout-title-text';
    titleText.textContent = shownTitle; // plain text via textContent — safe
    titleRow.append(icon, titleText);

    wrap.append(titleRow, body);
    bq.replaceWith(wrap);
  });
  return root;
}
