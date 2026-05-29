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
| Settings, recent files, window/theme state | `%APPDATA%\BP MD RTL Reader` |
| Transient caches (GPU, etc.) | `%LOCALAPPDATA%\BP MD RTL Reader` |
| Local diagnostic logs | `%APPDATA%\BP MD RTL Reader\logs\` |
| Your notes | wherever **you** saved them — plain `.md` files |

When you uninstall with the bundled installer, you're asked whether to **keep** your
settings and data or remove everything. Nothing is deleted without your say-so.

## Diagnostic logs (local only)

If the app hits an unexpected error, it writes a line to a **rotating local log file**
in your user-data `logs\` folder (capped at ~1 MiB, last three files kept). These logs:

- never leave your machine,
- contain only error messages and stack traces (rate-limited), and
- exist purely so you can attach them to a bug report if you choose to.

Crash minidumps, if any, are written locally too — `crashReporter` is started with
`uploadToServer: false`, so nothing is ever transmitted.

## What the app fetches (and what it doesn't)

The app itself makes **no network requests**. The reading view, however, loads three
**content-only** assets from public CDNs on first run when you're online:

| Asset | Purpose |
| ----- | ------- |
| [marked](https://marked.js.org/) | Markdown → HTML parsing |
| [DOMPurify](https://github.com/cure53/DOMPurify) | Sanitising the rendered HTML |
| Google Fonts (Inter, Fraunces, JetBrains Mono, IBM Plex Sans Arabic) | Typography |

These are fetched with **Subresource Integrity** hashes (so tampered files are
rejected), carry **no identifiers**, and are cached after the first load. They are not
used to track you. If you're offline, the app falls back gracefully.

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
