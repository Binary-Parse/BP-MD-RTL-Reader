/**
 * callouts.js — DOM transformer for GitHub/Obsidian callouts (T-F14).
 *
 * Post-processes already-rendered (and DOMPurify-sanitized) blockquotes: when a
 * blockquote's first line is a `[!TYPE]` marker (parsed by the pure
 * markdown.parseCalloutHeader core, injected), it is rewritten into a styled
 * callout — `<div class="callout callout-<type>">` with a title row (icon +
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

/**
 * Remove the first line (up to and including the first '\n') from an element's
 * text flow. Returns true if a newline was found (body text remains in the
 * element), false if the element held only the first line.
 */
function removeFirstLine(p) {
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
 * Transform callout blockquotes under `root` in place.
 * @param {Element} root
 * @param {{parseCalloutHeader: (line:string)=>({type:string,title:string}|null),
 *          resolveDirection?: (text:string, inherited?:string)=>('ltr'|'rtl')}} deps
 * @returns {Element} root
 */
export function transformCallouts(root, { parseCalloutHeader, resolveDirection } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function' || typeof parseCalloutHeader !== 'function') return root;
  const doc = root.ownerDocument;
  root.querySelectorAll('blockquote').forEach((bq) => {
    const firstP = bq.querySelector(':scope > p');
    const firstLine = (firstP ? firstP.textContent : (bq.textContent || '')).split('\n')[0];
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

    const wrap = doc.createElement('div');
    wrap.className = `callout callout-${callout.type}`;
    wrap.setAttribute('data-callout', callout.type);
    // Resolve the callout's own direction from its content (title + body). dir="auto"
    // can't be used on the wrapper because the leading icon glyph is strong-LTR and
    // would force ltr; resolveDirection reads the first strong char of the prose.
    const text = `${callout.title} ${body.textContent || ''}`.trim();
    wrap.setAttribute('dir', (typeof resolveDirection === 'function') ? resolveDirection(text, 'ltr') : 'auto');

    const titleRow = doc.createElement('div');
    titleRow.className = 'callout-title';
    const icon = doc.createElement('span');
    icon.className = 'callout-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = CALLOUT_ICONS[callout.type] || CALLOUT_ICONS.note;
    const titleText = doc.createElement('span');
    titleText.className = 'callout-title-text';
    titleText.setAttribute('dir', 'auto');
    titleText.textContent = callout.title; // plain text via textContent — safe
    titleRow.append(icon, titleText);

    wrap.append(titleRow, body);
    bq.replaceWith(wrap);
  });
  return root;
}
