# Contributing to BP MD RTL Reader

Thanks for considering a contribution. This is a local-first Markdown reader with
first-class right-to-left support, and it holds itself to fairly strict quality gates —
this document exists so you can meet them without guessing.

## Getting set up

Node.js **24+** is required (`.nvmrc` pins it, and CI builds on Node 24).

```bash
git clone https://github.com/Binary-Parse/BP-MD-RTL-Reader.git
cd BP-MD-RTL-Reader
npm install    # postinstall also downloads a Chromium build for Playwright
npm start      # electron . — run the app
```

`npm install` runs `playwright install chromium` as a `postinstall` step, so the first
install pulls a browser (~150 MB). That is expected.

## Running the tests

```bash
npm test                      # unit, browser e2e, then the real-Electron boundary suite
npm run test:unit             # Vitest only — fastest loop
npm run test:e2e              # full Playwright browser lane
npm run test:electron         # production Electron/preload/IPC boundary lane
npm run lint:security         # ESLint security / SAST pass
npm run test:update-snapshots # refresh visual-regression baselines
```

There are two Playwright lanes and they are not interchangeable. The **browser lane**
(`playwright.config.js`) loads the renderer over `file://` in bare Chromium — fast, but it
cannot prove anything about Electron. The **Electron lane**
(`playwright.electron.config.js`) launches a real main process with real IPC. Anything
that depends on main-process behaviour has to be proven in the Electron lane.

## Quality gates a pull request must pass

| Gate | Threshold | Configured in |
|------|-----------|---------------|
| Unit coverage (Vitest) | 95 % statements, 90 % branches, 95 % functions, 95 % lines | `config/coverage-thresholds.json` |
| Mutation (Stryker) | 80 % overall; per-file T1 85 % / T2 75 % / T3 60 % | `stryker.config.json`, `config/mutation-tiers.json` |
| Security lint | Zero new or moved findings against a reviewed baseline | `config/security-lint-baseline.json` |
| Packaging | Archive contents and Electron fuses verified | `npm run package:verify` |

### The security-lint baseline

`npm run lint:security` compares findings against a SHA-256 fingerprinted baseline. If your
change only moves existing findings around, refresh their positions:

```bash
node scripts/regen-security-baseline.cjs
```

If it reports genuinely **new** findings, review each one first, and only then accept them:

```bash
node scripts/regen-security-baseline.cjs --accept
```

Never run `--accept` to make a red gate go green without reading the delta. The baseline is
a review record, not a suppression list.

### Visual baselines

Visual specs are tagged `@visual` and run at 1440×900. Committed baselines exist for both
`chromium-win32` and `chromium-linux`. Linux baselines must be regenerated inside the
pinned container (`mcr.microsoft.com/playwright:v1.61.1-jammy`) so font rendering matches;
regenerating them on a host machine will produce baselines that fail in CI.

## How we work

**Test first.** Write the failing test, confirm it fails for the reason you expect, then
write the minimal code that passes it. A behavioural change without a test that would have
caught its absence is not finished.

**One logical change per commit**, in [Conventional Commits](https://www.conventionalcommits.org/)
form — `fix(reader): …`, `feat(tree): …`, `refactor(menu): …`. Explain *why* in the body;
the diff already shows *what*. Never amend a pushed commit — corrections are new commits.

**Run the full gate before you push**, not just the test you were working on. Several
invariants in this repo are cross-file, and a green single test proves less than you think.

## Architecture notes worth knowing

**Module system is split.** `src/main/` and `src/preload/` are CommonJS (Node/Electron
side). Everything under `src/renderer/` is ES modules (browser side).

**Entry points are injectable.** `src/main/index.js` exports
`bootstrap({ electron, fs, proc, fetchFn })` and `src/preload/index.js` exports
`setupBridge({ contextBridge, ipcRenderer })`, each calling itself at the bottom only in a
real runtime. That is what lets Vitest exercise main-process logic without launching
Electron — keep pure logic separable from Electron side-effects when you add IPC.

**Four stylesheets, fixed cascade order.** `src/renderer/styles/` holds `base.css`,
`themes.css`, `components.css`, and `responsive.css`, linked in that order.
`src/renderer/index.html` is markup that references them externally and carries no
`<style>` block. Do not add a fifth stylesheet.

**Logical properties only on the inline axis.** Every left/right-sensitive rule in
`src/renderer/styles/` uses `inset-inline-start`, `border-inline-start`, `padding-inline`
and friends — never physical `left`/`right`. RTL mirroring then falls out of `dir="rtl"`
for free. The sole exception is a handful of `text-align: right` rules scoped to
`#editor[dir="rtl"]`, because `text-align` has no logical keyword equivalent.

**Chrome tooltips use `data-tip`, not `title`.** No chrome element carries a native
`title=`; they render a designed `[data-tip]::after` pill. Controls inside `.tabs` are the
exception — that container clips vertically, so they share the JS-positioned `#floatingTip`.

**Security guards are labelled.** `src/main/main-logic.js` marks its checks `JB1` (path
allowlist), `JB2` (reject UNC/network paths), `JB3` (size/count caps), and `JB4` (reject
symlink escapes). Keep them in place and update their tests when touching filesystem access.

Ticket-style comment tags (`T-B1`, `T-F13`, `EC-A2`, `audit #3`) reference requirements and
audit findings — preserve them when refactoring.

## Continuous integration

GitHub Actions is **disabled** on this repository, so nothing below runs automatically.
The workflow definitions are kept because they document the intended gates and because
the checks are the same ones you can run locally — but the burden of running them is
yours before opening a pull request.

- `ci.yml` — lint, unit, e2e, coverage, Electron boundary, visual, packaging matrix, and a
  nightly mutation run. Defaults to `contents: read`.
- `codeql.yml` — CodeQL analysis on push, pull request, and a weekly schedule.
- `scorecard.yml` — OpenSSF Scorecard, publishing results as SARIF.
- `claude.yml` — handles explicit `@claude` requests on issues and reviews.
  The Claude workflow grants explicit write permissions for repository contents,
  pull requests, and issues, and gates every trigger on the author's association
  with the repository.

Every `uses:` in every workflow is pinned to a full commit SHA. Keep it that way.

Releases are cut by hand — see [docs/BUILD.md](docs/BUILD.md). `npm run dist` builds the
Windows installers, `npm run package:verify` checks the packaged archives and Electron
fuses, and `scripts/release-preflight.js` validates the version and changelog. Because no
pipeline enforces them, run all three before publishing anything.

## Reporting security issues

Please do **not** open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md)
for private reporting through GitHub Security Advisories.

## Licence

By contributing you agree that your contributions are licensed under the
[MIT Licence](LICENSE) that covers this project.
