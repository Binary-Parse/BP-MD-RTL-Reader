# Changelog

All notable changes to **BP MD RTL Reader** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Collapsible folder tree** — the sidebar now shows your vault's real folder
  structure with expand/collapse (click, Enter/Space, or ←/→); the collapsed state is
  remembered across sessions.
- **Session restore** — relaunching reopens your last folder and the note you were
  reading.
- **Fuller Arabic interface** — the welcome screen, command palette, and the
  find/search bars are now localized when the Arabic interface is on (joining the
  menus, inspector, and status bar).
- **Experimental unified live-preview editor** (opt-in via `?cm=1`) — a single
  CodeMirror 6 surface with per-line RTL/LTR and logical caret movement; the default
  editor is unchanged.

### Changed
- Rendered notes now pass through the hardened sanitizer — inline `style`, `<iframe>`,
  and event-handler attributes are stripped, so the sanitizer (not just the Content
  Security Policy) is the control. No change to how your Markdown looks.

### Fixed
- Status-bar items no longer show a pointer cursor — they were never clickable.

## [1.0.0] — 2026-05-29

First public release. 🎉

### Highlights
- **Bilingual by design** — first-class English **and** Arabic, with automatic
  right-to-left detection and Arabic-aware typography.
- **Three reading themes** — Paper (light), Ink (dark), and Sepia, remembered
  between sessions.
- **Plain Markdown, no lock-in** — opens and renders standard `.md` / `.markdown`
  files straight from disk.
- **Local-first & private** — no telemetry, no analytics, no auto-update
  phone-home; all logs stay on your machine.

### Features
- Open a single file or a whole folder ("vault") with a searchable file tree,
  tabs, tags pane, and recent-files list.
- Live Preview, Split, and Source view modes; zoom; a document outline and
  properties inspector.
- Command palette (`Ctrl+K`), find-in-document (`Ctrl+F`), wiki-links
  (`[[note]]`), `#tags`, daily notes, demo notes, and HTML export.
- Markdown rendering via [marked](https://marked.js.org/) with
  [DOMPurify](https://github.com/cure53/DOMPurify) sanitisation.

### Security
- Hardened Electron renderer: `contextIsolation` on, `nodeIntegration` off, a
  minimal `contextBridge` preload, and DOMPurify-sanitised output.
- Vault reads are allow-listed, size-bounded, and reject UNC/symlink escapes.

### Packaging
- Windows installers: NSIS (`BP MD RTL Reader Setup 1.0.0.exe`), a portable
  build (`BP MD RTL Reader 1.0.0.exe`), and a standalone Inno Setup installer
  (`BP MD RTL Reader Setup.exe`).
- Optional **.md / .markdown** file association and an "Open with BP MD RTL
  Reader" context-menu verb.

[1.0.0]: https://github.com/Binary-Parse/md-reader-rtl/releases/tag/v1.0.0
