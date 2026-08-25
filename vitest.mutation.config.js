import baseConfig from './vitest.config.js';

// Source-text integrity is verified by the ordinary unit/CI gates. Stryker
// rewrites source and generated assets in its instrumented sandbox, so raw byte
// and line-count assertions do not describe product-code mutants there.
export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    exclude: [
      ...baseConfig.test.exclude,
      'tests/unit/vendor-provenance.test.js',
      'tests/unit/main-controller-boundaries.test.js',
    ],
  },
};
