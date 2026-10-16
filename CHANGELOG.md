# Changelog

All notable changes to BP MD RTL Reader are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is the condensed version. The unabridged text of every release up to 2.1.0 is in [docs/changelog-archive/CHANGELOG-full-to-2.1.0.md](docs/changelog-archive/CHANGELOG-full-to-2.1.0.md).

## [Unreleased]

## [2.1.0] - 2026-10-16

2.1.0 opens notes up to 100 MB, adds a direction switch per block, and fixes a large Windows-1256 note that could not be saved, the Windows setup that offered to repair an app that was not installed, and a KaTeX advisory. Dependencies are on their current stable patches.

### Added

- Notes up to 100 MB now open (the limit was 10 MB). Notes of 5 to 20 MB open with a notice, notes of 20 to 100 MB ask first, and larger notes are refused with a message that names the limit.
- Large-file mode (20 to 100 MB) turns off live-preview styling, syntax coloring, find highlights and the outline, and Reading mode offers a **Render anyway** button.
- Large notes opened with "Open with" or from the command line now open, ask or say why they were not opened, instead of being dropped.
- Folders now read notes of up to 20 MB each and 100 MB in all; a larger note is listed as skipped and opens with **Open File**.
- The check that stops a save from overwriting changes made elsewhere now covers notes of any size, and crash recovery now keeps large notes, mirrored at most every 30 seconds.
- Export limits are now named in the message: HTML up to 256 MB, PDF and EPUB up to 64 MB. A PDF gets 30 seconds plus 10 seconds per MB, and says when it ran out of time.
- Direction per block: in Reading mode, a badge beside each paragraph, heading, list, table or callout sets it to right to left, left to right or auto.
- The portable Windows build keeps its data in a `BP-MD-RTL-Reader-data` folder beside the `.exe`, copying your existing settings there on its first start.
- A pinned block direction is saved with the note as a hidden comment and reaches exports; `Ctrl+D` flips the block under the caret, and **Reset all block directions to auto** in the command palette removes every pin.

### Changed

- A note's size class now follows the note: saving or reloading it across 5 or 20 MB moves it into the new class at once, and saving is limited by size in the note's own encoding.
- Reading mode now says a large note will take a while before it is drawn, and exporting a note over 5 MB says the export may take a while.
- **Load Demo** now adds the demo notes beside your open folders instead of closing them.
- Electron is now 44.7.2, and highlight.js, CodeMirror and Lezer highlight are on their latest patch or minor releases.
- Maintenance: other development tools were updated; the Stryker mutation run, the unused `build:cm` script, the finished `rem-convert` script and the release preflight's publish checks were removed; the packaged Linux smoke test was fixed.

### Removed

- The hidden plain-text editor that stood in when the editor engine failed to load, and the unused `editorMode` setting. If the engine fails, notes still open and read normally, and an edit says the editor could not load.

### Fixed

