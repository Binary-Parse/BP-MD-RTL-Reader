/**
 * src/renderer/index.js — Convenience re-export barrel for all renderer modules.
 */

export { isArabicHeavy, escapeHtml, escapeReg } from './i18n.js';
export { THEMES, getNextTheme, clampZoom } from './theme.js';
export { createState } from './state.js';
export { vaultSearch } from './search.js';
export { parseMarkdown, configureMarked, wikilinkTokenizer, wikilinkRenderer } from './markdown.js';
