# Privacy & Security

BP MD RTL Reader is **local-first**: reading and writing stay on the local machine, and
untrusted Markdown is sanitized before it is rendered.

## Summary

- **No telemetry.** No analytics, usage tracking, or product metrics.
- **No accounts, sync, or cloud.** There is nothing to sign in to.
- **No crash upload.** Crash reporting to any remote server is disabled.
- **No automatic update check or download.** Network access occurs only when you choose
  **Help → Check for Updates…**; that request is described below.
- **Local data.** Notes and settings are stored only on the local machine.

## Where your data lives

| What | Where |
| ---- | ----- |
| App settings (`settings.json`), filesystem grants (`capabilities.json`), Electron profile state, and local diagnostic logs | `%APPDATA%\bpmdrtlreader` (logs are in `logs\`) |
| Supported legacy app-data aliases | `%APPDATA%\BP MD RTL Reader`, `%LOCALAPPDATA%\bpmdrtlreader`, and `%LOCALAPPDATA%\BP MD RTL Reader` |
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

So the app reopens the way you left it, a single local file —
`%APPDATA%\bpmdrtlreader\settings.json` — stores your preferences. It is a plain JSON
file on your machine, written only by you (via the app) and **never transmitted**. It
holds:

- **Appearance & layout** — theme (paper/ink/sepia), editor zoom, Reading/Edit mode,
  panel visibility, UI language/direction, calendar, Arabic kashida, and italic color.
- **Recent files** — a short list (max five) of the **names and relative display paths** of notes you
  recently opened, so they appear under "Recents". This records *paths only* — never the
  contents of your notes. Main-process opaque capability IDs provide the authority to
  reopen them; their absolute path mapping is stored separately in `capabilities.json`.
- **Window geometry** — the window's last size, position, and maximised state, restored
  on the next launch (clamped to a currently-visible display).
- **Last session** — an opaque grant for the last folder plus its active relative note
  path. On launch the app re-reads the folder from disk; it does not persist note content,
  unsaved edits, standalone tabs, or each folder tab's open/closed state.

The settings schema reserves a `numerals` field, but the current UI does not expose or
apply a digit-style setting. It should not be treated as a user-visible persisted option.

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
app and loads from local files:

- the Markdown engine ([marked](https://marked.js.org/)) and the HTML sanitiser
  ([DOMPurify](https://github.com/cure53/DOMPurify)),
- math, syntax highlighting, and diagrams (KaTeX, highlight.js, Mermaid), and
- all four font families (Inter, Fraunces, JetBrains Mono, IBM Plex Sans Arabic), vendored
  as local `woff2` files under `assets/vendor/fonts/`.

Rendering works fully offline: no font, library, image, or note content is fetched from a
CDN or remote server.

There is one narrow main-process exception. If—and only if—you choose **Help → Check for
Updates…**, the app sends an HTTPS `GET` to
`https://api.github.com/repos/Binary-Parse/BP-MD-RTL-Reader/releases/latest` with
GitHub's JSON `Accept` header and a `BP-MD-RTL-Reader` User-Agent. It sends no note content,
stored path, account identifier, or telemetry; ordinary network metadata such as IP
address and request headers is visible to GitHub. The command reads public release
metadata only: it neither downloads nor installs an update. On an offline machine the
request fails and the rest of the app continues to work.

## Security model

BP MD RTL Reader follows current Electron hardening guidance:

- **Isolated renderer** — `contextIsolation: true`, `nodeIntegration: false`. The page
  that renders your Markdown has no direct access to Node.js, the filesystem, or the
  shell.
- **Minimal preload bridge** — the renderer can only call a small, explicit set of
  IPC methods exposed via `contextBridge`. There is no `require`, no `eval`, no
  arbitrary file write.
- **Sanitised output** — all rendered Markdown passes through DOMPurify, which strips
  `<script>`, event handlers, and other active content. Opening a hostile `.md` file
  cannot run code.
- **Guarded folder reads** — when you open a folder, reads are restricted to the folder
  you picked, reject UNC/network paths, reject symlinks that escape the folder, and are
  size-bounded (per-file, file-count, and cumulative caps).

If you discover a security issue, please report it privately to **Binary Parse** rather
than opening a public issue.
