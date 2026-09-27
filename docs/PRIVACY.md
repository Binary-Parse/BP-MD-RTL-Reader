# Privacy & Security

BP MD RTL Reader is **local-first**: reading and writing stay on the local machine, and
untrusted Markdown is sanitized before it is rendered.

## Summary

- **No telemetry.** No analytics, usage tracking, or product metrics.
- **No accounts, sync, or cloud.** There is nothing to sign in to.
- **No crash upload.** Crash reporting to any remote server is disabled.
- **No update download, and no update check unless you asked for one.** Network access
  occurs when you choose **Help → Check for Updates…**, and — if you turn it on in
  Settings ▸ Updates — an automatic check at most once a day. Both are described below;
  neither ever downloads or installs anything.
- **Local data.** Notes, settings, highlights, and reading stats are stored only on the
  local machine.

## Where your data lives

| What | Where |
| ---- | ----- |
| App settings (`settings.json`), filesystem grants (`capabilities.json`), highlights & margin notes (`annotations.json`), daily reading stats (`reading-stats.json`), crash-recovery snapshots (`recovery\`), Electron profile state, and local diagnostic logs | `%APPDATA%\bpmdrtlreader` (logs are in `logs\`) |
| Legacy app-data aliases (older installs; the app reads only the directory above — the uninstaller cleans these up) | `%APPDATA%\BP MD RTL Reader`, `%LOCALAPPDATA%\bpmdrtlreader`, and `%LOCALAPPDATA%\BP MD RTL Reader` |
| Your notes | wherever **you** saved them — plain `.md` files |

Both Windows installer families offer three actions before an interactive uninstall:

- **Remove app only** preserves app settings and data so they are available after a
  future reinstall. It is the default selection.
- **Remove app and all app data** removes `%APPDATA%\bpmdrtlreader`,
  `%APPDATA%\BP MD RTL Reader`, `%LOCALAPPDATA%\bpmdrtlreader`, and
  `%LOCALAPPDATA%\BP MD RTL Reader` for the current Windows account.
- **Cancel** exits before the uninstaller changes anything.

The primary button is labeled **Uninstall** for both choices; the selected option controls
whether app data is preserved or deleted. Silent uninstall follows the same rule:
`/S` preserves app data, while `/S /DELETEUSERDATA` explicitly
requests full app-data cleanup. The electron-builder compatibility switch
`--delete-app-data` requests the same comprehensive cleanup. Neither installer derives
cleanup targets from recent paths or filesystem grants, enumerates other Windows
profiles, or deletes Markdown files and other documents from folders where you saved
them. If Windows prevents a requested folder from being deleted, the interactive
uninstaller lists the remaining path instead of reporting complete cleanup.

## What persists between sessions

So the app reopens the way you left it, plain JSON files in
`%APPDATA%\bpmdrtlreader\` store your preferences. They are written only by you (via
the app) and **never transmitted**. `settings.json` holds:

- **Appearance & layout** — theme (paper/ink/sepia/oasis), whether the app follows the
  system colour scheme on first run, editor zoom, Reading/Edit mode, panel visibility,
  UI language/direction, calendar, Arabic kashida, italic color, and the chrome settings
  below (window-title mode, auto-hide top bar, hide status bar).
- **Reading positions** — per note, the last scroll position as a ratio (0–1) with a
  timestamp, plus the note's name and relative display path, so the welcome screen can
  offer "Continue reading". Positions and names only — never note content.
- **Recent files** — a short list (max five) of the **names and relative display paths** of notes you
  recently opened, so they appear under "Recents". This records *paths only* — never the
  contents of your notes. Main-process opaque capability IDs provide the authority to
  reopen them; their absolute path mapping is stored separately in `capabilities.json`.
- **Window geometry** — the window's last size, position, and maximised state, restored
  on the next launch (clamped to a currently-visible display).
- **Last session** — an opaque grant for the last folder plus its active relative note
  path. On launch the app re-reads the folder from disk; it does not persist note content,
  unsaved edits, standalone tabs, or each folder tab's open/closed state.

Two more local files hold the reading features:

- `annotations.json` — your highlights and margin notes, keyed by an opaque document
  identifier. The file stores the highlighted text, your note text, and an anchor; it
  is never transmitted, and the annotations channel carries text only (no paths).
- `reading-stats.json` — daily reading-minute totals (two years) so the welcome line
  can show your streak against the optional daily goal. Local only.

## What the window title shows

By default the OS window title is the **name of the note you have open** — so Windows
shows it in the taskbar, in the Alt+Tab switcher, and in window-picker previews. That
makes a file name visible to anyone who can see your screen, including during a screen
share or a screen recording. Nothing is transmitted; this is local display only.

Set **Settings → Window title → App name** (or View ▸ Settings…) to show only
"BP MD RTL Reader" instead. The choice is stored in `settings.json` like any other
preference. Note contents are never placed in the title — only the file name.

If this file is missing or corrupt, the app falls back to default settings. Notes are
separate `.md` files and are not affected by settings. You can delete `settings.json` at
any time to reset every preference.

## Diagnostic logs (local only)

If the app hits an unexpected error, it writes a line to a **rotating local log file**
in your user-data `logs\` folder (capped at ~1 MiB, last three files kept). These logs:

- never leave your machine,
- contain only error messages and stack traces (rate-limited), and
- exist purely so you can attach them to a bug report if you choose to.

Crash minidumps, if any, are written locally too — `crashReporter` is started with
`uploadToServer: false`, so nothing is ever transmitted.

## What the app fetches (and what it doesn't)

The renderer makes **zero outbound network requests**, enforced by its strict
Content-Security-Policy (`connect-src 'self'`). Every rendering asset ships inside the
app. Packaged builds load the UI over the privileged `app://ui/…` scheme (HTML, scripts,
styles, and fonts from `src/renderer/` and `resources/vendor/` inside `app.asar`). Vault
images use `bpmd://`. Neither scheme talks to the network:

