'use strict';

/**
 * audit M38: turn Chromium's spellchecker off for one session, so that no dictionary is
 * ever downloaded.
 *
 * Disabling the checker is not enough. On Linux (and wherever Chromium uses Hunspell) the
 * dictionary of every language in the session's list is fetched from a Google CDN as soon
 * as the list is not empty, whether the checker is enabled or not: the packaged 2.0.0 build
 * wrote `Dictionaries/en-US-10-1.bdic` into a new profile with the checker disabled. The
 * empty language list is what stops the download, so it comes first. Windows and macOS use
 * the system checker for most languages and fetch nothing either way.
 *
 * @param {Electron.Session|undefined|null} ses
 */
function turnSpellcheckOff(ses) {
  if (!ses) return;
  if (typeof ses.setSpellCheckerLanguages === 'function') ses.setSpellCheckerLanguages([]);
  if (typeof ses.setSpellCheckerEnabled === 'function') ses.setSpellCheckerEnabled(false);
}

module.exports = { turnSpellcheckOff };
