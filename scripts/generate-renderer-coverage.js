/**
 * Convert Playwright V8 coverage data to Istanbul HTML report.
 */

const fs = require('fs');
const path = require('path');
const v8toIstanbul = require('v8-to-istanbul');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const COVERAGE_DIR = path.join(process.cwd(), 'coverage', 'renderer');
const REPORT_DIR = path.join(process.cwd(), 'coverage', 'renderer-report');
const MARQAM_HTML = path.join(process.cwd(), 'marqam.html');

async function main() {
  if (!fs.existsSync(COVERAGE_DIR)) {
    console.error('No coverage data found. Run Playwright coverage collector first.');
    process.exit(1);
  }

  const coverageMap = libCoverage.createCoverageMap();
  const files = fs.readdirSync(COVERAGE_DIR).filter(f => f.endsWith('.json'));

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(COVERAGE_DIR, file), 'utf8'));
    for (const entry of raw) {
      if (!entry.url.includes('marqam.html')) continue;
      
      const converter = v8toIstanbul(MARQAM_HTML, 0, {
        source: entry.source,
      });
      await converter.load();
      converter.applyCoverage(entry.functions);
      const istanbulCoverage = converter.toIstanbul();
      
      for (const [filePath, data] of Object.entries(istanbulCoverage)) {
        // Remove v8-to-istanbul-specific keys that istanbul-lib-coverage rejects
        const { all, ...rest } = data;
        
        // Ensure all required keys exist and are truthy
        const standard = {
          path: (rest.path && rest.path !== '') ? rest.path : MARQAM_HTML,
          statementMap: rest.statementMap || {},
          s: rest.s || {},
          fnMap: rest.fnMap || {},
          f: rest.f || {},
          branchMap: rest.branchMap || {},
          b: rest.b || {},
        };
        
        coverageMap.addFileCoverage(standard);
      }
    }
  }

  const context = libReport.createContext({
    dir: REPORT_DIR,
    coverageMap,
  });

  reports.create('html').execute(context);
  reports.create('text').execute(context);
  reports.create('json').execute(context);

  console.log(`Renderer coverage report generated at: ${REPORT_DIR}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
