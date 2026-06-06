# BP MD RTL Reader — Agent Guide

This file is written for AI coding agents. It assumes you know nothing about the project. Every fact below is derived from the actual source, configuration, and documentation.

---

## Project Overview

**BP MD RTL Reader** is a local-first, bilingual Markdown reader built with Electron. It treats prose as a literary object and gives first-class support to both English (LTR) and Arabic (RTL). It opens plain `.md` files on disk — no database, no proprietary format, no cloud sync, and no telemetry.

Key traits you should keep in mind when editing code:
- **Privacy-first**: no analytics, no crash upload, no auto-update phone-home.
- **Sandboxed renderer**: `contextIsolation: true`, `nodeIntegration: false`, minimal preload bridge.
- **Bilingual by design**: automatic Arabic detection, manual direction flip, per-line bidi isolation, Arabic-aware fonts.
- **Test-driven**: new behaviour should come with a failing test that your change turns green.

---

## Technology Stack

| Area | Tool / Library | Version (lockfile truth) |
|------|----------------|--------------------------|
| Runtime | Electron | 42 |
| Packaging | electron-builder | 26 |
| Additional installer | Inno Setup | 6.3+ (local builds only) |
| Unit tests | Vitest | 4 |
| E2E / integration tests | Playwright | 1.60 |
| Accessibility testing | @axe-core/playwright + axe-core | 4.11 |
| Mutation testing | Stryker | 9 |
| Property-based tests | fast-check | 4 |
| Code bundling (editor) | esbuild | 0.28 |
| Markdown parser | marked | 18 |
| HTML sanitiser | DOMPurify | 3 (bundled in `assets/vendor/`) |
| Math rendering | KaTeX | bundled locally |
| Code highlighting | highlight.js | bundled locally |
| Diagrams | Mermaid | bundled locally |
| Editor | CodeMirror 6 | bundled into `assets/vendor/codemirror/` |
| Linting / SAST | ESLint 10 + `eslint-plugin-security`, `eslint-plugin-no-unsanitized`, `eslint-plugin-html` | — |
| Fonts | Self-hosted woff2 (Inter, Fraunces, JetBrains Mono, IBM Plex Sans Arabic) | — |

Node.js **24+** is required (`.nvmrc` pins the version; CI builds on Node 24).

---

## Project Structure

