/**
 * navigation.js — pure link/navigation policy (T-B11 / T-B12).
 * No Electron, no DOM. Decides whether a URL opens externally or is blocked,
 * and which schemes are safe for shell.openExternal.
 */

// Schemes we are willing to hand to the OS (shell.openExternal).
const OPENABLE_SCHEME = /^(https?|mailto|tel):/i;

/**
 * Classify a top-level navigation request made after the app page loaded.
 * Nothing is ever allowed to load in the renderer: the app page is loaded once
 * by the main process (`loadURL`, which raises no navigation event), and a
 * note link that resolves to the app's own URL would reload it and lose
 * unsaved work (B5). In-document anchors raise no `will-navigate` either.
 * @param {string} url        the navigation target
 * @returns {{action:'external'|'block'}}
 */
function classifyNavigation(url) {
  if (typeof url !== 'string') return { action: 'block' };
  if (OPENABLE_SCHEME.test(url)) return { action: 'external' };
  return { action: 'block' }; // the app page, file://, data:, blob:, javascript:, custom
}

/**
 * Whether a URL is safe to pass to shell.openExternal (EC-B5).
 * @param {string} url
 * @returns {boolean}
 */
function isExternallyOpenable(url) {
  return typeof url === 'string' && OPENABLE_SCHEME.test(url);
}

module.exports = { classifyNavigation, isExternallyOpenable, OPENABLE_SCHEME };
