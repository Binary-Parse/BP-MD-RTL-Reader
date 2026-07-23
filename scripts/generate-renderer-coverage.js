/**
 * Convert Playwright V8 coverage data to Istanbul HTML report.
 *
 * Reads every *.json under coverage/renderer/ (recursively). Each file is a
 * V8 coverage array as produced by page.coverage.stopJSCoverage(). Sources:
 *   - tests/e2e/coverage-collector.spec.js (the original targeted collector), and
 *   - the full e2e suite when run with COLLECT_RENDERER_COVERAGE=1, via the
 *     auto coverage fixture wired up in playwright.config.js (audit #11).
 *
 * Per-file coverage is converted to Istanbul and merged: istanbul-lib-coverage
 * merges (unions) hit counts for repeated file paths, so running more tests can
 * only ever increase coverage of index.html, never shrink it.
 */

const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { spawnSync } = require('child_process');
const v8toIstanbul = require('v8-to-istanbul');
const libCoverage = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');
const { writeCoverageMetadata } = require('./coverage-metadata');

const COVERAGE_DIR = path.join(process.cwd(), 'coverage', 'renderer');
const REPORT_DIR = path.join(process.cwd(), 'coverage', 'renderer-report');
const EXPECTED_MANIFEST = path.join(process.cwd(), 'config', 'renderer-coverage-files.json');

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
const CRITICAL_FILE_FLOORS = {
  'src/renderer/app.js': Number(process.env.MIN_RENDERER_APP_STMT_PCT || 45),
  'src/renderer/theme-boot.js': Number(process.env.MIN_RENDERER_THEME_BOOT_STMT_PCT || 80),
  'src/renderer/editor/codemirror-adapter.js': Number(process.env.MIN_RENDERER_CM_STMT_PCT || 35),
};

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
      '--grep-invert', '@visual|Renderer coverage collector',
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

function collectSourceFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...collectSourceFiles(full));
    else if (name.endsWith('.js')) out.push(path.relative(process.cwd(), full).replaceAll('\\', '/'));
  }
  return out.sort();
}

function loadExpectedFiles() {
  const expected = JSON.parse(fs.readFileSync(EXPECTED_MANIFEST, 'utf8')).slice().sort();
  const actual = collectSourceFiles(path.join(process.cwd(), 'src', 'renderer'));
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error('Renderer coverage manifest does not match src/renderer/**/*.js');
  }
  return expected;
}

function standardCoverage(data, localPath) {
  const { all, ...rest } = data;
  return {
    path: (rest.path && rest.path !== '') ? rest.path : localPath,
    statementMap: rest.statementMap || {},
    s: rest.s || {},
    fnMap: rest.fnMap || {},
    f: rest.f || {},
    branchMap: rest.branchMap || {},
    b: rest.b || {},
  };
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
  const expectedFiles = loadExpectedFiles();
  const observedFiles = new Set();

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
      if (!entry || typeof entry.url !== 'string') continue;
      // T-F13/audit fix (was: index.html-only): the strict CSP externalised all renderer JS
      // out of index.html into src/renderer/*.js (ES modules). Capture every first-party
      // renderer script and map each V8 entry back to its REAL source file on disk, instead
      // of the old hardcoded INDEX_HTML (which matched 0 entries → 0% → crash).
      if (!entry.url.includes('/src/renderer/')) continue;
      let localPath;
      try { localPath = fileURLToPath(entry.url.split('?')[0].split('#')[0]); }
      catch (_) { continue; }
      if (!fs.existsSync(localPath)) continue;
      observedFiles.add(path.relative(process.cwd(), localPath).replaceAll('\\', '/'));

      const converter = v8toIstanbul(localPath, 0, { source: entry.source });
      await converter.load();
      converter.applyCoverage(entry.functions);
      const istanbulCoverage = converter.toIstanbul();

      for (const [, data] of Object.entries(istanbulCoverage)) {
        // addFileCoverage MERGES (unions hit counts) when the path repeats,
        // so coverage from every test accumulates per renderer source file.
        coverageMap.addFileCoverage(standardCoverage(data, localPath));
        mergedEntries++;
      }
    }
  }

  // Missing first-party sources are materialized as zero-coverage files so
  // they cannot disappear from the denominator. They also fail the load gate.
  const missingFiles = expectedFiles.filter((file) => !observedFiles.has(file));
  for (const relative of missingFiles) {
    const localPath = path.join(process.cwd(), relative);
    const converter = v8toIstanbul(localPath, 0, { source: fs.readFileSync(localPath, 'utf8') });
    await converter.load();
    converter.applyCoverage([]);
    for (const [, data] of Object.entries(converter.toIstanbul())) {
      coverageMap.addFileCoverage(standardCoverage(data, localPath));
    }
  }

  const context = libReport.createContext({
    dir: REPORT_DIR,
    coverageMap,
  });

  reports.create('html').execute(context);
  reports.create('text').execute(context);
  reports.create('json').execute(context);
  writeCoverageMetadata(REPORT_DIR, 'renderer', {
    expectedFiles: expectedFiles.length,
    observedFiles: observedFiles.size,
    mergedEntries,
  });

  console.log(`Renderer coverage report generated at: ${REPORT_DIR}`);
  console.log(`Merged ${mergedEntries} renderer coverage entr${mergedEntries === 1 ? 'y' : 'ies'} from ${files.length} JSON file(s).`);

  // --- Regression guard -----------------------------------------------------
  const summary = coverageMap.getCoverageSummary().toJSON();
  // Guard the empty-collection case: an empty coverage map yields non-numeric pct
  // ("Unknown"/NaN). Coerce to 0 so we report + fail the floor cleanly instead of crashing
  // (the old `stmtPct.toFixed is not a function` bug when 0 files were collected).
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const funcPct = num(summary.functions && summary.functions.pct);
  const stmtPct = num(summary.statements && summary.statements.pct);
  console.log(`Renderer coverage: ${stmtPct.toFixed(2)}% stmts / ${funcPct.toFixed(2)}% funcs.`);

  if (ENFORCE_FLOOR) {
    const failures = [];
    if (missingFiles.length) {
      failures.push('required renderer sources were not observed: ' + missingFiles.join(', '));
    }
    if (funcPct < MIN_FUNC_PCT) {
      failures.push(`function coverage ${funcPct.toFixed(2)}% < required ${MIN_FUNC_PCT}%`);
    }
    if (stmtPct < MIN_STMT_PCT) {
      failures.push(`statement coverage ${stmtPct.toFixed(2)}% < required ${MIN_STMT_PCT}%`);
    }
    for (const [relative, minimum] of Object.entries(CRITICAL_FILE_FLOORS)) {
      const absolute = path.resolve(relative);
      const matched = coverageMap.files().find(file => path.resolve(file) === absolute);
      const fileCoverage = matched ? coverageMap.fileCoverageFor(matched) : null;
      const pct = fileCoverage
        ? num(fileCoverage.toSummary().statements.pct)
        : 0;
      console.log(relative + ': ' + pct.toFixed(2) + '% statements (min ' + minimum + '%).');
      if (pct < minimum) failures.push(relative + ' statement coverage ' + pct.toFixed(2) + '% < ' + minimum + '%');
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

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { collectJsonFiles, collectSourceFiles, loadExpectedFiles, standardCoverage };
