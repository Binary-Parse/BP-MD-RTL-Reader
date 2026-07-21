/**
 * table-frame.js — local, accessible horizontal containment for rendered Markdown tables.
 *
 * Tables are wrapped after bidi processing so their established `dir` attribute remains
 * untouched. The frame owns horizontal scrolling without allowing a wide table to widen
 * the reading/source pane.
 */

const FRAME_CLASS = 'table-frame';
const labels = {
  ar: 'جدول قابل للتمرير أفقيًا',
  en: 'Scrollable table',
};
const observers = new WeakMap();

export function tableFrameLabel(locale = 'en') {
  return locale === 'ar' ? labels.ar : labels.en;
}

/** Update the focus affordance from the frame's real horizontal overflow. */
export function updateTableFrameOverflow(frame) {
  if (!frame) return false;
  const overflows = frame.scrollWidth > frame.clientWidth + 1;
  if (overflows) frame.setAttribute('tabindex', '0');
  else frame.removeAttribute('tabindex');
  return overflows;
}

function observeOverflow(frame) {
  if (observers.has(frame) || typeof globalThis.ResizeObserver !== 'function') return;
  const observer = new globalThis.ResizeObserver(() => updateTableFrameOverflow(frame));
  observers.set(frame, observer);
  observer.observe(frame);
  const table = frame.querySelector('table');
  if (table) observer.observe(table);
}

/**
 * Idempotently add an accessible local-scroll wrapper around every table below root.
 * The table itself is never re-created or assigned direction attributes here.
 */
export function wrapTablesInFrames(root, { locale = 'en' } = {}) {
  if (!root || typeof root.querySelectorAll !== 'function') return root;

  root.querySelectorAll('table').forEach((table) => {
    let frame = table.parentElement;
    if (!frame || !frame.classList.contains(FRAME_CLASS)) {
      const parent = table.parentNode;
      if (!parent) return;
      frame = table.ownerDocument.createElement('div');
      frame.className = FRAME_CLASS;
      parent.insertBefore(frame, table);
      frame.appendChild(table);
    }

    frame.setAttribute('role', 'region');
    frame.setAttribute('aria-label', tableFrameLabel(locale));
    updateTableFrameOverflow(frame);
    observeOverflow(frame);
  });

  return root;
}
