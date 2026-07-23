/**
 * navigation.js — pure link/navigation policy (T-B11 / T-B12).
 * No Electron, no DOM. Decides whether a URL may load in the app, open
 * externally, or be blocked, and which schemes are safe for shell.openExternal.
 */

// Schemes we are willing to hand to the OS (shell.openExternal).
const OPENABLE_SCHEME = /^(https?|mailto|tel):/i;

/**
 * Classify a top-level navigation request.
 * @param {string} url        the navigation target
 * @param {string} appUrl     the app's own page URL (exact match allowed)
 * @returns {{action:'allow'|'external'|'block'}}
 */
function classifyNavigation(url, appUrl) {
  if (typeof url !== 'string') return { action: 'block' };
  // Only the app's exact page may load in the renderer (EC-B6: exact, not substring).
  // `url` is already a string, so strict equality also proves `appUrl` is the
  // same non-empty string; repeating those predicates creates equivalent mutants.
  if (url === appUrl) {
    return { action: 'allow' };
  }
  if (OPENABLE_SCHEME.test(url)) return { action: 'external' };
  return { action: 'block' }; // file:// elsewhere, data:, blob:, javascript:, custom
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
