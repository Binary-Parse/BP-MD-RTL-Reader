/**
 * codemirror-adapter.js — the CodeMirror 6 editor (T-F13); the sole editor surface.
 *
 * Exposes a small EditorPort-style interface (load / getValue / find / …) over CM6.
 * The CM6 namespace is INJECTED (the vendored window.CM6 bundle), so this module has no
 * hard dependency on the heavy engine and the wiring stays lazy + testable.
 */

// escapeReg is shared with the find box in i18n.js; a private copy here drifted from it.
import { escapeReg } from '../i18n.js';
import { arabicFindMatches } from '../components/text-normalize.js';
import { createLivePreview, livePreviewTheme } from './live-preview.js';
import { createLineDirection } from './line-direction.js';
import { createBlockPreview } from './block-preview.js';
import { createMathPreview } from './math-preview.js';
import { createWikilinkPreview } from './wikilink-preview.js';
import { createInlineMarksPreview } from './inline-marks-preview.js';
// listContinuation lives in its own module so the coverage + mutation gates SEE it (this
// adapter file is gate-excluded as e2e-only). Re-exported for back-compat with importers.
import { listContinuation } from './list-continuation.js';
import { withoutAppOwnedKeys } from './keymap-ownership.js';
import { createHistoryStore } from './history-store.js';
export { listContinuation };

/**
 * @param {HTMLElement} parent  where the editor mounts
 * @param {object} opts  { CM6, doc, onChange, dir }
 * @returns an EditorPort (+ setDirection/focus/destroy/_view) backed by a CM6 EditorView
 */
