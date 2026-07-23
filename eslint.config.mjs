// Flat-config for ESLint 10 (security-focused).
// Wires eslint-plugin-security + eslint-plugin-no-unsanitized + eslint-plugin-html
// (the last monkey-patches ESLint at require-time to extract <script> blocks from
// .html so SAST sees them — audit #11).
// Run via: npm run lint:security

import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import html from 'eslint-plugin-html';

export default [
  // Activate the HTML plugin so <script> blocks in .html are extracted.
  // Per README: just declare `plugins: { html }` on .html files; the plugin
  // monkey-patches ESLint's Linter at load time and extracts scripts.
  {
    files: ['**/*.html'],
    plugins: { html },
  },
  // First-party runtime, executed build/report tooling, configs, and extracted HTML scripts.
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
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  // Electron/main-side modules, Node scripts, and CJS configs use CommonJS.
  {
    files: [
      'src/main/**/*.js', 'src/preload/**/*.js',
      'scripts/**/*.js', 'playwright.config.js', 'playwright.electron.config.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
];
