# Contributing

This is the contributor reference for **BP MD RTL Reader**, a test-driven Electron app.
The full build, packaging, and CI details are in **[docs/BUILD.md](docs/BUILD.md)**.

## Getting started

```bash
git clone https://github.com/Binary-Parse/BP-MD-RTL-Reader.git
cd BP-MD-RTL-Reader
npm install      # installs dependencies and Playwright Chromium
npm start        # launch the development app (electron .)
```

Use the Node version in [`.nvmrc`](.nvmrc) (Node 24 or newer).

## Test and validation lanes

Run commands from the repository root.

| Command | What it validates |
| ------- | ----------------- |
| `npm test` | The complete routine test chain: Vitest, browser Playwright, then production Electron |
| `npm run test:unit` | Vitest unit tests under `tests/unit/` |
| `npm run test:unit:coverage` | Unit tests with the gated V8 coverage thresholds |
| `npm run test:e2e` | The complete browser Playwright suite selected by `playwright.config.js` |
| `npm run test:smoke` | The focused browser smoke spec |
| `npm run test:integration` | Browser integration specs under `tests/e2e/integration/` |
| `npm run test:electron` | Production Electron and preload/IPC boundary specs under `tests/e2e/electron/` |
| `npm run test:e2e:coverage` | Renderer V8 coverage collection and completeness checks |
| `npm run coverage` | Gated unit coverage, renderer coverage, and the merged coverage report |
| `npm run test:mutation` | Stryker plus the T1/T2/T3 per-file mutation floors |
| `npm run test:mutation:release` | The bounded-concurrency release mutation lane |
| `npm run lint:security` | ESLint security and SAST checks |
| `npm run vendor:check` | Vendored runtime bytes and provenance |
| `npm run license:inventory` | The lockfile-derived dependency-license inventory |
| `pwsh -File tests/installer/run-tests.ps1` | Pester installer tests, followed by installer mutation |
| `pwsh -File tests/installer/run-pascal-self-test.ps1` | The compiled Inno Pascal self-test; requires the pinned Inno Setup toolchain |
| `npm run dist` | Windows NSIS and portable package builds |
| `npm run package:verify` | Packaged archive contents and runtime asset paths |
| `npm run package:checksums:verify` | Exact release artifact names and canonical hashes after release artifacts exist |

Before opening a pull request, keep `npm run lint:security`, `npm test`, and every
lane affected by the change green. Run `npm run coverage` for source changes. Release
work also requires the mutation, packaging, installer, checksum, and signing gates
documented in [docs/BUILD.md](docs/BUILD.md).

## Test layout and naming convention

Runner ownership is explicit; not every file below `tests/` is an executable test:

- **`tests/unit/**/*.{test,spec}.js`** is owned by **Vitest** (`vitest.config.js`).
- Browser **`tests/e2e/**/*.spec.js`**, excluding `tests/e2e/electron/**`, is owned by
  **Playwright** (`playwright.config.js`). This includes
  `tests/e2e/integration/**/*.spec.js`.
- **`tests/e2e/electron/**/*.spec.js`** is owned by the dedicated production-Electron
  Playwright configuration (`playwright.electron.config.js`).
- **`tests/installer/*.test.ps1`** is owned by the exact Pester file list in
  `tests/installer/run-tests.ps1`. The same command runs `mutation-runner.ps1` unless
  `-SkipMutation` is supplied.
- **`tests/installer/selftest.iss`** belongs to the separate
  `run-pascal-self-test.ps1` lane, which requires pinned Inno Setup.
- **`tests/__mocks__/`, fixtures, helpers, snapshots, images, and baselines** are support
  data, not independent Playwright tests.

Name files so their suffix matches the owning runner:

- **`*.test.js`** for Vitest unit tests in `tests/unit/`.
- **`*.spec.js`** for browser or Electron Playwright specs in the owning directory.

## Branches and commits

1. Branch from `main` with a descriptive `feat/…`, `fix/…`, `chore/…`, `docs/…`, or
   `refactor/…` name.
2. Use [Conventional Commits](https://www.conventionalcommits.org/), keeping one concern
   per commit. Examples: `feat(editor): add focus mode` and
   `fix(rtl): preserve direction after reload`.
3. Do not rewrite shared branch history or force-push a branch other contributors use.

## Contribution workflow

1. Write a failing test first for new or changed behaviour.
2. Make the smallest implementation change that turns it green.
3. Run the relevant focused checks, then the full routine lanes listed above.
4. Update user or build documentation when interfaces, workflows, or release artifacts change.
5. Open a pull request with a clear problem statement, implementation summary, and
   verification evidence. CI also runs coverage, mutation, e2e, security lint, secret
   scanning, dependency audit, and packaging gates.

For security issues, **do not** open a public issue; follow
[SECURITY.md](SECURITY.md) instead.
