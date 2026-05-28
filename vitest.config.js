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
      include: ['main.js', 'preload.js', 'src/**/*.js', 'tests/unit/**/*.js'],
      exclude: ['node_modules/', 'dist/', 'coverage/', '__mocks__/'],
    },
  },
  resolve: {
    alias: {
      // ✅ استخدم resolve بدلاً من path.resolve
      electron: resolve(__dirname, '__mocks__/electron.cjs'),
    },
  },
});