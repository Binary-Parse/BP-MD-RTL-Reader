# BP MD RTL Reader — Agent Guide

This file is written for AI coding agents. It assumes you know nothing about the project. Every fact below is derived from the actual source, configuration, and documentation.

---

## Project Overview

**BP MD RTL Reader** is a local-first, bilingual Markdown reader built with Electron. It gives first-class support to both English (LTR) and Arabic (RTL). It opens plain `.md` files on disk — no database, no proprietary format, no cloud sync, and no telemetry.

Key traits you should keep in mind when editing code:
- **Privacy-first**: no analytics, no crash upload, no automatic update requests.
- **Sandboxed renderer**: `contextIsolation: true`, `nodeIntegration: false`, minimal preload bridge.
- **Bilingual by design**: automatic Arabic detection, manual direction flip, per-line bidi isolation, Arabic-aware fonts.
- **Test-driven**: new behaviour should come with a failing test that your change turns green.

---

## Technology Stack

| Area | Tool / Library | Version (lockfile truth) |
|------|----------------|--------------------------|
| Runtime | Electron | 42 |
| Packaging | electron-builder | 26 |
| Additional installer | Inno Setup | 6.3.3 pinned/signed (local and release builds) |
| Unit tests | Vitest | 4 |
| E2E / integration tests | Playwright | 1.61 |
| Accessibility testing | @axe-core/playwright + axe-core | 4.12 |
| Mutation testing | Stryker | 9 |
| Property-based tests | fast-check | 4 |
| Code bundling (editor) | esbuild | 0.28 |
| Markdown parser | marked | 18 |
| HTML sanitiser | DOMPurify | 3 (bundled in `resources/vendor/`) |
| Math rendering | KaTeX | bundled locally |
| Code highlighting | highlight.js | bundled locally |
| Diagrams | Mermaid | bundled locally |
| Editor | CodeMirror 6 | bundled into `resources/vendor/codemirror/` |
| Linting / SAST | ESLint 10 + `eslint-plugin-security`, `eslint-plugin-no-unsanitized`, `eslint-plugin-html` | — |
| Fonts | Self-hosted woff2 (Inter, Fraunces, JetBrains Mono, IBM Plex Sans Arabic) | — |

Node.js **24+** is required (`.nvmrc` pins the version; CI builds on Node 24).

---

## Project Structure

```
├── build/                         electron-builder inputs (icons, entitlements, installers)
│   ├── icons/                     Application/file-association icons and source masters
│   └── installer/                 Inno/NSIS scripts, policies, and installer artwork
├── docs/
│   └── assets/                    README and guide screenshots
├── resources/
│   └── vendor/                    Bundled libraries, fonts, and license manifests (0 runtime network)
├── scripts/                       Build, coverage, release, and asset tooling
├── src/
│   ├── main/
│   │   ├── index.js               Electron bootstrap and application lifecycle composition
│   │   ├── main-logic.js          Pure, Electron-free file/security helpers
│   │   ├── ipc-controller.js      Privileged IPC registration and watcher/export state
│   │   └── window-controller.js   BrowserWindow security, lifecycle, menus, and navigation
│   ├── preload/
│   │   └── index.js               contextBridge — the renderer's ONLY door to the main process
│   └── renderer/
│       ├── index.html             Renderer UI markup and ordered external assets
│       ├── app.js                 Main renderer application state and UI glue
│       ├── components/            File tree, outline, search, tables, settings, and workspace helpers
│       ├── editor/                CodeMirror 6 editor and live-preview extensions
│       ├── markdown/              marked, DOMPurify, KaTeX, highlighting, Mermaid, and export pipeline
│       └── styles/                Base, theme, component, and responsive CSS boundaries
├── tests/
│   ├── unit/                      Vitest unit tests
│   ├── e2e/                       Playwright browser, integration, visual, a11y, and Electron lanes
│   ├── fixtures/                  Markdown and renderer fixtures
│   ├── installer/                 Pester + Inno Setup self-tests
│   └── __mocks__/                 Test mocks (electron.cjs, etc.)
├── .github/                       Workflows, issue forms, PR template, and dependency updates
├── vitest.config.js               Unit test + V8 coverage configuration
├── playwright.config.js           Browser E2E configuration
├── playwright.electron.config.js  Production Electron boundary configuration
├── eslint.config.mjs              Security-focused ESLint flat config
├── stryker.config.json            Mutation test scope + thresholds
└── package.json                   Dependencies, scripts, and electron-builder config
```

---

## Build and Test Commands

