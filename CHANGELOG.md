# Changelog

All notable changes to **BP MD RTL Reader** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-22

First public release.

### Added

- A local-first Electron Markdown reader and editor for plain `.md` and `.markdown`
  files, with no database, proprietary format, cloud sync, telemetry, or automatic
  update traffic.
- First-class English and Arabic reading and writing, including automatic RTL/LTR
  detection, manual direction control, per-line bidi isolation, Arabic-aware fonts,
  and a bilingual interface.
- A unified CodeMirror 6 live-preview editor: rendered Markdown while typing, raw
  syntax on the active line, per-line direction, and logical caret movement.
- A writing toolbar for headings, emphasis, underline, inline code, highlight,
  subscript, superscript, blockquotes, callouts, lists, links, wiki-links, math,
  footnotes, code blocks, tables, images, and horizontal rules.
- Interactive table row/column controls and keyboard navigation between cells.
- Callouts, KaTeX math, Mermaid diagrams, syntax-highlighted code, task lists,
  footnotes, wiki-links, tags, daily notes, demo notes, and HTML/PDF export.
- File and vault opening with a searchable/collapsible file tree, tabs, tags,
  recent files, session restore, document outline, and properties inspector.
- Command palette, find-in-document, vault search, zoom, and Live Preview, Split,
  Source, and Reading modes.
- Paper, Ink, Sepia, Nord, Solarized, and Midnight themes, each represented by its
  own theme icon and remembered between sessions.
- Windows NSIS multi-architecture, Windows portable multi-architecture, Windows
  Inno x64, macOS x64/arm64 DMG and ZIP, and Linux x64/arm64 AppImage and DEB
  release targets.
- A modern Windows uninstall choice between preserving app data and deleting all
  current-account app data; user-authored Markdown outside app data is never removed.

### Changed

- Save writes atomically back to the original file, preserves encoding, and detects
  conflicts instead of downloading a copy.
- Vault images load from disk through the sandboxed `bpmd://` protocol.
- The outline navigates the editor, places the caret, and follows scrolling.
- All renderer libraries and fonts are bundled locally. The explicit **Check for
  Updates...** action is the only opt-in network request and reads GitHub release
  metadata without downloading or installing anything.
- Heading controls and keyboard shortcuts now apply working H1-H6 formatting.
- The theme control now presents the icon assigned to the active theme.

### Fixed

- Formatting tools no longer stack markers, and block inserts no longer split the
  line currently being edited.
- Rapid file switches no longer leave stale preview or outline content onscreen.
- Images stay within the content width.
- Status-bar labels no longer present a pointer cursor.
- Windows uninstall actions use a stable unclipped **Uninstall** button label.
- Destructive uninstall covers every supported roaming/local profile alias and
  reports incomplete cleanup instead of claiming success.

### Security

- Electron renderer isolation uses `contextIsolation: true`, `nodeIntegration: false`,
  sandboxing, a minimal preload bridge, and a strict Content Security Policy.
- Rendered Markdown is sanitized with DOMPurify; inline styles, iframes, scripts,
  event handlers, and other active content are removed.
- Vault access is allow-listed, size-bounded, rejects network paths and symlink
  escapes, and uses atomic writes.
- Release publication is gated by locked dependencies, vendored-byte and license
  verification, security lint, secret scanning, dependency audit, full unit/browser/
  Electron/visual suites, combined coverage, and full mutation thresholds.
- Windows public executables and installed uninstallers must be signed and timestamped
  by Binary Parse. macOS artifacts must be Developer ID signed, notarized, and stapled.
- The final release directory is constrained to an exact public allowlist, receives a
  canonical `SHA256SUMS.txt`, and is attested by GitHub before publication.

### Distribution

- Release builds are produced only by the staged GitHub Actions release workflow with
  `--publish never` in native packaging jobs. Only the final aggregate job can create
  the GitHub Release.
- Both Windows installer families are exercised on a disposable runner in preserve-data
  and delete-data modes, including program files, shortcuts, associations, ARP entries,
  app-data aliases, signatures, and an external Markdown sentinel.

[1.0.0]: https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases/tag/v1.0.0
