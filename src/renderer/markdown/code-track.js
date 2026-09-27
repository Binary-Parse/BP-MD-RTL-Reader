/**
 * code-track.js — which fenced code block is "current" for a scroll position.
 *
 * The reading view keeps ONE floating copy button that follows whichever code
 * block is in view while the reader scrolls up or down. This module holds the
 * pure decision (mirrors outline.js `activeHeading`: the last block whose top
 * has reached the viewport midline) so the rule is unit-testable without DOM.
 */

/**
 * Index of the current code block, or -1 when none applies (scrolled above the
 * first block, or an empty list).
 * @param {Array<{top: number}>} blocks ascending content-coordinate tops
 * @param {number} scrollTop  scroller's content coordinate at the viewport top
 * @param {number} viewportH  visible height of the scroller
 * @returns {number}
 */
export function activeCodeBlock(blocks, scrollTop, viewportH) {
  if (!Array.isArray(blocks) || blocks.length === 0) return -1;
  if (!Number.isFinite(scrollTop) || !Number.isFinite(viewportH) || viewportH <= 0) return -1;
  const mid = scrollTop + viewportH / 2;
  let idx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const top = blocks[i] && typeof blocks[i].top === 'number' ? blocks[i].top : NaN;
    if (!Number.isFinite(top)) continue;
    if (top <= mid) idx = i;
    else break;
  }
  return idx;
}
