<div align="center">

<img src="docs/assets/icon.png" width="128" height="128" alt="BP MD RTL Reader icon">

# BP MD RTL Reader

**A Markdown reader that treats prose like a literary object.**

Bilingual to its core — first-class English **and** Arabic.
Plain `.md` files on disk. No proprietary format. No telemetry.

[![Version](https://img.shields.io/badge/version-1.0.0-3ddc4a)](CHANGELOG.md)
[![Platform](https://img.shields.io/badge/desktop-Windows%20%7C%20macOS%20%7C%20Linux-47848F)](#-download)
[![License](https://img.shields.io/badge/license-MIT-3ddc4a)](LICENSE)
[![Built with Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Checks](https://img.shields.io/badge/checks-CI%20gated-brightgreen)](docs/BUILD.md#testing)

<img src="docs/assets/theme-paper.png" width="820" alt="BP MD RTL Reader — reading view">

</div>

---

## Why BP MD RTL Reader?

Most Markdown apps are built for writing code or shipping notes to a cloud. **BP MD
RTL Reader** is built for *reading* — calmly, in either direction of script, from
plain files that stay on your machine.

- 🅰️ **Truly bilingual.** Arabic isn't an afterthought. The app detects Arabic-heavy
  documents and flips to a proper right-to-left layout with Arabic-aware typography —
  and you can flip direction yourself any time.
- 🎨 **Three calm themes.** Paper, Ink, and Sepia — chosen to make long reading easy
  on the eyes. Your choice is remembered.
- 📄 **Just Markdown.** Open a single file or a whole folder of `.md` files. No
  database, no proprietary format, no lock-in.
- 🔒 **Local-first & private.** No telemetry, no analytics, no account, no
  auto-update phone-home. Your words never leave your computer.
- 🛡️ **Hardened by design.** A sandboxed renderer and DOMPurify-sanitised output mean
  opening an untrusted `.md` file is safe.

---

## 📸 Screenshots

|  Paper (light)  |  Ink (dark)  |  Sepia  |
| :-------------: | :----------: | :-----: |
| <img src="docs/assets/theme-paper.png" alt="Paper theme"> | <img src="docs/assets/theme-ink.png" alt="Ink theme"> | <img src="docs/assets/theme-sepia.png" alt="Sepia theme"> |

|  Arabic / RTL  |  Live-preview editor  |  Command palette  |
| :------------: | :-------------------: | :---------------: |
| <img src="docs/assets/rtl-arabic.png" alt="Right-to-left Arabic rendering"> | <img src="docs/assets/editor.png" alt="Live-preview editor: formatting toolbar, rendered note, and table controls"> | <img src="docs/assets/command-palette.png" alt="Command palette"> |

---

## ⬇️ Download

Grab the latest build from the [**Releases**](https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases) page. Each release publishes the following platform choices:

| Platform | Files | Notes |
| -------- | ----- | ----- |
| **Windows 10/11** | `BP-MD-RTL-Reader-1.0.0-Windows-NSIS-multiarch.exe`, `BP-MD-RTL-Reader-1.0.0-Windows-Inno-x64.exe` | Signed installers; NSIS selects x64, 32-bit, or ARM64, while Inno is x64 |
| **Windows portable** | `BP-MD-RTL-Reader-1.0.0-Windows-Portable-multiarch.exe` | Signed, no installation required |
| **macOS** | x64 and arm64 `.dmg` or `.zip` | Both architectures are signed and notarized by Apple |
| **Linux** | x64 and arm64 `.AppImage` or `.deb` | Pick the package and architecture for your distribution |

The release also includes `SHA256SUMS.txt`, a source-manifest JSON for the Inno payload,
and GitHub artifact attestations. Verify the checksum before running a downloaded file;
the exact file list and commands are documented in [docs/BUILD.md](docs/BUILD.md).

---

## 🚀 Quick start

1. **Install** and launch — you'll land on a calm welcome screen.
2. **Open a file** with `Ctrl+O`, or **open a folder** of notes with `Ctrl+Shift+O`.
   No files handy? Click **Try Demo Notes** to load a bilingual sample set.
3. **Read.** Switch themes with the ◐ button (or `Ctrl+Shift+D`), flip direction with
   ⇄ (`Ctrl+Shift+L`), and press `Ctrl+K` for the command palette.

New to the app? The **[User Guide](docs/USER_GUIDE.md)** walks through every feature —
vaults, tabs, search, tags, wiki-links, the writing toolbar, the inspector, and export.

---

## ✨ Features at a glance

| | |
| --- | --- |
| **Editor** | A single CodeMirror 6 **live-preview** surface — text renders as you type; the line with the caret shows raw Markdown · zoom (60–200%) · document outline & properties inspector |
| **Writing** | Formatting toolbar that **toggles** (Bold/Italic/Strike/Code, H1–H6, lists, quote, callout) · interactive **tables** (add/remove rows & columns, `Tab` between cells) · links, images, footnotes · highlight, sub/superscript, clear-formatting, indent/outdent · active-state buttons + shortcuts (`Ctrl+B/I`, `Ctrl+1–6`) |
| **Bilingual** | Automatic Arabic RTL detection · manual direction flip · per-line direction & bidi isolation · Arabic-aware fonts & alignment |
| **Library** | Open file or folder ("vault") · tabbed editing · file tree · cross-vault search · `#tags` · recent files |
| **Linking** | `[[wiki-links]]` with `[[target\|alias]]` aliases · click to jump |
| **Markdown** | Headings, lists & task lists, tables, blockquotes, **callouts**, **footnotes**, code blocks with **syntax highlighting**, **KaTeX math**, **Mermaid diagrams**, ==highlight==, `<u>`, sub/superscript — rendered with [marked](https://marked.js.org/) + [DOMPurify](https://github.com/cure53/DOMPurify), [KaTeX](https://katex.org/), [highlight.js](https://highlightjs.org/) & [Mermaid](https://mermaid.js.org/), all **bundled (0-network)** |
| **Productivity** | Command palette (`Ctrl+K`) · find-in-document (`Ctrl+F`) · daily notes · **PDF & HTML export** · drag-and-drop |
| **Comfort** | Three themes remembered across sessions · custom frameless window · keyboard-first |

See the full **[Keyboard Shortcuts](docs/KEYBOARD_SHORTCUTS.md)** reference (or press `Ctrl+/` in the app).

---

## 🔒 Privacy & security

BP MD RTL Reader is **local-first**. There is **no telemetry, no analytics, no crash
upload, and no auto-update phone-home** — verifiable in the source.

- Your notes stay wherever you saved the plain Markdown files. App settings, recent-path
  history, local logs, and filesystem grants live in the app profile under
  `%APPDATA%\BP MD RTL Reader` on Windows.
- The renderer runs with `contextIsolation` on and `nodeIntegration` off, behind a
  minimal preload bridge; rendered HTML is sanitised by DOMPurify.
- The renderer makes **no outbound network requests** at any time — the Markdown engine,
  sanitiser, math/highlight/diagram libraries, and fonts are all bundled locally and
  loaded under a strict CSP (`connect-src 'self'`).
- The sole app-level network exception is the explicit **Help → Check for Updates…**
  command, which requests GitHub's public release metadata; it never runs automatically
  and sends no note content.

Full details: **[docs/PRIVACY.md](docs/PRIVACY.md)**.

---

## 🛠️ Build from source

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

## 🧪 Quality

This is a small app with a deliberately large safety net:

- **Vitest** unit coverage gated at 95% statements/lines/functions and 90% branches
- **Playwright** browser, accessibility, visual-regression, and production-Electron lanes
- **Combined unit + renderer coverage** from one current commit (`npm run coverage`)
- **Mutation testing** with an 80% overall floor and per-file T1/T2/T3 floors of
  85%/75%/60%
- **Installer logic** verified by Pester, plus signed install/uninstall tests on disposable
  Windows release runners for both preserve-data and delete-data choices
- **CI** for lint/SAST, full-history secret scan, `npm audit`, tests, coverage, mutation,
  native-platform packages, payload inspection, signing/notarization, exact artifact
  allowlisting, checksums, and attestations

---

## 📄 License

Released under the [MIT License](LICENSE) © 2026 **Binary Parse**.

Third-party components (Electron, marked, DOMPurify, fonts) and their licenses are
listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) — all permissive and
MIT-compatible.

<div align="center"><sub>Made with care for readers of every direction.</sub></div>