- the Markdown engine ([marked](https://marked.js.org/)) and the HTML sanitiser
  ([DOMPurify](https://github.com/cure53/DOMPurify)),
- math, syntax highlighting, and diagrams (KaTeX, highlight.js, Mermaid), and
- all four font families (Inter, Literata, JetBrains Mono, IBM Plex Sans Arabic), vendored
  as local `woff2` files under `resources/vendor/fonts/`.

Rendering works fully offline: no font, library, image, or note content is fetched from a
CDN or remote server.

There is one narrow main-process exception. When you choose **Help → Check for
Updates…** — and, if you enable **Settings ▸ Updates → Check for updates automatically**,
at most once a day after that — the app sends an HTTPS `GET` to
`https://api.github.com/repos/Binary-Parse/BP-MD-RTL-Reader/releases/latest` with
GitHub's JSON `Accept` header and a `BP-MD-RTL-Reader` User-Agent. It sends no note content,
stored path, account identifier, or telemetry; ordinary network metadata such as IP
address and request headers is visible to GitHub. The command reads public release
metadata only: it neither downloads nor installs an update — when the automatic check
finds a newer release it shows a local notice, whose "View release" button opens the
project's releases page (one fixed URL the app owns). On an offline machine the
request fails and the rest of the app continues to work.

## Security model

BP MD RTL Reader follows current Electron hardening guidance:

- **Isolated renderer** — `contextIsolation: true`, `nodeIntegration: false`. The page
  that renders your Markdown has no direct access to Node.js, the filesystem, or the
  shell. Packaged windows load that page over `app://`, not `file://` inside the asar
  archive (Electron fuses deny extra `file://` privileges).
- **Minimal preload bridge** — the renderer can only call a small, explicit set of
  IPC methods exposed via `contextBridge`. There is no `require`, no `eval`, no
  arbitrary file write.
- **Sanitised output** — all rendered Markdown passes through DOMPurify, which strips
  `<script>`, event handlers, and other active content. Opening a hostile `.md` file
  cannot run code.
- **Guarded folder reads** — when you open a folder, reads are restricted to the folder
  you picked, reject UNC network paths (`\\server\share` and `//server/share`), reject
  symlinks that escape the folder, and are size-bounded (per-file, file-count, and
  cumulative caps). One limitation, stated plainly: a **drive-letter mapped share**
  (e.g. `Z:\notes`) is indistinguishable from a local drive by any pure-Node check, so
  it is not rejected. On such a share the folder watcher cannot run — the
  external-change indicator and conflict banner will not appear for edits made by
  other programs, and saving uses atomic-rename over the network. Keep vaults on a
  local (or properly local-synced) folder for full data-safety behavior.

If you discover a security issue, please report it privately to **Binary Parse** rather
than opening a public issue.
