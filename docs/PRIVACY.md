# Privacy

BP MD RTL Reader is local-first. Reading and writing stay on your computer. This page lists what the app stores, what it can send over the network, what it logs, and how to remove its data. For the security model and how to report a vulnerability, see [the security policy](../SECURITY.md).

## Contents

- [Summary](#summary)
- [What the app stores](#what-the-app-stores)
- [Remove the app data](#remove-the-app-data)
- [Network access](#network-access)
- [Links, images and fonts](#links-images-and-fonts)
- [Temporary files](#temporary-files)
- [Logs and crash dumps](#logs-and-crash-dumps)
- [What the window title shows](#what-the-window-title-shows)

## Summary

- **No telemetry.** The app has no analytics, no usage tracking and no product metrics.
- **No accounts, sync or cloud.** There is nothing to sign in to.
- **No crash upload.** Crash reporting to a remote server is turned off.
- **One optional network request.** The app contacts the network only to check for a newer release, and only when you choose **Help → Check for Updates…** or turn on the automatic check in Settings. It never downloads or installs anything. See [Network access](#network-access).
- **Local data.** Your notes, settings, highlights and reading stats stay on your computer.
- **No spellcheck download.** The built-in spellchecker is off, so no dictionary is ever fetched.

## What the app stores

Your Markdown notes stay wherever you saved them, as plain `.md` files. The app keeps its own data in a separate profile folder:

| System | Location |
| ------ | -------- |
| Windows | `%APPDATA%\bpmdrtlreader` |
| Linux | `~/.config/bpmdrtlreader`, or `$XDG_CONFIG_HOME/bpmdrtlreader` |

None of these files is ever sent anywhere. The profile folder holds:

| File or folder | What it holds |
| -------------- | ------------- |
| `settings.json` | Preferences, recent files, reading positions, window size and the last session. Details below |
| `capabilities.json` | Opaque grants mapped to the absolute paths of the files and folders you picked |
| `annotations.json` | Your highlights and margin notes: the highlighted text, your note text and an anchor. It is keyed by an opaque note id and carries no paths |
| `reading-stats.json` | Reading minutes per day for up to two years |
| `recovery\` | Crash-recovery snapshots of unsaved notes. See below |
| `logs\` | Diagnostic logs. See [Logs and crash dumps](#logs-and-crash-dumps) |
| Other files | Electron's own profile state |

### What `settings.json` holds

- **Look and layout.** Theme, zoom, Reading or Edit mode, panel visibility, interface language and direction, calendar, kashida, italics color, and the window title and bar settings.
- **Reading positions.** For each note, the last position as a number from 0 to 1, a timestamp, and the note's name and relative path. Positions and names only, never note content. The app keeps 30 notes.
- **Recent files.** Up to five names and relative display paths. Never content.
- **Window geometry.** Size, position and maximized state.
- **Last session.** An opaque grant for your last folder and its active note path. The app does not store note content, unsaved edits, standalone tabs or open tab state.

### Recovery snapshots hold your text

While you work, the app copies your unsaved notes to `recovery\snapshot.json` and `live.json` in the profile folder. The full text of those notes is stored there as plain, unencrypted JSON. The app copies up to 20 notes, about every 10 seconds. A large note is copied at most every 30 seconds.

The snapshot stays until you choose **Restore** or **Discard** on the recovery prompt. If you work on private notes on a shared computer, remember that this file exists. A normal close that saves or discards your notes does not leave a snapshot to offer.

### Reset your data

If `settings.json` is missing or damaged, the app uses defaults. Your notes are separate files and are not affected. You can delete `settings.json` at any time to reset every preference.

## Remove the app data

On Windows, both installers offer these choices before an interactive uninstall:

- **Remove app only** keeps app settings and data, so they are there after a future reinstall. It is the default.
- **Remove app and all app data** removes `%APPDATA%\bpmdrtlreader`, `%APPDATA%\BP MD RTL Reader`, `%LOCALAPPDATA%\bpmdrtlreader` and `%LOCALAPPDATA%\BP MD RTL Reader` for the current Windows account.
- **Cancel** exits before the uninstaller changes anything.

The primary button is labeled **Uninstall** for both choices. The selected option controls whether the data is kept or deleted.

A silent uninstall keeps the app data unless you add `/DELETEUSERDATA`. The silent switch is `/S` for the NSIS uninstaller and `/SILENT` or `/VERYSILENT` for the Inno uninstaller. The NSIS uninstaller also accepts the electron-builder switch `--delete-app-data`. See [Install](INSTALL.md) for the full table.

The uninstallers never use your recent paths or file grants to decide what to delete. They do not look at other Windows accounts, and they do not delete Markdown files or other documents from the folders where you saved them. If Windows prevents a requested folder from being deleted, the interactive uninstaller lists the folder that remains instead of saying cleanup is complete.

The last three folders are older locations. The app reads only `%APPDATA%\bpmdrtlreader`. The uninstaller cleans the others up.

On Linux, removing the package or deleting the AppImage leaves the profile folder in place. Delete it yourself to remove the app data. See [Install](INSTALL.md#uninstall).

## Network access

The app's page makes no network requests. A strict content policy blocks them. Every library and all four font families ship inside the app, so rendering works fully offline.

There is one exception in the app's main process: the update check.

### When it runs

- When you choose **Help → Check for Updates…**. The app limits manual checks to one per minute.
- If you turn on **Settings → Updates → Check for updates automatically** (off by default): once when the app starts, after the window loads, and then every 24 hours while the app keeps running.

### What it sends

One HTTPS `GET` request to `https://api.github.com/repos/Binary-Parse/BP-MD-RTL-Reader/releases/latest`, with GitHub's JSON `Accept` header and a `BP-MD-RTL-Reader` User-Agent. It sends no note content, stored path, account identifier or telemetry. GitHub can see ordinary network metadata, such as your IP address and the request headers.

The request has a 15-second timeout and follows no redirects. The app accepts the answer only from a server whose certificate chain contains a public key this version knows. If it does not, the app reads no data, says the check was not made, and offers the releases page.

### What it does with the answer

It reads public release information only. It never downloads or installs an update. When the automatic check finds a newer release, the app shows a notice. Its **View release** button opens the project's releases page, which is one fixed address the app owns. On an offline computer, the request fails and the rest of the app keeps working.

## Links, images and fonts

- **Links open in your system.** When you click an `http:`, `https:`, `mailto:` or `tel:` link in a note, the app hands it to your default program, such as your browser. This happens only when you click. The app itself makes no request. Other kinds of link are blocked.
- **Remote images never load.** The content policy allows only images from the app, from `data:` addresses and from the folder you opened. A note cannot make your computer fetch an image from a server.
- **Fonts and libraries are local.** The Markdown engine, the sanitizer, math, syntax highlighting, diagrams and the four font families (Inter, Literata, JetBrains Mono and IBM Plex Sans Arabic) are bundled with the app.

## Temporary files

A PDF export writes a temporary file named `bpmd-export-<id>.html` in your system's temp folder. The app deletes it after the export. If a file is left behind, for example after a crash, the next export removes leftovers older than one hour.

A save writes the note to a temporary file next to it, named like `note.md.tmp-<id>`, and then renames it over the note. That keeps a crash from leaving half a file. If a crash leaves a temporary file behind, the app removes it the next time you open that folder, once it is older than one hour.

## Logs and crash dumps

If the app hits an unexpected error, it writes a line to `bpmdrtlreader.log` in the `logs` folder of the profile folder. The app keeps the current file and three older ones, so up to four files. A file rotates at about 1 MiB.

The logs:

- never leave your computer,
- hold only error messages and stack traces, written at a limited rate, and
- exist so you can attach them to a bug report if you choose to.

Crash dumps, if any, are written locally too. The app starts its crash reporter with uploading turned off, so nothing is transmitted.

## What the window title shows

By default, the title of the window is the name of the note you have open. The system shows it in the taskbar, in the Alt+Tab switcher and in window previews. That makes a file name visible to anyone who can see your screen, including during a screen share or recording. Nothing is transmitted.

To show only "BP MD RTL Reader", set **Settings → Window title → App name**. Note contents are never placed in the title.
