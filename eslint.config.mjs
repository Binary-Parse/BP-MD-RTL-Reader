// Flat-config for ESLint 10 (security-focused).
// Wires eslint-plugin-security + eslint-plugin-no-unsanitized.
// Run via: npm run lint:security

import security from 'eslint-plugin-security';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

export default [
  // Default: treat first-party JS as modern (ES2022)
  {
    files: ['main.js', 'preload.js', 'src/**/*.js'],
    plugins: {
      security,
      'no-unsanitized': noUnsanitized,
    },
    rules: {
      ...security.configs.recommended.rules,
      'no-unsanitized/method': 'warn',
      'no-unsanitized/property': 'warn',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  // Electron main + preload + main-logic are CommonJS — override sourceType
  {
    files: ['main.js', 'preload.js', 'src/main-logic.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
];
