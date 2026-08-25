# Changelog

## [1.1.0] - 2026-08-25

### Added

- **Open more than one folder at a time.** Opening a folder used to replace the workspace: it asked "N unsaved files. Discard changes and continue?" and then threw away every open tab. Folders now accumulate. Each appears in the sidebar as its own named root with its files nested beneath it, and files that belong to no folder — single-file opens, new notes, drag-and-drop — collect under an **Open files** root. Re-opening a folder you already have open refreshes it in place instead of duplicating it.
- **Close one folder without disturbing the others.** Each folder root carries a close button (or `Delete`/`Backspace` on a focused root row). It prompts only about unsaved files in *that* folder, releases only that folder's disk watcher, and re-activates the nearest surviving note. The status bar shows `folder: <name>` for one, `folders: N` with a tooltip listing them for several.
- **Settings dialog** (`Ctrl+,`, or View ▸ Settings…) holding three new persisted preferences.
- **Window title** setting. The OS window title now follows the active note, so the Windows taskbar and Alt+Tab can tell two open documents apart; `•` marks unsaved changes. Set it to *App name* to show only the product name. The file name is bidi-isolated so RTL names render predictably. See `docs/PRIVACY.md` — the title is visible to anyone who can see your screen.
- **Auto-hide top bar** (`Ctrl+Shift+T`). The top bar leaves the layout and returns when the pointer touches the top edge, on keyboard focus, or via the shortcut. Off by default. While it is hidden the window cannot be dragged, since a frameless window is moved by its title bar.
- **Hide bottom status bar** (`Ctrl+Shift+B`). Removes the status bar and gives its row back to the note.
- **Fullscreen toggle** in the title bar. Off by default; `Esc` exits it like every other overlay in the app.
- **A themed right-click menu**, replacing the OS-native one, so it can follow the app's own paper/ink/sepia palettes: Undo/Redo/Cut/Copy/Paste, spellcheck suggestions, link/image actions, and quick access to New Note, Find, the Command Palette, Settings, and the two bar-visibility toggles above. Fully keyboard-navigable (arrow keys, `Enter`, `Escape`).
- **Designed tooltips** on the whole chrome, replacing the browser's native title bubble, with a short hover delay that collapses to instant under reduced motion.

### Changed

- **A v10 visual redesign** across every theme and both text directions: retuned title bar/status bar scale, a restyled sidebar with elbow-connector tree indentation, a new reading-surface type scale and illumination marks (heading rule, document metadata diamond, wikilink pills), ledger-style tables, paper-grain backgrounds, and restyled menus/palette/modals/toolbar. The sidebar's vault-name header row is removed; the open vault is still shown in the status bar.
- **Literata** replaces **Fraunces** as the serif face (`--serif`). Anyone overriding `--serif` in a custom theme should retarget it — see `resources/vendor/fonts/LICENSES.md`.

- DevTools and Electron's default menu accelerators (`Ctrl+Shift+I`, `Ctrl+R`) are disabled in packaged builds on Windows and Linux. macOS keeps its application menu, which also carries the Cmd+C/V/X/Z key equivalents.
- `--reset-chrome` restores the top and status bars from the command line, for a window that has somehow become unusable. It leaves every other setting untouched.
- `Ctrl+Shift+B` no longer swallows a Bold keystroke typed with Shift still held down.
- The title bar and status bar were rescaled to a compact editor scale — 35px with 13px menu text and 16px icons on top, 22px with 12px text below — driven by six `:root` tokens instead of literals in five rules. The sidebar, inspector and reading area are unchanged.
- The title bar no longer paints the app name beside its mark; the name is kept in the accessibility tree.
- The sidebar and inspector toggles moved into the title bar as panel icons, so each stays visible while its panel is collapsed. They now expose disclosure semantics (`aria-expanded` + `aria-controls`) instead of a bare chevron glyph.

### Fixed

