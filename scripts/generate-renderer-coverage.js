/**
 * Convert Playwright V8 coverage data to Istanbul HTML report.
 *
 * Reads every *.json under coverage/renderer/ (recursively). Each file is a
 * V8 coverage array as produced by page.coverage.stopJSCoverage(). Sources:
 *   - tests/coverage-collector.spec.js (the original targeted collector), and
 *   - the full e2e suite when run with COLLECT_RENDERER_COVERAGE=1, via the
 *     auto coverage fixture wired up in playwright.config.js (audit #11).
 *
 * Per-file coverage is converted to Istanbul and merged: istanbul-lib-coverage
 * merges (unions) hit counts for repeated file paths, so running more tests can
 * only ever increase coverage of marqam.html, never shrink it.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const v8toIstanbul = require('v8-to-istanbul');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const COVERAGE_DIR = path.join(process.cwd(), 'coverage', 'renderer');
const REPORT_DIR = path.join(process.cwd(), 'coverage', 'renderer-report');
const MARQAM_HTML = path.join(process.cwd(), 'marqam.html');

// Regression guard (audit #11): if this report ever drops back to the narrow
// "collector-only" footprint, fail loudly instead of silently shipping a
// misleading number. The historical collector-only baseline was 33.2 % funcs /
// 63.6 % stmts; the full e2e suite covers materially more. We assert a floor
// safely below the full-suite result but ABOVE the collector-only baseline, so
// the guard turns red the moment full-suite collection stops working.
// Opt out with ENFORCE_RENDERER_COVERAGE_FLOOR=0 (e.g. ad-hoc partial runs).
const ENFORCE_FLOOR = process.env.ENFORCE_RENDERER_COVERAGE_FLOOR !== '0';
const MIN_FUNC_PCT = Number(process.env.MIN_RENDERER_FUNC_PCT || 40);
const MIN_STMT_PCT = Number(process.env.MIN_RENDERER_STMT_PCT || 70);

/**
 * Run the full Playwright e2e suite with renderer-coverage collection enabled,
 * then fall through to report generation. Invoked via `--run` so the npm script
 * stays a single, cross-platform `node` call (no cross-env / shell-specific
 * `VAR=val` syntax needed on Windows).
 *
 * The original collector spec (`Renderer coverage collector`) is excluded
 * because the auto coverage fixture in playwright.config.js now instruments
 * every spec, and that spec manages its own start/stopJSCoverage (a second
 * startJSCoverage on the same page would throw).
 */
function runFullSuite() {
  // Reset stale coverage so a previous narrow run can't inflate the report.
  fs.rmSync(COVERAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });

  // Invoke the Playwright CLI directly through node (shell:false) so that the
  // spaced --grep-invert regex is passed verbatim — going through npx + a shell
  // splits it and Playwright then reports "No tests found".
  const playwrightCli = require.resolve('@playwright/test/cli');
  const result = spawnSync(
    process.execPath,
    [
      playwrightCli, 'test',
      '--config', 'playwright.config.js',
      '--grep-invert', 'Renderer coverage collector',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, COLLECT_RENDERER_COVERAGE: '1' },
      shell: false,
    }
  );
  if (result.status !== 0) {
    console.error(`Playwright e2e suite failed (exit ${result.status}); aborting coverage report.`);
    process.exit(result.status || 1);
  }
}

/** Recursively collect every *.json file under dir. */
function collectJsonFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectJsonFiles(full));
    } else if (name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  if (process.argv.includes('--run')) {
    runFullSuite();
  }

  if (!fs.existsSync(COVERAGE_DIR)) {
    console.error('No coverage data found. Run Playwright coverage collector first.');
    process.exit(1);
  }

  const coverageMap = libCoverage.createCoverageMap();
  const files = collectJsonFiles(COVERAGE_DIR);

  let mergedEntries = 0;
  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      // A half-written file from a crashed worker shouldn't abort the report.
      console.warn(`Skipping unreadable coverage file: ${file} (${err.message})`);
      continue;
    }
    if (!Array.isArray(raw)) continue;

    for (const entry of raw) {
      if (!entry || typeof entry.url !== 'string' || !entry.url.includes('marqam.html')) continue;

      const converter = v8toIstanbul(MARQAM_HTML, 0, {
        source: entry.source,
      });
      await converter.load();
      converter.applyCoverage(entry.functions);
      const istanbulCoverage = converter.toIstanbul();

      for (const [, data] of Object.entries(istanbulCoverage)) {
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

        // addFileCoverage MERGES (unions hit counts) when the path repeats,
        // so coverage from every test accumulates onto marqam.html.
        coverageMap.addFileCoverage(standard);
        mergedEntries++;
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
  console.log(`Merged ${mergedEntries} marqam.html coverage entr${mergedEntries === 1 ? 'y' : 'ies'} from ${files.length} JSON file(s).`);

  // --- Regression guard -----------------------------------------------------
  const summary = coverageMap.getCoverageSummary().toJSON();
  const funcPct = summary.functions.pct;
  const stmtPct = summary.statements.pct;
  console.log(`Renderer coverage: ${stmtPct.toFixed(2)}% stmts / ${funcPct.toFixed(2)}% funcs.`);

  if (ENFORCE_FLOOR) {
    const failures = [];
    if (funcPct < MIN_FUNC_PCT) {
      failures.push(`function coverage ${funcPct.toFixed(2)}% < required ${MIN_FUNC_PCT}%`);
    }
    if (stmtPct < MIN_STMT_PCT) {
      failures.push(`statement coverage ${stmtPct.toFixed(2)}% < required ${MIN_STMT_PCT}%`);
    }
    if (failures.length) {
      console.error(
        '\n✗ Renderer coverage below the full-suite floor — the report likely ' +
        'reflects only the narrow collector spec, not the full e2e suite:\n  - ' +
        failures.join('\n  - ') +
        '\n  Ensure COLLECT_RENDERER_COVERAGE=1 ran the full Playwright suite.'
      );
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
