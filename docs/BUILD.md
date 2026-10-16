# Build from source

How to run BP MD RTL Reader from source, build the installers, and regenerate assets.
To publish a release, see [Releasing](RELEASING.md). To make a change, see [CONTRIBUTING.md](../CONTRIBUTING.md). For how the code is organized, see [Architecture](ARCHITECTURE.md).

## Contents

- [Prerequisites](#prerequisites)
- [Get started](#get-started)
- [Tech stack](#tech-stack)
- [npm scripts](#npm-scripts)
- [Build the installers](#build-the-installers)
- [Regenerate assets](#regenerate-assets)

## Prerequisites

Everyone needs:

- **Node.js 24+**, the major version in `.nvmrc`, and **npm** (the project pins npm 12 in `packageManager`).
- Git.

Each task adds its own tools:

| Task | Tool |
| ---- | ---- |
| Inno installer (x64) | The signed Inno Setup 6.3.3 compiler (`ISCC.exe`) in its standard Program Files location |
| Inno installer, installer tests, Pascal self-test | PowerShell 7 (`pwsh`) |
| Installer tests | Windows PowerShell with [Pester 5+](https://pester.dev/) (`-InstallPester` installs it if missing) |
| Linux packages (`npm run dist:linux`) | Linux, or WSL 2 on Windows. Docker is needed only if you build or smoke-test in a container |
| Icon regeneration | The Playwright Chromium that `npm install` downloads |
| `npm run scan:deps` | [syft](https://github.com/anchore/syft) and [osv-scanner](https://github.com/google/osv-scanner) on your `PATH` |
| `npm run audit:secrets` | [gitleaks](https://github.com/gitleaks/gitleaks) on your `PATH` |

## Get started

```bash
git clone https://github.com/Binary-Parse/BP-MD-RTL-Reader.git
cd BP-MD-RTL-Reader
npm install
npm start
```

`npm install` needs the network.
The `electron` package downloads the Electron binary for your platform (more than 100 MB) in its own install step.
This project's `postinstall` also downloads the Chromium used by the browser tests (about 150 MB), unless `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` or `CI` is set.
`npm start` downloads nothing.

With `npm ci --ignore-scripts`, neither download happens. Fetch Electron with `node node_modules/electron/install.js` before the app can start.

> [!TIP]
> npm 12 can skip a dependency's install script, which leaves Electron without its binary. If `npm start` or `npm run test:electron` reports a missing Electron binary, run `node node_modules/electron/install.js`.

## Tech stack

| Area | Tooling |
| ---- | ------- |
| Runtime | Electron |
| Packaging | electron-builder and Inno Setup (pinned compiler) |
| Unit tests | Vitest with V8 coverage |
| End-to-end tests | Playwright, with axe-core accessibility checks and visual regression |
| Property tests | fast-check |
| Installer tests | Pester and a compiled Inno Setup self-test |
| Markdown and sanitizing | marked and DOMPurify |
| Editor | CodeMirror 6 |
| Math, code, diagrams | KaTeX, highlight.js, Mermaid |
| Linting and SAST | ESLint with `eslint-plugin-security` and `eslint-plugin-no-unsanitized` |

Exact versions are in `package.json`. The runtime libraries the app ships are vendored under `resources/vendor/`.

## npm scripts

| Script | What it does |
| ------ | ------------ |
| `npm start` | Run the app in development (`electron .`) |
| `npm run dist` | Build the Windows installers (NSIS and portable, x64 and ARM64) into `dist/` |
| `npm run dist:linux` | Build the Linux AppImage and `.deb` files (x64 and ARM64) into `dist/`. Run it on Linux or WSL 2 |
| `npm test` | Unit tests, browser e2e tests, then the production-Electron boundary tests |
| `npm run test:unit` | Vitest unit tests |
| `npm run test:unit:coverage` | Unit tests with a gated V8 coverage report: 95% statements / 90% branches / 95% functions / 95% lines of the modules it covers |
| `npm run test:e2e` | The full Playwright browser suite |
| `npm run test:electron` | Start the real Electron app and test its process boundary |
| `npm run test:e2e:coverage` | The full renderer suite with coverage gates. `@visual` and `@perf` specs are excluded, because instrumentation distorts timing |
| `npm run test:perf` | The `@perf` timing specs. Run it on a quiet machine |
| `npm run test:smoke` | Playwright smoke tests only |
| `npm run test:integration` | Playwright integration tests only |
| `npm run test:update-snapshots` | Refresh the visual-regression baselines |
| `npm run test:watch` | Vitest in watch mode |
| `npm run coverage` | Generate fresh unit and renderer coverage, then merge and gate both |
| `npm run report:merge` | Merge the unit and renderer coverage and enforce the combined floor. The last step of `npm run coverage` |
| `npm run lint:security` | ESLint security (SAST) pass against the reviewed baseline |
| `npm run lint:tests` | ESLint over `tests/`, for undefined and unused names |
| `npm run dupcheck` | jscpd duplicate-code check over `src/`. Fails above 1 % |
| `npm run audit:deps` | Fail on any `npm audit` advisory that is not fixed or listed with a reason in `config/audit-acceptance.json` |
| `npm run audit:secrets` | gitleaks over the whole working tree, `node_modules` included. It fails if it read nothing. Local only. Reviewed false positives are in `.gitleaksignore` |
| `npm run scan:deps` | Run syft and osv-scanner and record the reports with the SHA-256 of `package-lock.json` |
| `npm run tls:verify` | Check the update-check TLS pins against the live `api.github.com` chain |
| `npm run vendor:sync` | Rebuild every vendored asset from `node_modules`, then the manifest and the license text |
| `npm run vendor:check` | Verify the vendored runtime assets byte for byte against their manifest |
| `npm run license:inventory` | Verify the lockfile-derived dependency-license summary |
| `npm run license:inventory:update` | Rewrite that summary after a dependency change |
| `npm run icons:generate` | Regenerate the app and file icons from their SVG sources |
| `npm run browser:install` | Download the Playwright Chromium by hand. `postinstall` does it otherwise |
| `npm run fuses:verify` | Check the Electron fuses of the built binaries. Part of `package:verify` |
| `npm run package:verify` | Inspect every built app archive for required and forbidden content, and check the fuses |
| `npm run package:checksums` | Check `dist/release` against the public allowlist and write `SHA256SUMS.txt` |
| `npm run package:checksums:verify` | Recheck the allowlist and every hash in `SHA256SUMS.txt` |

The quality gates a change must pass are listed in [CONTRIBUTING.md](../CONTRIBUTING.md#quality-gates).

## Build the installers

### Windows: NSIS and portable

```bash
npm run dist
```

This must produce both the NSIS installer and the portable exe, each holding x64 and ARM64. A directory-only unpack is not a substitute.
The NSIS include `build/installer/installer.nsh` must not reference `$installMode`: electron-builder compiles that include before `Var installMode`, and `nsis.warningsAsErrors` stays `true`.

The packaged renderer is served over `app://ui/…`, not `file://` inside `app.asar`.
To prove that a build paints, start `dist/win-unpacked/BP MD RTL Reader.exe` with a fresh `--user-data-dir` and check for a live `#app`. Playwright over `file://` and unpackaged `electron .` do not prove it.

### Windows: Inno Setup (x64)

```powershell
pwsh -File build/installer/build-installer.ps1
```

This is the only supported Inno entry point.
It does not use `PATH` or an existing `dist/win-unpacked`.
It checks the pinned compiler's path, exact version, Authenticode publisher, and SHA-256.
It builds a fresh x64 electron-builder directory and checks it against `build/installer/source-manifest-policy.json`.
It copies the exact files to clean staging, then writes two files:

- `dist/BP-MD-RTL-Reader-2.1.0-Windows-Inno-x64.exe`
- `dist/BP-MD-RTL-Reader-2.1.0-Windows-Inno-x64.source-manifest.json`

`source-manifest-policy.json` also pins the Electron version, and the script fails when it disagrees with `package.json`.
An Electron bump that forgets this pin breaks the Inno build.
`tests/installer/installer-security.test.ps1` asserts the pin too, so the drift fails the installer tests at the change that causes it.

Local Inno builds may be unsigned. For signing inputs, see [Releasing](RELEASING.md#signing).

### Linux: AppImage and deb

Build on Linux. On Windows, use WSL 2 with Node 24, and work on a copy inside the Linux file system. A build under `/mnt/c` is slow and would reuse the Windows `node_modules`.

```bash
git archive --format=tar HEAD | tar -x -C ~/bpmd-build     # a clean copy of the commit
cd ~/bpmd-build && npm ci --ignore-scripts
npm run dist:linux                                          # 4 files in dist/
npx electron-builder --linux --x64 --dir --config.extraMetadata.bpmdTestBuild=true -c.directories.output=dist-smoke
node tests/packaged/linux-smoke.js dist-smoke/linux-unpacked/bpmdrtlreader
```

electron-builder names the files the way each format does: `…-Linux-x86_64.AppImage` and `…-Linux-amd64.deb` for x64, and `…-Linux-arm64.AppImage` and `…-Linux-arm64.deb` for ARM64.
Only the x64 build can be started on an x64 machine. The ARM64 files are built but not run.
The desktop entry registers `text/markdown`.

The smoke test drives the app over `--remote-debugging-port`, which a release build refuses (`src/main/launch-guard.js`).
So it runs a second, unpacked build that differs only by `bpmdTestBuild: true` in its `package.json`. The files in `dist/` never carry that flag.
`tests/packaged/linux-smoke.js` needs a display (WSLg is enough).
It starts the packaged program four times, each with an empty profile, and checks that:

- a note passed by path opens,
- typed text is saved by `Ctrl+S`,
- a note passed as a `file://` URL opens (this is what the desktop entry's `%U` sends),
- no spellchecker dictionary appears in any of the profiles.

`git archive` leaves `tests/` out (`.gitattributes`, `export-ignore`), so copy `tests/packaged/linux-smoke.js` into the build copy before the last command.
The smoke test also needs the Playwright package that `npm ci` installed, and no browser download.
Inside a Docker container, Chromium's sandbox needs user namespaces (`--security-opt seccomp=unconfined`). Without them the app stops at start, and the smoke test fails with the signal it got.

### What the Windows installers do

Both installers show a license page before they copy any file.
NSIS reads `build/installer/LICENSE-INSTALLER.rtf`. Inno reads the `LICENSE` file at the repository root.
The NSIS file is plain-ASCII RTF with every Arabic character written as a `\uN?` escape and the Arabic section right-aligned with `\rtlpar`, so no code page can damage it.
`tests/unit/installer-license.test.js` pins that format.
`setup.iss` starts with a UTF-8 byte-order mark, because Inno reads a script without one as ANSI.

The NSIS installer also:

- **Offers Add to PATH.** A radio pair on the page after the directory page: add to `PATH`, or leave it unchanged (the default). A silent install opts in with `/add-path`. It uses only the vendored [EnVar plug-in](https://nsis.sourceforge.io/EnVar_plug-in) (`build/x86-unicode/`), because rewriting `PATH` in script truncates and flattens `REG_EXPAND_SZ` values. Uninstall removes exactly the `$INSTDIR` entry.
- **Detects an existing install.** A first page reads the `DisplayVersion` value under the electron-builder key and the Inno key, in both HKLM and HKCU. It offers upgrade (the default), repair (same version), or remove. A downgrade defaults to exiting with a warning. Remove opens `ms-settings:appsfeatures`.
- **Mirrors for Arabic.** Wizard pages of the installer and the uninstaller use `nsDialogs::SetRTL 1`.
- **Never runs a registry command.** The setup only reads those registry values and never executes an uninstall command from the registry. `tests/installer/installer-security.test.ps1` enforces this.
- **Bans `MessageBox`.** A Pester contract fails if one returns.
- **Skips the pages in silent mode.** `/S` keeps electron-builder's protected in-place upgrade.

For the switches users can pass, see [Install](INSTALL.md).

## Regenerate assets

```powershell
# App and Markdown file icons from build/icons/*-source.svg. Also copies icon.ico and icon.png
# to build/installer/assets/ and docs/assets/. Renders with the Playwright Chromium.
node scripts/generate-icons.mjs

# Documentation screenshots in docs/assets/
node scripts/capture-screenshots.mjs

# Every vendored asset, from node_modules: the CodeMirror 6 bundle
# (resources/vendor/codemirror/codemirror.min.js, from scripts/codemirror-entry.mjs),
# highlight.js, the Mermaid bundle (scripts/mermaid-entry.mjs), and the Lucide icon sprite block.
# It also refreshes vendor-manifest.json, so `npm run vendor:check` passes afterwards.
npm run vendor:sync
```

Run `npm install` first: the bundles need the `@codemirror/*`, `@lezer/highlight`, `highlight.js`, `mermaid`, `lucide-static`, and `esbuild` dev dependencies.
