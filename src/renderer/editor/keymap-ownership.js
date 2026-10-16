/**
 * keymap-ownership.js — which chords the APP owns instead of CodeMirror (audit H2 / H3).
 *
 * The document keydown handler in app.js is the single owner of these chords. CodeMirror's
 * defaultKeymap also binds them (Mod-i = selectParentSyntax, Mod-/ = toggleComment), and CM6
 * handles a key before the document handler sees it, so the app action ran on the selection CM6
 * had just changed (the whole paragraph italicised, the line commented out). The editor must not
 * bind chords the app owns.
 *
 * Pure and CodeMirror-free so the coverage gate sees it (the adapter is e2e-only).
 */
export const APP_OWNED_KEYS = Object.freeze(['Mod-i', 'Mod-/']);

/**
 * @param {Array<{key?: string}>} bindings  a CM6 keymap array (e.g. defaultKeymap)
 * @returns the same bindings without the ones that use an app-owned chord (order kept)
 */
export function withoutAppOwnedKeys(bindings) {
  return (bindings || []).filter((b) => !APP_OWNED_KEYS.includes(b && b.key));
}
