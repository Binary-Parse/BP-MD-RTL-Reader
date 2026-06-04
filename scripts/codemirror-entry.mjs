// Entry for the vendored CodeMirror 6 IIFE bundle (T-F13). Re-exports only the pieces the
// CodeMirrorAdapter needs, so the bundle stays lean. Build:
//   npx esbuild scripts/codemirror-entry.mjs --bundle --format=iife --global-name=CM6 \
//     --minify --outfile=assets/vendor/codemirror/codemirror.min.js
export { EditorState, EditorSelection, Compartment, RangeSetBuilder, Prec } from '@codemirror/state';
export { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, selectAll } from '@codemirror/commands';
export { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, syntaxTree } from '@codemirror/language';
export { markdown, markdownLanguage } from '@codemirror/lang-markdown';
export { tags } from '@lezer/highlight';
// F13: "highlight all matches" for Find — the `search` extension draws .cm-searchMatch on
// every hit of the active SearchQuery (set via setSearchQuery). CSP-safe: bundled into the IIFE.
export { search, setSearchQuery, SearchQuery } from '@codemirror/search';
