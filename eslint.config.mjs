// Flat-config for ESLint 10.
// Security rules (plugin-security + no-unsanitized + html script extraction) PLUS the
// hand-written correctness set below (audit QA-15 — eslint:recommended's key rules,
// inlined because @eslint/js and the globals package are not dependencies and this
// repo pins zero runtime deps). Run via: npm run lint:security
// Globals are enumerated by hand: browser + the vendored window globals for the
// renderer/html; node/electron for main, preload, scripts, and CJS configs.

import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import html from 'eslint-plugin-html';

const CORRECTNESS_RULES = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
  'no-redeclare': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error',
  'no-dupe-else-if': 'error', 'no-self-assign': 'error', 'no-self-compare': 'error',
  'no-cond-assign': 'error', 'no-constant-condition': 'error', 'no-debugger': 'error',
  'no-delete-var': 'error', 'no-empty': 'error', 'no-empty-character-class': 'error',
  'no-ex-assign': 'error', 'no-fallthrough': 'error', 'no-func-assign': 'error',
  'no-import-assign': 'error', 'no-loss-of-precision': 'error',
  'no-new-native-nonconstructor': 'error', 'no-nonoctal-decimal-escape': 'error',
  'no-obj-calls': 'error', 'no-prototype-builtins': 'error',
  'no-shadow-restricted-names': 'error', 'no-sparse-arrays': 'error',
  'no-unreachable': 'error', 'no-unreachable-loop': 'error', 'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error', 'no-unsafe-optional-chaining': 'error',
  'no-unused-private-class-members': 'error', 'no-useless-backreference': 'error',
  'no-useless-catch': 'error', 'no-useless-escape': 'error', 'no-useless-rename': 'error',
  'no-with': 'error', 'require-yield': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
};

const G = (names) => Object.fromEntries(names.map((n) => [n, 'readonly']));
const BROWSER_AND_LIBS = G([
  'console', 'window', 'document', 'navigator', 'localStorage', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'queueMicrotask', 'structuredClone',
  'performance', 'crypto', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'AbortController', 'AbortSignal', 'fetch', 'Node', 'HTMLElement', 'Element', 'Text', 'Range', 'Selection',
  'NodeFilter', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'PointerEvent',
  'WheelEvent', 'DragEvent', 'InputEvent', 'FocusEvent', 'ClipboardEvent', 'MutationObserver',
  'ResizeObserver', 'IntersectionObserver', 'DOMParser', 'XMLSerializer', 'getComputedStyle',
  'matchMedia', 'getSelection', 'location', 'history', 'addEventListener',
  'removeEventListener', 'dispatchEvent', 'alert', 'confirm', 'prompt', 'open', 'close',
  'focus', 'blur', 'self', 'devicePixelRatio', 'innerWidth', 'innerHeight', 'scrollX',
  'scrollY', 'scrollTo', 'scrollBy', 'Blob', 'File', 'FileReader', 'FormData', 'Headers',
  'Response', 'Request', 'DOMPurify', 'marked', 'katex', 'hljs', 'mermaid', 'CM6',
  'isNaN', 'parseFloat', 'parseInt', 'escape', 'unescape', 'decodeURIComponent', 'encodeURIComponent',
]);
const NODE = G([
  'require', 'module', 'exports', 'process', 'Buffer', '__dirname', '__filename', 'global',
  'console', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask',
  'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams', 'performance', 'structuredClone',
  'Response', 'Request', 'AbortController', 'AbortSignal', 'fetch',
]);

export default [
  {
    files: ['**/*.html'],
    plugins: { html },
  },
  {
    files: [
      'src/**/*.js', 'scripts/**/*.{js,mjs}',
      '*.config.{js,mjs}', '**/*.html',
    ],
    plugins: {
      security,
      'no-unsanitized': noUnsanitized,
    },
    rules: {
      ...security.configs.recommended.rules,
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      ...CORRECTNESS_RULES,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: BROWSER_AND_LIBS,
    },
  },
  {
    files: [
      'src/main/**/*.js', 'src/preload/**/*.js',
      'scripts/**/*.js', 'playwright.config.js', 'playwright.electron.config.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: NODE,
    },
  },
  {
    // ESM build scripts: `import.meta` needs sourceType module, but they still use the
    // Node globals (audit QA-15's no-undef pass found scripts/rem-convert.mjs:33's process).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: NODE,
    },
  },
];
