import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ✅ الحل البديل لـ __dirname في ESM
const __dirname = dirname(fileURLToPath(import.meta.url));

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
    deps: {
      inline: [/src\/main-logic\.js/],
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage/node',
      // Measure PRODUCT code only — never test files or test-support helpers
      // (e.g. tests/unit/main-harness.js), whose unused mock closures would
      // otherwise drag the function/line totals below the gate.
      include: ['main.js', 'preload.js', 'src/**/*.js'],
      exclude: ['node_modules/', 'dist/', 'coverage/', 'tests/**'],
      // Coverage gate (audit #5): SAFE thresholds set BELOW current measured
      // coverage (≈98% stmt / 95% branch / 100% func / 98% lines) so the gate
      // enforces a regression floor without false-failing on normal runs.
      thresholds: {
        statements: 95,
        branches: 88,
        functions: 95,
        lines: 95,
      },
    },
  },
  resolve: {
    alias: {
      // ✅ استخدم resolve بدلاً من path.resolve
      electron: resolve(__dirname, 'tests/__mocks__/electron.cjs'),
    },
  },
});