/**
 * shortcut-keys.js — which key a keydown event means for the app's shortcuts (audit M24).
 *
 * Two facts about a key press: `e.key` is the character the current layout produces, `e.code`
 * is the physical key named after the US layout. A shortcut is what is printed on the key, so
 * the character decides whenever it is one a shortcut can be bound to. Only when the layout
 * produces something else (Arabic 'س' on the S key, '&' on the French 1 key) the physical key
 * decides, so Ctrl+S still saves on an Arabic layout.
 *
 * The earlier rule accepted either fact. On a German keyboard the key labelled Z has the code
 * KeyY, so Ctrl+Z also ran Redo; on a French one it has the code KeyW, so Ctrl+Z closed the tab.
 *
 * Pure: no DOM, takes any object with `key` and `code`.
 */

const ASCII_LETTER_OR_DIGIT = /^[a-z0-9]$/i;
const PHYSICAL_LETTER_OR_DIGIT = /^(?:Key|Digit)([A-Z0-9])$/;
// The punctuation characters the app binds. A layout that produces one of them on some other
// physical key (German '-' sits on the US Slash key) means that character, nothing else.
const BOUND_PUNCTUATION = new Set(['\\', '/', ',', '=', '-']);

/** The letter or digit of a key press, lower case; '' when it is neither. */
export function shortcutLetter(e) {
  const key = String((e && e.key) || '');
  if (ASCII_LETTER_OR_DIGIT.test(key)) return key.toLowerCase();
  const physical = PHYSICAL_LETTER_OR_DIGIT.exec(String((e && e.code) || ''));
  if (physical) return physical[1].toLowerCase();
  return key.toLowerCase();
}

/** True when the key press is the letter or digit `ch` (lower case). */
export function hitKey(e, ch) {
  return shortcutLetter(e) === ch;
}

/** True when the key press is the punctuation `ch`, whose US physical key is `code`. */
export function hitCode(e, ch, code) {
  const key = String((e && e.key) || '');
  if (BOUND_PUNCTUATION.has(key) || ASCII_LETTER_OR_DIGIT.test(key)) return key === ch;
  return String((e && e.code) || '') === code;
}
