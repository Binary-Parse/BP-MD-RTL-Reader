/**
 * editor-port.js — ports & adapters seam for the editor (T-AI3).
 * The UI depends on this interface, never on a concrete engine, so the
 * textarea→CodeMirror-6 migration is incremental, reversible, and unit-testable
 * with a mock element. A CodeMirrorAdapter implements the same contract later.
 *
 * EditorPort:
 *   load(content): void
 *   getValue(): string
 *   getSelection(): {start, end}
 *   setSelection({start,end}): void
 *   replaceSelection(text): void
 *   onChange(cb): () => void   // returns unsubscribe
 *   find(query, {caseSensitive?}): Array<{start,end}>
 */

const REQUIRED = ['load', 'getValue', 'getSelection', 'setSelection', 'replaceSelection', 'onChange', 'find'];

/** Assert an object conforms to the EditorPort contract. */
export function isEditorPort(obj) {
  return !!obj && REQUIRED.every((m) => typeof obj[m] === 'function');
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parity adapter over a textarea-like element (`{ value, selectionStart,
 * selectionEnd }`). Used as the fallback engine and in tests.
 */
export function createTextareaAdapter(el) {
  let changeCb = null;
  const fire = () => { if (changeCb) changeCb(el.value); };
  return {
    load(content) { el.value = content == null ? '' : String(content); fire(); },
    getValue() { return el.value; },
    getSelection() { return { start: el.selectionStart, end: el.selectionEnd }; },
    setSelection({ start, end }) { el.selectionStart = start; el.selectionEnd = end == null ? start : end; },
    replaceSelection(text) {
      const s = el.selectionStart, e = el.selectionEnd;
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
      const pos = s + text.length;
      el.selectionStart = el.selectionEnd = pos;
      fire();
    },
    onChange(cb) { changeCb = cb; return () => { if (changeCb === cb) changeCb = null; }; },
    find(query, { caseSensitive = false } = {}) {
      const matches = [];
      if (!query) return matches;
      const re = new RegExp(escapeReg(query), caseSensitive ? 'g' : 'gi');
      let m;
      while ((m = re.exec(el.value)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return matches;
    },
  };
}
