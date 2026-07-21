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

// One observer tracks the live frames. Disconnected frames are removed on the following
// microtask (after CM6 can mount a freshly rendered widget) and on every resize callback.
const trackedFrames = new Map();
let overflowObserver = null;
let windowResizeWired = false;
let cleanupScheduled = false;

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

function untrackFrame(frame) {
  const table = trackedFrames.get(frame);
  if (overflowObserver) {
    overflowObserver.unobserve(frame);
    if (table) overflowObserver.unobserve(table);
  }
  trackedFrames.delete(frame);
}

function cleanupDisconnectedFrames() {
  trackedFrames.forEach((_, frame) => {
    if (!frame.isConnected) untrackFrame(frame);
  });
}

function scheduleDisconnectedFrameCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  const run = () => {
    cleanupScheduled = false;
    cleanupDisconnectedFrames();
  };
  if (typeof globalThis.queueMicrotask === 'function') globalThis.queueMicrotask(run);
  else Promise.resolve().then(run);
}

function refreshTrackedFrameOverflow() {
  cleanupDisconnectedFrames();
  trackedFrames.forEach((_, frame) => updateTableFrameOverflow(frame));
}

function ensureWindowResizeListener() {
  if (windowResizeWired || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  windowResizeWired = true;
  // This is the active fallback when ResizeObserver is unavailable, and harmless otherwise.
  window.addEventListener('resize', refreshTrackedFrameOverflow, { passive: true });
}

function ensureOverflowObserver() {
  if (overflowObserver || typeof globalThis.ResizeObserver !== 'function') return overflowObserver;
  overflowObserver = new globalThis.ResizeObserver(refreshTrackedFrameOverflow);
  return overflowObserver;
}

function observeOverflow(frame) {
  const table = frame.querySelector('table');
  const previousTable = trackedFrames.get(frame);
  if (previousTable === table) return;

  const observer = ensureOverflowObserver();
  if (observer && previousTable) observer.unobserve(previousTable);
  if (observer && !previousTable) observer.observe(frame);
  trackedFrames.set(frame, table);
  if (observer && table) observer.observe(table);
  ensureWindowResizeListener();
  scheduleDisconnectedFrameCleanup();
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
