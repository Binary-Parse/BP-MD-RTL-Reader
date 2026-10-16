/**
 * audit-deps.test.js — audit B8: the dependency-advisory gate.
 *
 * Requirement: the gate passes only when every advisory `npm audit` reports has been reviewed
 * (listed with a reason in config/audit-acceptance.json) and the list holds nothing else; a
 * package that is shipped can never be waved through as "dev only".
 */
import { describe, test, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { evaluateAudit, reportedAdvisories, shippedPackages, advisoryId } = require('../../scripts/audit-deps.js');

const REASON = 'No patched release exists; development tool only.';
const via = (name, id, severity) => ({ source: 1, name, url: `https://github.com/advisories/${id}`, severity, range: '*' });
const report = (...roots) => ({
  vulnerabilities: {
    ...Object.fromEntries(roots.map((r) => [r.name, { name: r.name, severity: r.severity, via: [r] }])),
    dependent: { name: 'dependent', severity: 'high', via: roots.map((r) => r.name) },
  },
});
const entry = (over = {}) => ({ advisory: 'GHSA-aaaa', package: 'braces', severity: 'high', scope: 'dev', reason: REASON, ...over });

describe('reportedAdvisories', () => {
  test('lists each advisory once and ignores the packages that only depend on a vulnerable one', () => {
    const found = reportedAdvisories(report(via('braces', 'GHSA-aaaa', 'high'), via('katex', 'GHSA-bbbb', 'low')));
    expect([...found.keys()]).toEqual(['GHSA-aaaa', 'GHSA-bbbb']);
    expect(found.get('GHSA-aaaa')).toEqual({ id: 'GHSA-aaaa', package: 'braces', severity: 'high' });
  });

  test('keeps the highest severity when one advisory is reported twice', () => {
    const twice = { vulnerabilities: {
      a: { via: [via('braces', 'GHSA-aaaa', 'low')] },
      b: { via: [via('braces', 'GHSA-aaaa', 'critical')] },
      c: { via: [via('braces', 'GHSA-aaaa', 'moderate')] },
    } };
    expect(reportedAdvisories(twice).get('GHSA-aaaa').severity).toBe('critical');
  });

  test('an empty or missing report has no advisories', () => {
    expect(reportedAdvisories({ vulnerabilities: {} }).size).toBe(0);
    expect(reportedAdvisories({}).size).toBe(0);
    expect(reportedAdvisories(null).size).toBe(0);
    expect(reportedAdvisories({ vulnerabilities: { a: {} , b: { via: [null] } } }).size).toBe(0);
  });

  test('advisoryId takes the id from the advisory URL', () => {
    expect(advisoryId('https://github.com/advisories/GHSA-vfj7-8cjw-p6xm')).toBe('GHSA-vfj7-8cjw-p6xm');
    expect(advisoryId(undefined)).toBe('');
  });
});

describe('shippedPackages', () => {
  test('reads the package names from the bundled licence headings, scoped names included', () => {
    const text = 'Third-party licences\n\nkatex@0.18.9 — MIT\nsome text with user@example.com — not a heading\n@chevrotain/utils@11.1.2 — Apache-2.0\r\nmarked@18.0.6 — MIT\nno-version — MIT\n@0 — MIT\n';
    expect([...shippedPackages(text)].sort()).toEqual(['@chevrotain/utils', 'katex', 'marked']);
    expect(shippedPackages(undefined).size).toBe(0);
  });
});

describe('evaluateAudit', () => {
  test('passes when nothing is reported and nothing is accepted', () => {
    expect(evaluateAudit({ vulnerabilities: {} }, { accepted: [] })).toEqual([]);
    expect(evaluateAudit({ vulnerabilities: {} }, {})).toEqual([]);
    expect(evaluateAudit({ vulnerabilities: {} }, null)).toEqual([]);
  });

  test('passes when every reported advisory is accepted with a reason', () => {
    expect(evaluateAudit(report(via('braces', 'GHSA-aaaa', 'high')), { accepted: [entry()] })).toEqual([]);
  });

  test('an advisory that is not listed fails, whatever its severity', () => {
    for (const severity of ['low', 'moderate', 'high', 'critical']) {
      const errors = evaluateAudit(report(via('undici', 'GHSA-new1', severity)), { accepted: [] });
      expect(errors).toEqual([`GHSA-new1 (undici, ${severity}) is not accepted: fix it or add it to config/audit-acceptance.json with a reason`]);
    }
  });

  test('an accepted advisory npm no longer reports fails, so the list cannot rot', () => {
    expect(evaluateAudit({ vulnerabilities: {} }, { accepted: [entry()] }))
      .toEqual(['GHSA-aaaa: accepted but no longer reported — remove it from config/audit-acceptance.json']);
  });

  test('a severity above the reviewed one fails; the same or a lower one passes', () => {
    const accepted = { accepted: [entry({ severity: 'moderate' })] };
    expect(evaluateAudit(report(via('braces', 'GHSA-aaaa', 'high')), accepted))
      .toEqual(['GHSA-aaaa: severity is now high, reviewed as moderate']);
    expect(evaluateAudit(report(via('braces', 'GHSA-aaaa', 'moderate')), accepted)).toEqual([]);
    expect(evaluateAudit(report(via('braces', 'GHSA-aaaa', 'low')), accepted)).toEqual([]);
  });

  test('a severity npm invents later counts as the worst one', () => {
    expect(evaluateAudit(report(via('braces', 'GHSA-aaaa', 'catastrophic')), { accepted: [entry({ severity: 'critical' })] })).toEqual([]);
    expect(evaluateAudit(report(via('braces', 'GHSA-aaaa', 'catastrophic')), { accepted: [entry({ severity: 'high' })] }))
      .toEqual(['GHSA-aaaa: severity is now catastrophic, reviewed as high']);
  });

  test('an acceptance for another package does not cover the advisory', () => {
    expect(evaluateAudit(report(via('micromatch', 'GHSA-aaaa', 'high')), { accepted: [entry()] }))
      .toEqual(['GHSA-aaaa: reported for micromatch, accepted for braces']);
  });

  test('a "dev" acceptance fails when the package is inside the shipped bundles', () => {
    const rep = report(via('braces', 'GHSA-aaaa', 'high'));
    expect(evaluateAudit(rep, { accepted: [entry()] }, new Set(['braces'])))
      .toEqual(['acceptance entry GHSA-aaaa: braces is inside the vendored bundles, so it is shipped, not dev-only']);
    expect(evaluateAudit(rep, { accepted: [entry()] }, new Set(['katex']))).toEqual([]);
  });

  test('a shipped package may carry only a low advisory', () => {
    const shipped = new Set(['katex']);
    const low = entry({ advisory: 'GHSA-bbbb', package: 'katex', severity: 'low', scope: 'shipped' });
    expect(evaluateAudit(report(via('katex', 'GHSA-bbbb', 'low')), { accepted: [low] }, shipped)).toEqual([]);
    expect(evaluateAudit(report(via('katex', 'GHSA-bbbb', 'info')), { accepted: [{ ...low, severity: 'info' }] }, shipped)).toEqual([]);
    for (const severity of ['moderate', 'high', 'critical']) {
      expect(evaluateAudit(report(via('katex', 'GHSA-bbbb', severity)), { accepted: [{ ...low, severity }] }, shipped))
        .toEqual(['acceptance entry GHSA-bbbb: a shipped package may only carry an accepted advisory of low severity']);
    }
  });

  test('every entry needs an id, a package, a real reason, a known severity and a scope', () => {
    const rep = report(via('braces', 'GHSA-aaaa', 'high'));
    expect(evaluateAudit(rep, { accepted: [entry({ reason: 'ok' })] })).toEqual(['acceptance entry GHSA-aaaa: needs a reason']);
    expect(evaluateAudit(rep, { accepted: [entry({ reason: '                         ' })] })).toEqual(['acceptance entry GHSA-aaaa: needs a reason']);
    expect(evaluateAudit(rep, { accepted: [entry({ reason: 42 })] })).toEqual(['acceptance entry GHSA-aaaa: needs a reason']);
    expect(evaluateAudit(rep, { accepted: [entry({ reason: '12345678901234567890' })] })).toEqual([]);
    expect(evaluateAudit(rep, { accepted: [entry({ scope: 'test' })] })).toEqual(['acceptance entry GHSA-aaaa: scope must be "dev" or "shipped"']);
    expect(evaluateAudit(rep, { accepted: [entry({ severity: 'severe' })] })).toContain('acceptance entry GHSA-aaaa: unknown severity "severe"');
    expect(evaluateAudit({ vulnerabilities: {} }, { accepted: [entry({ advisory: '' })] }))
      .toEqual(['acceptance entry (no advisory id): "advisory" and "package" are required']);
    expect(evaluateAudit(rep, { accepted: [entry({ package: '' })] })).toEqual([
      'acceptance entry GHSA-aaaa: "advisory" and "package" are required',
      'GHSA-aaaa (braces, high) is not accepted: fix it or add it to config/audit-acceptance.json with a reason',
    ]);
  });

  test('an advisory listed twice fails', () => {
    expect(evaluateAudit(report(via('braces', 'GHSA-aaaa', 'high')), { accepted: [entry(), entry({ reason: 'x' })] }))
      .toEqual(['acceptance entry GHSA-aaaa: listed twice']);
  });
});

describe('the committed acceptance file', () => {
  const acceptance = JSON.parse(fs.readFileSync('config/audit-acceptance.json', 'utf8'));
  const shipped = shippedPackages(fs.readFileSync('resources/vendor/THIRD-PARTY-LICENSES.txt', 'utf8'));

  test('is well formed against exactly the advisories it lists', () => {
    const rep = report(...acceptance.accepted.map((e) => via(e.package, e.advisory, e.severity)));
    expect(evaluateAudit(rep, acceptance, shipped)).toEqual([]);
  });

  test('marks nothing above low as shipped, and every entry carries a review date', () => {
    expect(Array.isArray(acceptance.accepted)).toBe(true); // empty since D7 and D11 were fixed
    for (const e of acceptance.accepted) {
      expect(e.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (shipped.has(e.package)) expect(e.scope).toBe('shipped');
    }
  });

  test('the bundled licence file is read as a non-empty package list', () => {
    expect(shipped.has('katex')).toBe(true);
    expect(shipped.has('mermaid')).toBe(true);
    expect(shipped.size).toBeGreaterThan(100);
  });
});

describe('npmEnvironment', () => {
  test('drops the configuration npm run exports and keeps everything else', () => {
    const { npmEnvironment } = require('../../scripts/audit-deps.js');
    expect(npmEnvironment({
      PATH: '/bin', npm_config_allow_scripts: 'x', NPM_CONFIG_REGISTRY: 'y', npm_execpath: 'npm-cli.js', my_npm_config_x: 'kept',
    })).toEqual({ PATH: '/bin', npm_execpath: 'npm-cli.js', my_npm_config_x: 'kept' });
  });
});
