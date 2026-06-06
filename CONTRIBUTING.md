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
| `npm run test:e2e` | Playwright specs (everything else under `tests/`) |
| `npm run lint:security` | ESLint security / SAST pass |
| `npm run test:mutation` | Stryker mutation testing |

Keep `npm run test:unit`, `npm run lint:security`, and the relevant e2e specs green before
opening a PR — CI must pass before merge.

## Test layout & naming convention

Which runner owns a file is decided by **directory**, not the filename:

- **`tests/unit/`** → **Vitest** (the only path in `vitest.config.js`'s `include`).
- **Everything else under `tests/`** → **Playwright** (`playwright.config.js` uses
  `testDir: './tests'` with `testIgnore: ['**/unit/**']`).

By convention, name files accordingly so the suffix matches the runner:

- **`*.test.js`** for Vitest unit tests in `tests/unit/`.
- **`*.spec.js`** for Playwright specs (e2e, integration, visual, …).

## Workflow

1. Branch from `master` (`feat/…` or `fix/…`).
2. **Write a test first** — new behaviour should come with a failing test that your change
   turns green.
3. Open a PR with a clear description; CI runs coverage, mutation, e2e, security lint, a
   secret scan, and `npm audit`.

For security issues, **do not** open a public issue — see [SECURITY.md](SECURITY.md).
