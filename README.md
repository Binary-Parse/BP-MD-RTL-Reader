<div align="center">

<img src="docs/assets/icon.png" width="128" height="128" alt="BP MD RTL Reader application icon">

# BP MD RTL Reader

**A local-first Markdown editor and reader for Windows and Linux, with
first-class right-to-left support for Arabic.**

Opens plain `.md` files from disk. No proprietary format, no account, no telemetry.

[![Version](https://img.shields.io/badge/version-2.0.0-3ddc4a)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/desktop-Windows%20%7C%20Linux-47848F)](#download)
[![License](https://img.shields.io/badge/license-MIT-3ddc4a)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Checks](https://img.shields.io/badge/checks-local%20test%20gates-brightgreen)](docs/BUILD.md#testing)

<img src="docs/assets/theme-paper.png" width="820" alt="BP MD RTL Reader in reading mode: file tree, rendered Markdown with serif typography, and the document inspector">

</div>

---

## Overview

BP MD RTL Reader is a desktop Markdown application built on Electron. It opens a single
file or several folders of `.md` notes, renders them for reading, and edits them in a
live-preview editor. Files are read from and written to disk in place — there is no
database, no sync service, and no proprietary container.

Its distinguishing concern is **bidirectional text**. Most Markdown editors treat
right-to-left languages as an afterthought: a global "RTL mode" that flips the entire
interface, or nothing at all. This one detects direction **per block**, so a document that
mixes Arabic prose with English code samples renders each paragraph in its own correct
direction, with proper bidi isolation, Arabic-aware typography, and mirrored layout for
quotes, lists, and tables.

**What it does**

- **Bidirectional by design.** Automatic per-block direction detection, manual override
  per document, Unicode bidi isolation, and Arabic-aware fonts and justification.
- **Several folders at once.** Open more than one folder; each becomes a named root in the
  file tree and can be closed independently, without disturbing the others.
- **Reading and editing.** A reading view with a tuned type scale, and a CodeMirror 6
  live-preview editor where the line under the caret shows raw Markdown. The app
  remembers where you stopped in each note, highlights and margin notes persist with
  your library (beside the text in a wide window), and a quiet reading-streak line tracks daily minutes against an
  optional goal.
- **Fully offline.** The Markdown engine, sanitizer, math and diagram renderers, syntax
  highlighting, and every font are bundled locally. The renderer makes no network requests.
- **Hardened rendering.** Context isolation on, Node integration off, a minimal preload
  bridge, DOMPurify sanitization, and a strict Content-Security-Policy.

---

## Screenshots

|  Paper (light)  |  Ink (dark)  |  Sepia  |
| :-------------: | :----------: | :-----: |
| <img src="docs/assets/theme-paper.png" alt="Paper light theme showing rendered Markdown"> | <img src="docs/assets/theme-ink.png" alt="Ink dark theme showing rendered Markdown"> | <img src="docs/assets/theme-sepia.png" alt="Sepia theme showing rendered Markdown"> |

|  Arabic / right-to-left  |  Live-preview editor  |  Command palette  |
| :----------------------: | :-------------------: | :---------------: |
| <img src="docs/assets/rtl-arabic.png" alt="Arabic document rendered right-to-left with mirrored blockquote and RTL document outline"> | <img src="docs/assets/editor.png" alt="CodeMirror live-preview editor with formatting toolbar and raw Markdown on the caret line"> | <img src="docs/assets/command-palette.png" alt="Command palette listing file and view commands with keyboard shortcuts"> |

---

## Features

| | |
| --- | --- |
| **Bidirectional text** | Per-block Arabic/RTL detection; manual direction flip; Unicode bidi isolation that keeps numbers, dates, links, and inline code in true left-to-right order inside Arabic prose; Arabic-aware fonts, alignment, and optional kashida justification; mirrored quotes, lists, and tables |
| **Workspace** | Open several folders at once, each a named root in the tree; per-folder close; tabbed editing; folder-wide search; `#tags`; recent files; session restore |
| **Editor** | A single CodeMirror 6 live-preview surface — text renders as you type while the caret line shows raw Markdown; adjustable reading width and text size; app zoom 60–200% |
| **Writing** | Toolbar for Bold/Italic/Strikethrough/Code, H1–H6, lists, quotes, and callouts; interactive tables (add and remove rows and columns, `Tab` between cells); links, images, footnotes; highlight, sub/superscript, indent/outdent; shortcuts (`Ctrl+B`/`I`, `Ctrl+1`–`6`) |
| **Markdown** | Headings, lists and task lists, tables, blockquotes, callouts, footnotes, fenced code with syntax highlighting, KaTeX math, Mermaid diagrams, `==highlight==`, `<u>`, and sub/superscript — via [marked](https://marked.js.org/), [DOMPurify](https://github.com/cure53/DOMPurify), [KaTeX](https://katex.org/), [highlight.js](https://highlightjs.org/), and [Mermaid](https://mermaid.js.org/), all bundled locally |
| **Faithful saves** | Opens UTF-8, UTF-16 (with or without a byte-order mark), and legacy Windows-1256 (Arabic) files; every save preserves the file's own encoding, BOM, line endings (line by line when a file mixes them), and final-newline style. When the encoding of a file is only a guess, the app says so and does not save the file until you have confirmed or changed it. A character the file's legacy code page cannot carry is never corrupted — Save offers a one-click upgrade of that file to UTF-8 instead |
| **Linking** | `[[wiki-links]]` with `[[target\|alias]]` aliases; click to jump; document outline |
| **Productivity** | Command palette (`Ctrl+K`); find-in-document (`Ctrl+F`); daily notes; PDF, HTML, and EPUB export (HTML and PDF ask before they include your own highlights and notes; EPUB never includes them); drag-and-drop |
| **Reading** | Per-note reading positions with a **Continue reading** shelf on the welcome card; highlights and margin notes saved alongside your library (Inspector **Notes** section, and foldable cards in the margin beside the page); a quiet daily-reading streak with an optional goal (10/20/30 min) and a 12-week reading heat-grid; a reading-progress line and zoom button in the status bar; Highlight / Add Note / Search library in the right-click menu |
| **Interface** | Four themes (Paper, Ink, Sepia, Oasis) remembered across sessions; follows the system colour scheme on first run; a fully Arabic interface option; frameless two-row title bar with a tab row; Read/Edit and Auto/RTL/LTR switches; optional auto-hiding chrome; keyboard-first navigation |

Full **[Keyboard Shortcuts](docs/KEYBOARD_SHORTCUTS.md)** reference, or press `Ctrl+/` in
the app. Every feature is documented in the **[User Guide](docs/USER_GUIDE.md)**.

---

## Download

Builds are published on the
[Releases](https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases) page.

| Platform | Files | Notes |
| -------- | ----- | ----- |
| **Windows 10/11** (x64, ARM64) | `…-Windows-NSIS-multiarch.exe`, `…-Windows-Inno-x64.exe` | The NSIS installer holds the x64 and the ARM64 build; the Inno installer is x64 only. 32-bit Windows is not built |
| **Windows portable** (x64, ARM64) | `…-Windows-Portable-multiarch.exe` | No installation |
| **Linux** (x64, ARM64) | `…-Linux-x86_64.AppImage`, `…-Linux-amd64.deb`, `…-Linux-arm64.AppImage`, `…-Linux-arm64.deb` | The x64 files were started and tested on Ubuntu under WSL 2. The ARM64 files are built but have not been run |
| **macOS** | — | Not built and not tested |

**The files are not code-signed.** Windows shows "Windows protected your PC" (SmartScreen)
for an unsigned installer: choose **More info → Run anyway** after you have checked the
file. Every release ships `SHA256SUMS.txt`; check the download against it before you run it:

```powershell
(Get-FileHash .\BP-MD-RTL-Reader-2.0.0-Windows-NSIS-multiarch.exe -Algorithm SHA256).Hash
```

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
```

The value must equal the line for that file in `SHA256SUMS.txt`. The checksum proves the
file is the one that was published; it does not replace a signature. Releases are built by
hand as described in [docs/BUILD.md](docs/BUILD.md); GitHub Actions is not used, so there
is no automated build-provenance attestation.

---

## Quick start

1. Install and launch the app; it opens to a welcome screen.
2. Open a file with `Ctrl+O`, or a folder of notes with `Ctrl+Shift+O`. Open a second
   folder the same way — it is added alongside the first, not in place of it. To load a
   bilingual sample set, choose **Try Demo Notes**.
3. Switch themes with `Ctrl+Shift+D`, flip text direction with `Ctrl+Shift+L`, toggle
   reading and editing with `Ctrl+E`, and press `Ctrl+K` for the command palette.

---

## Privacy and security

The app is local-first. It performs no telemetry, no analytics, and no crash upload, and
it never contacts the network unless you ask it to — update checks are manual
(**Help → Check for Updates…**) by default, with an opt-in daily automatic check in
Settings that only notifies you and never downloads anything.

- Notes stay wherever the plain Markdown files live. Settings, recent paths, reading
  positions, highlights and margin notes, reading stats, local logs, and filesystem
  grants are kept in the app profile — `%APPDATA%\bpmdrtlreader` on Windows,
  `~/.config/bpmdrtlreader` on Linux.
- The renderer runs with `contextIsolation` enabled and `nodeIntegration` disabled behind
  a minimal preload bridge. Rendered HTML is sanitized with DOMPurify under Trusted Types.
  Packaged builds serve the interface over `app://` rather than `file://` inside the asar.
- The renderer issues no outbound requests. Markdown parsing, sanitization, maths,
  highlighting, diagrams, and fonts are all bundled and loaded under a strict
  Content-Security-Policy (`connect-src 'self'`).
- Folder access is capability-based: absolute paths never cross the preload boundary. The
  main process grants opaque identifiers and enforces containment, size caps, and symlink
  escape checks.
- The only app-level network requests are update checks, which read GitHub's public
  release metadata (`api.github.com`) and send no note content: **Help → Check for
  Updates…** whenever you choose, plus an optional daily automatic check (Settings ▸
  Updates, off by default) that only shows a notice — it never downloads or installs.

Details in **[docs/PRIVACY.md](docs/PRIVACY.md)**.

---

## Build from source

Requires Node.js 24 or newer.

```bash
git clone https://github.com/Binary-Parse/BP-MD-RTL-Reader.git
cd BP-MD-RTL-Reader
npm install      # also downloads the Electron binary and the Chromium used by the e2e tests
npm start        # launch the app in development
npm run dist     # build the Windows installers into dist/
```

`npm install` needs the network: besides the packages it downloads the Electron binary for
your platform (more than 100 MB) and a Chromium for the browser tests (about 150 MB; set
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to leave it out). `npm start` downloads nothing.

Packaging, icon regeneration and the release steps are documented in
**[docs/BUILD.md](docs/BUILD.md)**.

---

## Project structure

```text
build/                 Packaging inputs: icons, entitlements, NSIS, and Inno Setup
resources/vendor/      Offline runtime libraries, fonts, and licence manifests
src/main/              Electron entry point, privileged IPC, storage, window lifecycle
src/preload/           Minimal context-isolated renderer bridge
src/renderer/          Interface, editor, Markdown pipeline, and styles
tests/unit/            Vitest unit suite
tests/e2e/             Playwright browser, integration, visual, a11y, and Electron lanes
tests/installer/       Pester and Inno Setup installer tests
docs/                  Build, usage, keyboard, and privacy documentation
scripts/               Build, verification, coverage, release, and asset tooling
```

---

## Roadmap

The current version is **2.0.0**: the Marginalia interface plus the fixes listed in the
[changelog](CHANGELOG.md). Releasing it (build, checksums, tag, GitHub release) is a manual step —
see [docs/BUILD.md](docs/BUILD.md).

## Contributing

Bug reports and pull requests are welcome. **[CONTRIBUTING.md](CONTRIBUTING.md)** covers
the development setup, the two Playwright test lanes, the coverage and mutation gates a
change has to pass, and the architectural conventions worth knowing before editing the
renderer. Participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

Security issues should be reported privately — see [SECURITY.md](SECURITY.md).

---

## License

Released under the [MIT License](LICENSE). Copyright 2026 Binary Parse.

Third-party components and their licences are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
