'use strict';

/**
 * window-health.js — what main does when a window's page dies or hangs (audit M11).
 *
 * A crashed page used to leave a dead window until the user closed it, and a hung page was
 * not noticed at all. Now:
 *   - Crash: the page is reloaded and the reloaded page offers the unsaved work back (the
 *     recovery mirror on disk is at most 10 s old). After MAX_AUTO_RELOADS reloads within
 *     CRASH_WINDOW_MS the reload stops and the user is asked: Reload / Quit.
 *   - Hang: HANG_GRACE_MS after `unresponsive` with no `responsive`, the user is asked:
 *     Wait / Reload. Reload kills the page, which then takes the crash path above.
 *
 * `dialog`, `now` and the recovery reset are parameters so unit tests drive this with fakes.
 */

const CRASH_WINDOW_MS = 60000;
const MAX_AUTO_RELOADS = 2;
const HANG_GRACE_MS = 10000;

const TEXT_EN = {
  crashMessage: 'The window stopped working',
  crashDetail: 'It stopped more than twice in one minute. Your unsaved work is kept: it is offered back after a reload, or the next time you open the app.',
  hangMessage: 'The window is not responding',
  hangDetail: 'You can wait for it, or reload it. After a reload the app offers back the unsaved work it kept (up to the last 10 seconds may be missing).',
  reload: 'Reload',
  quit: 'Quit',
  wait: 'Wait',
};

const TEXT_AR = {
  crashMessage: 'توقفت النافذة عن العمل',
  crashDetail: 'توقفت أكثر من مرتين خلال دقيقة. عملك غير المحفوظ محفوظ: يُعرض عليك بعد إعادة التحميل، أو عند فتح التطبيق في المرة القادمة.',
  hangMessage: 'النافذة لا تستجيب',
  hangDetail: 'يمكنك الانتظار أو إعادة تحميلها. بعد إعادة التحميل يعرض التطبيق العمل غير المحفوظ الذي احتفظ به (قد تنقص آخر 10 ثوانٍ).',
  reload: 'إعادة التحميل',
  quit: 'إنهاء',
  wait: 'انتظار',
};

function createWindowHealth({ dialog = null, getLocale = () => 'en', resetRecovery = () => {}, now = Date.now } = {}) {
  const canAsk = !!dialog && typeof dialog.showMessageBox === 'function';
  const text = () => (getLocale() === 'ar' ? TEXT_AR : TEXT_EN);

  /** Watch one window. Returns the handlers window-controller wires to its events. */
  function watch(win) {
    let reloads = [];
    let crashAsked = false;
    let hangTimer = null;
    let hangQuestion = null;

    const alive = () => !win.isDestroyed() && !!win.webContents && !win.webContents.isDestroyed();

    function reload() {
      if (!alive() || typeof win.webContents.reload !== 'function') return;
      // The reloaded page must be offered snapshot.json AND live.json, as after a relaunch.
      try { resetRecovery(); } catch (_) { /* the reload matters more than the reset */ }
      win.webContents.reload();
    }

    function endHang() {
      if (hangTimer) { clearTimeout(hangTimer); hangTimer = null; }
      if (hangQuestion) { const open = hangQuestion; hangQuestion = null; open.abort(); }
    }

    function askCrash() {
      if (!canAsk || crashAsked) return;
      crashAsked = true;
      const t = text();
      dialog.showMessageBox(win, {
        type: 'error', buttons: [t.reload, t.quit], defaultId: 0, cancelId: 1, noLink: true,
        message: t.crashMessage, detail: t.crashDetail,
      }).then((answer) => {
        crashAsked = false;
        if (!alive()) return;
        if (answer && answer.response === 0) { reloads = []; reload(); return; }
        win.close(); // the page is gone, so the close handler lets it through; recovery stays on disk
      }).catch(() => { crashAsked = false; });
    }

    function rendererGone(reason) {
      endHang();
      if (reason === 'clean-exit' || !alive()) return;
      const at = now();
      reloads = reloads.filter((earlier) => at - earlier < CRASH_WINDOW_MS);
      if (reloads.length >= MAX_AUTO_RELOADS) { askCrash(); return; }
      reloads.push(at);
      reload();
    }

    function askHang() {
      if (!canAsk || !alive()) return;
      const question = new AbortController();
      hangQuestion = question;
      const t = text();
      dialog.showMessageBox(win, {
        type: 'warning', buttons: [t.wait, t.reload], defaultId: 0, cancelId: 0, noLink: true,
        message: t.hangMessage, detail: t.hangDetail, signal: question.signal,
      }).then((answer) => {
        if (hangQuestion !== question) return; // the page answered meanwhile: nothing to do
        hangQuestion = null;
        if (!alive()) return;
        if (answer && answer.response === 1 && typeof win.webContents.forcefullyCrashRenderer === 'function') {
          win.webContents.forcefullyCrashRenderer(); // a hung page cannot reload itself; this takes the crash path
          return;
        }
        unresponsive(); // Wait: ask again if it is still hung after the same grace
      }).catch(() => { if (hangQuestion === question) hangQuestion = null; });
    }

    function unresponsive() {
      if (hangTimer || hangQuestion) return;
      hangTimer = setTimeout(() => { hangTimer = null; askHang(); }, HANG_GRACE_MS);
    }

    return { rendererGone, unresponsive, responsive: endHang, dispose: endHang };
  }

  return { watch };
}

module.exports = { createWindowHealth, CRASH_WINDOW_MS, MAX_AUTO_RELOADS, HANG_GRACE_MS };
