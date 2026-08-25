import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

// ✅ الحل البديل لـ __dirname في ESM
const __dirname = dirname(fileURLToPath(import.meta.url));
const coverageThresholds = JSON.parse(
  readFileSync(resolve(__dirname, 'config/coverage-thresholds.json'), 'utf8'),
);

export default defineConfig({
  test: {
    name: 'node',
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.js', 'tests/unit/**/*.spec.js'],
    exclude: [
      'tests/e2e/**',              // safety: never let Playwright specs slip in
      'tests/**/*.e2e.spec.js',    // safety: same
    ],
    server: {
      deps: {
        inline: [/src[\\/]main[\\/]main-logic\.js/],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage/node',
      // Measure PRODUCT code only — never test files or test-support helpers
      // (e.g. tests/unit/main-harness.js), whose unused mock closures would
      // otherwise drag the function/line totals below the gate.
      include: ['src/**/*.js'],
      // src/renderer/app.js + theme-boot.js are the renderer ENTRY/glue (DOM wiring, DI
      // seams) externalized from index.html for the strict CSP (T-B4). Like the inline
      // <script> they replaced, they are exercised by the Playwright e2e suite, not unit
      // tests — the PURE logic they import (i18n/theme/state/markdown/bidi/…) stays fully
      // unit-covered. Excluding them keeps the gate measuring unit-testable product code.
      exclude: ['node_modules/', 'dist/', 'coverage/', 'tests/**', 'src/renderer/app.js', 'src/renderer/theme-boot.js', 'src/renderer/trusted-types-boot.js', 'src/renderer/editor/codemirror-adapter.js'],
      // Coverage gate (audit #5): SAFE thresholds set BELOW current measured
      // coverage (≈98% stmt / 95% branch / 100% func / 98% lines) so the gate
      // enforces a regression floor without false-failing on normal runs.
      thresholds: coverageThresholds.unit,
    },
  },
  resolve: {
    alias: {
      // ✅ استخدم resolve بدلاً من path.resolve
      electron: resolve(__dirname, 'tests/__mocks__/electron.cjs'),
    },
  },
});
