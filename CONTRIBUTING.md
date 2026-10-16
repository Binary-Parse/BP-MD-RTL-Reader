# Contributing to BP MD RTL Reader

Thank you for helping. BP MD RTL Reader is a local-first Markdown reader with first-class right-to-left support.
It holds itself to strict quality gates. This page lets you meet them without guessing.

> [!NOTE]
> Pull requests are turned off on this repository. Propose every change in an issue. See [Send your change](#send-your-change).

## Contents

- [Ways to help](#ways-to-help)
- [Report a bug or suggest a feature](#report-a-bug-or-suggest-a-feature)
- [Set up](#set-up)
- [Run the tests](#run-the-tests)
- [Quality gates](#quality-gates)
- [Make a change](#make-a-change)
- [Continuous integration](#continuous-integration)
- [Security reports](#security-reports)
- [Code of Conduct](#code-of-conduct)
- [License](#license)

## Ways to help

- **Report a bug.** Clear steps and a small sample file are the most useful thing you can send.
- **Share right-to-left test cases.** Arabic notes that render wrongly, mixed-direction paragraphs, tricky punctuation, and numbers all help.
- **Translate.** Interface strings live in `src/renderer/locale.js`. Fixes to the Arabic text are welcome.
- **Improve the docs.** Fix a mistake, clear up a step, or add something that was missing. Start from the [documentation index](docs/README.md).
- **Fix an issue.** Comment on it first, so two people do not do the same work, then send the fix as a patch on the issue.

## Report a bug or suggest a feature

Use the [issue forms](https://github.com/Binary-Parse/BP-MD-RTL-Reader/issues/new/choose).
Search the existing issues first.
Do not report a security problem in a public issue. See [Security reports](#security-reports).

## Set up

You need Node.js 24 or newer (`.nvmrc` pins it).

```bash
git clone https://github.com/Binary-Parse/BP-MD-RTL-Reader.git
cd BP-MD-RTL-Reader
npm install
npm start
```

The first `npm install` downloads the Electron binary (more than 100 MB) and a Chromium build for Playwright (about 150 MB).
That is expected.
If `npm start` reports a missing Electron binary, or you want to skip a download, see [Get started](docs/BUILD.md#get-started) in the build guide. It is the one place that explains both.

## Run the tests

```bash
npm test                      # unit, browser e2e, then the real-Electron boundary suite
npm run test:unit             # Vitest only, the fastest loop
npm run test:e2e              # the full Playwright browser lane
npm run test:electron         # the production Electron, preload, and IPC boundary lane
npm run test:perf             # @perf timing budgets, on a quiet machine
npm run lint:security         # ESLint security (SAST) pass
npm run lint:tests            # ESLint on tests/: undefined and unused names
npm run test:update-snapshots # refresh the visual-regression baselines
```

While you work, run only the tests for your change. Run the whole set before you push.
Several rules in this repository span files, and one green test proves less than it seems to.

The two functional Playwright lanes are not interchangeable.
The **browser lane** (`playwright.config.js`) loads the renderer over `file://` in bare Chromium. It is fast, but it cannot prove anything about Electron.
The **Electron lane** (`playwright.electron.config.js`) starts a real main process with real IPC.
Anything that depends on main-process behavior must be proven in the Electron lane.
A third config, `playwright.perf.config.js`, holds the `@perf` timing specs.

Installer tests run on Windows with PowerShell 7 and Pester 5:

```powershell
pwsh -File tests/installer/run-tests.ps1               # Pester plus installer mutation
pwsh -File tests/installer/run-pascal-self-test.ps1    # compiles and runs the Inno Pascal logic; needs the pinned compiler
```

The default Playwright `Desktop Chrome` viewport is 1280×720. Visual specs set 1440×900 before they capture a snapshot.
Test counts are not written in the docs on purpose. A passing count means something only with a named commit and a finished run.

## Quality gates

A change must pass these before it lands.

| Gate | Threshold | Command or config |
| ---- | --------- | ----------------- |
| Unit coverage (Vitest) | 95 % statements, 90 % branches, 95 % functions, 95 % lines, of the modules Vitest covers | `npm run test:unit:coverage`, `config/coverage-thresholds.json` |
| Combined coverage | 90 % statements and 90 % functions of all product code, `app.js` included | `npm run coverage`, `config/coverage-thresholds.json` (`combined`) |
| Renderer coverage (browser tests) | 70 % statements and 40 % functions, plus a statement floor for each of three page-only files | `npm run test:e2e:coverage`, `config/coverage-thresholds.json` (`renderer`) |
| Security lint | No new or moved findings against the reviewed baseline | `npm run lint:security`, `config/security-lint-baseline.json` |
| Test lint | No undefined or unused names in `tests/` | `npm run lint:tests` |
| Duplicate code | At most 1 % of `src/` | `npm run dupcheck` |
| Vendored assets | Bytes match the manifest | `npm run vendor:check` |
| License inventory | The summary matches the lockfile | `npm run license:inventory` |
| Dependency audit | Every `npm audit` advisory fixed, or listed with a reason | `npm run audit:deps`, `config/audit-acceptance.json` |
| Packaging | Archive contents and Electron fuses verified | `npm run package:verify` |

Notes on the coverage gates:

- Vitest does not cover `src/renderer/app.js` (about 6,600 lines), `theme-boot.js`, `trusted-types-boot.js`, and `editor/codemirror-adapter.js`, because they run only in a page. `vitest.config.js` lists them. The browser tests cover them, and the combined figure counts them.
- `npm run coverage` prints the combined figure and fails below the floor.
- The renderer floors also include a guard that the whole suite was collected.

### Environment variables

| Variable | Effect |
| -------- | ------ |
| `BPMD_TEST=1` | A development (unpackaged) app loads its page with `?bpmdTest=1`, which exposes the renderer test hooks. `playwright.electron.config.js` sets it. A packaged build ignores it |
| `COLLECT_RENDERER_COVERAGE=1` | The browser lane records renderer coverage. `npm run test:e2e:coverage` sets it |
| `MIN_COMBINED_STMT_PCT`, `MIN_COMBINED_FUNC_PCT` | Override the combined coverage floor, for a partial run |
| `MIN_RENDERER_*_PCT`, `ENFORCE_RENDERER_COVERAGE_FLOOR=0` | Override or switch off the renderer coverage floors, for a partial run |
| `VERIFY_FUSES_ALLOW_NO_BINARIES=1` | `fuses:verify` checks the fuse config alone when `dist/` has no binary |
| `VERIFY_FUSES_REQUIRED=1` | `fuses:verify` fails when `dist/` has no binary, even with the variable above |
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` | `npm install` skips the Playwright Chromium download |

The overrides are for ad-hoc partial runs. Never use them to pass a gate.

### The security-lint baseline

`npm run lint:security` compares findings with a baseline of SHA-256 fingerprints.
If your change only moves existing findings, refresh their positions:

```bash
node scripts/regen-security-baseline.cjs
```

If the script reports genuinely new findings, review each one first. Only then accept them:

```bash
node scripts/regen-security-baseline.cjs --accept
```

Never run `--accept` to turn a red gate green without reading the difference. The baseline is a review record, not a list of suppressions.

### Visual baselines

Visual specs are tagged `@visual`.
Committed baselines exist for `chromium-win32` and `chromium-linux`.
Regenerate the Linux baselines inside the pinned container (`mcr.microsoft.com/playwright:v1.61.1-jammy`), so font rendering matches.
Baselines made on a host machine fail in CI.

### Performance specs

Timing specs are tagged `@perf` (`tests/e2e/performance.spec.js`, `tests/e2e/f13-cm6-perf.spec.js`).
They are not part of `npm run test:e2e`, because a busy machine can miss a millisecond budget without a code change.
Run them with `npm run test:perf` on a quiet machine.
They are also excluded from `npm run test:e2e:coverage`, because coverage instrumentation slows the page enough to break millisecond budgets.
The zoom budget measures style and layout work through the DevTools protocol, not frame pacing, so a slow machine does not round it up to whole 16.7 ms frames.

## Make a change

**Branch.** Branch from `main` with a `feat/…`, `fix/…`, or `chore/…` name.

**Tests come with the change.**
A behavior change without a test that would have caught its absence is not finished.
Put the test in the existing file for that area where one fits.
For a bug fix, write a test that fails first, then fix it.

**Commit.**
Make one logical change per commit, in [Conventional Commits](https://www.conventionalcommits.org/) form: `fix(reader): …`, `feat(tree): …`, `refactor(menu): …`.
Explain why in the body. The diff already shows what.
Never amend a commit you have pushed. Add a new commit instead.

**Docs.** Update the docs and `CHANGELOG.md` when behavior or a workflow changes.

### Send your change

Pull requests are turned off. Attach your change to its issue as a patch (`git format-patch main`), and say what it changes and why. The maintainer reviews it and lands it with you credited as the author. Confirm this checklist in the issue (it is also in [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md)):

- You followed this guide.
- `lint:security` and `lint:tests` pass.
- `npm test` passes, and `npm run coverage` passes for source changes.
- `dupcheck`, `vendor:check`, and `license:inventory` pass.
- `package:verify` passes when packaging or runtime asset paths changed.
- The change does not weaken the CSP, the DOMPurify configuration, or the path-security guards.
- You added screenshots in both right-to-left and left-to-right layouts for a visible change.

Because Actions is off, say in the issue which commands you ran.
Architecture notes worth reading before you edit the renderer are in [Architecture](docs/ARCHITECTURE.md).

## Continuous integration

GitHub Actions is disabled on this repository, so none of the workflows below runs automatically.
The definitions stay because they document the intended gates, and the checks are the same ones you can run locally.
Running them before you send a change is your job.

- `ci.yml` runs lint, unit, e2e, coverage, Electron boundary, visual, and packaging checks. It defaults to `contents: read`.
- `codeql.yml` runs CodeQL analysis on push, pull request, and a weekly schedule.
- `scorecard.yml` runs OpenSSF Scorecard and publishes the results as SARIF.
- `claude.yml` handles explicit `@claude` requests on issues and reviews. The Claude workflow grants explicit write permissions for repository contents, pull requests, and issues, and gates every trigger on the author's association with the repository.

Every `uses:` in every workflow is pinned to a full commit SHA. Keep it that way.

Releases are cut by hand. See [Releasing](docs/RELEASING.md).

## Security reports

Do not open a public issue for a vulnerability.
Use GitHub private vulnerability reporting, as described in [SECURITY.md](SECURITY.md).

## Code of Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) that covers this project.
