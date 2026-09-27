# Changelog

## [1.3.0] - 2026-09-27

### Fixed

- **Opening or dropping a very large single-line note (~10 MB on one line) no longer
  freezes the app.** The bidi direction scanner stripped URLs with a regex that
  backtracked quadratically on any long whitespace-free run, wedging the renderer for
  minutes. URL/email/domain stripping now scans token-wise in linear time with the same
  RTL behavior (a URL or bare domain still never flips a sentence's direction).
- **Vault-folder highlight records no longer accumulate forever.** When a folder's grant
  is pruned from the registry (settings no longer reference it), its orphaned
  annotation keys are now cleaned up on first annotations use instead of counting
  toward the store's 2 MiB cap. Highlights of vault notes are additionally pinned by a
  two-session regression test (open → highlight → restart → highlight re-found).

### Changed

- Release preflight now refuses a stale OSV vulnerability scan with the same rule it
  already applied to the SBOM: either artifact older than `package-lock.json` fails the
  run (previously only the SBOM was dated, so a stale vulnerability report could pass).
- A hostile pre-release security audit — the full scanner suite plus an adversarial
  review of every application boundary — found no critical or high issues; all four low
  findings were fixed before release (below), with the full record in
  `docs/SECURITY-AUDIT-2026-09-27.md`.
- The update check caps the response body it will buffer at 1 MiB — a pinned-host peer
  returning a giant body can no longer grow the main process's memory without bound —
  and rate-limits repeated checks: one network call per minute, with a repeat inside
  that window answered from the previous result (a failed network attempt is never
  cached, so retrying after going back online really retries).
- Vendored DOMPurify 3.4.13 → 3.4.16 and KaTeX 0.17.0 → 0.18.9, clearing the two
  recently published low advisories that named the older versions (neither code path
  was reachable in this app; the bumps make that moot). Rendering behavior is
  unchanged; the full suite passes against the new versions.

A pre-release integrity pass over the save path, capability checks, and packaging, from
the 2026-09-23 adversarial review and its 2026-09-24 follow-up passes (a second adversarial
attack, the remaining review items, and the RTL product blockers). No new features; nothing
new talks to the network.

### Fixed — data safety

- **Saving a legacy Windows-1256 (Arabic) file no longer corrupts characters the code page
  cannot carry.** A character outside Windows-1256 (an emoji, for instance) used to be
  written to disk as a bare `?` with no warning. Save now refuses with a clear error —
  naming the characters at fault — and offers to upgrade that file to UTF-8 and complete
  the save in place (Cancel keeps the note unsaved). The same offer runs in the Save As
  flow; the auto-save timer never prompts, it just reports the failure.
- **The second save of a Windows-1256 or UTF-16 file is no longer a false conflict.** The
  hash stored after a re-encoding save was computed over different bytes than the next
  conflict check reads, so every later save of a legacy-encoded file reported a conflict
  even with no external change. Both sides now hash the same view of the file.
- **An omitted or forged save hash can no longer skip the conflict check.** When the main
  process has not read a document in this session (a reopened recent, for example), it now
  hashes the file on disk itself before accepting a write, instead of treating the missing
  baseline as permission to overwrite.

### Fixed — filesystem authority

- **Reveal in File Explorer / Copy Path require the same session grant as reading and
  writing.** A stale capability id from the recents list could previously put a file's full
  path on the clipboard or open its folder without the file being open this session.
- **A folder or file that moved on disk is re-pinned for real.** The re-open path mutated a
  copy of the registry record, so the new canonical path was never saved and every launch
  re-reported the folder as missing. The registry now relocates the record itself and
  persists it.
- **Notes and folders whose names begin with two dots** (`..notes.md`) **open normally.**
  The containment check read any leading `..` as an escape; it now rejects only a real
  `..` path segment. The same fix covers the vault-image protocol and app-asset resolvers.

### Fixed — reliability

- **Files handed to an already-running instance before its window exists are no longer
  dropped.** They are queued and delivered when the window finishes loading.
- **An uncaught error in the main process now exits the app** (after logging) instead of
  continuing in an unknown state.
- **The capability registry survives a power cut like every other JSON store**: it now
  flushes the temp file before its atomic rename and a failed write no longer leaves a
  `.tmp` file behind. Note-write temp files use an unguessable name with an exclusive
  create, matching the PDF exporter.
- **The Inno installer lane builds again.** The T14 Electron update bumped the runtime to
  42.11.6 but left the installer's source-manifest policy pinning 42.7.0, so every Inno
  build since has failed its own fail-closed policy check (no Inno artifact exists for
  1.3.0). The pin now matches package.json, and the Pester contract that pins it was
  updated with it.

### Fixed — full-codebase audit pass (2026-09-24)

- **Quitting after dismissing the crash-recovery prompt no longer deletes the recovered
  work.** Dismissal is not a decision: the snapshot stays re-offerable until the user
  restores or discards it explicitly.
- **Files added by drag-drop or the file picker open with the same encoding detection as
  files opened from the Open dialog.** A dropped Windows-1256 or UTF-16 note used to open
  as mojibake, and saving over the original wrote that mojibake back. The bytes are now
  decoded by the main process and re-encoded faithfully on save.
- **A note deleted on disk is marked in the tab bar** (dashed, dimmed name), and saving it
  says plainly that the save recreated the file instead of doing it silently.
- **The auto-save timer pauses while a Save / Don't Save answer is pending**, so a
  trailing tick can no longer write the exact edits the user just declined to keep.
- **Two tab-close paths now persist the session snapshot**, closing the last way a closed
  tab could quietly re-open after relaunch.
- **Closing a folder ends the app's authority over its files for the rest of the run.**
  The session grant used to survive the close; reading or writing those notes now
  requires re-opening the folder through the validated path.
- **The close prompt can no longer be outrun by the 20s force-close.** While the app's
  own close flow waits on a dialog it heartbeats the failsafe; a genuinely wedged
  renderer still gets force-closed.
- **Opening a large folder no longer freezes the app for the whole decode pass** — the
  vault read yields to the event loop as it works, and each file's metadata rides the
  stat the folder walk already took.
- **Atomic writes keep the file's original permissions** instead of widening them to the
  default, and temp files orphaned by a crash (notes and JSON stores alike) are swept on
  the next open/write.
- **Conflict baselines hash with SHA-256.** The hashes never leave the running session,
  so nothing stored by an older release is affected.
- **EPUB exports are epubcheck-cleaner**: footnote references cited twice no longer
  duplicate IDs, links to anchors that landed in another chapter are rewritten to that
  chapter file, links to local files no longer ship as dead references, and Mermaid
  diagrams render as figures instead of raw code fences (matching HTML export).
- **Editor details**: continuing an ordered list keeps its zero-padding (`01.` → `02.`)
  and stays exact for huge numbers; multi-selection copy/cut now carries every selected
  range, not just the last; a byte-order mark no longer hides a note's front-matter.
- **Sanitizer tightened**: backslash protocol-relative URLs are rejected, `data:` URLs no
  longer survive on links, and the fallback render path escapes instead of passing raw
  HTML through.
- **Arabic interface polish**: the inspector panel, menus and palette now use one word for
  المُعايِن; toasts sit centered in RTL; Arabic plural phrasings read correctly for any
  count; the Arabic UI no longer flashes English/LTR at boot; Escape closes one layer at
  a time; shortcuts no longer fire behind the command palette; the daily note prefers the
  active folder's own `YYYY-MM-DD.md`; duplicating a note twice can no longer flag the
  first copy as a conflict; loading the demo notes releases the previous folder's watcher.
- **Release gates hardened**: the vendored fonts and the installer's EnVar.dll are pinned
  by hash in the vendor manifest; the duplication check can actually fail (1% threshold);
  `package:verify` fails when nothing was built instead of passing vacuously;
  `release-preflight` treats a missing or drifting `dist/release` as a failure; the
  gitleaks config hash can no longer be overridden from the environment; the Inno version
  must come from the build script; the Claude workflow gets a timeout.

### Fixed — second adversarial pass (2026-09-24)

- **A file saved with Save As keeps its save rights.** Save As created the new document's
  capability but never activated its session grant, so the first save worked and every
  later one — manual or auto — failed with `unauthorized-capability` until relaunch. The
  grant now activates the same way Open File activates it.
- **A legacy Windows-1256 note carrying a UTF-8 byte-order mark is no longer destroyed.**
  The reader trusted any BOM and decoded the body as UTF-8, turning half-converted Arabic
  files into U+FFFD mojibake that the auto-save then wrote back over the original bytes.
  The body is validated now: a BOM over non-UTF-8 bytes reads as Windows-1256.
- **Sidebar-search, palette and conflict-banner clicks always act on the file they were
  built from.** All three held a list index that any vault merge (an external edit, a
  reopened folder) silently shifted, so a search result could open — and auto-save — a
  different file. They resolve by document identity now, and session restore re-resolves
  the active file after every merge, per mergeVaultSlice's own contract.
- **Two saves racing on one file no longer produce a false conflict.** A double-tapped
  Ctrl+S, or an auto-save overlapping a manual save, sent a stale baseline hash and raised
  the "changed on disk" banner for a file only the app itself had touched. Writes for the
  same file serialize behind each other now.
- **A highlight made during a file switch is filed under the document it belongs to.** The
  annotation key used to re-point only after the load finished; a selection captured in
  that window was stored as a highlight of the previous note. The key re-points
  synchronously and anything added mid-load is merged back into the loaded list.
- **A forged math placeholder can no longer bypass the math size cap.** The private-use
  sentinel characters are ordinary typeable text; a crafted note could hand KaTeX
  megabytes of TeX through the placeholder wire format and hang the reader on open. The
  restore path enforces the same cap the tokenizer applies.
- **Every JSON store main owns writes through an unguessable, exclusively-created temp
  file.** The capability registry got UUID + O_EXCL temp names in the previous pass;
  annotations, reading stats and settings.json now share one hardened writer, and
  settings no longer leaves a `.tmp` file behind on failure.
- **`npm install` never falls back to `npx playwright install`.** When devDependencies
  were absent, that lifecycle step fetched and executed the latest Playwright from the
  registry. Only the pinned local CLI runs now; an install without it skips quietly.
- **Canceling the destination after accepting a UTF-8 upgrade leaves the note's encoding
  untouched.** The upgrade used to be pinned to the file before the second picker opened,
  so the next auto-save silently re-encoded the original path to UTF-8. Canceling rolls
  the encoding back.
- **The Inno installer's Electron pin is enforced against package.json**, not a
  hand-synced literal that can drift exactly the way the 1.3.0 Inno lane did.

### Fixed — follow-up pass (2026-09-24, part 2)

- **Numbers inside Arabic prose keep their true left-to-right order.** A bare `<bdi>`
  around a digit group (a date, a time, a decimal) is `dir="auto"`, and content with no
  strong character inherits the surrounding RTL direction — the separators the isolate
  exists to protect reordered inside it. Digit isolates and inline code now carry an
  explicit `dir="ltr"`; `#tags` keep the auto isolate their letters anchor.
- **A wikilink whose text is a date renders its digits in order.** Link contents were
  excluded from inline isolation wholesale, so `[[2026-06-01]]` inside Arabic text flipped
  to `01-06-2026`. Neutral-text links are now isolated like any other run, while URL-named
  links stay untouched so a visible URL is never fragmented.
- **Closing a folder requires the session grant that opened it.** `fs:closeVault` accepted
  any vault id, so a compromised renderer could silently disarm every folder's
  external-change watcher.
- **Opening a folder no longer writes its file listing to disk.** The per-file grants a
  vault read mints are session-only bookkeeping; they are never serialized to
  `capabilities.json` (previously up to 5,000 records per folder landed there until the
  next launch pruned them).
- **An "Open With" batch is bounded like a folder read** — the same 5,000-file and
  100 MB cumulative caps now cover argv, open-with and second-instance delivery.
- **A shortcut can no longer stack a second dialog over a pending one.** Global chords
  (Ctrl+S, Ctrl+W, Ctrl+K…) are inert while a dialog is open, and a dialog that is
  superseded anyway settles immediately with its abandoned value instead of hanging and
  reporting a false "Save canceled" after the newer flow finished.
- **The 20-second close failsafe never destroys a dialog the close flow itself opened.**
  Aborting it now covers every Save choice, not only the Save-As path — the encoding
  upgrade prompt could previously sit under a ticking force-close.
- **Opening a note in one folder no longer evicts another folder's entry** from the
  recents shelf: dedupe matches the same (path, vault) identity reopening resolves by.

### Fixed — residual review items (2026-09-24, part 3)

- **A UTF-16 file whose byte-order mark was stripped no longer opens as mojibake** — and
  its first save no longer overwrites the original bytes. UTF-16 without a BOM is now
  detected by its byte parity (every script this app reads keeps one byte of each pair
  ≤ 0x08), reads as real Arabic/ASCII text, and round-trips byte-exactly.
- **The crash-recovery prompt no longer deletes the snapshot before you answer.** It
  peeks; only an explicit Restore or Discard consumes it. A dismissed prompt, a crash,
  or quitting mid-dialog leaves the snapshot re-offerable on the next launch.
- **Code blocks stay left-to-right in exported RTL documents.** The HTML and EPUB
  stylesheets pin `pre`/`code` to LTR (mirroring the in-app rule), so exported Arabic
  notes no longer show mirrored, colliding code.
- **Editor widgets follow the note's front-matter direction, and a direction flip
  refreshes them immediately.** Table and callout widgets in the CM6 editor now resolve
  the same forced direction as the reading pane, and toggling direction rebuilds the
  widgets instead of keeping the pre-flip rendering until the next edit.

### Changed

- **Reading minutes accept exactly one minute per tick** (the channel previously allowed up
  to 120 per call), so the daily total cannot be inflated by a runaway or scripted renderer.
- **The About dialog shows the real running version**, fetched from the main process, with
  the package version pinned as the browser-lane fallback.
- **More of the chrome follows the Arabic UI**: the top-bar/status-bar and
  Arabic-interface toasts, the conflict tab's screen-reader label, and the cursor readout
  come from the locale catalog now; the textarea fallback no longer inserts a literal
  "text" placeholder on Bold/Italic; the kashida Settings description describes the actual
  inter-character justification.

A reading-experience release: the app now remembers where you were, lets you mark up what you
read, ships a fourth theme and can hand a note to your phone as an EPUB — and it carries the
complete hardening, correctness, and performance work from the 2026-09-20 application audit
(`docs/AUDIT-REPORT-2026-09-20.md`), plus the T14 pre-release security fixes. Everything new
stays local — no new runtime dependency, and no new background network call. (This section
folds what an earlier draft kept as a separate "[Unreleased]" block: v1.3.0 was never tagged
or published before this release, so there is exactly one 1.3.0, and it contains all of this —
including the integrity passes above, which an earlier draft had labeled "1.3.1"; that version
was likewise never tagged or published.)

### Added

- **Reading positions are remembered per note.** Each note stores how far through it you were; the welcome screen grows a **Continue reading** shelf (four newest, with a percentage and a relative time) and reopening a note returns you to that spot. The position is captured from the reading pane only, because Reading is the mode you read in — see the limits below.
- **Highlights and margin notes.** Select text in Reading view and a small bar offers **Highlight** (saved immediately) or **Note** (the same passage plus a note you type). Highlights re-anchor by their own text when the note is re-rendered, the Inspector gains a **Notes** section after Properties with a 60-character excerpt per entry, a click jumps to the passage in the reading view, and × deletes it. Stored in `<userData>/annotations.json` — text only, no paths, and never synced anywhere.
- **A fourth theme: Oasis.** A warm dark palette (amber on near-black) alongside Paper, Ink and Sepia, reachable from View ▸ Theme, the command palette, the theme button's cycle and the Settings dialog. Every theme token is contrast-checked at WCAG AA by the test suite, and the visual-regression suite pins a fourth snapshot (Windows baseline in this tree; the Linux baseline is generated by the Linux visual lane).
- **EPUB export** (File ▸ Export EPUB…). The book is built in the renderer with no compression dependency: markdown is rendered through the same bidi-aware pipeline as the HTML/PDF export, split into chapters at each `h1`/`h2`, given an OCF container, an EPUB 3 package document (with `page-progression-direction="rtl"` for Arabic notes), a table of contents and a stylesheet derived from the paper theme, then written as a stored-only ZIP whose first entry is an uncompressed `mimetype`. The archive is handed to the main process as opaque bytes — nothing is rendered or fetched there.
- **Reading streak and daily minutes.** One quiet line above the Continue-reading shelf — `5-day streak · Today 12 of 20 min` — backed by `<userData>/reading-stats.json` (two years of daily totals, a day key computed in the main process so timezones cannot drift). The daily goal is Off / 10 / 20 / 30 minutes in Settings ▸ Reading; Off hides the line entirely. Minutes are counted one per minute only while the reading view is open in a visible window.
- **A floating copy button follows the code block you are reading.** One copy button lives beside whichever fenced code block is currently in view; it scrolls with that block and moves to the next one as you scroll down or up (the same tracking rule as the document outline). A click copies the block's exact source to the clipboard — trailing newline trimmed — with a confirmation toast, in both interface languages. Mermaid diagrams are excluded.
- **Opt-in automatic update check** (Settings ▸ Updates). Off by default: nothing is requested at all. When switched on, the main process checks the releases manifest once a day and only tells you — it never downloads or installs, sends no identifier, and the notice's **View release** button opens one fixed URL that the main process owns. The TLS pin is now a list, so a certificate rotation is a one-line addition rather than a release that has to land first.
- Highlight/note, reading-goal and update chrome are localized in both languages.

### Changed

- **Settings schema v5.** The four new keys (`readingProgress`, `themeFollowSystem`, `updateCheck`, `readingGoalMin`) are validated and migrated on load, and travel through the full save path — a hand-edited or newer `settings.json` cannot lose them silently. The persisted-keys and payload-shape tests were updated with it.
- **Border radii come from tokens** (`--r-sm`/`--r-md`/`--r-lg`), so the interface's corners are one decision instead of fifty literals.
- The continue-reading shelf, the reading line and the notes list are all built with `createElement`/`textContent` — no `innerHTML` path takes part in any of the new UI.

### Added — follow the system colour scheme

- **On first run (and only then) the theme follows Windows light/dark** instead of assuming Paper. Choosing a theme in the app remains a permanent override; a saved choice is never clobbered by an OS change (the `themeFollowSystem` key exists precisely so an upgrade cannot flip it for you).

### Fixed — reading (T10 post-audit)

- **A tab switch during a scroll could zero another note's saved position.** The throttled trailing capture measured whoever was active when the timer fired, not the note that was scrolled; a switch inside the one-second window could read the incoming note's just-reset pane and write ~0 % over its own shelf entry. The pending capture is now bound to the note being scrolled and cancelled on switch, and the switch's own pane bookkeeping (reset + restore) no longer counts as reading. Both behaviors are pinned by a test that forces the restore to land inside the old race window.
- **A margin note could be filed into the wrong document.** The Note prompt is a modal, but keyboard shortcuts (Ctrl+W/O/E) still fire while it is open; saving after such a switch stored the passage under the new note's annotations. The pending selection now remembers which document it was made in, and a selection from another document is discarded instead of saved.

### Fixed — installer (T11)

- **The installer's license page rendered the Arabic as mojibake — and looked like a terminal.** The bilingual NSIS license text shipped as UTF-8 without a BOM, and electron-builder passes an explicitly configured `nsis.license` to the Unicode NSIS compiler raw — which then read it as ANSI, so every Arabic letter displayed as `Ã˜Â±`-style garbage, and the terminal-style `====` banner lines plus missing CRLF endings made the page look unfinished. The page is now a **clean bilingual RTF**: a real title, a bold "MIT License (English — the binding text)" section, and the informal Arabic translation as right-to-left, right-aligned paragraphs — with every Arabic character written as an ASCII `\uN?` escape, so no codepage can ever corrupt it again. Byte-level unit tests pin the RTF contracts.

### Changed — installer wizard (T13)

- **Existing installations get a real maintenance page, not a wall of text.** Running setup over an installed copy used to interrupt you with three paragraph-stuffed message boxes (with literal blank-line padding to fake spacing). It now opens a proper wizard page — the pattern used by mainstream installers (Python's maintenance mode, Git's radio pages): a colored version-state line (`installed · this installer`), and radio choices with sub-captions — upgrade (default, notes and settings preserved), repair, or remove (which opens the Windows "Installed apps" settings page and exits). A downgrade defaults to exiting, in warning red. `MessageBox` is now banned outright from the installer script by a test contract.
- **The PATH choice follows the Git for Windows pattern.** A radio pair — "Add BP MD RTL Reader to PATH" (run it from any terminal) vs "Leave PATH unchanged (default)" — each with a sub-caption, instead of the bare checkbox. The `/add-path` switch remains for silent/enterprise installs only.
- **Arabic wizard pages are genuinely RTL.** Every custom page (installer and uninstaller) now calls the documented `nsDialogs::SetRTL` API when the installer runs in Arabic, so radio buttons, labels, and text mirror and right-align properly instead of hugging the left edge.

### Added — installer (T12)

- **An optional "Add to PATH" choice.** After picking the install folder, a checkbox (unchecked by default, in both languages) adds BP MD RTL Reader to the system PATH so it can be launched from a terminal; uninstalling removes the entry again. Implementation and safety notes: the write goes through the vendored EnVar NSIS plug-in — it appends the folder only when it is not already on PATH, preserves the PATH value's expandable (`REG_EXPAND_SZ`) form instead of flattening it, and broadcasts the change to running processes. Silent installs opt in with `/add-path`. The plug-in's source, license, and vendored SHA-256 are recorded in THIRD-PARTY-NOTICES.

### Documented limits (v1)

- **Reading positions live in Reading mode.** Edit (CodeMirror) mode captures and restores nothing: "how far through the note you were" is a reading concept, and the editor owns its own scrolling.
- **A highlight is a single text node.** Selecting across element boundaries (a paragraph plus the next one, or part of a bold run and part of the following text) offers no highlight bar rather than storing a span that could not be re-anchored safely.
- **EPUB v1 replaces embedded images with text.** Vault-relative images (`bpmd://…`) become a `[Image: alt text]` placeholder in the exported book, exactly as the HTML/PDF export already does; data-URI images are kept.

### Security — pre-release fixes (T14)

- **Opening or watching one folder could silently redirect another folder's keystrokes into the wrong file (critical).** Every folder tick (the file watcher, auto-save of a sibling folder, re-opening a recent) rebuilds the workspace's file array, and the active-tab index survived the reshuffle — pointing at whatever note landed in that position. The next keystroke wrote the open editor's content into that foreign note and marked it dirty, so auto-save would have written it over the other file on disk. The active tab is now re-resolved by identity (path, then capability key) after every merge, pinned by unit tests.
- **Electron is updated 42.7.0 → 42.11.6**, clearing three published High advisories that affected the shipped runtime — most importantly GHSA-qmv3-fv6v-rmhq, where a compromised renderer could poison the sandboxed preload's code cache and run code in the preload context (a contextIsolation breach in exactly this app's threat model).
- **The GitHub TLS pin was re-minted and verified against the live endpoint.** The 1.3.0-rc pin (`b42b6ae8…`) had shipped unverified and matched no live certificate value, so every update check failed closed — dead feature, not an open one. Pins are now SPKI hashes (stable across GitHub's ~90-day certificate re-issues) of the live leaf *and* its issuing intermediate CA as a rotation backup, matching walks the whole presented chain, and `npm run tls:verify` proves the list against the real api.github.com before a release.
- **PDF export can no longer read arbitrary local files.** The export session's request filter allowed any `file:` URL, so an export document could embed local files by path; only the export's own temp document may load from disk now (inline `data:` and `about:` still work), and the allowance is dropped the moment the export ends.
- **Save-dialog names coming from the renderer are sanitized to a bare filename** (PDF, EPUB, and Save As), so a compromised renderer can no longer pre-position the dialog inside an attacker-chosen directory.
- **Preferences, recents, session, annotations and reading stats survive a power cut.** The shared JSON stores and the settings writer now `fsync` the temp file before the atomic rename (the note files already did), so an OS crash can no longer persist an empty or torn store over the user's data.
- **The fuse verifier now asserts all seven security fuses** — `enableCookieEncryption` was configured but never checked, so a packaging regression there would have shipped silently.
- **Development-only dependency audit is clean again** (`npm audit --audit-level=moderate` exits 0): vitest 4.1.11 (path traversal in `@vitest/mocker`) and refreshed version `overrides` (fast-uri, qs, @xmldom/xmldom, browserslist, js-yaml, baseline-browser-mapping) whose earlier pins had drifted into the vulnerable ranges. None of these packages ship in the app — they are build/test tooling — but the gate is green.
- **Installer: the PATH radio no longer remembers a stale choice** across Next → Back → Next (the Leave callback resets before reading the radio), and the license RTF's CRLF line endings are pinned in `.gitattributes` with a byte test, so every checkout builds the identical page.

### Rolling back to 1.2.2

The v5 settings file is read safely by 1.2.2: its schema whitelist drops the four new keys on
load and rewrites the file without them. You lose the stored reading positions, the theme-follow
preference, the update-check choice and the daily goal — nothing else — and `annotations.json`
and `reading-stats.json` are simply ignored and left in place for the next 1.3+ launch. One
caveat: 1.2.2 does not know the Oasis theme, so a profile saved with it falls back to the
default theme after a downgrade.

### Security — hardening (2026-09-20 audit)

Every Critical/High finding and every code-level Medium/Low finding from the audit is fixed in this release.

- **Filesystem capabilities are session-scoped.** A persisted grant alone no longer authorizes reads or writes: a vault must be open, granted through a picker this session, or bootstrapped from the last session after re-validation against disk. Reopening a recent re-validates it through the new `fs:reopenVault` / `fs:reopenDocument` bridge (a moved folder is followed), and the capability registry is pruned at startup to what settings still reference — it no longer accumulates every path ever granted, forever.
- **The save conflict check is no longer renderer-optional.** Main keeps its own copy of each document's last-read hash; an omitted or tampered `baseHash` is a conflict, never a silent overwrite.
- `update:check` no longer returns the network-sourced `html_url`; the wikilink alias is escaped at render time; the capability registry drops structurally invalid records at load; `app://` assets enforce realpath containment; PDF export writes its temp HTML under an unguessable name with an exclusive (`O_EXCL`) create.
- ESLint runs hand-written correctness rules alongside the security set, and the release preflight refuses SBOM/OSV artifacts older than the lockfile.

### Fixed — bidirectional text

- **Per-block direction resolves by a strict majority of strong letters, with URLs stripped; exact ties inherit the base direction.** The previous 60 % threshold had a dead band where adding one English word flipped an Arabic paragraph to LTR, and URL path letters could force a genuinely Arabic sentence LTR.
- **Code fences no longer flip their Arabic containers.** Callouts, list items, and quotes that explain a snippet keep their RTL direction and Arabic typography; the fenced code itself stays LTR.
- **Arabic search normalization.** Vault search and reading-mode find match across tashkeel, hamza, ta-marbuta, and alif-maqsura variants — `محمد` finds `مُحَمَّد`, `اسلام` finds `إسلام`.
- Heading anchors fold tashkeel, so `#كِتَاب` and `#كتاب` produce the same anchor.

### Fixed — data safety

- **Auto-save failures are no longer invisible**: a persistent write failure toasts once per file, and a conflict shows its resolution banner on the active tab immediately.
- **The crash-recovery prompt actually appears** (a result-shape mismatch previously made it unreachable). A corrupt snapshot is kept aside as `snapshot.json.corrupt` instead of being destroyed, identical snapshots stop being rewritten every 10 s, and an unreadable one is reported.
- The 20 s close failsafe logs the last-reported unsaved-file count; closing a background tab persists the session; vault reads report skipped files; watcher re-read failures surface once; a missing vault image renders a named placeholder; a failed editor-engine load announces its plain-text fallback.

### Changed — performance

- **highlight.js (1.08 MB — 76 % of the old blocking payload) lazy-loads on the first fenced code block.** Notes without code never load it at all; the offline/CSP tests prove the runtime injection works under the strict CSP.
- KaTeX and highlight.js results are cached per source, TOC rebuilds are skipped when headings did not change, and unlabeled fences no longer run 192-language auto-detection (a bounded subset with a 4 KB guard).
- Vault reads use an O(1) capability path index and a per-file fast path; the search index is pre-warmed in idle chunks; tag extraction is cached per file content; the Ln/Col readout uses CM6 `lineAt` instead of serializing the document per keystroke.

### Changed — session & interface

- **Session restore reopens every folder that was open, with its tabs** — previously only the last-opened folder came back, silently dropping the rest.
- The three copies of the render pipeline are harmonized (localized note label, UI-locale word count, wikilink wiring on every path).
- `--gold` passes WCAG AA in Paper and Sepia; Sepia owns its accent/backdrop/caution palette; a per-theme contrast test pins the tokens. The find counter is announced (aria-live) and localized; Mermaid renders with an 8 s timeout and a visible failure caption; the command palette caps the empty-query file list at 50; wikilinks prefer the active folder when two open folders share a filename.
- The dormant `numerals` setting is removed (a hand-edited `settings.json` key is now ignored); the Arabic options — interface, calendar, kashida, italic recolour — also live in the Settings dialog; the remaining English-only toasts, empty states, and context-menu role labels now follow the Arabic UI.
- THIRD-PARTY-NOTICES match the shipped vendor manifest (DOMPurify 3.4.13, Mermaid 11.16.1) and KaTeX's 20 bundled math fonts are attributed SIL OFL-1.1; the offline e2e proof asserts zero external requests; the README's signing claims are scoped to official releases with checksum verification.

## [1.2.2] - 2026-09-03

### Fixed

- **Pressing Save in the close prompt did nothing for untitled notes.** Choosing Save / Save All while closing the window (or during a workspace-swap discard check) silently skipped any note that had never been saved: the prompt closed, no Save As dialog appeared, and the window just stayed open. Untitled notes now get their Save As dialog one by one; canceling it keeps the window open with the "still unsaved" toast, and saving every note completes the close — Word's behavior. Main's 20-second force-close failsafe is disengaged before the first native dialog opens, so taking your time browsing for a folder can no longer get the window force-closed mid-save.
- **New notes shipped with placeholder text baked into the document.** A fresh note contained `# Untitled` + `Start writing…` as real content, so saving an untouched note wrote the placeholder to disk. A pristine note now starts **empty and clean**: closing it needs no save prompt, and the visible "Start writing…" is a DOM-only hint that follows the UI language (Arabic: «ابدأ الكتابة…») and never enters the file. (An explicitly saved empty note contains just the standard trailing newline.) The hint also no longer floats over the welcome card after a crash-restored session.

### Changed

- **A pristine new note is no longer born "dirty".** It starts clean (no ● on the tab, no `•` in the window title) and only marks itself unsaved on the first keystroke, so closing an untouched note closes the window immediately instead of prompting.

## [1.2.1] - 2026-09-03

### Added

- **Word-style Save / Don't Save / Cancel prompt.** Closing a tab, a folder, or the window with unsaved edits used to show an English `confirm()` whose default button *discarded* the changes. A themed, Arabic-aware dialog now names the file and actually saves (with Save As for untitled notes) before closing; canceling a Save As aborts the close.
- **Crash recovery.** Unsaved edits are mirrored to `<userData>/recovery/` every few seconds. After a crash, a force-shutdown, or a hung renderer, the next launch offers to restore them — the Word "recover unsaved documents" model.
- **Optional auto-save** (Settings ▸ Files). Files opened from disk are written back after you pause typing; untitled notes still ask where to live.
- **Multi-encoding files.** Files are now read as bytes: UTF-16 (LE/BE, BOM) and legacy Arabic Windows-1256 files open correctly instead of rendering as mojibake — and, critically, saving them no longer writes the mojibake back to disk. The original encoding is preserved on save.
- **Right-click menus for the surface under the cursor.** File-tree rows (open, reveal in Explorer, copy path), document tabs (close, close others, close all, duplicate, reveal, copy path), and `[[wikilinks]]` (open, copy name) get their own items. The six generic app commands no longer crowd every menu — they only appear on neutral surfaces, never inside text fields.
- **Reveal in File Explorer / Copy Path** for any file opened from disk, resolved main-side so the renderer still never learns filesystem paths.
- **F11** now uses the real OS fullscreen (`win.setFullScreen`), in sync with the title-bar toggle.
- **Enter / Shift+Enter** in the find bar step to the next / previous match.
- **Installer: license page + explicit upgrade/maintenance flow.** Both Windows installers now show the MIT license (English + Arabic) before installing. The NSIS installer detects an already-installed copy and says which flow is happening — upgrade (notes and settings preserved), repair, or a loud downgrade warning — and guides removal to Windows "Installed apps". Detection is read-only: the setup never executes an uninstall command taken from the registry. (This release also fixes a long-standing packaging bug: the NSIS custom include was resolved against the wrong directory, so none of its uninstall pages had ever shipped.)
- **Installer: running-app close prompt (Inno).** The Inno installer explicitly engages the Windows Restart Manager when the app is still running.

### Fixed

- **Every keyboard shortcut broke under an Arabic (or any non-Latin) keyboard layout.** Shortcuts matched `e.key` — the layout-dependent character — so on an Arabic layout Ctrl+S produced «س» and matched nothing, silently. They now match the physical key (`e.code`) as well, so Ctrl+S/Ctrl+O/Ctrl+W work on every layout.
- **Re-opening a note that was already open with unsaved edits destroyed the edits.** Double-clicking an open note in Explorer replaced the in-memory copy with the disk version, no questions asked. The conflict banner (Keep my edits / Reload from disk) now appears instead.
- **The window could become unclosable.** The close prompt round-trip had no timeout; a hung renderer meant the window ignored every close attempt, including Alt+F4. Main now force-closes after a grace period, with the recovery mirror as the data net.
- **Ctrl+Y (Redo) was dead everywhere except inside the editor.** It was advertised in the Edit menu, the shortcut sheet, and the right-click menu; now it works globally.
- **The theme icon duplicated the Reading/Edit toggle in Sepia.** Sepia's theme button borrowed the same open-book glyph as the adjacent view-mode button; it now uses a palette glyph.
- **A failed "open with" opened nothing, silently.** A CLI/open-with file that could not be read now shows an error instead of launching with no file and no message. Several selected files in Explorer now all open (previously only the first).
- **Large folders truncated silently on relaunch** — the restore path now says when the 5000-file cap hid anything.
- **Save As out of an open folder** now tells you the note left the folder's watch/conflict protection, and canceling Save As says the note is still unsaved (previously total silence).

### Changed

- **Full Arabic interface parity for everything users see daily:** the writing toolbar (all 24 tooltips), status bar (folder/word count/cursor position), shortcut sheet, conflict banner, every toast, and the close prompts were English-only; all now follow the Arabic UI. Letter-spacing that breaks the joined Arabic script is neutralized under the RTL chrome, and the search button's ⌘ glyph becomes Ctrl on Windows/Linux.
- **Themed, centered-icon dialog design.** The Save/Don't-Save/Cancel and recovery prompts use the user-picked centered-icon layout (circular document badge, bolded file name, full-width segmented action row) with a dedicated stylesheet — they previously rendered as unstyled browser buttons.
- **Theme-aware design tokens** replace the hard-coded colors (find highlight, callout caution, toast error, tooltips, backdrop), plus a uniform keyboard focus ring (previously invisible on several surfaces) and RTL-flipped navigation arrows in the tab strip and file tree.
- **`npm install` no longer downloads Playwright's Chromium in CI** — a plain local install still fetches it (set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to skip); `npm run browser:install` fetches it explicitly.

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