All commands run from the repository root.

### Development

```bash
npm install      # installs deps + Playwright Chromium (postinstall)
npm start        # electron . — run the app in development
```

### Packaging

```bash
npm run dist                 # electron-builder — Windows NSIS + portable (x64, ia32, arm64)
# macOS / Linux targets are defined in package.json but not built in routine dev.

# Local Inno Setup installer (x64) — requires the pinned ISCC.exe:
pwsh -File build/installer/build-installer.ps1
```

### Asset regeneration

```bash
npm run build:cm             # Rebuild CodeMirror 6 bundle from scripts/codemirror-entry.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
node scripts/capture-screenshots.mjs
```

### Testing

```bash
npm test                     # Unit, browser e2e, THEN real-Electron boundary suite
npm run test:unit            # Vitest unit tests only
npm run test:unit:coverage   # Unit tests + V8 coverage report (gated)
npm run test:e2e             # Full Playwright suite
npm run test:electron        # Production Electron/preload/IPC boundary suite
npm run test:e2e:coverage    # Full non-visual renderer coverage + completeness gate
npm run test:smoke           # Playwright smoke tests only
npm run test:integration     # Playwright integration tests only
npm run test:update-snapshots # Refresh visual-regression baselines
npm run test:mutation        # Stryker mutation testing
npm run test:mutation:release # Full bounded-concurrency mutation + tier gate
npm run test:watch           # Vitest in watch mode
npm run coverage             # Combined unit + e2e coverage
npm run report:merge         # Merge coverage reports
npm run lint:security        # ESLint security / SAST pass
npm run vendor:check         # Verify vendored runtime bytes/provenance
npm run license:inventory    # Verify lockfile-derived license inventory
npm run package:verify       # Inspect packaged app archives
npm run package:checksums    # Enforce release allowlist + write canonical hashes
npm run package:checksums:verify # Recheck exact names and every canonical hash
```

### Coverage gates

| Suite | Threshold | Notes |
|-------|-----------|-------|
| Unit (Vitest) | 95 % statements, 90 % branches, 95 % functions, 95 % lines | Configured through `config/coverage-thresholds.json` |
| E2E (Playwright) | Renderer V8 coverage collected per-test via auto-fixture | Merged by `scripts/generate-renderer-coverage.js` |
| Mutation (Stryker) | 80 % overall; per-file T1 85 % / T2 75 % / T3 60 % | Configured in `stryker.config.json` and `config/mutation-tiers.json` |

---

## Code Style and Conventions

### Module system split
- **CommonJS**: `src/main/index.js`, `src/preload/index.js`, `src/main/main-logic.js`, and `src/main/*.js` (Node / Electron main side).
- **ES modules**: everything under `src/renderer/` (browser / renderer side).

### Injectable entry points (testability)
Both `src/main/index.js` and `src/preload/index.js` use an **injectable bootstrap pattern** so they can be imported by unit tests without running Electron or hijacking `require`:

- `src/main/index.js` exports `bootstrap({ electron, fs, proc, fetchFn })`. The real app calls it at the bottom guarded by `require.main === module`.
- `src/preload/index.js` exports `setupBridge({ contextBridge, ipcRenderer })`. The real preload calls it at the bottom guarded by `typeof globalThis.__vitest_worker__ === 'undefined'`.

When you add new IPC channels or main-process logic, keep the pure/testable parts separate from Electron side-effects so they can be exercised by Vitest.

### Comment conventions
- Ticket-style tags are common: `T-B1`, `T-F13`, `JB1-JB4`, `audit #3`, `EC-A2`, etc. These refer to requirements / audit findings. Preserve them when refactoring.
- Some comments include Arabic text (e.g., in `vitest.config.js`). Preserve bilingual comments when they exist.

### Security annotations
Security checks in `src/main/main-logic.js` are explicitly labeled:
- `JB1` — path allowlist check
- `JB2` — reject UNC / network paths
- `JB3` — reject symlinks that escape the vault
- `JB4` — file size / count / cumulative caps

When modifying file-system access, keep these guards in place and update the corresponding tests.

### ESLint
- Flat config (`eslint.config.mjs`) targeting ESLint 10.
- Plugins: `eslint-plugin-security`, `eslint-plugin-no-unsanitized`, `eslint-plugin-html`.
- `eslint-plugin-html` monkey-patches the linter at load time to extract `<script>` blocks from `src/renderer/index.html` so SAST rules apply to them.
- Run with `npm run lint:security`.

---

## Testing Instructions

