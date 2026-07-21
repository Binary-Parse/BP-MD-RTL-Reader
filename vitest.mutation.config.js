import baseConfig from './vitest.config.js';

// Repository-byte provenance is verified by the ordinary unit/CI gates. Stryker
// copies generated vendor assets into an instrumented sandbox, so byte-for-byte
// artifact assertions do not describe a product-code mutant in that environment.
export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    exclude: [
      ...baseConfig.test.exclude,
      'tests/unit/vendor-provenance.test.js',
    ],
  },
};
