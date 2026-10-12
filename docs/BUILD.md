# Build & Contribute

How to run BP MD RTL Reader from source, build the Windows installers, and work on
the codebase.

## Prerequisites

- **Node.js 24+** (the exact major in `.nvmrc` and CI) and **npm**
- For the x64 **Inno installer**: the signed Inno Setup **6.3.3** compiler
  (`ISCC.exe`) installed in the canonical Program Files location
- For the **installer tests**: Windows PowerShell with
  [Pester 5+](https://pester.dev/) (`-InstallPester` opts into installation if missing)
- For **icon regeneration** (`npm run icons:generate`): the Playwright Chromium that
  `npm ci` installs

## Get started

```bash
git clone https://github.com/Binary-Parse/BP-MD-RTL-Reader.git
cd BP-MD-RTL-Reader
npm install      # also downloads the Electron binary and the Playwright Chromium
npm start        # launch the app (electron .)
```

`npm install` needs the network: the `electron` package downloads the Electron binary for
your platform (more than 100 MB) in its own install step, and this project's `postinstall`
downloads the Chromium used by the browser tests (about 150 MB) unless
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` or `CI` is set. `npm start` downloads nothing. With
`npm ci --ignore-scripts` neither download happens, and Electron must then be fetched with
`node node_modules/electron/install.js` before the app can start.

## Tech stack

| Area | Tooling |
| ---- | ------- |
| Runtime | **Electron 44** |
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
| `npm run test:e2e:coverage` | Full renderer suite with source-completeness/coverage gates; `@visual` and `@perf` specs are excluded (coverage instrumentation distorts timing) |
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

**Installer UX contract (v1.2.1, extended T12).** Both installers present a license page
before any files are copied: NSIS via `nsis.license`
(`build/installer/LICENSE-INSTALLER.rtf`, bilingual MIT text), Inno via `LicenseFile`
(the repo-root `LICENSE`). Encoding contract (T11/T12): electron-builder passes an
explicit `nsis.license` to the Unicode NSIS compiler raw, so the file's own format is
the contract — it is **plain-ASCII RTF** (NSIS renders RTF natively) with every Arabic
character written as a `\uN?` escape and the Arabic section right-aligned via `\rtlpar`;
no ANSI codepage can touch it. `setup.iss` itself carries a UTF-8 BOM (Inno reads a
BOM-less script as ANSI). `tests/unit/installer-license.test.js` pins the RTF contracts.
The optional **Add to PATH** choice is a Git-for-Windows-style radio pair on the page
after the directory page (`customPageAfterChangeDir`): "add to PATH" vs "leave PATH
unchanged" (default), each with a sub-caption; silent installs opt in via `/add-path`.
It is implemented exclusively through the vendored
[EnVar plug-in](https://nsis.sourceforge.io/EnVar_plug-in) (`build/x86-unicode/`, SHA-256
recorded in THIRD-PARTY-NOTICES) — `AddValueEx`/`DeleteValue` only, because script-level
PATH rewriting truncates and flattens `REG_EXPAND_SZ` values. Uninstall removes exactly
the `$INSTDIR` entry. An existing installation gets a **maintenance wizard page**
(T13, the `customWelcomePage` slot — the first page): read-only inspection of the
`DisplayVersion` value under the electron-builder key (APP_GUID) and the Inno
key, both HKLM and HKCU, a colored version-state line, and radio choices —
**upgrade** (default), **repair** (same version), or **remove**, which opens
`ms-settings:appsfeatures`; a **downgrade** defaults to exiting with a warning color.
Arabic wizard pages (installer and uninstaller) are mirrored through the documented
`nsDialogs::SetRTL 1` API. `MessageBox` is banned outright from the script — a
Pester contract fails if one ever returns. The security boundary is unchanged and
enforced by `tests/installer/installer-security.test.ps1`: the setup only ever READS
those registry values and never executes an uninstall command string from the
registry; the remove choice opens `ms-settings:appsfeatures` instead. Silent installs
(`/S`) skip the pages and keep electron-builder's protected in-place upgrade.

**Inno Setup** standalone installer (x64):

```powershell
pwsh -File build/installer/build-installer.ps1
```

This is the only supported Inno entry point. It does not use PATH or a pre-existing
`dist/win-unpacked`: it verifies the pinned compiler's Program Files path, exact version,
Authenticode publisher, and SHA-256; produces a fresh x64 electron-builder directory;
checks it against `build/installer/source-manifest-policy.json`; hashes/copies the exact files
to clean staging; then writes
`dist/BP-MD-RTL-Reader-2.0.0-Windows-Inno-x64.exe` and
`dist/BP-MD-RTL-Reader-2.0.0-Windows-Inno-x64.source-manifest.json`.

`source-manifest-policy.json` also pins the **Electron version** and the script fails
closed when it disagrees with `package.json` — an Electron bump that forgets this pin
kills the Inno lane (that exact gap broke every Inno build between the 42.11.6 update and
the 1.3.0 release). The pin is additionally asserted against `package.json` by
`tests/installer/installer-security.test.ps1`, so drift now fails the installer test lane
at the change that introduces it, not at the next Inno build.

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

**Linux** (AppImage and deb, x64 and ARM64) is built on Linux; on Windows use WSL 2 with
Node 24, working on a copy inside the Linux file system (a build under `/mnt/c` is slow and
would reuse the Windows `node_modules`):

```bash
git archive --format=tar HEAD | tar -x -C ~/bpmd-build     # a clean copy of the commit
cd ~/bpmd-build && npm ci --ignore-scripts
npm run dist:linux                                          # 4 files in dist/
node tests/packaged/linux-smoke.js dist/linux-unpacked/bpmdrtlreader
```

`git archive` leaves `tests/` out (`.gitattributes`, `export-ignore`), so copy
`tests/packaged/linux-smoke.js` into the build copy before the last line. It also needs the
Playwright package that `npm ci` installed, and no browser download.

`electron-builder` names the x64 files the way each format does: `…-Linux-x86_64.AppImage`
and `…-Linux-amd64.deb`; the ARM64 files are `…-Linux-arm64.AppImage` and
`…-Linux-arm64.deb`. `tests/packaged/linux-smoke.js` needs a display (WSLg is enough): it starts the
packaged program three times with an empty profile and checks that a note passed by path
opens, that typed text is saved by Ctrl+S, that a note passed as a `file://` URL (what
the desktop entry's `%U` sends) opens, and that no spellchecker dictionary appears in any of
its profiles. Only the x64 build can be started on an x64 machine;
the ARM64 files are built but not run here. The desktop entry registers `text/markdown`.

### Public artifact contract

Version 2.0.0 publishes exactly these 8 files before the generated checksum manifest:

```text
BP-MD-RTL-Reader-2.0.0-Windows-NSIS-multiarch.exe
BP-MD-RTL-Reader-2.0.0-Windows-Portable-multiarch.exe
BP-MD-RTL-Reader-2.0.0-Windows-Inno-x64.exe
BP-MD-RTL-Reader-2.0.0-Windows-Inno-x64.source-manifest.json
BP-MD-RTL-Reader-2.0.0-Linux-x86_64.AppImage
BP-MD-RTL-Reader-2.0.0-Linux-arm64.AppImage
BP-MD-RTL-Reader-2.0.0-Linux-amd64.deb
BP-MD-RTL-Reader-2.0.0-Linux-arm64.deb
```

The `multiarch` Windows installers (NSIS and portable) each contain x64 and ARM64 builds.
32-bit Windows (`ia32`) is not built: Electron 44 publishes no `win32-ia32` binary.

**macOS is not built and not tested.** The `mac` block in `package.json` is kept as a
starting point only: there is no Mac to build on, no Apple Developer certificate, and
`build/icons/icon.png` (256 px) is too small for a macOS icon. A macOS file must not be
attached to a release until it has been built, signed, notarized and tested on a Mac.

**The release is not code-signed** (owner decision, 2026-10-10). The README tells users how
to check a download against `SHA256SUMS.txt` and what the SmartScreen warning means.

**No updater.** `"publish": null` keeps electron-builder from writing `app-update.yml` and
`latest*.yml`: the app has no auto-update. `resources/elevate.exe` still ships in the NSIS
build, because electron-builder packs it into every per-machine installation and ignores
`packElevateHelper: false` there; it is listed in `THIRD-PARTY-NOTICES.md`. `appImage.executableArgs: []` removes the `--no-sandbox` that
electron-builder otherwise puts in the AppImage's desktop entry.

Copy those 8 files into `dist/release`, then run `npm run package:checksums` (it rejects
missing, extra, duplicate, or case-colliding names) and `npm run package:checksums:verify`.
Attach `SHA256SUMS.txt` and all 8 allowlisted files to the GitHub Release. Do not invent
placeholders for a file this machine cannot build; omit the canonical checksum file
until the full set exists.

## Regenerating assets

```powershell
# App and Markdown file icons from build/icons/*-source.svg (also copies icon.ico and icon.png
# to build/installer/assets/ and docs/assets/); renders with Playwright Chromium
node scripts/generate-icons.mjs

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
| **Browser e2e** | `npm run test:e2e` | Playwright functional, visual, accessibility, performance (`@perf`), integration, and adversarial specs |
| **Electron boundary** | `npm run test:electron` | Launches `electron .` with temporary user data and exercises the production preload/IPC boundary |
| **Combined coverage** | `npm run coverage` | Regenerates both fresh inputs at one commit, requires all renderer sources, then merges and gates them |
| **Mutation** (not run) | `npm run test:mutation` | Stopped by owner decision on 2026-10-11; not a release gate. The configuration is kept: 80% repository floor plus per-file **T1 85% / T2 75% / T3 60%** floors |
| **Installer logic** | `pwsh -File tests/installer/run-tests.ps1` | Pester plus installer mutation; Windows CI runs Pester with `-SkipMutation` |
| **Pascal self-test** | `pwsh -File tests/installer/run-pascal-self-test.ps1` | Compiles/runs pure Inno Pascal logic locally; requires the pinned compiler |

The default Playwright `Desktop Chrome` project viewport is **1280×720**. Visual specs
set **1440×900** explicitly before snapshot capture. Test counts are intentionally not
hard-coded here; a passing count is meaningful only with a named commit and completed run.

## Continuous integration

GitHub Actions is disabled on this repository, so the workflow below does not run
automatically. `.github/workflows/ci.yml` still documents the intended gates on every
push/PR to `main`, `master`, and `feat/**` / `feature/**` / `fix/**` branches:

1. Lint/SAST, full-history Gitleaks scan, `npm run audit:deps` (every advisory `npm audit` reports must be fixed or listed with a reason in `config/audit-acceptance.json`), and vendor/license verification
2. Unit coverage and full non-visual renderer coverage/merge gates
3. Four functional E2E shards plus a separately reproducible visual-snapshot lane
4. Production Electron runtime-boundary tests
5. Full mutation on schedules/manual runs and incremental mutation on pull requests
6. Windows and Linux native package matrices, package-content inspection, and
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
npm run tls:verify                    # TLS pins vs the LIVE api.github.com chain (T14)
npm run audit:deps                    # every npm advisory fixed or reviewed
npm run scan:deps                     # syft SBOM + osv-scanner report, recorded with the
                                      # SHA-256 of package-lock.json (preflight checks it)
node scripts/release-preflight.js     # version, changelog, repository checks,
                                      # and — once dist/release exists — the exact
                                      # 8-artifact allowlist + SHA256SUMS.txt.
                                      # Before the release dir is assembled, pass
                                      # --skip-artifact-check explicitly.
npm run dist                          # Windows NSIS + portable installers
pwsh -File build/installer/build-installer.ps1   # Inno x64 installer
npm run dist:linux                    # on Linux / WSL: AppImage + deb, x64 and ARM64
npm run package:verify                # archive contents + Electron fuses
                                      # (reads the built binaries; with no dist/ it
                                      # FAILS unless VERIFY_FUSES_ALLOW_NO_BINARIES=1)
```

`release-preflight.js` requires `package.json`'s version to be stable SemVer and
`CHANGELOG.md` to hold exactly one non-empty section for it, and it treats a missing
`dist/release` directory (or an artifact set that drifts from `scripts/release-artifacts.js`'s
allowlist, or checksums that do not match the bytes) as a hard failure — `--skip-artifact-check`
is the explicit opt-out for pre-build runs. `package:verify` reads a fuse
wire out of each packaged binary rather than trusting configuration, and no longer passes
vacuously when nothing was built. `tls:verify` exists
because the 1.3.0-rc pin shipped unverified and matched no live certificate — never skip it:
a pin that looks fine but matches nothing silently kills the update check (fail-closed).

The pin list (`src/main/github-tls.js`) holds the four keys of the chain GitHub presents
today, leaf to root, and six backup roots of other CAs. `tls:verify` prints each presented
key as `LIVE` or `BACKUP`:

- exit 1, nothing matched: do not release; re-mint `LIVE_CHAIN_PINS` from the live chain.
- `WARNING — the leaf pin no longer matches`: GitHub re-issued its leaf with a new key (it
  expires 2026-11-27 at the latest). The CA pins carry the check; replace the leaf pin.
- `WARNING — only backup roots match`: GitHub changed its CA. Replace all four live pins.

A root pin must be the public key of the root it names in Node's bundled root store;
`tests/unit/github-tls.test.js` fails otherwise. An installed copy whose pins match nothing
tells the user that the check was not made and offers the releases page.

Releases are published unsigned (see "Public artifact contract" above). The signing support
in the build is kept for the day a certificate exists: with `WIN_CSC_LINK` (or
`WIN_CSC_LINK_B64` decoded to a PFX) and `WIN_CSC_KEY_PASSWORD` set, `npm run dist` signs
the Windows files, and `build-installer.ps1 -RequireSigned -CertificateSha1 …` fails closed
if the result is unsigned or signed by another certificate.

Tag the release once the artifacts verify:

```bash
git tag -a v2.0.0 -m "BP MD RTL Reader 2.0.0"
git push origin v2.0.0
```

Then attach the installers and `SHA256SUMS.txt` to a GitHub Release manually. Generate the
checksums with `npm run package:checksums`, which also enforces the artifact allowlist.

### 1.3.0 release state (2026-09-27)

The 1.3.0 release was published from a squashed single commit ("BP MD RTL Reader 1.3.0")
on top of the 1.2.2 remote history. The granular local history is not on the remote, and
the release tree intentionally excludes the `design/` prototypes and `AGENTS.md`
(local-only agent policy; neither was ever in the shipped asars — `build.files` covers
`src/`, the vendored runtime, icons, and license files only). Consequence for future
releases: pushing local `main` can never fast-forward. Repeat the squash flow (build the
release tree with `git commit-tree` from `main^{tree}` minus those paths, force-push
`main` and the tag) or publish the Release notes with `gh release create`. The release
lives at `https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases/tag/v1.3.0`; the
Windows installers are rebuilt locally, staged unsigned in `dist/release-windows-subset/`
with `WINDOWS-SUBSET-SHA256.txt`, and are attached after the signed rebuild.

## Project structure

```
build/
  icons/                  electron-builder icon inputs and SVG source masters
  installer/              Inno/NSIS scripts, policies, and installer artwork
docs/
  assets/                 README and guide screenshots
resources/
  vendor/                 offline runtime libraries, fonts, and license manifests
scripts/                  build, coverage, release, and asset tooling
src/
  main/                   Electron entry point, IPC, window (including its theme-matched background colour), `app://`/`bpmd://` protocol, storage, and security policy
  preload/                minimal context-isolated renderer bridge
  renderer/
    components/           file tree, outline, search, settings, tables, workspace, inspector, margin-note, context-menu, doc-meta, and streak-grid helpers
    icons.js              SVG icon hydration (placeholders become `createElementNS` SVG, since the sanitiser strips `<use>`)
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
2. **Add tests with the change.** New behaviour comes with tests, in the existing test
   files where one fits.
3. Keep `npm run test:unit`, `npm run lint:security`, and the relevant e2e specs green.
4. Open a PR. CI is disabled on this repository: run `npm test` and
   `npm run lint:security` yourself and say in the PR that you did.
