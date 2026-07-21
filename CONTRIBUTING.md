# Contributing

Thanks for your interest in **BP MD RTL Reader**! This is a small, test-driven Electron
app. The full build, packaging, and CI details live in **[docs/BUILD.md](docs/BUILD.md)**;
this file is the quick contributor reference.

## Getting started

```bash
git clone https://github.com/Binary-Parse/md-reader-rtl.git
cd md-reader-rtl
npm install      # postinstall fetches the Playwright Chromium used by the e2e tests
npm start        # launch the app in development (electron .)
```

Use the Node version in [`.nvmrc`](.nvmrc) (Node 24).

## Tests & checks

| Command | What it runs |
| ------- | ------------ |
| `npm run test:unit` | Vitest unit tests (everything under `tests/unit/`) |
| `npm run test:e2e` | Browser Playwright specs selected by `playwright.config.js` |
| `npm run test:electron` | Production Electron specs under `tests/electron/` |
| `npm run lint:security` | ESLint security / SAST pass |
| `npm run test:mutation` | Stryker mutation testing |
| `pwsh -File tests/installer/run-tests.ps1` | Pester installer tests, then installer mutation |
| `npm run license:inventory` | Verify the committed lockfile/license summary |

Keep `npm run test:unit`, `npm run lint:security`, and the relevant e2e specs green before
opening a PR — CI must pass before merge.

## Test layout & naming convention

Runner ownership is explicit; not every file below `tests/` is an executable test:

- **`tests/unit/**/*.{test,spec}.js`** → **Vitest** (`vitest.config.js`).
- **Browser `tests/**/*.spec.js`**, excluding `tests/unit/**` and `tests/electron/**`,
  → **Playwright** (`playwright.config.js`); this includes root e2e specs and
  `tests/integration/**/*.spec.js`.
- **`tests/electron/**/*.spec.js`** → the dedicated production-Electron Playwright
  configuration (`playwright.electron.config.js`).
- **`tests/installer/*.test.ps1`** → the exact Pester file list in
  `tests/installer/run-tests.ps1`. The same command runs `mutation-runner.ps1` unless
  `-SkipMutation` is supplied.
- **`tests/installer/selftest.iss`** → the separate local
  `run-pascal-self-test.ps1` lane, which requires pinned Inno Setup.
- **`tests/__mocks__/`, fixtures, helpers, snapshots, images, and baselines** are support
  data, not independent Playwright tests.

By convention, name files accordingly so the suffix matches the runner:

- **`*.test.js`** for Vitest unit tests in `tests/unit/`.
- **`*.spec.js`** for browser or Electron Playwright specs in the owning directory.

## Workflow

1. Branch from `master` (`feat/…` or `fix/…`).
2. **Write a test first** — new behaviour should come with a failing test that your change
   turns green.
3. Open a PR with a clear description; CI runs coverage, mutation, e2e, security lint, a
   secret scan, and `npm audit`.

For security issues, **do not** open a public issue — see [SECURITY.md](SECURITY.md).