- **`Ctrl+A` no longer selects the entire application.** It selected the title bar, sidebar and status bar along with the note, because the command was dispatched as a Chromium `selectAll` role against the whole window. It is now scoped to the document, and follows the view mode: Reading mode selects the rendered prose, Edit mode selects the editor buffer. Previously it always targeted the editor, which in Reading mode is hidden — so the visible text could not be selected at all. On the welcome screen it now selects nothing instead of the surrounding chrome.
- **"Content width" now actually widens the text.** The setting, its slider and its persistence were all correct, but the reading column was capped one level up the box tree: a fixed 160px of horizontal padding plus an 800px shell. At the default window size that left less room than even the default 72-character measure, so every increase was a no-op. The padding is now proportional to the pane, and the shell cap no longer applies to any mode with a document open — it previously excluded Split View and the fallback editor, which were stuck at 640px regardless of window size. Reading and Edit also render the same setting at the same width; they differed by about 6%.
- **The top-right icons line up with the inspector panel.** They sat 19px short of its edge, so the title bar's zoning did not match the columns beneath it. Panel widths and title-bar zones now derive from shared tokens and cannot drift apart. Below 1100px the tab strip tracks the narrowed sidebar too, which it previously did not.
- **The visibility toggles say which way they will go.** "Auto-hide Top Bar" and "Hide Bottom Status Bar" kept the same wording once active, so the menu offered to hide something already hidden. They now read "Always Show Top Bar" and "Show Bottom Status Bar" when on, consistently across the View menu, the command palette, the right-click menu and the shortcut sheet. The Settings dialog keeps static labels by design — there the switch carries the state.
- **The right-click menu follows the interface language.** Its entries were built in the main process with English text and stayed English with the interface in Arabic.
- **Two folders can no longer serve each other's images.** A note's `![](pic.png)` resolved against whichever folder was read most recently rather than the note's own, so with two folders open an image could come from the wrong one. Asset URLs are now scoped to the folder that owns the note.
- **The Settings dialog matches the rest of the interface.** Section labels such as "WINDOW" and "APPEARANCE" rendered in the monospace face; they now use the same typeface as every other chrome label.
- **The Windows installer no longer crashes on machines that already have the app.** The Inno script passed two custom button labels to an `MB_OKCANCEL` task dialog, where Cancel is a common button and only one label is legal, so Setup died with `Invalid ButtonLabels` before copying a byte. Fresh installs never took that branch, which is why it shipped.
- **The auto-hidden top bar can be brought back with the mouse again.** It kept its window drag region while hidden, and a drag region swallows every pointer event — so the reveal strip beneath it never fired. The bar now releases that region while hidden, and the reveal follows pointer position instead of a covered strip.
- **Opening with the top bar hidden now says how to get it back.** Restoring the setting from disk never went through the code path that shows the hint, so the app opened with no title bar, no menus and no explanation.
- **A window stranded off-screen is pulled back** when a display is removed or its metrics change, instead of only at launch.
- The window's framing policy now takes effect. `frame-ancestors 'none'` had been declared in the renderer's CSP `<meta>`, where [W3C CSP3 §3.3](https://www.w3.org/TR/CSP3/) says it is ignored — so the app had no framing protection and logged a console error on every boot. It is served as a real response header on the `app://` document instead, on the HTML only.
- Rendered maths keeps its accessible MathML. KaTeX's `<semantics>`/`<annotation>` were being stripped even though the maths sanitizer explicitly allows them, because its output reached `innerHTML` as a plain string and was re-sanitised by the app-wide Trusted Types policy. Screen readers announced the raw TeX on top of the MathML it duplicates; they now read the expression once.
- **The packaged build's Electron fuses are now actually verified.** `package:verify` reported "Verified electronFuses config against 9 packaged binary path(s)" while never reading a binary — it confirmed the reader function existed, then printed success. It now reads a fuse wire from each packaged Electron binary and fails on a mismatch, so a fuse electron-builder failed to apply can no longer ship silently. Windows only for now; macOS and Linux binaries are not in a layout the walker can find, and that limit is written down.
- Two CI jobs declared an egress allowlist that never applied. Both run inside a container, where `harden-runner` returns before installing its agent, so they ran with unrestricted egress while the workflow read as locked down. The steps are removed rather than left to be mistaken for protection.
- The editor's find box and the rest of the app now share one regex-escaping helper. The editor's private copy had drifted, so a non-string query was accepted in one place and threw in the other.
- Exported HTML no longer carries a `frame-ancestors` directive that browsers ignore. It was declared in the export's `<meta>` CSP, where [W3C CSP3 §3.3](https://www.w3.org/TR/CSP3/) excludes it, so it protected nothing and made every opened export log a console error. The directives `<meta>` does honour are unchanged.
- Fuse verification now covers the macOS and Linux layouts too, not only Windows — a `.app` bundle and an extensionless Linux binary are both recognised.
- Packaging now fails if any of the Windows installer tooling bundled with a build dependency (7-Zip, WiX, Squirrel — about 31 MB, none of it used by this project's installers) ever reaches a shipped tree.

### Note for downgrades

- The settings schema is now version 4. An older build will not recognise the three new preferences and will reset them to their defaults on its next save; no other setting is affected.

## [1.0.1] - 2026-08-21

### Fixed

- Packaged Windows builds now load the renderer over `app://` instead of `file://` inside `app.asar`, so the window paints with Electron fuses that deny extra `file://` privileges.
- NSIS custom uninstall no longer references `$installMode`, which failed the installer compile when warnings are treated as errors.

### Changed

- Documented the packaged `app://` UI protocol, asar fuse constraints, and NSIS `$installMode` restriction in `README.md`, `docs/PRIVACY.md`, `docs/BUILD.md`, and `AGENTS.md`.

## [1.0.0] - 2026-07-22

First public release.

### Added

- Local-first bilingual Markdown reader with Electron isolation, RTL support, and signed Windows installers.
