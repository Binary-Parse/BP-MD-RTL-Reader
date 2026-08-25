/**
 * list-continuation.js — the PURE Obsidian-style list/blockquote continuation logic (T-F13).
 *
 * Extracted from codemirror-adapter.js so it lives in a file the coverage + mutation gates
 * SEE (the adapter is gate-excluded as e2e-only). The CM6 Enter keymap in the adapter wraps
 * this; the logic itself needs no editor and is unit/mutation-tested directly.
 *
 * Given a single line's text, decide what happens when Enter is pressed on it:
 *   - returns null  → the line is not a list/quote item; Enter behaves normally.
 *   - returns { empty: true, marker } → the line is ONLY the marker (an empty item):
 *       Enter should DELETE the marker and break the line (exit the list/quote).
 *   - returns { empty: false, prefix } → a non-empty item: Enter should insert `prefix`
 *       (the SAME marker) on the new line; ordered lists carry the incremented number.
 *
 * Recognised markers (leading indentation is preserved):
 *   - one or more blockquotes:  "> ", "> > ", …
 *   - unordered bullets:        "- ", "* ", "+ "
 *   - task list items:          "- [ ] ", "- [x] " (any single char inside the box)
 *   - ordered lists:            "1. ", "2) ", … (`.` or `)` delimiter)
 */
export function listContinuation(line) {
  const text = String(line == null ? '' : line);
  const indentMatch = text.match(/^[ \t]*/);
  const indent = indentMatch ? indentMatch[0] : '';
  const rest = text.slice(indent.length);

  // Blockquote(s): one or more "> ". Quotes nest, so capture the whole run.
  const quote = rest.match(/^((?:> )+)(.*)$/);
  if (quote) {
    const marker = quote[1];
    return quote[2].length === 0
      ? { empty: true, marker: indent + marker }
      : { empty: false, prefix: indent + marker };
  }

  // Task list: "- [ ] " / "- [x] " (also * / +). Check BEFORE plain bullets.
  const task = rest.match(/^([-*+] \[.\] )(.*)$/);
  if (task) {
    const marker = task[1];
    // an empty task exits; a non-empty one continues with an UNCHECKED box (Obsidian-style).
    return task[2].length === 0
      ? { empty: true, marker: indent + marker }
      : { empty: false, prefix: indent + marker.replace(/\[.\]/, '[ ]') };
  }

  // Unordered bullet: "- " / "* " / "+ ".
  const bullet = rest.match(/^([-*+] )(.*)$/);
  if (bullet) {
    const marker = bullet[1];
    return bullet[2].length === 0
      ? { empty: true, marker: indent + marker }
      : { empty: false, prefix: indent + marker };
  }

  // Ordered list: "N. " or "N) ". Increment the number on continuation.
  const ordered = rest.match(/^(\d+)([.)] )(.*)$/);
  if (ordered) {
    const num = ordered[1];
    const delim = ordered[2];
    const body = ordered[3];
    const marker = num + delim;
    return body.length === 0
      ? { empty: true, marker: indent + marker }
      : { empty: false, prefix: indent + (Number(num) + 1) + delim };
  }

  return null;
}
