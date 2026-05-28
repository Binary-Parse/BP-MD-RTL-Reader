/**
 * Merge Node (Vitest) and Renderer (Playwright) coverage reports into one.
 */

const fs = require('fs');
const path = require('path');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const NODE_COVERAGE = path.join(process.cwd(), 'coverage', 'node', 'coverage-final.json');
const RENDERER_COVERAGE = path.join(process.cwd(), 'coverage', 'renderer-report', 'coverage-final.json');
const MERGED_DIR = path.join(process.cwd(), 'coverage', 'merged');

async function main() {
  const coverageMap = libCoverage.createCoverageMap();

  if (fs.existsSync(NODE_COVERAGE)) {
    const node = JSON.parse(fs.readFileSync(NODE_COVERAGE, 'utf8'));
    coverageMap.merge(node);
    console.log('✅ Merged Node coverage');
  }

  if (fs.existsSync(RENDERER_COVERAGE)) {
    const renderer = JSON.parse(fs.readFileSync(RENDERER_COVERAGE, 'utf8'));
    coverageMap.merge(renderer);
    console.log('✅ Merged Renderer coverage');
  }

  const context = libReport.createContext({
    dir: MERGED_DIR,
    coverageMap,
  });

  reports.create('html').execute(context);
  reports.create('text-summary').execute(context);
  reports.create('json').execute(context);

  console.log(`\n📊 Merged coverage report: ${MERGED_DIR}/index.html`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