- Two spellings of one file name (a precomposed `é`, or `e` with a combining accent) that lead to the same file now share one grant, and two real files are never merged.
- The Windows setups (NSIS and Inno) no longer offer to repair an app that is not installed; setup now installs fresh unless the program file is in the recorded folder.
- A large Arabic note stored in Windows-1256 saves again; the size limit is now counted in the note's own encoding, so any note that opens can be saved unchanged.
- Typing in a line of millions of characters, a very large note after each pause in typing, and a note with a very long line or deeply nested tags no longer freeze or slow the window.
- Selected text, the caret and find matches are now visible in Edit mode in every theme, including Ink and Oasis.
- Reading mode is read-only again: formatting shortcuts and the Edit menu no longer change the note behind it, and a message says to press Ctrl+E.
- Typing in Find in Edit mode no longer types into the note, and Next no longer jumps to positions from an older search.
- "Reload from disk" keeps your edits when the disk copy cannot be read, a failed save after the UTF-8 upgrade keeps the original encoding, and saving a reopened note no longer overwrites a disk copy that is too large or unreadable.
- Closing a folder, Close All, Close Others and closing a tab in the background now ask about the right notes, stop at Cancel and no longer switch to or reopen other tabs.
- Several editing commands were corrected: Tab in a code block, Footnote with a selection, triple-click with heading, quote and list, and Clear formatting on `~5 min` and `2 * 3`.
- Text between a leading `---` rule and a later `---` is no longer hidden as front matter, code blocks, `#123` and `#fff` no longer show up as tags, and a note can no longer press the app's own buttons through a `<label>`.
- With two headings of the same text the outline jumps to the right one, and links to headings work in exported HTML, PDF and EPUB.
- Save As now keeps the note's highlights and reading position, a second dropped file with the same name opens in its own tab, and a dialog closed with Escape can no longer close a later dialog.
- The Arabic interface is now Arabic in the first-run sidebar, Tags pane, search fields, About dialog, file dialogs, new note names and messages, and the shortcuts sheet lists Ctrl+1 to 6, F11 and Ctrl+Shift+Z.
- Arabic interface layout was corrected: icons point the right way, tooltips stay on screen, a Latin file name keeps its own order, and Persian, Urdu and Hebrew notes are no longer tagged as Arabic.
- Hovered wiki-links, list bullets and quote bars, folder counts and outline numbers are readable in every theme, and Windows High Contrast keeps focus rings, highlights and switches visible.
- A damaged `reading-stats.json` is kept as `.corrupt-<timestamp>`, a damaged zoom value falls back to 100 %, and a settings folder that cannot be written now reports the cause.
- Opening a file from Explorer no longer quits the app when the grants file cannot be written, and failed opens, Save As and exports now say so and leave their cause in the local log.

### Security

- Every message from the page to the main process is now checked to come from the app's own top frame, and a packaged build refuses to start with `--remote-debugging-port`, `--remote-debugging-pipe` or `--inspect`.
- The page no longer receives the IPC event emitter.
- A save is refused unless its line ending is LF or CRLF, and the same folder or note opened with different letter case on Windows now keeps one grant.
- Mermaid is now 12.1.0, built from source with the app's own DOMPurify (3.4.16) and KaTeX, which removes the KaTeX advisory GHSA-238p-pmpm-9mq7 and the older DOMPurify 3.4.0 in Mermaid's prebuilt file.
- KaTeX is now 0.18.11, patched for GHSA-238p-pmpm-9mq7; math in notes and the Mermaid bundle share one copy.

## [2.0.0] - 2026-10-12

2.0.0 is the first release of the Marginalia interface that went through a full audit: the known issues of 1.3.0 are fixed, and so are all Blocker and High defects of the pre-release audit and most of the Medium ones. It is also the first release with Linux packages.

### Added

- Linux packages (AppImage and deb); x64 was tested, ARM64 was built but not run.
- Margin notes now fold into small markers level with their passages, and the choice is remembered; a narrow margin shows the markers instead of hiding the notes.
- A new app icon and Markdown file icon: a reed pen drawing a coral kashida.

### Changed

- Table columns now follow the direction of the table: `:--` is the start of the cell, which is the right side in an Arabic table.
- `Ctrl+L` now inserts a link, `Ctrl+Shift+Z` redoes, `Ctrl+I` italicizes only the word or selection, `Ctrl+/` opens the shortcut list, and `Esc` leaves full screen.
- Export HTML now asks where to save and says "Exported" only after the file is written; HTML and PDF export ask before including your highlights and notes.
- A callout without a title of its own shows the Arabic name of its type when the callout is Arabic.
- The Arabic interface no longer shows English ids, uses correct plural forms, and re-localizes what is already on screen when the language changes.
- Search now treats `ک`/`ك` and `ی`/`ي` as the same letter and finds a number in any digit style.
- The update check keeps working when GitHub renews its certificates, and shows a card with the releases page when it cannot be made or trusted.
- Electron is now 44.7.0 (Chromium 152, Node 24), because Electron 42 reaches end of life on 2026-10-20.
- Releases are not code-signed; the README explains the SmartScreen warning and how to check a download against `SHA256SUMS.txt`. macOS is not built or tested.
- Packages no longer contain `app-update.yml`, and the Linux AppImage no longer starts with the Chromium sandbox switched off from its menu entry.
- Maintenance: the mutation gate, release scan checks and dependency audit were tightened, with each advisory reviewed individually.