### Unit tests (Vitest)
- Located in `tests/unit/`.
- Entry files are auto-discovered: `*.test.js` and `*.spec.js`.
- The Vitest alias resolves `electron` to `tests/__mocks__/electron.cjs` so main-process code can be tested without the real Electron binary.
- `src/main/main-logic.js` is inlined (`deps.inline`) so coverage is correctly attributed.
- `--no-file-parallelism` is used when collecting coverage to avoid under-reporting.

### E2E tests (Playwright)
- Located in `tests/e2e/*.spec.js` and `tests/e2e/integration/`.
- Uses Chromium only. The effective `Desktop Chrome` default is 1280×720; visual specs
  explicitly set 1440×900 before snapshots.
- Visual-regression tests (`@visual` tag) run inside `mcr.microsoft.com/playwright:v1.61.1-jammy` so font rendering matches the committed Linux baselines.
- Accessibility tests use `@axe-core/playwright`.
- The `playwright.config.js` installs an **auto-coverage fixture** when `COLLECT_RENDERER_COVERAGE=1` — it starts V8 JSCoverage before each test and writes per-test JSON into `coverage/renderer/`.

### Mutation tests (Stryker)
- Scope is intentionally broad: includes `src/main/index.js`, `src/preload/index.js`, `src/main/main-logic.js`, all `src/main/` modules, and most `src/renderer/` modules.
- Excluded from mutation: `src/renderer/app.js`, `theme-boot.js`, `editor/codemirror-adapter.js` (e2e-only, no unit tests) and `src/renderer/locale.js` (translation string table).
- Full run on nightly CI; `--incremental` on PRs (cached baseline).

### Installer tests
- PowerShell + Pester 5 tests in `tests/installer/`.
- Windows package CI runs the Pester suite non-destructively with `-SkipMutation`.
- `tests/installer/run-pascal-self-test.ps1` is a separate local compiled Inno Pascal
  self-test because it requires the pinned ISCC toolchain.
- `tests/installer/run-release-vm-tests.ps1` is destructive and hard-guarded to a fresh,
  elevated GitHub-hosted Windows release runner. It installs and removes each signed
  public installer in both preserve-data and delete-data modes, then forces all opt-in
  post-uninstall Pester checks to execute.

---

## Security Considerations

This project takes a defence-in-depth approach. Do not weaken any of the following without explicit justification and test updates.

### Renderer isolation
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` (Electron default)
- Renderer has no direct access to Node.js, `fs`, or `shell`. All access goes through the narrow `src/preload/index.js` bridge.

### Content Security Policy (CSP)
A strict CSP is declared in `src/renderer/index.html`:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: bpmd: file:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'
```
- `script-src 'self'` means **no inline scripts** — all JS is externalised to `src/renderer/app.js` and `src/renderer/theme-boot.js`.
- `connect-src 'self'` means the renderer makes **zero outbound network requests**.

### Output sanitisation
- All rendered Markdown HTML passes through **DOMPurify** (`src/renderer/markdown/trusted.js`).
- DOMPurify strips `<script>`, event handlers, and other active content.

### File-system guards (`src/main/main-logic.js`)
- **Path allow-listing** (`isAuthorizedPath`) — only folders the user explicitly opened are readable.
- **Network path rejection** (`isNetworkPath`) — rejects `\\` and `//` paths.
- **Symlink escape detection** (`isSymlinkEscape`) — prevents reading outside the authorised vault.
- **Size caps** — per-file 10 MiB, max 5 000 files per directory, cumulative 100 MiB.
- **Atomic writes** — `document-store.js` writes to a temp file then renames to avoid corruption.

### Privacy guarantees
- **No telemetry** — verified in source; `crashReporter` starts with `uploadToServer: false`.
- **No auto-update checks** — the only update path is an explicit "Check for Updates…" user action (`T-Q6`).
- **Local-only logs** — renderer errors are forwarded via IPC and appended to `<userData>/logs/bpmdrtlreader.log`. No network transmission.

---

## CI / CD Overview

### `ci.yml` — runs on every push/PR to `main`, `master`, `feat/**`, `fix/**`
1. **Lint + SAST + secrets + audit** — ESLint security rules, gitleaks secret scan, `npm audit`.
2. **Unit tests + coverage gate** — Vitest with V8 coverage; artifact uploaded.
3. **E2E functional** — sharded 4 ways (excludes `@visual`); blob reports merged in a follow-up job.
4. **Visual snapshots** — `@visual` specs inside the pinned Playwright container so baselines match.
5. **Mutation testing** — full run on schedule / workflow_dispatch; `--incremental` on PRs.
6. **Real Electron boundary** — launches production Electron with temporary profile/data.
7. **Native package matrix** — Windows/macOS/Linux targets, archive inspection, and
   Windows Pester installer logic. These routine CI packages are not release-signed.
