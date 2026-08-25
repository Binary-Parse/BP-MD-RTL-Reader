# Build & Contribute

How to run BP MD RTL Reader from source, build the Windows installers, and work on
the codebase.

## Prerequisites

- **Node.js 24+** (the exact major in `.nvmrc` and CI) and **npm**
- For the x64 **Inno installer**: the signed Inno Setup **6.3.3** compiler
  (`ISCC.exe`) installed in the canonical Program Files location
- For the **installer tests / icon scripts**: Windows PowerShell with
  [Pester 5+](https://pester.dev/) (`-InstallPester` opts into installation if missing)

## Get started

```bash
git clone https://github.com/Binary-Parse/BP-MD-RTL-Reader.git
cd BP-MD-RTL-Reader
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

The renderer is **`src/renderer/index.html`** (UI markup) with ordered external stylesheets under
**`src/renderer/styles/`**. Its JavaScript is externalized into **`src/renderer/app.js`**
and **`src/renderer/theme-boot.js`**, loaded via external `<script>` tags to satisfy the
strict CSP (`script-src 'self'`). Those modules import pure helpers from the rest of
**`src/renderer/`**. The main entry is **`src/main/index.js`** + **`src/preload/index.js`**;
privileged IPC/vault-watcher state and BrowserWindow lifecycle live behind injected
controllers in **`src/main/`**, with pure file/security policy in
**`src/main/main-logic.js`** and pure `app://` / `bpmd://` resolvers in
**`src/main/protocol.js`** so each boundary can be unit-tested without launching Electron.
Packaged windows `loadURL('app://ui/src/renderer/index.html')`; PDF export still uses
`loadFile` on a temp HTML file.

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
| `npm run test:mutation:release` | Full Stryker run with bounded concurrency, then per-file tier enforcement |
| `npm run test:watch` | Vitest in watch mode |
| `npm run coverage` | Generate fresh unit and renderer coverage, then merge/gate both |
| `npm run lint:security` | ESLint security/SAST pass |
| `npm run vendor:check` | Byte-verify vendored runtime assets against their manifest |
| `npm run license:inventory` | Verify the lockfile-derived dependency-license summary |
| `npm run package:verify` | Inspect every built app archive for required/forbidden content |
| `npm run package:checksums` | Validate `dist/release` against the exact public allowlist and write `SHA256SUMS.txt` |
| `npm run package:checksums:verify` | Revalidate the allowlist and every hash in the canonical checksum file |

## Building the installers

**electron-builder** (NSIS + portable, three architectures):

```bash
npm run dist
```

`npm run dist` must produce both the NSIS installer and the portable exe (all Windows architectures in `package.json`). A dir-only unpack is not a substitute. The NSIS include `build/installer/installer.nsh` must not reference `$installMode` (electron-builder compiles that include before `Var installMode`, and `nsis.warningsAsErrors` stays `true`).

The packaged renderer is served over `app://ui/…`, not `file://` inside `app.asar`. Proof that a build paints is a PrintWindow / live `#app` on `dist/win-unpacked/BP MD RTL Reader.exe` with a fresh `--user-data-dir`, not Playwright `file://` or unpackaged `electron .`.

**Inno Setup** standalone installer (x64):

```powershell
pwsh -File build/installer/build-installer.ps1
```

This is the only supported Inno entry point. It does not use PATH or a pre-existing
`dist/win-unpacked`: it verifies the pinned compiler's Program Files path, exact version,
Authenticode publisher, and SHA-256; produces a fresh x64 electron-builder directory;
checks it against `build/installer/source-manifest-policy.json`; hashes/copies the exact files
to clean staging; then writes
`dist/BP-MD-RTL-Reader-1.1.0-Windows-Inno-x64.exe` and
`dist/BP-MD-RTL-Reader-1.1.0-Windows-Inno-x64.source-manifest.json`.

Local Inno builds may be unsigned. A release build is fail-closed and requires a
Binary Parse code-signing certificate already imported into `Cert:\CurrentUser\My`, a
trusted Windows SDK `signtool.exe`, and the certificate PFX/password environment:

```powershell
$env:WIN_CSC_LINK = 'C:\secure\binary-parse-code-signing.pfx'
$env:WIN_CSC_KEY_PASSWORD = '<secret>'
pwsh -File build/installer/build-installer.ps1 -RequireSigned `
  -CertificateSha1 '<40-hex-thumbprint>' `
  -SignToolPath 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe'
```

The build script verifies the signer, exact certificate thumbprint, and timestamp on the
application payload and generated installer. The release VM gate separately verifies the
installed uninstaller. Neither path silently downgrades a requested release build to
unsigned output.

### Public artifact contract

Version 1.1.0 publishes exactly these 12 files before the generated checksum manifest:

```text
BP-MD-RTL-Reader-1.1.0-Windows-NSIS-multiarch.exe
BP-MD-RTL-Reader-1.1.0-Windows-Portable-multiarch.exe
BP-MD-RTL-Reader-1.1.0-Windows-Inno-x64.exe
BP-MD-RTL-Reader-1.1.0-Windows-Inno-x64.source-manifest.json
BP-MD-RTL-Reader-1.1.0-macOS-x64.dmg
BP-MD-RTL-Reader-1.1.0-macOS-arm64.dmg
BP-MD-RTL-Reader-1.1.0-macOS-x64.zip
BP-MD-RTL-Reader-1.1.0-macOS-arm64.zip
BP-MD-RTL-Reader-1.1.0-Linux-x64.AppImage
BP-MD-RTL-Reader-1.1.0-Linux-arm64.AppImage
BP-MD-RTL-Reader-1.1.0-Linux-x64.deb
BP-MD-RTL-Reader-1.1.0-Linux-arm64.deb
```

Copy those 12 files into `dist/release`, then run `npm run package:checksums` (it rejects
missing, extra, duplicate, or case-colliding names) and `npm run package:checksums:verify`.
Attach `SHA256SUMS.txt` and all 12 allowlisted files to the GitHub Release. Do not invent
placeholders for platforms this machine cannot build; omit the canonical checksum file
until the full set exists.

## Regenerating assets

```powershell
# App icons in build/icons/ plus build/installer/assets/icon.ico from icon-source.png
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1

# Documentation screenshots in docs/assets/
node scripts/capture-screenshots.mjs

# CodeMirror 6 editor bundle (resources/vendor/codemirror/codemirror.min.js) from
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

GitHub Actions is disabled on this repository, so the workflow below does not run
automatically. `.github/workflows/ci.yml` still documents the intended gates on every
push/PR to `main`, `master`, and `feat/**` / `feature/**` / `fix/**` branches:

1. Lint/SAST, full-history Gitleaks scan, `npm audit`, and vendor/license verification
2. Unit coverage and full non-visual renderer coverage/merge gates
3. Four functional E2E shards plus a separately reproducible visual-snapshot lane
4. Production Electron runtime-boundary tests
5. Full mutation on schedules/manual runs and incremental mutation on pull requests
6. Windows/macOS/Linux native package matrices, package-content inspection, and
   non-destructive Windows Pester installer checks
7. Pull-request dependency review (currently non-blocking until GHAS is enabled)

The workflow uploads test, coverage, mutation, and verified package artifacts. It does
not claim code signing/notarization and does not publish a GitHub Release.

### Releasing

There is no release pipeline. GitHub Actions is disabled on this repository, and
`.github/workflows/release.yml` has been removed — releases are built and published by
hand, which means every gate it used to enforce is now your responsibility.

Before publishing, run in order:

```bash
npm test                              # unit, browser e2e, Electron boundary
npm run lint:security                 # SAST against the reviewed baseline
node scripts/release-preflight.js     # version, changelog, and repository checks
npm run dist                          # Windows NSIS + portable installers
pwsh -File build/installer/build-installer.ps1   # Inno x64 installer
npm run package:verify                # archive contents + Electron fuses
```

`release-preflight.js` requires `package.json`'s version to be stable SemVer and
`CHANGELOG.md` to hold exactly one non-empty section for it. `package:verify` reads a fuse
wire out of each packaged binary rather than trusting configuration.

Code signing is not automated. For signed Windows builds, set `WIN_CSC_LINK` (or
`WIN_CSC_LINK_B64` decoded to a PFX) and `WIN_CSC_KEY_PASSWORD` in the environment before
`npm run dist`; `build-installer.ps1` accepts `-RequireSigned` and `-CertificateSha1` to
fail closed if the result is unsigned or signed by the wrong certificate. macOS signing and
Apple notarization require an Apple Developer certificate and an App Store Connect `.p8`
key, applied through electron-builder's own environment variables.

Tag the release once the artifacts verify:

```bash
git tag -a v1.1.0 -m "BP MD RTL Reader 1.1.0"
git push origin v1.1.0
```

Then attach the installers and `SHA256SUMS.txt` to a GitHub Release manually. Generate the
checksums with `npm run package:checksums`, which also enforces the artifact allowlist.

## Project structure

```
build/
  icons/                  electron-builder icon inputs and source masters
  installer/              Inno/NSIS scripts, policies, and installer artwork
docs/
  assets/                 README and guide screenshots
resources/
  vendor/                 offline runtime libraries, fonts, and license manifests
scripts/                  build, coverage, release, and asset tooling
src/
  main/                   Electron entry point, IPC, window, `app://`/`bpmd://` protocol, storage, and security policy
  preload/                minimal context-isolated renderer bridge
  renderer/
    components/           file tree, outline, search, settings, tables, and workspace helpers
    editor/               CodeMirror 6 editor and live-preview extensions
    markdown/             parse, sanitize, math, highlight, diagram, and export pipeline
    styles/               base, theme, component, and responsive styles
    index.html             renderer document
tests/
  unit/                   Vitest
  e2e/                    Playwright browser, integration, visual, a11y, and Electron lanes
  fixtures/               Markdown and renderer fixtures
  installer/              Pester and Inno self-tests
```

## Contributing

1. Branch from `main` using `feat/…`, `fix/…`, or `chore/…`.
2. **Write a test first.** This codebase is test-driven; new behaviour should come with
   a failing test that your change turns green.
3. Keep `npm run test:unit`, `npm run lint:security`, and the relevant e2e specs green.
4. Open a PR — CI must pass before merge.
