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
import { createMathPreview } from './math-preview.js';
// listContinuation lives in its own module so the coverage + mutation gates SEE it (this
// adapter file is gate-excluded as e2e-only). Re-exported for back-compat with importers.
import { listContinuation } from './list-continuation.js';
export { listContinuation };

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {HTMLElement} parent  where the editor mounts
 * @param {object} opts  { CM6, doc, onChange, dir }
 * @returns an EditorPort (+ setDirection/focus/destroy/_view) backed by a CM6 EditorView
 */
export function createCodeMirrorAdapter(parent, { CM6, doc = '', onChange = null, dir = 'ltr', livePreview = true, renderBlock = null, renderMath = null } = {}) {
  const {
    EditorState, EditorSelection, EditorView, keymap, Prec, highlightActiveLine, drawSelection,
    defaultKeymap, history, historyKeymap, indentWithTab,
    syntaxHighlighting, defaultHighlightStyle, HighlightStyle, tags, markdown, markdownLanguage,
    search, setSearchQuery, SearchQuery,
  } = CM6;

  // T-F13: the prose look. With the markdown markers hidden off the active line (live-preview.js),
  // the SURVIVING text must read as formatted prose — serif headings at real sizes, true bold /
  // italic, monospace inline code — NOT flat monospace source. A HighlightStyle styles the
  // markdown highlight tags directly (font/size/weight, not just colour). Guarded: the fake-CM6
  // unit harness omits HighlightStyle/tags, so this is added only when both are present.
  const proseHighlight = (HighlightStyle && tags) ? HighlightStyle.define([
    { tag: tags.heading1, fontFamily: 'var(--serif)', fontSize: '1.9em', fontWeight: '600', lineHeight: '1.2' },
    { tag: tags.heading2, fontFamily: 'var(--serif)', fontSize: '1.55em', fontWeight: '600' },
    { tag: tags.heading3, fontFamily: 'var(--serif)', fontSize: '1.3em', fontWeight: '600' },
    { tag: tags.heading4, fontFamily: 'var(--serif)', fontSize: '1.15em', fontWeight: '600' },
    { tag: [tags.heading5, tags.heading6], fontFamily: 'var(--serif)', fontWeight: '600' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--plum)' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
    { tag: tags.url, color: 'var(--ink-mute)' },
    { tag: tags.monospace, fontFamily: 'var(--mono)', fontSize: '0.9em', color: 'var(--accent)' },
    { tag: tags.quote, color: 'var(--ink-soft)', fontStyle: 'italic' },
    { tag: [tags.list, tags.contentSeparator], color: 'var(--accent)' },
  ]) : null;

  // Obsidian-style list/blockquote continuation on Enter (uses the PURE listContinuation
  // helper above so the decision logic stays unit-testable without a real editor). Bound at
  // Prec.highest below so it beats BOTH defaultKeymap and the markdown language's own Enter.
  const continueListOnEnter = (v) => {
    const { state } = v;
    const sel = state.selection.main;
    if (!sel.empty) return false; // only a plain caret continues a list
    const line = state.doc.lineAt(sel.head);
    if (sel.head !== line.to) return false; // only at the END of the line
    const cont = listContinuation(line.text);
    if (!cont) return false;
    if (cont.empty) {
      // exit the list/quote: delete the whole marker, then break the line.
      v.dispatch({
        changes: { from: line.from, to: line.to, insert: '\n' },
        selection: EditorSelection.cursor(line.from + 1),
        scrollIntoView: true,
        userEvent: 'input',
      });
      return true;
    }
    const insert = '\n' + cont.prefix;
    v.dispatch({
      changes: { from: sel.head, insert },
      selection: EditorSelection.cursor(sel.head + insert.length),
      scrollIntoView: true,
      userEvent: 'input',
    });
    return true;
  };

  let changeCb = onChange;
  const fire = () => { if (changeCb) changeCb(view.state.doc.toString()); };

  const listener = EditorView.updateListener.of((u) => {
    if (u.docChanged && changeCb) changeCb(view.state.doc.toString());
  });

  const state = EditorState.create({
    doc: doc == null ? '' : String(doc),
    extensions: [
      history(),
      // list/quote continuation on Enter, at Prec.highest so it beats BOTH defaultKeymap's
      // insertNewlineAndIndent AND the markdown language's own continueMarkup Enter binding
      // (markdownLanguage registers a keymap via the language facet). Guarded: the fake-CM6
      // unit harness omits Prec, so fall back to plain ordering (this module is e2e-covered).
      ...(Prec ? [Prec.highest(keymap.of([{ key: 'Enter', run: continueListOnEnter }]))] : []),
      keymap.of([...(Prec ? [] : [{ key: 'Enter', run: continueListOnEnter }]), ...defaultKeymap, ...historyKeymap, indentWithTab]),
      // GFM via the `extended` parser (markdownLanguage) — strikethrough + tables parse,
      // matching the preview pipeline (marked is GFM). markdownLanguage is already vendored,
      // so this needs no bundle rebuild. Guarded so the fake-CM6 unit path stays safe.
      markdown(markdownLanguage ? { base: markdownLanguage } : undefined),
      // prose styling first → higher precedence than the default token colours below
      ...(proseHighlight ? [syntaxHighlighting(proseHighlight)] : []),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ...(livePreview ? [createLivePreview(CM6), livePreviewTheme(CM6)] : []), // T-F13: rewrite markers off the active line
      ...(livePreview && renderBlock ? [createBlockPreview(CM6, renderBlock)] : []), // T-F13: render BLOCKS (tables…) off the active line
      ...(livePreview && renderMath ? [createMathPreview(CM6, renderMath)] : []), // T-F13: render $…$ KaTeX off the active line
      ...createLineDirection(CM6, () => dir), // R1/R2 in CM6: per-line dir + logical caret (perLineTextDirection)
      // F13 Find: the `search` extension draws .cm-searchMatch on EVERY hit of the active
      // SearchQuery (set via setSearchHighlight below) so all matches are visible, not just the
      // selected one. No panel/keymap is wired — Find is driven by the app's own find-bar.
      // Guarded: the fake-CM6 unit harness omits `search`.
      ...(search ? [search()] : []),
      highlightActiveLine(),
      drawSelection(),
      EditorView.lineWrapping,
      // a11y (T-F2): the contenteditable surface is a role=textbox; give it an accessible
      // name so screen readers + axe (aria-input-field-name) recognise it as the note editor.
      ...(EditorView.contentAttributes ? [EditorView.contentAttributes.of({ 'aria-label': 'Markdown note editor' })] : []),
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
    // F13 Find: highlight ALL matches of `query` (drawn as .cm-searchMatch by the `search`
    // extension). An empty/falsy query clears the highlight. Guarded for the fake-CM6 unit
    // harness, which omits setSearchQuery/SearchQuery (this path is e2e-covered).
    setSearchHighlight(query) {
      if (!setSearchQuery || !SearchQuery) return;
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query == null ? '' : String(query) })) });
    },
    // T-F13 extras beyond the core contract:
    setDirection(d) { view.dom.setAttribute('dir', d === 'rtl' ? 'rtl' : 'ltr'); },
    focus() { view.focus(); },
    // Edit-menu/keyboard operations routed through CM6's own commands (so the menu
    // acts on the real editor, not the hidden preview). Guarded for the fake-CM6 unit harness.
    selectAll() { view.focus(); if (CM6.selectAll) CM6.selectAll(view); else view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) }); },
    undo() { view.focus(); if (CM6.undo) CM6.undo(view); },
    redo() { view.focus(); if (CM6.redo) CM6.redo(view); },
    destroy() { view.destroy(); },
    _view: view,
  };
}
