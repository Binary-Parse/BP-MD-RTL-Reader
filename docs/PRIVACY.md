# Privacy & Security

BP MD RTL Reader is **local-first**. It is designed so your reading and writing stay
on your own machine — and so that opening an untrusted Markdown file is safe.

## The short version

- ❌ **No telemetry.** No analytics, no usage tracking, no product metrics.
- ❌ **No accounts, no sync, no cloud.** There is nothing to sign in to.
- ❌ **No crash upload.** Crash reporting to any remote server is explicitly disabled.
- ❌ **No auto-update phone-home.** The app never calls out to check for updates.
- ✅ **Your data is yours.** Notes and settings live only on your computer.

## Where your data lives

| What | Where |
| ---- | ----- |
| App settings (`settings.json`) — see **What persists** below | `%APPDATA%\BP MD RTL Reader` |
| Transient caches (GPU, etc.) | `%LOCALAPPDATA%\BP MD RTL Reader` |
| Local diagnostic logs | `%APPDATA%\BP MD RTL Reader\logs\` |
| Your notes | wherever **you** saved them — plain `.md` files |

When you uninstall with the bundled installer, you're asked whether to **keep** your
settings and data or remove everything. Nothing is deleted without your say-so.

## What persists between sessions

So the app reopens the way you left it, a single local file —
`%APPDATA%\BP MD RTL Reader\settings.json` — stores your preferences. It is a plain JSON
file on your machine, written only by you (via the app) and **never transmitted**. It
holds:

- **Appearance & layout** — theme (paper/ink/sepia), editor zoom level, editor mode, and
  whether the sidebar and inspector panels are shown.
- **Recent files** — a short list (max 10) of the **names and file paths** of notes you
  recently opened, so they appear under "Recents". This records *paths only* — never the
  contents of your notes.
- **Window geometry** — the window's last size, position, and maximised state, restored
  on the next launch (clamped to a currently-visible display).

The file also reserves a few fields for upcoming bilingual/RTL options (UI language and
direction, digit style, calendar). These are kept at their defaults today and are not yet
adjustable from the UI, so they do not currently change between sessions.

If this file is missing or corrupt, the app silently falls back to safe defaults — it
never crashes and never loses your notes (your notes are separate `.md` files, untouched
by settings). You can delete `settings.json` at any time to reset every preference.

## Diagnostic logs (local only)

If the app hits an unexpected error, it writes a line to a **rotating local log file**
in your user-data `logs\` folder (capped at ~1 MiB, last three files kept). These logs:

- never leave your machine,
- contain only error messages and stack traces (rate-limited), and
- exist purely so you can attach them to a bug report if you choose to.

Crash minidumps, if any, are written locally too — `crashReporter` is started with
`uploadToServer: false`, so nothing is ever transmitted.

## What the app fetches (and what it doesn't)

The Markdown engine ([marked](https://marked.js.org/)) and the HTML sanitiser
([DOMPurify](https://github.com/cure53/DOMPurify)) are **bundled with the app**. They
load from local files, never the network, so rendering works fully offline.

The one remaining outbound request is for **web fonts** (Inter, Fraunces, JetBrains
Mono, IBM Plex Sans Arabic) from Google Fonts, on first run when you're online. They
carry **no identifiers**, are cached after the first load, and are not used to track
you; offline, the app falls back to system fonts. Self-hosting these fonts to remove the
last request is a tracked follow-up.

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
- **Guarded folder reads** — when you open a vault, reads are restricted to the folder
  you picked, reject UNC/network paths, reject symlinks that escape the folder, and are
  size-bounded (per-file, file-count, and cumulative caps).

If you discover a security issue, please report it privately to **Binary Parse** rather
than opening a public issue.
