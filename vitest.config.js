import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    name: 'node',
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.js', 'tests/unit/**/*.spec.js'],
    exclude: ['tests/unit/**/*.assert.test.js'],
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
      electron: path.resolve(__dirname, '__mocks__/electron.cjs'),
    },
  },
});