```
├── index.html                    Renderer — UI markup + inline styles
├── main.js                       Electron main process (window, IPC, files, export, logging)
├── preload.js                    contextBridge — the renderer's ONLY door to the main process
├── src/
│   ├── main-logic.js             Pure, Electron-free file/security helpers (unit-testable in Node)
│   ├── main/
│   │   ├── context-menu.js       Pure context-menu template builder
│   │   ├── document-store.js     File read/write/atomic-save helpers
│   │   ├── navigation.js         Link-classification helpers (internal vs external)
│   │   ├── protocol.js           `bpmd://` custom scheme asset resolver
│   │   ├── settings.js           Persistent settings (JSON on disk) + migration
│   │   └── version.js            Semver comparison utility
│   └── renderer/
│       ├── app.js                Main renderer application (~3K lines of state + UI glue)
│       ├── theme-boot.js         Theme bootstrap (runs before app.js)
│       ├── bidi.js               RTL/LTR direction resolution logic
│       ├── bidi-dom.js           DOM-level bidi application
│       ├── callouts.js           Markdown callout transformation
│       ├── dates.js              Daily-note filename generation
│       ├── edit-commands.js      Clipboard / undo / redo / select-all helpers
│       ├── export.js             HTML export document builder
│       ├── file-predicates.js    File-type checks (droppable, etc.)
│       ├── focus.js              Focus-trap and roving-tab-index utilities
│       ├── footnotes.js          Footnote ID extraction
│       ├── frontmatter.js        YAML front-matter parsing
│       ├── highlight.js          Syntax-highlighting wrapper
│       ├── i18n.js               Arabic-heavy detection, HTML escaping
│       ├── locale.js             UI strings and locale direction
│       ├── markdown.js           marked configuration + custom extensions
│       ├── math.js               KaTeX math parsing / rendering
│       ├── mermaid.js            Mermaid diagram rendering wrapper
│       ├── outline.js            Table-of-contents / active-heading tracking
│       ├── search.js             Vault-wide search
│       ├── session.js            Session restore logic
│       ├── state.js              Proxy-based observable state store
│       ├── table-edit.js         Interactive table editing
│       ├── tags.js               Tag extraction from file set
│       ├── theme.js              Theme definitions + zoom clamping
│       ├── tree.js               File-tree building / flattening
│       ├── trusted.js            DOMPurify sanitisation configuration
│       └── editor/
│           ├── codemirror-adapter.js   CM6 editor surface (e2e-only, excluded from unit coverage gate)
│           ├── live-preview.js         Hide markdown syntax on non-active lines
│           ├── block-preview.js        Block-level live preview
│           ├── inline-marks-preview.js Inline formatting preview
│           ├── math-preview.js         Math rendering inside CM6
│           ├── wikilink-preview.js     Wiki-link hover cards
│           ├── line-direction.js       Per-line RTL/LTR inside CM6
│           └── list-continuation.js    Smart list item continuation
├── tests/
│   ├── unit/                     Vitest unit tests (468+)
│   ├── *.spec.js                 Playwright e2e specs (526+) — smoke, rtl, visual, a11y, perf, fuzz, …
│   ├── integration/              Playwright integration tests
│   ├── installer/                Pester + Inno Setup self-tests
│   └── __mocks__/                Test mocks (electron.cjs, etc.)
├── assets/
│   ├── vendor/                   Bundled libraries + fonts (0 runtime network)
│   ├── icon-source.png
│   ├── icon.png
│   └── icon.ico
├── installer/
│   ├── setup.iss                 Inno Setup script
│   ├── build-installer.ps1       PowerScript to compile Inno installer
│   └── scripts/*.pas             Pascal installer logic
├── scripts/
│   ├── codemirror-entry.mjs      CM6 bundle entry point
│   ├── capture-screenshots.mjs   Regenerate docs screenshots
│   ├── generate-icons.ps1        Regenerate icon assets
│   └── merge-coverage.js         Merge unit + e2e coverage reports
├── docs/                         User guides, build docs, privacy policy
├── .github/workflows/            CI/CD (ci.yml, release.yml, codeql.yml, scorecard.yml)
├── vitest.config.js              Unit test + V8 coverage configuration
├── playwright.config.js          E2E test configuration (auto-coverage fixture)
├── eslint.config.mjs             Security-focused ESLint flat config
├── stryker.config.json           Mutation test scope + thresholds
└── package.json                  Dependencies, scripts, electron-builder config
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

# Optional local Inno Setup installer (x64) — requires ISCC.exe:
pwsh -File installer/build-installer.ps1
```

### Asset regeneration

```bash
npm run build:cm             # Rebuild CodeMirror 6 bundle from scripts/codemirror-entry.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
node scripts/capture-screenshots.mjs
```

### Testing

```bash
npm test                     # Unit tests THEN e2e suite
npm run test:unit            # Vitest unit tests only
npm run test:unit:coverage   # Unit tests + V8 coverage report (gated)
npm run test:e2e             # Full Playwright suite
npm run test:smoke           # Playwright smoke tests only
npm run test:integration     # Playwright integration tests only
npm run test:update-snapshots # Refresh visual-regression baselines
npm run test:mutation        # Stryker mutation testing
npm run test:watch           # Vitest in watch mode
npm run coverage             # Combined unit + e2e coverage
npm run report:merge         # Merge coverage reports
npm run lint:security        # ESLint security / SAST pass
```

### Coverage gates

| Suite | Threshold | Notes |
|-------|-----------|-------|
| Unit (Vitest) | 95 % statements, 95 % lines, 95 % functions, 88 % branches | Configured in `vitest.config.js` |
| E2E (Playwright) | Renderer V8 coverage collected per-test via auto-fixture | Merged by `scripts/generate-renderer-coverage.js` |
| Mutation (Stryker) | 85 % break threshold | Configured in `stryker.config.json` |

---

## Code Style and Conventions

### Module system split
- **CommonJS**: `main.js`, `preload.js`, `src/main-logic.js` (Node / Electron main side).
- **ES modules**: everything under `src/renderer/` (browser / renderer side).

### Injectable entry points (testability)
Both `main.js` and `preload.js` use an **injectable bootstrap pattern** so they can be imported by unit tests without running Electron or hijacking `require`:

- `main.js` exports `bootstrap({ electron, fs, proc, fetchFn })`. The real app calls it at the bottom guarded by `require.main === module`.
- `preload.js` exports `setupBridge({ contextBridge, ipcRenderer })`. The real preload calls it at the bottom guarded by `typeof globalThis.__vitest_worker__ === 'undefined'`.

When you add new IPC channels or main-process logic, keep the pure/testable parts separate from Electron side-effects so they can be exercised by Vitest.

### Comment conventions
- Ticket-style tags are common: `T-B1`, `T-F13`, `JB1-JB4`, `audit #3`, `EC-A2`, etc. These refer to requirements / audit findings. Preserve them when refactoring.
- Some comments include Arabic text (e.g., in `vitest.config.js`). Preserve bilingual comments when they exist.

### Security annotations
Security checks in `src/main-logic.js` are explicitly labeled:
- `JB1` — path allowlist check
- `JB2` — reject UNC / network paths
- `JB3` — reject symlinks that escape the vault
- `JB4` — file size / count / cumulative caps

When modifying file-system access, keep these guards in place and update the corresponding tests.

### ESLint
- Flat config (`eslint.config.mjs`) targeting ESLint 10.
- Plugins: `eslint-plugin-security`, `eslint-plugin-no-unsanitized`, `eslint-plugin-html`.
- `eslint-plugin-html` monkey-patches the linter at load time to extract `<script>` blocks from `index.html` so SAST rules apply to them.
- Run with `npm run lint:security`.

---

## Testing Instructions

### Unit tests (Vitest)
- Located in `tests/unit/`.
- Entry files are auto-discovered: `*.test.js` and `*.spec.js`.
- The Vitest alias resolves `electron` to `tests/__mocks__/electron.cjs` so main-process code can be tested without the real Electron binary.
- `src/main-logic.js` is inlined (`deps.inline`) so coverage is correctly attributed.
- `--no-file-parallelism` is used when collecting coverage to avoid under-reporting.

### E2E tests (Playwright)
- Located in `tests/*.spec.js` and `tests/integration/`.
- Uses Chromium only (headless, viewport 1440×900).
- Visual-regression tests (`@visual` tag) run inside `mcr.microsoft.com/playwright:v1.60.0-jammy` so font rendering matches the committed Linux baselines.
- Accessibility tests use `@axe-core/playwright`.
- The `playwright.config.js` installs an **auto-coverage fixture** when `COLLECT_RENDERER_COVERAGE=1` — it starts V8 JSCoverage before each test and writes per-test JSON into `coverage/renderer/`.

### Mutation tests (Stryker)
- Scope is intentionally broad: includes `main.js`, `preload.js`, `src/main-logic.js`, all `src/main/` modules, and most `src/renderer/` modules.
- Excluded from mutation: `src/renderer/app.js`, `theme-boot.js`, `editor/codemirror-adapter.js` (e2e-only, no unit tests) and `src/renderer/locale.js` (translation string table).
- Full run on nightly CI; `--incremental` on PRs (cached baseline).

### Installer tests
- PowerShell + Pester 5 tests in `tests/installer/`.
- Also includes a compiled Inno Setup Pascal self-test.
- These are **manual / local only** — not run in CI.

---

## Security Considerations

This project takes a defence-in-depth approach. Do not weaken any of the following without explicit justification and test updates.

### Renderer isolation
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` (Electron default)
- Renderer has no direct access to Node.js, `fs`, or `shell`. All access goes through the narrow `preload.js` bridge.

### Content Security Policy (CSP)
A strict CSP is declared in `index.html`:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: bpmd: file:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'
```
- `script-src 'self'` means **no inline scripts** — all JS is externalised to `src/renderer/app.js` and `src/renderer/theme-boot.js`.
- `connect-src 'self'` means the renderer makes **zero outbound network requests**.

### Output sanitisation
- All rendered Markdown HTML passes through **DOMPurify** (`src/renderer/trusted.js`).
- DOMPurify strips `<script>`, event handlers, and other active content.

### File-system guards (`src/main-logic.js`)
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
6. **Dependency review** — PR-only; blocks known vulnerabilities (currently `continue-on-error` until GHAS is enabled).

### `codeql.yml` — weekly + on PR/push
- Inter-procedural taint analysis for JS/TS.
- Uploads SARIF (currently `continue-on-error` if Code Scanning is not yet enabled).

### `scorecard.yml` — weekly
- OpenSSF Scorecard supply-chain security analysis.

### `release.yml` — triggered by `v*` tag push
- Builds per-platform installers on `windows-latest`, `macos-latest`, `ubuntu-latest`.
- Gates on unit tests + coverage before packaging.
- Publishes to the matching GitHub Release.
- Code signing / notarization activate only when the corresponding secrets are present.

### Supply-chain hardening
- Every GitHub Action is pinned to a **full commit SHA** (tags are considered mutable after the `tj-actions/changed-files` CVE).
- `step-security/harden-runner` audits egress on Linux jobs.
- `permissions` are set to `contents: read` by default; jobs elevate only the scopes they need.

---

## Entry Points and Module Boundaries

### Runtime entry points
- **`main.js`** — Node process entry (`"main": "main.js"` in `package.json`). Calls `bootstrap()` with live `electron`/`fs`/`process`.
- **`preload.js`** — Electron preload script declared in `main.js` (`preload: path.join(__dirname, 'preload.js')`).
- **`index.html`** — Renderer window loadURL. Loads `theme-boot.js`, vendored libraries, then `src/renderer/app.js`.

### What belongs where
| Concern | Location |
|---------|----------|
| Electron main-process side-effects (window, menu, dialog, IPC handlers) | `main.js` |
| Pure file / path / security logic | `src/main-logic.js` |
| IPC bridge exposure | `preload.js` |
| Renderer state, DOM manipulation, event handling | `src/renderer/app.js` |
| Pure renderer helpers (markdown, bidi, search, etc.) | `src/renderer/*.js` |
| Editor-specific CM6 plugins | `src/renderer/editor/*.js` |

### When adding a feature
1. Decide whether it lives in **main**, **preload**, or **renderer**.
2. If it touches the filesystem or shell, put the policy in `src/main-logic.js` or `src/main/` and wire it through an IPC channel in `preload.js`.
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
