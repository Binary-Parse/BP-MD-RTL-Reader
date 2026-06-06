# Build & Contribute

How to run BP MD RTL Reader from source, build the Windows installers, and work on
the codebase.

## Prerequisites

- **Node.js 20+** (CI builds on Node 24) and **npm**
- For the **installers**: [Inno Setup 6.3+](https://jrsoftware.org/isdl.php) (`ISCC.exe`)
- For the **installer tests / icon scripts**: Windows PowerShell with
  [Pester 5+](https://pester.dev/) (auto-installed on first run if missing)

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
| Packaging | **electron-builder 26** + **Inno Setup 6** |
| Unit tests | **Vitest 4** (+ V8 coverage) |
| End-to-end | **Playwright 1.60** (+ axe-core accessibility, visual regression) |
| Mutation | **Stryker 9** |
| Property tests | **fast-check** |
| Installer tests | **Pester 5** + a compiled Inno Setup self-test |
| Markdown / sanitise | **marked 18** + **DOMPurify 3** |
| Linting / SAST | **ESLint 10** + `eslint-plugin-security`, `eslint-plugin-no-unsanitized` |

The renderer is **`index.html`** (UI markup + inline styles) whose JavaScript is
externalized into **`src/renderer/app.js`** and **`src/renderer/theme-boot.js`**, loaded via
external `<script>` tags to satisfy the strict CSP (`script-src 'self'`). Those modules
import pure helpers from the rest of **`src/renderer/`**. The main process is **`main.js`** +
**`preload.js`**, with Electron-free file/security logic isolated in **`src/main-logic.js`**
and the **`src/main/`** modules so they can be unit-tested without Electron.

## npm scripts

| Script | What it does |
| ------ | ------------ |
| `npm start` | Run the app in development (`electron .`) |
| `npm run dist` | Build the Windows installers (NSIS + portable) into `dist/` |
| `npm test` | Unit tests, then the e2e suite |
| `npm run test:unit` | Vitest unit tests |
| `npm run test:unit:coverage` | Unit tests with a V8 coverage report (gated) |
| `npm run test:e2e` | Full Playwright suite |
| `npm run test:smoke` | Playwright smoke tests only |
| `npm run test:integration` | Playwright integration tests only |
| `npm run test:update-snapshots` | Refresh visual-regression baselines |
| `npm run test:mutation` | Stryker mutation testing |
| `npm run test:watch` | Vitest in watch mode |
| `npm run coverage` | Combined unit + e2e coverage report |
| `npm run lint:security` | ESLint security/SAST pass |

## Building the installers

**electron-builder** (NSIS + portable, three architectures):

```bash
npm run dist
```

**Inno Setup** standalone installer (x64) — needs `dist/win-unpacked` from the step
above, then:

```powershell
pwsh -File installer/build-installer.ps1
```

It locates `ISCC.exe`, compiles `installer/setup.iss`, and writes
`dist/BP MD RTL Reader Setup.exe` with a printed SHA-256.

> The electron-builder config in `package.json` also defines **macOS** (dmg/zip) and
> **Linux** (AppImage/deb) targets, but only the Windows artifacts are regularly built and
> released; the Inno Setup installer above is a manual/local build, not part of the
> automated release.

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
| **Unit** | `npm run test:unit` | 468 tests (Vitest); 95% statement / 95% line / 95% function / 90% branch coverage gate |
| **End-to-end** | `npm run test:e2e` | 526 tests (Playwright) incl. visual regression + accessibility |
| **Mutation** | `npm run test:mutation` | Stryker; build breaks below an 85% mutation score |
| **Installer logic** | `pwsh -File tests/installer/run-tests.ps1` | Pester unit tests + a compiled Pascal self-test (manual / local — not run in CI) |

## Continuous integration

`.github/workflows/ci.yml` runs on every push/PR to `main`, `master`, and `feat/**` /
`fix/**` branches:

1. Unit tests **+ coverage** (Vitest)
2. Security lint / SAST (`lint:security`)
3. Secret scan (gitleaks)
4. Mutation tests (Stryker)
5. End-to-end tests (Playwright)
6. Dependency audit (`npm audit`)

Coverage, mutation, and Playwright artifacts are uploaded on each run.

## Project structure

```
index.html              Renderer — UI markup + styles; JS externalized to src/renderer/app.js + theme-boot.js (CSP)
main.js                 Electron main process — window, IPC, file handling, logging
preload.js              contextBridge — the renderer's only door to the main process
src/
  main-logic.js         Pure file/security helpers (allow-list, size caps, BOM, symlinks)
  main/                 Electron-free main-process modules — context-menu, document-store, navigation, protocol, settings, version
  renderer/             Renderer modules — app.js, theme-boot.js, i18n, markdown, search, state, theme, edit-commands, editor/
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
