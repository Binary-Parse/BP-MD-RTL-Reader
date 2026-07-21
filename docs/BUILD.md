# Build & Contribute

How to run BP MD RTL Reader from source, build the Windows installers, and work on
the codebase.

## Prerequisites

- **Node.js 24+** (the exact major in `.nvmrc` and CI) and **npm**
- For the optional x64 **Inno installer**: the signed Inno Setup **6.3.3** compiler
  (`ISCC.exe`) installed in the canonical Program Files location
- For the **installer tests / icon scripts**: Windows PowerShell with
  [Pester 5+](https://pester.dev/) (`-InstallPester` opts into installation if missing)

## Get started

```bash
git clone https://github.com/Binary-Parse/md-reader-rtl.git
cd md-reader-rtl
npm install      # postinstall fetches the Playwright Chromium used by the e2e tests
npm start        # launch the app (electron .)
```

## Tech stack

| Area | Tooling |
| ---- | ------- |
| Runtime | **Electron 42** |
| Packaging | **electron-builder 26** + pinned **Inno Setup 6.3.3** |
| Unit tests | **Vitest 4** (+ V8 coverage) |
| End-to-end | **Playwright 1.61** (+ axe-core accessibility, visual regression) |
| Mutation | **Stryker 9** |
| Property tests | **fast-check** |
| Installer tests | **Pester 5** + a compiled Inno Setup self-test |
| Markdown / sanitise | **marked 18** + **DOMPurify 3** |
| Linting / SAST | **ESLint 10** + `eslint-plugin-security`, `eslint-plugin-no-unsanitized` |

The renderer is **`index.html`** (UI markup) with ordered external stylesheets under
**`src/renderer/styles/`**. Its JavaScript is externalized into **`src/renderer/app.js`**
and **`src/renderer/theme-boot.js`**, loaded via external `<script>` tags to satisfy the
strict CSP (`script-src 'self'`). Those modules import pure helpers from the rest of
**`src/renderer/`**. The main process is **`main.js`** +
**`preload.js`**, with Electron-free file/security logic isolated in **`src/main-logic.js`**
and the **`src/main/`** modules so they can be unit-tested without Electron.

## npm scripts

| Script | What it does |
| ------ | ------------ |
| `npm start` | Run the app in development (`electron .`) |
| `npm run dist` | Build the Windows installers (NSIS + portable) into `dist/` |
| `npm test` | Unit, browser e2e, then production-Electron boundary tests |
| `npm run test:unit` | Vitest unit tests |
| `npm run test:unit:coverage` | Unit tests with a V8 coverage report (gated) |
| `npm run test:e2e` | Full Playwright suite |
| `npm run test:electron` | Launch and test the real Electron application boundary |
| `npm run test:e2e:coverage` | Full non-visual renderer suite with source-completeness/coverage gates |
| `npm run test:smoke` | Playwright smoke tests only |
| `npm run test:integration` | Playwright integration tests only |
| `npm run test:update-snapshots` | Refresh visual-regression baselines |
| `npm run test:mutation` | Stryker mutation testing |
| `npm run test:watch` | Vitest in watch mode |
| `npm run coverage` | Generate fresh unit and renderer coverage, then merge/gate both |
| `npm run lint:security` | ESLint security/SAST pass |
| `npm run vendor:check` | Byte-verify vendored runtime assets against their manifest |
| `npm run license:inventory` | Verify the lockfile-derived dependency-license summary |
| `npm run package:verify` | Inspect every built app archive for required/forbidden content |
| `npm run package:checksums` | Write SHA-256 checksums for built artifacts |

## Building the installers

**electron-builder** (NSIS + portable, three architectures):

```bash
npm run dist
```

**Inno Setup** standalone installer (x64):

```powershell
pwsh -File installer/build-installer.ps1
```

This is the only supported Inno entry point. It does not use PATH or a pre-existing
`dist/win-unpacked`: it verifies the pinned compiler's Program Files path, exact version,
Authenticode publisher, and SHA-256; produces a fresh x64 electron-builder directory;
checks it against `installer/source-manifest-policy.json`; hashes/copies the exact files
to clean staging; then writes `dist/BP MD RTL Reader Setup.exe` and a source manifest.

> The electron-builder config in `package.json` also defines **macOS** (dmg/zip) and
> **Linux** (AppImage/deb) targets. CI builds and inspects every configured native target
> and uploads workflow artifacts, but this repository has no automated GitHub Release
> publishing workflow. The separate Inno installer remains a deliberate local build.

## Regenerating assets

```powershell
# App icon (icon.png + icon.ico + installer/assets/icon.ico) from icon-source.png
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1

# Documentation screenshots in docs/assets/
node scripts/capture-screenshots.mjs

# CodeMirror 6 editor bundle (assets/vendor/codemirror/codemirror.min.js) from
# scripts/codemirror-entry.mjs — requires the @codemirror/* + @lezer/highlight + esbuild
# devDependencies (run `npm install` first).
npm run build:cm
```

## Testing

| Layer | Command | Notes |
| ----- | ------- | ----- |
| **Unit** | `npm run test:unit` | Vitest behavior suite; `test:unit:coverage` enforces 95% statements / 90% branches / 95% functions / 95% lines |
| **Browser e2e** | `npm run test:e2e` | Playwright functional, visual, accessibility, performance, integration, and adversarial specs |
| **Electron boundary** | `npm run test:electron` | Launches `electron .` with temporary user data and exercises the production preload/IPC boundary |
| **Combined coverage** | `npm run coverage` | Regenerates both fresh inputs at one commit, requires all renderer sources, then merges and gates them |
| **Mutation** | `npm run test:mutation` | 80% repository floor plus per-file **T1 85% / T2 75% / T3 60%** floors |
| **Installer logic** | `pwsh -File tests/installer/run-tests.ps1` | Pester plus installer mutation; Windows CI runs Pester with `-SkipMutation` |
| **Pascal self-test** | `pwsh -File tests/installer/run-pascal-self-test.ps1` | Compiles/runs pure Inno Pascal logic locally; requires the pinned compiler |

The default Playwright `Desktop Chrome` project viewport is **1280×720**. Visual specs
set **1440×900** explicitly before snapshot capture. Test counts are intentionally not
hard-coded here; a passing count is meaningful only with a named commit and completed run.

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR to `main`, `master`, and `feat/**` /
`fix/**` branches:

1. Lint/SAST, full-history Gitleaks scan, `npm audit`, and vendor/license verification
2. Unit coverage and full non-visual renderer coverage/merge gates
3. Four functional E2E shards plus a separately reproducible visual-snapshot lane
4. Production Electron runtime-boundary tests
5. Full mutation on schedules/manual runs and incremental mutation on pull requests
6. Windows/macOS/Linux native package matrices, package-content inspection, checksums,
   and non-destructive Windows Pester installer checks
7. Pull-request dependency review (currently non-blocking until GHAS is enabled)

The workflow uploads test, coverage, mutation, and verified package artifacts. It does
not publish a GitHub Release or claim code signing/notarization when credentials are absent.

## Project structure

```
index.html              Renderer — UI markup + ordered external CSS/JS links (CSP)
main.js                 Electron main process — window, IPC, file handling, logging
preload.js              contextBridge — the renderer's only door to the main process
src/
  main-logic.js         Pure file/security helpers (allow-list, size caps, BOM, symlinks)
  main/                 Electron-free main-process modules — context-menu, document-store, navigation, protocol, settings, version
  renderer/             Renderer modules — app.js, theme-boot.js, styles/, i18n, markdown, search, state, theme, edit-commands, editor/
tests/
  unit/                 Vitest unit tests
  *.spec.js             Playwright e2e (smoke, rtl, visual, a11y, performance, fuzz, …)
  integration/          Playwright integration tests
  installer/            Pester + Inno self-test for the installer logic
installer/
  setup.iss             Inno Setup script
  build-installer.ps1   Compile the Inno installer
  scripts/*.pas         Installer logic (version check, dir validation, cleanup)
  assets/               Installer icon + wizard images
scripts/
  generate-icons.ps1    Regenerate icon.png / icon.ico from icon-source.png
  capture-screenshots.mjs  Regenerate docs/assets screenshots
  codemirror-entry.mjs  CodeMirror 6 bundle entry (built by `npm run build:cm`)
assets/
  icon.ico · icon.png · icon-source.png   App icon + its source master
  vendor/               Bundled libs & fonts (CodeMirror, marked, DOMPurify, KaTeX, highlight.js, Mermaid, woff2)
```

## Contributing

1. Branch from `master` (`feat/…` or `fix/…`).
2. **Write a test first.** This codebase is test-driven; new behaviour should come with
   a failing test that your change turns green.
3. Keep `npm run test:unit`, `npm run lint:security`, and the relevant e2e specs green.
4. Open a PR — CI must pass before merge.
