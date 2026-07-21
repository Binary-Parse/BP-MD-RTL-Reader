# Changelog

All notable changes to **BP MD RTL Reader** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Unified live-preview editor** — a single CodeMirror 6 surface is now *the* editor:
  text renders as you type, and only the line with the caret shows raw Markdown.
  Per-line RTL/LTR with logical caret movement.
- **Writing toolbar** — Bold, Italic, Strikethrough, Underline, Inline code, Highlight
  (`==`), Subscript (`~x~`), Superscript (`^x^`), Clear-formatting; Headings H1–H6
  (dropdown + `Ctrl+1`–`6`); Blockquote, Callout, Bulleted/Numbered/Task lists, Indent/
  Outdent; Link, Wiki-link, Math, Footnote; Code block, Table, Image, Horizontal rule.
  Tools **toggle** (re-applying removes the style; heading/list type *replaces*), expand
  to the word when nothing is selected, and **highlight when the cursor is inside** them.
- **Interactive tables** — a row/column controls bar (**+/− Row**, **+/− Col**) appears
  when the cursor is inside a table; `Tab` / `Shift+Tab` move between cells (and add a
  row past the end).
- **Footnotes** — `[^1]` references render as a numbered list at the end of the note,
  each with a back-link.
- **More Markdown** — callouts (`> [!NOTE]`), KaTeX math, Mermaid diagrams, syntax-
  highlighted code, task lists, and `==highlight==` / `<u>` / sub & superscript.
- **PDF export** — render the current note to a PDF (offline, isolated renderer).
- **Collapsible folder tree**, **last-vault/active-note session restore**, and a
  **fuller Arabic interface**
  (welcome, palette, and find/search bars localized alongside the menus and status bar).

### Changed
- **Save writes back to the original file** atomically (encoding-preserving, conflict-
  aware) instead of downloading a copy.
- **Vault images** (`![](pic.png)`) now load from disk via a sandboxed `bpmd://` scheme.
- The outline **navigates the editor** (scrolls + places the caret) and tracks scroll.
- All third-party rendering assets (CodeMirror, marked, DOMPurify, KaTeX, highlight.js,
  Mermaid, fonts) are **bundled**; rendering makes no network request under the strict
  renderer CSP. The explicit **Check for Updates…** action is the sole opt-in main-process
  request and reads GitHub public release metadata without downloading an update.
- Images are constrained to the content width (no horizontal overflow).
- Rendered notes pass through the hardened sanitizer — inline `style`, `<iframe>`, and
  event-handler attributes are stripped (the sanitizer, not just CSP, is the control).

### Fixed
- Formatting tools no longer stack markers (`### ## …`, `****…****`) and block inserts
  (table/callout/code/rule) no longer split the line you're typing on.
- After quickly switching files, the preview/outline no longer briefly shows the
  previous file's content.
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
- Windows installers: NSIS (`BP MD RTL Reader Setup 1.0.0.exe`) and a portable
  build (`BP MD RTL Reader 1.0.0.exe`) are produced by the automated build. A
  standalone Inno Setup installer (`BP MD RTL Reader Setup.exe`) can also be built
  locally (see `docs/BUILD.md`); it is not part of the automated release.
- Optional **.md / .markdown** file association and an "Open with BP MD RTL
  Reader" context-menu verb.

[1.0.0]: https://github.com/Binary-Parse/md-reader-rtl/releases/tag/v1.0.0