export function createCodeMirrorAdapter(parent, { CM6, doc = '', onChange = null, dir = 'ltr', forceDir = null, livePreview = true, renderBlock = null, renderMath = null, onWikilink = null, onSelectionChange = null, onTab = null } = {}) {
  const {
    EditorState, EditorSelection, EditorView, keymap, Prec, highlightActiveLine, drawSelection,
    defaultKeymap, history, historyKeymap, indentWithTab,
    syntaxHighlighting, defaultHighlightStyle, HighlightStyle, tags, markdown, markdownLanguage,
    syntaxTree, ViewPlugin, Decoration,
  } = CM6;

  // Live, mutable direction so setDirection() can re-drive per-line dir AFTER mount — the
  // createLineDirection getters below read THESE (not a stale closed-over value). liveForce
  // ('rtl'|'ltr'|null) forces every line; liveDir is the base direction. setDirection() flips
  // these and dispatches a benign transaction so the line-direction plugin re-reads them and
  // repaints (the vendored CM6 bundle exports no StateEffect to wake it more directly).
  let liveDir = dir === 'rtl' ? 'rtl' : 'ltr';
  let liveForce = (forceDir === 'rtl' || forceDir === 'ltr') ? forceDir : null;

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
    // Active-state: notify when the caret/selection moves (or the doc changes) so the toolbar
    // can highlight the construct the cursor is inside. Wrapped so a callback error can't break typing.
    if ((u.selectionSet || u.docChanged) && typeof onSelectionChange === 'function') {
      try { onSelectionChange(); } catch (_) { /* never let the toolbar break the editor */ }
    }
  });

  // Audit B1: the undo history is part of the EditorState, so every open file gets a state of
  // its own. `makeState(text)` builds a fresh one (empty history) with the full extension set;
  // load() below swaps states per file with view.setState() and parks the one it leaves in
  // `store` (history-store.js).
  // Find (F13, audit N1): every match of the app's find-bar query is marked in the editor.
  // CodeMirror's own search highlighter draws only while its search panel is open, and this
  // app never opens it, so nothing was drawn. The marks come from findIn() below, the same
  // search the find-bar counts with, so an Arabic match found through normalisation (tashkeel
  // folded) is marked too. Only matches in the visible part of the document are decorated.
  let findQuery = '';
  let findMatches = [];
  let findStamp = 0; // changes when the query does; the plugin compares it (no StateEffect in the bundle)
  const findIn = (text, query, caseSensitive = false) => {
    const matches = [];
    if (!query) return matches;
    // RTL-M3: Arabic queries search the NORMALIZED document (tashkeel folded), with
    // match offsets mapped back to source positions — the same model as the Reading
    // pane, so 'محمد' finds 'مُحَمَّد' in Edit mode too instead of silently missing it.
    const arabicMatches = arabicFindMatches(text, query);
    if (arabicMatches) return arabicMatches;
    const re = new RegExp(escapeReg(query), caseSensitive ? 'g' : 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return matches;
  };
  const findMark = (ViewPlugin && Decoration) ? Decoration.mark({ class: 'cm-searchMatch' }) : null;
  const buildFindMarks = (v) => {
    const length = v.state.doc.length;
    const ranges = [];
    for (const { start, end } of findMatches) {
      if (!(end > start) || end > length) continue;
      if (v.visibleRanges.some((r) => end > r.from && start < r.to)) ranges.push(findMark.range(start, end));
    }
    return Decoration.set(ranges, true);
  };
  const findMarks = findMark ? ViewPlugin.fromClass(
    class {
      constructor(v) { this.stamp = findStamp; this.decorations = buildFindMarks(v); }
      update(u) {
        if (u.docChanged) findMatches = findIn(u.state.doc.toString(), findQuery);
        if (!u.docChanged && !u.viewportChanged && this.stamp === findStamp) return;
        this.stamp = findStamp;
        this.decorations = buildFindMarks(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  ) : null;

  const makeState = (text) => EditorState.create({
    doc: text,
    extensions: [
      history(),
      // list/quote continuation on Enter, at Prec.highest so it beats BOTH defaultKeymap's
      // insertNewlineAndIndent AND the markdown language's own continueMarkup Enter binding
      // (markdownLanguage registers a keymap via the language facet). Guarded: the fake-CM6
      // unit harness omits Prec, so fall back to plain ordering (this module is e2e-covered).
      ...(Prec ? [Prec.highest(keymap.of([
        { key: 'Enter', run: continueListOnEnter },
        // Tab / Shift-Tab move to the next/previous cell when the caret is inside a table
        // (onTab returns true if it handled it); otherwise fall through to indentWithTab below.
        ...(onTab ? [{ key: 'Tab', run: () => onTab(false) }, { key: 'Shift-Tab', run: () => onTab(true) }] : []),
      ]))] : []),
      keymap.of([...(Prec ? [] : [{ key: 'Enter', run: continueListOnEnter }]), ...withoutAppOwnedKeys(defaultKeymap), ...historyKeymap, indentWithTab]),
      // GFM via the `extended` parser (markdownLanguage) — strikethrough + tables parse,
      // matching the preview pipeline (marked is GFM). markdownLanguage is already vendored,
      // so this needs no bundle rebuild. Guarded so the fake-CM6 unit path stays safe.
      markdown(markdownLanguage ? { base: markdownLanguage } : undefined),
      // prose styling first → higher precedence than the default token colours below
      ...(proseHighlight ? [syntaxHighlighting(proseHighlight)] : []),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ...(livePreview ? [createLivePreview(CM6), livePreviewTheme(CM6)] : []), // T-F13: rewrite markers off the active line
      ...(livePreview && renderBlock ? [createBlockPreview(CM6, renderBlock, () => `${liveDir}|${liveForce || ''}`)] : []), // T-F13: render BLOCKS (tables…) off the active line; dirKey rebuilds widgets on a direction flip
      ...(livePreview && renderMath ? [createMathPreview(CM6, renderMath)] : []), // T-F13: render $…$ KaTeX off the active line
      ...(livePreview ? [createWikilinkPreview(CM6, onWikilink)] : []), // R09: [[wikilinks]] → clickable anchors off the active line
      ...(livePreview ? [createInlineMarksPreview(CM6)] : []), // ==highlight==/<u>/~sub~/^sup^ rendered off the active line
      ...createLineDirection(CM6, () => liveDir, () => liveForce), // R1/R2 in CM6: per-line dir (forced or auto) + logical caret
      // F13 Find: every hit of the find-bar query is drawn as .cm-searchMatch (see findMarks).
      ...(findMarks ? [findMarks] : []),
      highlightActiveLine(),
      drawSelection(),
      EditorView.lineWrapping,
      // a11y (T-F2): the contenteditable surface is a role=textbox; give it an accessible
      // name so screen readers + axe (aria-input-field-name) recognise it as the note editor.
      ...(EditorView.contentAttributes ? [EditorView.contentAttributes.of({ 'aria-label': 'Markdown note editor' })] : []),
      listener,
    ],
  });
  const view = new EditorView({ state: makeState(doc == null ? '' : String(doc)), parent });
  view.dom.setAttribute('dir', liveForce || liveDir); // forced direction wins for the surface base

  const store = createHistoryStore((s) => s.doc.toString());
  let liveKey = null;      // the file whose state is live in the view (null: none / not tracked)

  const clamp = (n, len) => Math.max(0, Math.min(n == null ? 0 : n, len));

  return {
    /**
     * Put a file's text into the editor. Not an undoable step: the view is handed a state of
     * its own — the file's parked one when its text is unchanged since it was parked, otherwise
     * a fresh one with an empty history. `key` identifies the file (see historyKeyOf); without
     * one the text is simply loaded into a fresh state.
     */
    load(content, key = null) {
      const text = content == null ? '' : String(content);
      if (liveKey != null) store.put(liveKey, view.state);
      const parked = key != null ? store.take(key, text) : null;
      // a file always opens with the caret at the start, as it did when load() replaced the document
      const next = parked ? parked.update({ selection: { anchor: 0 } }).state : makeState(text);
      liveKey = key;
      findMatches = findIn(text, findQuery); // the marks follow the note that is shown
      view.setState(next);
      fire();
      // setState raises no update event; the toolbar + caret readout used to hear about a load
      // through the docChanged update, so tell them explicitly.
      if (typeof onSelectionChange === 'function') {
        try { onSelectionChange(); } catch (_) { /* never let the toolbar break the editor */ }
      }
    },
    /** A closed file's history is freed. */
    releaseHistory(key) {
      store.release(key);
      if (liveKey === key) liveKey = null;
    },
    /** Free the history of every file whose key is not listed (files that are gone). */
    retainHistory(keys) { store.retain(keys); },
    _historySize() { return store.size(); },
    getValue() { return view.state.doc.toString(); },
    // `ranges` feeds edit-commands' multi-selection cut/copy (the clipboard must carry
    // every range replaceSelection will delete); start/end stay the main-range shape
    // every existing consumer reads.
    getSelection() {
      const s = view.state.selection;
      return { start: s.main.from, end: s.main.to, ranges: s.ranges.map((r) => ({ start: r.from, end: r.to })) };
    },
    setSelection({ start, end }) {
      const len = view.state.doc.length;
      const s = clamp(start, len);
      const e = clamp(end == null ? start : end, len);
      view.dispatch({ selection: EditorSelection.range(s, e) });
    },
    replaceSelection(text) { view.dispatch(view.state.replaceSelection(String(text))); fire(); },
    onChange(cb) { changeCb = cb; return () => { if (changeCb === cb) changeCb = null; }; },
    find(query, { caseSensitive = false } = {}) {
      return findIn(view.state.doc.toString(), query, caseSensitive);
    },
    // F13 Find: mark ALL matches of `query` (drawn as .cm-searchMatch by findMarks above).
    // An empty/falsy query clears the marks. No-op in the fake-CM6 unit harness, which has
    // no ViewPlugin (this path is e2e-covered).
    setSearchHighlight(query) {
      if (!findMarks) return;
      findQuery = query == null ? '' : String(query);
      findMatches = findIn(view.state.doc.toString(), findQuery);
      findStamp += 1;
      view.dispatch({});
    },
    // Active formatting constructs at the caret (for toolbar active-state). Walks the markdown
    // syntax tree up from the cursor; returns a Set of tags ('bold','italic','strike','code',
    // 'heading','quote','bullet','ordered','task','codeblock'). lang-markdown ships no such API,
    // so this is derived from the tree (research: must be hand-built). Empty if syntaxTree absent.
    getActiveMarks() {
      const marks = new Set();
      if (typeof syntaxTree !== 'function') return marks;
      const pos = view.state.selection.main.head;
      let node = syntaxTree(view.state).resolveInner(pos, -1);
      while (node) {
        const n = node.name;
        if (n === 'StrongEmphasis') marks.add('bold');
        else if (n === 'Emphasis') marks.add('italic');
        else if (n === 'Strikethrough') marks.add('strike');
        else if (n === 'InlineCode') marks.add('code');
        else if (/^(ATXHeading[1-6]|SetextHeading[12])$/.test(n)) marks.add('heading');
        else if (n === 'Blockquote') marks.add('quote');
        else if (n === 'OrderedList') marks.add('ordered');
        else if (n === 'BulletList') marks.add('bullet');
        else if (n === 'Task' || n === 'TaskMarker') marks.add('task');
        else if (n === 'FencedCode' || n === 'CodeBlock') marks.add('codeblock');
        else if (n === 'Table') marks.add('table');
        node = node.parent;
      }
      return marks;
    },
    // T-F13 extras beyond the core contract:
    setDirection(d, force) {
      liveDir = d === 'rtl' ? 'rtl' : 'ltr';
      liveForce = (force === 'rtl' || force === 'ltr') ? force : null;
      view.dom.setAttribute('dir', liveForce || liveDir);
      // Fire a transaction so the per-line direction plugin's update() runs and re-reads
      // the new direction. The selection is set EXPLICITLY (an equal, fresh object): that
      // marks the transaction selectionSet, which is what recomputes the block-widget
      // decorations facet — without it the widgets kept the pre-flip direction until the
      // next edit. The equal selection means no cursor movement.
      view.dispatch({ selection: view.state.selection });
    },
    focus() { view.focus(); },
    // audit PERF-08: the caret line/column straight from CM6's own line index. The app
    // used to derive these with `val.slice(0, pos).split('\n')` — an O(doc) copy on every
    // keystroke. Clamped, so an out-of-range pos can never throw.
    lineAt(pos) {
      const len = view.state.doc.length;
      const p = Math.max(0, Math.min(pos == null ? 0 : pos, len));
      const line = view.state.doc.lineAt(p);
      return { line: line.number, col: p - line.from + 1 };
    },
    // Scroll a document position into view (outline navigation). `select:true` also places the
    // caret there. Used by the outline now that CM6 is the sole surface (the old preview pane is
    // hidden in cm-single mode, so scrolling it did nothing).
    scrollToPos(pos, { select = false } = {}) {
      const len = view.state.doc.length;
      const p = Math.max(0, Math.min(pos == null ? 0 : pos, len));
      view.dispatch({
        ...(select ? { selection: EditorSelection.cursor(p) } : {}),
        effects: EditorView.scrollIntoView(p, { y: 'start', yMargin: 16 }),
      });
      view.focus();
    },
    // Edit-menu/keyboard operations routed through CM6's own commands (so the menu
    // acts on the real editor, not the hidden preview). Guarded for the fake-CM6 unit harness.
    selectAll() { view.focus(); if (CM6.selectAll) CM6.selectAll(view); else view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length) }); },
    undo() { view.focus(); if (CM6.undo) CM6.undo(view); },
    redo() { view.focus(); if (CM6.redo) CM6.redo(view); },
    destroy() { view.destroy(); },
    _view: view,
  };
}
