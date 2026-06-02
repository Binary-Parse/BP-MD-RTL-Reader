// Entry for the vendored CodeMirror 6 IIFE bundle (T-F13). Re-exports only the pieces the
// CodeMirrorAdapter needs, so the bundle stays lean. Build:
//   npx esbuild scripts/codemirror-entry.mjs --bundle --format=iife --global-name=CM6 \
//     --minify --outfile=assets/vendor/codemirror/codemirror.min.js
export { EditorState, EditorSelection, Compartment } from '@codemirror/state';
export { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
export { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching } from '@codemirror/language';
export { markdown, markdownLanguage } from '@codemirror/lang-markdown';
export { tags } from '@lezer/highlight';
