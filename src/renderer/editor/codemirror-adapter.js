/**
 * codemirror-adapter.js — a CodeMirror 6 EditorPort implementation (T-F13).
 *
 * Conforms to the same EditorPort contract as createTextareaAdapter (editor-port.js), so
 * it is a drop-in source engine behind a flag (the textarea stays the default/fallback).
 * The CM6 namespace is INJECTED (the vendored window.CM6 bundle), so this module has no
 * hard dependency on the heavy engine and the wiring stays lazy + testable.
 */

import { createLivePreview, livePreviewTheme } from './live-preview.js';
import { createLineDirection } from './line-direction.js';
import { createBlockPreview } from './block-preview.js';

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {HTMLElement} parent  where the editor mounts
 * @param {object} opts  { CM6, doc, onChange, dir }
 * @returns an EditorPort (+ setDirection/focus/destroy/_view) backed by a CM6 EditorView
 */
export function createCodeMirrorAdapter(parent, { CM6, doc = '', onChange = null, dir = 'ltr', livePreview = true, renderBlock = null } = {}) {
  const {
    EditorState, EditorSelection, EditorView, keymap, highlightActiveLine, drawSelection,
    defaultKeymap, history, historyKeymap, indentWithTab,
    syntaxHighlighting, defaultHighlightStyle, markdown, markdownLanguage,
  } = CM6;

  let changeCb = onChange;
  const fire = () => { if (changeCb) changeCb(view.state.doc.toString()); };

  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged && changeCb) changeCb(view.state.doc.toString());
  });

  const state = EditorState.create({
    doc: doc == null ? '' : String(doc),
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      // GFM via the `extended` parser (markdownLanguage) — strikethrough + tables parse,
      // matching the preview pipeline (marked is GFM). markdownLanguage is already vendored,
      // so this needs no bundle rebuild. Guarded so the fake-CM6 unit path stays safe.
      markdown(markdownLanguage ? { base: markdownLanguage } : undefined),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ...(livePreview ? [createLivePreview(CM6), livePreviewTheme(CM6)] : []), // T-F13: rewrite markers off the active line
      ...(livePreview && renderBlock ? [createBlockPreview(CM6, renderBlock)] : []), // T-F13: render BLOCKS (tables…) off the active line
      ...createLineDirection(CM6, () => dir), // R1/R2 in CM6: per-line dir + logical caret (perLineTextDirection)
      highlightActiveLine(),
      drawSelection(),
      EditorView.lineWrapping,
      listener,
    ],
  });
  const view = new EditorView({ state, parent });
  view.dom.setAttribute('dir', dir);

  const clamp = (n, len) => Math.max(0, Math.min(n == null ? 0 : n, len));

  return {
    load(content) {
      const insert = content == null ? '' : String(content);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert } });
      fire();
    },
    getValue() { return view.state.doc.toString(); },
    getSelection() { const r = view.state.selection.main; return { start: r.from, end: r.to }; },
    setSelection({ start, end }) {
      const len = view.state.doc.length;
      const s = clamp(start, len);
      const e = clamp(end == null ? start : end, len);
      view.dispatch({ selection: EditorSelection.range(s, e) });
    },
    replaceSelection(text) { view.dispatch(view.state.replaceSelection(String(text))); fire(); },
    onChange(cb) { changeCb = cb; return () => { if (changeCb === cb) changeCb = null; }; },
    find(query, { caseSensitive = false } = {}) {
      const matches = [];
      if (!query) return matches;
      const text = view.state.doc.toString();
      const re = new RegExp(escapeReg(query), caseSensitive ? 'g' : 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return matches;
    },
    // T-F13 extras beyond the core contract:
    setDirection(d) { view.dom.setAttribute('dir', d === 'rtl' ? 'rtl' : 'ltr'); },
    focus() { view.focus(); },
    destroy() { view.destroy(); },
    _view: view,
  };
}