### Removed

- The 32-bit Windows build, because Electron 44 has none; the installers now cover x64 and ARM64.
- The built-in spellchecker: the app never downloads a dictionary, and the right-click menu no longer offers suggestions or "Add to Dictionary".

### Fixed

- Notes with many tables or callouts open far faster, large notes render several times faster, and a note built to freeze the app now opens at once, with unformatted text shown as plain text.
- A window that crashes now comes back with your unsaved work, a hung window asks whether to wait or reload, and logging off or shutting down saves the latest unsaved text first.
- A recovery offer you have not answered is kept until you choose Restore or Discard.
- Notes whose encoding is uncertain are no longer guessed in silence, UTF-16 notes without a byte-order mark open correctly, and a change made by another program to a Windows-1256 or UTF-16 note is always noticed.
- Saving a note with mixed line endings changes only the lines you edited, and a note that another program holds for a moment still saves, with a message that says why a save failed.
- Each open note now keeps its own undo history, "Don't Save" really discards, and the unsaved dot follows the text.
- A deleted highlight can be brought back with Undo, one long highlight can no longer stop others from being saved, and highlights and margin notes are no longer deleted behind your back.
- Find now marks every match in the editor, and shortcuts follow the key labels on German and French keyboards.
- Arabic text with Latin terms stays right-to-left, lists take the direction of their items, and code inside a fence stays left-to-right.
- Table columns align as the note asks in the reader, the editor and every export, and long text wraps instead of making the page scroll sideways.
- File names read correctly in the Arabic interface, window buttons stay on screen at 200 % zoom, and the welcome screen and margin notes fit their space.
- `Ctrl+N` always gets a free name, and the line and column readout follows the caret.
- The bundled license file now covers all 149 bundled packages, and exported HTML and PDF keep their charset, title, language and direction.
- Saving a note no longer re-reads the whole folder, and opening a subfolder note no longer replaces a note of the same name.

### Security

- Raw HTML in a note can no longer draw fake app windows, break the app by reusing its element ids, or reload the app through a link.

## [1.3.0] - 2026-09-27

1.3.0 is a reading-experience release: the app remembers where you were, lets you mark up what you read, adds a fourth theme and exports a note as an EPUB. Everything new stays local, apart from the opt-in update check.

### Added

- Reading positions are remembered per note, with a **Continue reading** shelf on the welcome screen and a reading streak and daily goal in Settings.
- Highlights and margin notes: select text in Reading mode to highlight it or add a note, with an Inspector list that jumps to each passage.
- A fourth theme, Oasis: a warm dark palette. On first run only, the theme now follows the Windows light or dark setting.
- EPUB export (File > Export EPUB), with right-to-left page progression for Arabic notes.
- A floating copy button follows the code block you are reading.
- An opt-in update check (Settings > Updates), off by default, that only tells you about a new release and never downloads or installs.
- An optional "Add to PATH" choice in the Windows installer, unchecked by default.

### Changed

- New look, "Marginalia": a two-row title bar, a library sidebar with read time and progress, an inspector, a paper sheet for reading and editing, and highlights shown as margin notes.
- The Windows installer now has a maintenance page for existing installations (upgrade, repair or remove) and a PATH radio choice, and its Arabic pages are right-to-left.
- Session restore now reopens every folder that was open, with its tabs, and more of the chrome follows the Arabic interface.
- Opening code-heavy and large notes is faster: highlight.js now loads only on the first fenced code block, and rendering results are cached.
- Maintenance: release checks refuse stale scan reports, and the settings file moved to schema v5, which 1.2.2 reads safely if you roll back.

### Fixed

- Saving a legacy Windows-1256 file no longer writes `?` for characters it cannot carry; save refuses and offers to upgrade the file to UTF-8.
- Windows-1256 and UTF-16 files, including dropped files and files without a byte-order mark, now open and save faithfully, with no false conflict on the second save.
- Quitting after dismissing the crash-recovery prompt no longer deletes the recovered work, and Save As keeps its save rights.
- Sidebar search, the command palette, conflict banners and highlights made during a file switch now act on the right file.
- A very large single-line note no longer freezes the app, and numbers in Arabic prose keep their left-to-right order.
- Arabic search matches across tashkeel, hamza and similar variants, and direction detection is stricter about mixed Arabic and English text.
- The installer's license page no longer shows Arabic as garbled text, and the Inno installer builds again.
- EPUB exports now pass stricter checks, and code blocks stay left-to-right in exported right-to-left documents.

