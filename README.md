<div align="center">

<img src="docs/assets/icon.png" width="128" height="128" alt="BP MD RTL Reader icon">

# BP MD RTL Reader

A Markdown reader and editor for Windows, macOS, and Linux with first-class support for
English and Arabic (right-to-left). It opens plain `.md` files from disk. No proprietary
format, no telemetry.

[![Version](https://img.shields.io/badge/version-1.0.0-3ddc4a)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/desktop-Windows%20%7C%20macOS%20%7C%20Linux-47848F)](#download)
[![License](https://img.shields.io/badge/license-MIT-3ddc4a)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Checks](https://img.shields.io/badge/checks-CI%20gated-brightgreen)](docs/BUILD.md#testing)

<img src="docs/assets/theme-paper.png" width="820" alt="BP MD RTL Reader reading view">

</div>

---

## Overview

BP MD RTL Reader opens a single Markdown file or a folder of `.md` files and renders it for
reading and editing. It supports both left-to-right (English) and right-to-left (Arabic)
text, with automatic direction detection and manual override. Files are read from and
written to disk in place; there is no database, account, or cloud sync.

- **Bilingual layout.** The app detects Arabic-heavy documents and switches to a
  right-to-left layout with Arabic-aware typography. Direction can also be set manually or
  fixed per document.
- **Themes.** Three reading themes — Paper, Ink, and Sepia. The selection is remembered
  between sessions.
- **Plain Markdown.** Opens a single file or a whole folder of `.md` files. No database
  and no proprietary format.
- **Local-first.** No telemetry, analytics, account, or automatic update check. Document
  content stays on the local machine.
- **Sandboxed rendering.** The renderer runs with context isolation and Node integration
  disabled, and rendered HTML is sanitized with DOMPurify.

---

## Screenshots

|  Paper (light)  |  Ink (dark)  |  Sepia  |
| :-------------: | :----------: | :-----: |
| <img src="docs/assets/theme-paper.png" alt="Paper theme"> | <img src="docs/assets/theme-ink.png" alt="Ink theme"> | <img src="docs/assets/theme-sepia.png" alt="Sepia theme"> |

|  Arabic / RTL  |  Live-preview editor  |  Command palette  |
| :------------: | :-------------------: | :---------------: |
| <img src="docs/assets/rtl-arabic.png" alt="Right-to-left Arabic rendering"> | <img src="docs/assets/editor.png" alt="Live-preview editor: formatting toolbar, rendered note, and table controls"> | <img src="docs/assets/command-palette.png" alt="Command palette"> |

---

## Download

Builds are published on the [Releases](https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases)
page. Each release provides the following platform choices:

| Platform | Files | Notes |
| -------- | ----- | ----- |
| **Windows 10/11** | `BP-MD-RTL-Reader-1.0.0-Windows-NSIS-multiarch.exe`, `BP-MD-RTL-Reader-1.0.0-Windows-Inno-x64.exe` | Signed installers; NSIS covers x64, 32-bit, and ARM64, Inno is x64 |
| **Windows portable** | `BP-MD-RTL-Reader-1.0.0-Windows-Portable-multiarch.exe` | Signed; no installation required |
| **macOS** | x64 and arm64 `.dmg` or `.zip` | Both architectures are signed and notarized by Apple |
| **Linux** | x64 and arm64 `.AppImage` or `.deb` | Package and architecture per distribution |

Each release also includes `SHA256SUMS.txt`, a source-manifest JSON for the Inno payload,
and GitHub artifact attestations. Verify the checksum before running a downloaded file; the
exact file list and commands are documented in [docs/BUILD.md](docs/BUILD.md).

---

## Quick start

1. Install and launch the app; it opens to a welcome screen.
2. Open a file with `Ctrl+O`, or open a folder of notes with `Ctrl+Shift+O`. To load a
   bilingual sample set, select **Try Demo Notes**.
3. Switch themes with the ◐ button (or `Ctrl+Shift+D`), flip direction with ⇄
   (`Ctrl+Shift+L`), and press `Ctrl+K` for the command palette.

The **[User Guide](docs/USER_GUIDE.md)** documents every feature — folders, tabs, search,
tags, wiki-links, the writing toolbar, the inspector, and export.

---

## Features

| | |
| --- | --- |
| **Editor** | A single CodeMirror 6 live-preview surface — text renders as you type, and the line with the caret shows raw Markdown; zoom (60–200%); document outline and properties inspector |
| **Writing** | Formatting toolbar that toggles Bold/Italic/Strike/Code, H1–H6, lists, quote, and callout; interactive tables (add/remove rows and columns, `Tab` between cells); links, images, footnotes; highlight, sub/superscript, clear-formatting, indent/outdent; active-state buttons and shortcuts (`Ctrl+B`/`I`, `Ctrl+1`–`6`) |
| **Bilingual** | Automatic Arabic RTL detection; manual direction flip; per-line direction and bidi isolation; Arabic-aware fonts and alignment |
| **Library** | Open a file or a folder; tabbed editing; file tree; folder-wide search; `#tags`; recent files |
| **Linking** | `[[wiki-links]]` with `[[target\|alias]]` aliases; click to jump |
| **Markdown** | Headings, lists and task lists, tables, blockquotes, callouts, footnotes, code blocks with syntax highlighting, KaTeX math, Mermaid diagrams, `==highlight==`, `<u>`, and sub/superscript — rendered with [marked](https://marked.js.org/), [DOMPurify](https://github.com/cure53/DOMPurify), [KaTeX](https://katex.org/), [highlight.js](https://highlightjs.org/), and [Mermaid](https://mermaid.js.org/), all bundled locally (no network) |
| **Productivity** | Command palette (`Ctrl+K`); find-in-document (`Ctrl+F`); daily notes; PDF and HTML export; drag-and-drop |
| **Interface** | Three themes remembered across sessions; frameless window; keyboard-first navigation |

See the full **[Keyboard Shortcuts](docs/KEYBOARD_SHORTCUTS.md)** reference (or press
`Ctrl+/` in the app).

---

## Privacy & security

BP MD RTL Reader is local-first. It performs no telemetry, analytics, crash upload, or
automatic update check.

- Notes remain wherever the plain Markdown files are saved. App settings, recent-path
  history, local logs, and filesystem grants are stored in the app profile under
  `%APPDATA%\BP MD RTL Reader` on Windows.
- The renderer runs with `contextIsolation` on and `nodeIntegration` off behind a minimal
  preload bridge; rendered HTML is sanitized by DOMPurify.
- The renderer makes no outbound network requests. The Markdown engine, sanitizer,
  math/highlight/diagram libraries, and fonts are bundled locally and loaded under a strict
  Content-Security-Policy (`connect-src 'self'`).
- The only app-level network request is the **Help → Check for Updates…** command, which
  reads GitHub's public release metadata. It never runs automatically and sends no document
  content.

Full details are in **[docs/PRIVACY.md](docs/PRIVACY.md)**.

---

## Build from source

```bash
git clone https://github.com/Binary-Parse/BP-MD-RTL-Reader.git
cd BP-MD-RTL-Reader
npm install      # postinstall fetches the Playwright Chromium used by the e2e tests
npm start        # launch the app in development
npm run dist     # build the Windows installers into dist/
```

Building the installers, regenerating the icon, and the full test/CI workflow are
documented in **[docs/BUILD.md](docs/BUILD.md)**.

---

## Quality

The project includes:

- **Vitest** unit coverage gated at 95% statements/lines/functions and 90% branches
- **Playwright** browser, accessibility, visual-regression, and production-Electron lanes
- **Combined unit and renderer coverage** from one commit (`npm run coverage`)
- **Mutation testing** with an 80% overall floor and per-file T1/T2/T3 floors of
  85%/75%/60%
- **Installer logic** verified by Pester, plus signed install/uninstall tests on disposable
  Windows runners for both preserve-data and delete-data choices
- **CI** for lint/SAST, full-history secret scan, `npm audit`, tests, coverage, mutation,
  native-platform packages, payload inspection, signing/notarization, artifact
  allowlisting, checksums, and attestations

---

## License

Released under the [MIT License](LICENSE). Copyright 2026 Binary Parse.

Third-party components (Electron, marked, DOMPurify, fonts) and their licenses are listed
in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
