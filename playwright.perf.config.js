// @ts-check
// QA-N7: the @perf timing budgets, kept out of npm run test:e2e because a busy machine can
// miss a millisecond budget without a code change. Run them on a quiet machine:
// npm run test:perf
const base = require('./playwright.config.js');

module.exports = { ...base, grep: /@perf/, grepInvert: undefined };