### Security

- Opening or watching one folder could redirect another folder's keystrokes into the wrong file; the active tab is now tracked by identity.
- Electron is now 42.11.6, clearing three published High advisories that affected the shipped runtime.
- The GitHub TLS pin was replaced with a verified one, so the update check works again.
- PDF export can no longer read arbitrary local files, and save-dialog names from the page are reduced to a bare filename.
- File access is now scoped to the current session, and a save can no longer skip the check for changes made elsewhere.
- DOMPurify is now 3.4.16 and KaTeX 0.17.0 to 0.18.9, clearing two low advisories.

## [1.2.2] - 2026-09-03

### Fixed

- Pressing Save in the close prompt now opens Save As for untitled notes one by one, instead of doing nothing.
- A new note now starts empty, so saving an untouched note no longer writes placeholder text to disk.

### Changed

- A new, untouched note now starts clean: no unsaved marker, and closing it needs no prompt.

## [1.2.1] - 2026-09-03

### Added

- A Word-style Save / Don't Save / Cancel prompt when you close a tab, a folder or the window with unsaved edits.
- Crash recovery: unsaved edits are mirrored every few seconds, and the next launch offers to restore them.
- Optional auto-save (Settings > Files) for files opened from disk.
- Files in UTF-16 and legacy Windows-1256 open correctly and keep their original encoding on save.
- Right-click menus for file-tree rows, tabs and wiki-links, plus Reveal in File Explorer and Copy Path.
- A license page and an explicit upgrade, repair or downgrade flow in the Windows installers.

### Changed

- The interface is now fully Arabic when set to Arabic, and dialogs and design tokens were reworked.

### Fixed

- Keyboard shortcuts now work under Arabic and other non-Latin keyboard layouts, and Ctrl+Y redoes everywhere.
- Reopening a note with unsaved edits now shows the conflict banner instead of discarding the edits, and the window can no longer become unclosable.

## [1.1.0] - 2026-08-25

### Added

- You can open more than one folder at a time and close each one separately.
- A Settings dialog (`Ctrl+,`) with window title following the active note, an auto-hide top bar, a hidden status bar and a full-screen toggle; older builds reset these to defaults.
- A themed right-click menu and designed tooltips across the interface.
- `--reset-chrome` restores the top and status bars from the command line.

### Changed

- A visual redesign across every theme and both text directions, with Literata replacing Fraunces as the serif face.
- DevTools and Electron's default menu accelerators are disabled in packaged builds on Windows and Linux.

### Fixed

- `Ctrl+A` now selects only the note, and the Content width setting now widens the text.
- Two open folders no longer serve each other's images.
- The Windows installer no longer crashes on machines that already have the app, and a hidden top bar can be brought back with the mouse.

### Security

- The `frame-ancestors` framing policy is now served as a real response header, where it takes effect.

## [1.0.1] - 2026-08-21

### Changed

- Documented the packaged `app://` UI protocol and installer build constraints.

### Fixed

- Packaged Windows builds now load the renderer over `app://` instead of `file://`, so the window paints correctly.
- The NSIS custom uninstall no longer breaks the installer compile.

## [1.0.0] - 2026-07-22

First public release.

### Added

- A local-first bilingual Markdown reader with Electron isolation, RTL support and Windows installers.

[Unreleased]: https://github.com/Binary-Parse/BP-MD-RTL-Reader/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/Binary-Parse/BP-MD-RTL-Reader/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/Binary-Parse/BP-MD-RTL-Reader/compare/v1.3.0...v2.0.0
[1.3.0]: https://github.com/Binary-Parse/BP-MD-RTL-Reader/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/Binary-Parse/BP-MD-RTL-Reader/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/Binary-Parse/BP-MD-RTL-Reader/compare/v1.1.0...v1.2.1
[1.1.0]: https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases/tag/v1.1.0
