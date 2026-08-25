// Set the saved theme before first paint (avoids a flash). Externalized for CSP (T-B4).
// T-F19: the chrome-visibility modes ride along, for the same reason. This file is the
// only hook that runs before the stylesheets load, and the CSP forbids an inline script,
// so a second boot script would buy nothing. settings.json remains authoritative — this
// mirror only prevents one frame of the wrong chrome for a user who turned it on.
// Wrapped in try/catch because localStorage throws outright when storage is disabled by
// policy: an exception here would skip the chrome application entirely and reopen the
// very flash this exists to prevent.
(function () {
  try {
    var t = localStorage.getItem('bpmdrtlreader-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable — restoreSettings() still applies the real value */ }
  try {
    var c = localStorage.getItem('bpmdrtlreader-chrome');
    // Allow-list before use. setAttribute cannot be escaped and the CSS selectors use ~=
    // (exact token match), so a corrupt value is inert rather than dangerous — but every
    // other setting is validated before it is applied, and this one should not be the
    // exception just because it happens to be safe.
    if (c && /^(autohide|nostatus|autohide nostatus|nostatus autohide)$/.test(c)) {
      document.documentElement.setAttribute('data-chrome', c);
    }
  } catch (e) { /* as above */ }
  // T-F19: the same signal app.js uses, just earlier. The preload's contextBridge has
  // already run by the time this file executes, and html.electron is what makes .app
  // flush to the window edge and gives the title bar its drag region -- so setting it
  // after first paint meant one frame of the wrong geometry, unlike every other chrome
  // flag above. app.js keeps its own idempotent call for the case where the bridge
  // arrives late.
  if (window.electronAPI) document.documentElement.classList.add('electron');
})();
