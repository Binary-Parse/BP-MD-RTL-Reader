# Architecture

This page is for contributors. It explains how the app is split into processes, how they talk, which rules keep untrusted Markdown contained, and where files live.
To build and test the app, see [Build from source](BUILD.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Contents

- [Process model](#process-model)
- [IPC and its guards](#ipc-and-its-guards)
- [Security model](#security-model)
- [File and size pipeline](#file-and-size-pipeline)
- [Renderer conventions](#renderer-conventions)
- [Code conventions](#code-conventions)
- [Project structure](#project-structure)

## Process model

The app has three parts.

| Part | Folder | Module type | Job |
| ---- | ------ | ----------- | --- |
| Main process | `src/main/` | CommonJS | Owns the window, the file system, settings, and every privileged action |
| Preload bridge | `src/preload/` | CommonJS | Exposes a minimal, context-isolated API to the page |
| Renderer | `src/renderer/` | ES modules | The interface, the editor, and the Markdown pipeline |

The entry points take their dependencies as arguments.
`src/main/index.js` exports `bootstrap({ electron, fs, proc, fetchFn })`, and `src/preload/index.js` exports `setupBridge({ contextBridge, ipcRenderer })`.
Each one calls itself at the bottom only in a real runtime.
That lets Vitest test main-process logic without starting Electron.
When you add IPC, keep pure logic apart from Electron side effects.

Main-process state lives behind injected controllers in `src/main/` (window, IPC, protocol).
Pure policy lives in small files that import nothing from Electron: `main-logic.js` (file and size policy), `protocol.js` (`app://` and `bpmd://` resolvers), and `navigation.js` (which links may open outside the app).

The renderer is `src/renderer/index.html` (markup only) plus four stylesheets, two boot scripts (`theme-boot.js` and `trusted-types-boot.js`) and the main module `app.js` (about 6,600 lines).
Both are loaded as external scripts to satisfy the strict CSP.
Helpers live in the rest of `src/renderer/`.

A packaged build loads the page from `app://ui/src/renderer/index.html`, not from `file://` inside the archive.
PDF export loads a temporary HTML file from the OS temp folder.
Note images load through `bpmd://`, scoped to the folder they belong to.

## IPC and its guards

Every message from the page to the main process goes through one guard (`src/main/ipc-guard.js`).
The guard accepts a message only when all three are true:

- The sending frame exists.
- Its origin is the app's own (`app://ui`).
- It is the top frame of its page, not a subframe.

A rejected `handle` call answers `{ error: 'untrusted-sender' }`. A rejected `on` message is dropped. Both are logged.
Because the guard wraps `ipcMain` once, no handler has to remember the check.

The preload bridge returns only an unsubscribe function from event subscriptions, so the page never holds the privileged emitter.
It also copies any typed-array view into an exactly sized buffer before it crosses the bridge, so the size caps in main run on the real data size.

## Security model

[SECURITY.md](../SECURITY.md) lists the guarantees and the supported versions. This section is how the code delivers them.

- **Context isolation on, Node integration off.** The page can call only what the preload bridge exposes.
- **Strict CSP.** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: bpmd:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; require-trusted-types-for 'script'`, set in `index.html`. The policy permits style attributes written by code (`'unsafe-inline'` for styles), but every script must be a file. Remote images never load.
- **Sanitized output.** Rendered HTML passes through DOMPurify under Trusted Types.
- **Capability-based folder access.** Absolute paths never cross the preload boundary. Main canonicalizes the result of a native picker, stores it, and gives the page an opaque ID. The page cannot create access by writing a path into settings.
- **Four file-system checks in `src/main/main-logic.js`.** Keep them in place, and update their tests when you touch file access:
  - a path allowlist,
  - rejection of UNC and network paths,
  - caps on file size and on file count,
  - rejection of symlinks that resolve outside their folder.
- **Link policy.** `navigation.js` hands only `http(s):`, `mailto:`, and `tel:` links to the OS, and only after a user click. Everything else is blocked.
- **No debugger in a release.** `launch-guard.js` makes a packaged build exit when started with a remote-debugging or inspect switch.
- **Electron fuses.** `npm run package:verify` reads the fuse settings out of the built binaries.
- **One network client.** The only request the app makes is the opt-in update check, over a pinned TLS chain (`src/main/github-tls.js`). See [Releasing](RELEASING.md#rotate-the-tls-pins) for the pins.

## File and size pipeline

Notes pass through main in this order.

1. **Read.** `document-store.js` reads a note, detects its encoding (UTF-8, UTF-16 LE and BE, Windows-1256), and keeps the byte-order mark and line endings.
2. **Size tier.** `main-logic.js` decides how to treat it. Main owns the limits and sends them to the page over the `app:limits` channel. The renderer keeps matching defaults for the browser test lane, and a unit test pins the two together.
3. **Write.** Saves go through `atomic-rename.js`: write a temporary file, flush it, then rename it over the target. On Windows it retries the rename briefly, because antivirus and sync clients can hold a file for a moment.
4. **Conflict check.** Before it writes, the store checks that the file did not change on disk since it was read.
5. **Own writes.** `own-write-tracker.js` stops the folder watcher from reporting the app's own saves back as external changes.

The numbers (size tiers, folder caps, export caps) are listed for users in [Files and limits](FILES_AND_LIMITS.md).
The values in code are the source of truth: `src/main/main-logic.js`, `src/renderer/limits.js`, and `src/renderer/components/large-file.js`.

The small JSON files main owns (settings, capabilities, highlights, reading stats) share one load-and-save core in `json-store.js`, with a version guard and the same atomic writer.

## Renderer conventions

**Four stylesheets, fixed order.**
`src/renderer/styles/` holds `base.css`, `themes.css`, `components.css`, and `responsive.css`, linked in that order from `src/renderer/index.html`.
The HTML carries no `<style>` block. Do not add a fifth stylesheet. A test pins the list and the order.

**Prefer logical properties on the inline axis.**
Write `inset-inline-start`, `border-inline-start`, `padding-inline`, and similar, not `left` and `right`.
Then right-to-left mirroring follows from `dir="rtl"` with no extra rules.
`components.css` still has a few physical rules for things that do not mirror, such as centering with `left: 50%`.
`text-align: right` rules are scoped to `#editor[dir="rtl"]`, because `text-align` has no logical keyword for them.
When you add a rule that depends on side, use the logical property unless you have a reason not to.

**Tooltips use `data-tip`, not `title`.**
Chrome elements do not carry a native `title=`. They show a styled `[data-tip]::after` bubble.
Controls inside `.tabs` are the exception: that container clips vertically, so they share the script-positioned `#floatingTip`.

## Code conventions

**Comment tags.** Comments in the code carry short tags such as `T-F13`, `EC-A2`, or `audit M4`. They point to the requirement or audit finding that explains why the code is written that way. Keep them when you refactor nearby code, and do not copy them into user-facing documentation.

**Tests come with the change.** See [CONTRIBUTING.md](../CONTRIBUTING.md#make-a-change).

## Project structure

```text
.nvmrc                    Pinned Node.js major version
build/
  icons/                  electron-builder icon inputs and SVG source masters
  installer/              Inno Setup and NSIS scripts, policies, and installer artwork
config/                   Coverage thresholds, security-lint baseline, audit acceptance list
docs/
  assets/                 README and guide screenshots
  changelog-archive/      Full changelog text of older versions
resources/
  vendor/                 Offline runtime libraries, fonts, and license manifests
scripts/                  Build, coverage, release, scan, and asset tooling
src/
  main/                   Entry point, IPC, window, app:// and bpmd:// protocols, storage, security policy
  preload/                Minimal context-isolated renderer bridge
  renderer/
    components/           File tree, outline, search, settings, tables, workspace, inspector, margin notes, context menus
    editor/               CodeMirror 6 editor and live-preview extensions
    markdown/             Parse, sanitize, math, highlight, diagram, and export pipeline
    styles/               base, themes, components, and responsive stylesheets
    index.html            Renderer document (markup only)
tests/
  unit/                   Vitest
  e2e/                    Playwright browser, integration, visual, accessibility, and Electron lanes
  fixtures/               Markdown and renderer fixtures
  installer/              Pester and Inno Setup self-tests
  packaged/               Smoke test that starts a packaged Linux build
```
