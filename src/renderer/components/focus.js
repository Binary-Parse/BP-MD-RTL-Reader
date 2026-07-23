/**
 * focus.js — keyboard focus helpers for accessible overlays (T-F4) and menus (T-F5).
 *
 * Pure / DOM-light: these compute *what* should receive focus; the renderer keeps
 * the stateful focus-restore stack and does the actual `.focus()`. Splitting it this
 * way keeps the tricky wrap/roving math unit-testable in jsdom, where there is no
 * layout — so visibility is judged by attributes only (real visibility is e2e-tested).
 */

// Natively or explicitly focusable elements. `[tabindex]` also matches tabindex="-1",
// which `isFocusable` then rejects.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[tabindex]',
].join(',');

function isFocusable(el) {
  if (el.hasAttribute('disabled')) return false;
  const ti = el.getAttribute('tabindex');
  if (ti !== null && parseInt(ti, 10) < 0) return false;
  // `hidden`, `aria-hidden="true"`, or an inline display:none anywhere up the chain
  // removes the element from the tab order — these all inherit to descendants. (jsdom
  // has no layout, so this attribute walk is the proxy for real visibility.)
  for (let p = el; p; p = p.parentElement) {
    if (p.nodeType === 1) {
      if (p.hasAttribute('hidden')) return false;
      if (p.getAttribute('aria-hidden') === 'true') return false;
    }
    if (p.style && p.style.display === 'none') return false;
  }
  return true;
}

/** Focusable descendants of `container`, in DOM order. */
export function getFocusable(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return [];
  return Array.prototype.filter.call(container.querySelectorAll(FOCUSABLE_SELECTOR), isFocusable);
}

/**
 * Decide the wrap target for a Tab keystroke inside a focus trap.
 *   - Tab at the last element  → first  (wrap forward)
 *   - Shift+Tab at the first    → last   (wrap backward)
 *   - focus escaped the trap    → first  (pull it back in)
 *   - any interior move         → null   (let the browser advance focus natively)
 * Returns the element to focus, or null when the caller should do nothing.
 */
export function trapTab(focusables, active, shiftKey) {
  if (!focusables || focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const idx = focusables.indexOf(active);
  if (idx === -1) return first;                 // focus is outside the trap
  if (shiftKey) return active === first ? last : null;
  return active === last ? first : null;
}

/**
 * Next index for a roving-tabindex menu given an arrow/Home/End key.
 * `current` may be -1 (nothing focused yet). Returns -1 for non-navigation keys
 * or an empty list, signalling the caller to ignore the event.
 */
export function rovingNext(key, current, count, opts = {}) {
  if (count <= 0) return -1;
  const loop = opts.loop !== false;
  switch (key) {
    case 'ArrowDown':
      if (current < 0) return 0;
      return loop ? (current + 1) % count : Math.min(current + 1, count - 1);
    case 'ArrowUp':
      if (current < 0) return count - 1;
      return loop ? (current - 1 + count) % count : Math.max(current - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return -1;
  }
}