8. **Dependency review** — PR-only and currently `continue-on-error` until GHAS is enabled.

This workflow uploads verified CI artifacts but does not publish a GitHub Release. There
are no committed CodeQL or Scorecard workflows.

### `claude.yml` — explicit `@claude` issue/review requests
- Runs only for supported issue/review events containing `@claude` and excludes bot actors.
- Checkout and the Claude action are pinned to full commit SHAs.
- The Claude workflow grants explicit write permissions for repository contents, pull
  requests, and issues, plus read access to Actions; it does not inherit `ci.yml`'s
   read-only default and does not use `harden-runner`.

### `release.yml` — signed tag validation and publication
- Manual dispatch runs the complete release validation but cannot publish.
- A signed annotated tag matching `v` plus the stable package version may publish only
  when the repository is public and the tagged package metadata is publishable.
- Windows outputs are Authenticode-signed and timestamped; macOS outputs are signed,
  notarized, stapled, and validated; Linux outputs are built on native Linux runners.
- The final job enforces the exact 12-file public allowlist, creates and verifies
  `SHA256SUMS.txt`, creates GitHub attestations, and publishes the changelog section.
- Real preserve-data and delete-data uninstalls run only on disposable Windows release
  runners and never target Markdown documents outside the four current-account app aliases.
- Release workflow grants `contents: write`, `id-token: write`, and `attestations: write`
  only to the aggregate publication job; earlier release jobs remain read-only.

### Supply-chain hardening
- Every current `uses:` action in all three workflows is pinned to a full commit SHA.
- `step-security/harden-runner` audits egress in applicable `ci.yml` Linux jobs; container
  and native package jobs are not described as having that step.
- `ci.yml` defaults to `contents: read`; its dependency-review job elevates only its PR
  scope. `claude.yml` declares the separate write permissions documented above, while
  `release.yml` reserves publication and provenance permissions for its final job.

---

## Entry Points and Module Boundaries

### Runtime entry points
- **`src/main/index.js`** — Node process entry (`"main": "src/main/index.js"` in `package.json`). Calls `bootstrap()` with live `electron`/`fs`/`process`.
- **`src/preload/index.js`** — Electron preload script declared in `src/main/index.js` (`preload: path.join(__dirname, 'src/preload/index.js')`).
- **`src/renderer/index.html`** — Renderer window loadURL. Loads `theme-boot.js`, vendored libraries, then `src/renderer/app.js`.

### What belongs where
| Concern | Location |
|---------|----------|
| Electron bootstrap, protocol, logging, and application lifecycle composition | `src/main/index.js` |
| Privileged dialog/file/settings/export IPC and vault watcher ownership | `src/main/ipc-controller.js` |
| BrowserWindow security options, close protocol, navigation, and native menus | `src/main/window-controller.js` |
| Pure file / path / security logic | `src/main/main-logic.js` |
| IPC bridge exposure | `src/preload/index.js` |
| Renderer state, DOM manipulation, event handling | `src/renderer/app.js` |
| Pure renderer helpers (markdown, bidi, search, etc.) | `src/renderer/*.js` |
| Editor-specific CM6 plugins | `src/renderer/editor/*.js` |

### When adding a feature
1. Decide whether it lives in **main**, **preload**, or **renderer**.
2. If it touches the filesystem or shell, put the policy in `src/main/main-logic.js` or `src/main/` and wire it through an IPC channel in `src/preload/index.js`.
3. Add or update **unit tests** in `tests/unit/` for pure logic.
4. Add or update **e2e tests** in `tests/*.spec.js` for user-visible behaviour.
5. Run `npm run lint:security` and `npm run test:unit` before committing.
6. Ensure the change does not weaken the CSP, DOMPurify config, or path-security guards.

---

## Useful References

- `docs/BUILD.md` — Detailed build, test, and contribution instructions.
- `docs/USER_GUIDE.md` — Feature walkthrough.
- `docs/KEYBOARD_SHORTCUTS.md` — Full shortcut reference.
- `docs/PRIVACY.md` — Privacy and security model.
- `CHANGELOG.md` — Release history.
- `THIRD-PARTY-NOTICES.md` — License attributions for bundled libraries and fonts.
