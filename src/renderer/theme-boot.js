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
    // Allow-list the mirrored value against the real theme tokens (THEMES in theme.js,
    // re-declared here because this boot script cannot be a module without deferring past
    // first paint) — the data-chrome mirror below applies the same rigor. A corrupt value
    // is treated as no stored choice, so the T2.1 system-scheme fallback still runs.
    if (t && /^(paper|ink|sepia|oasis)$/.test(t)) {
      document.documentElement.setAttribute('data-theme', t);
    }
    // T2.1: no mirror at all means either a first run or a profile where the user never
    // chose a theme manually. Follow the OS scheme for that one frame so a dark-system user
    // does not see light-then-dark; settings.json (restoreSettings) remains authoritative.
    else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'ink');
    }
  } catch { /* storage unavailable — restoreSettings() still applies the real value */ }
  try {
    var c = localStorage.getItem('bpmdrtlreader-chrome');
    // Allow-list before use. setAttribute cannot be escaped and the CSS selectors use ~=
    // (exact token match), so a corrupt value is inert rather than dangerous — but every
    // other setting is validated before it is applied, and this one should not be the
    // exception just because it happens to be safe.
    if (c && /^(autohide|nostatus|autohide nostatus|nostatus autohide)$/.test(c)) {
      document.documentElement.setAttribute('data-chrome', c);
    }
  } catch { /* as above */ }
  // Mirror the persisted UI locale onto <html lang/dir> as early as possible so an Arabic
  // user does not spend the whole boot in English/LTR chrome. The app's only locale
  // persistence is settings.json via the async settings bridge (uiLocale in
  // settings-controller.js) — there is no localStorage mirror to read synchronously, so
  // the earliest honest hook is this fire-and-forget getSettings() call, which lands
  // before app.js's own restoreSettings() and stays subordinate to it. Validated against
  // 'en'/'ar' exactly like restoreSettings/setUiLocale; a miss applies nothing.
  if (window.electronAPI && typeof window.electronAPI.getSettings === 'function') {
    window.electronAPI.getSettings().then(function (saved) {
      if (!saved || typeof saved !== 'object') return;
      if (saved.uiLocale !== 'ar' && saved.uiLocale !== 'en') return;
      document.documentElement.setAttribute('lang', saved.uiLocale);
      document.documentElement.setAttribute('dir', saved.uiLocale === 'ar' ? 'rtl' : 'ltr');
    }).catch(function () { /* the bridge stays optional; restoreSettings() will report */ });
  }
  // T-F19: the same signal app.js uses, just earlier. The preload's contextBridge has
  // already run by the time this file executes, and html.electron is what makes .app
  // flush to the window edge and gives the title bar its drag region -- so setting it
  // after first paint meant one frame of the wrong geometry, unlike every other chrome
  // flag above. app.js keeps its own idempotent call for the case where the bridge
  // arrives late.
  if (window.electronAPI) document.documentElement.classList.add('electron');
})();
