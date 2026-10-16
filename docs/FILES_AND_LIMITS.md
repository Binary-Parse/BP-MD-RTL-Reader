# Files and limits

This page is a reference. It lists the files the app can open, the encodings it understands, every size limit, and every file the app keeps in its profile folder.

## Contents

- [Supported files](#supported-files)
- [Encodings](#encodings)
- [Size tiers](#size-tiers)
- [Large-file mode](#large-file-mode)
- [Folder limits](#folder-limits)
- [Export limits](#export-limits)
- [Other limits](#other-limits)
- [The profile folder](#the-profile-folder)
- [What the app remembers](#what-the-app-remembers)
- [Good to know](#good-to-know)

## Supported files

| Task | Accepted files |
| ---- | -------------- |
| **Open File** dialog | `.md`, `.markdown` |
| Open a folder | `.md`, `.markdown`. A `.txt` file is not listed in a folder |
| Drag and drop onto the window | `.md`, `.markdown`, `.txt` |
| Open from your file manager | `.md`, `.markdown`, after [file association](INSTALL.md#set-up-file-association) |
| Save and Save As | `.md`, `.markdown` only |
| Export | `.html`, `.pdf`, `.epub` |

The app opens plain files on disk. It has no database and no proprietary format.

The app does not support network locations such as `\\server\share`. Folder reads reject them, and saving to one is refused. See [Troubleshooting](TROUBLESHOOTING.md#folder-on-a-network-drive).

## Encodings

| Encoding | Notes |
| -------- | ----- |
| UTF-8 | The default |
| UTF-16 LE and BE | Recognized with or without a byte-order mark |
| Windows-1256 | The legacy Arabic code page |

Every save keeps the file's own encoding, byte-order mark, line endings and final-newline style. In a file that mixes CRLF and LF, each line you did not edit keeps its own ending. The status bar shows **Mixed** for such a file.

Two special cases:

- **A guess.** When the app cannot be sure of the encoding, for example a UTF-8 note with a damaged byte, a bar above the note names the guess. Choose **Keep** *encoding* or **Reopen as** *encoding*. The note is not saved until you answer.
- **A character the code page cannot hold.** A Windows-1256 note that now contains an emoji cannot be saved as it is. Save refuses and offers to save the file as UTF-8, which keeps every character.

## Size tiers

| Size of the file | What happens |
| ---------------- | ------------ |
| Under 5 MiB | Opens normally |
| 5 to 20 MiB | Opens, and a message says the note is large. The preview is not redrawn while you type. It is drawn when you switch to Reading mode, which can take several seconds, and the app says so first |
| 20 to 100 MiB | The app asks before it opens the note. It then opens in [large-file mode](#large-file-mode) |
| Over 100 MiB | Not opened, and not saved. A message names the limit |

These rules are the same for **Open File**, a dropped file, and a note opened from the file manager ("Open with") or the command line.

The limit counts the file as it is stored on disk. A large Windows-1256 note that opens also saves unchanged. As UTF-8 it can take up to twice the space.

The tier follows the note. If a save, or a reload from disk, moves a note across 5 MiB or 20 MiB, it moves into the new tier and is shown again, with the cursor where it was.

## Large-file mode

Large-file mode keeps typing quick in a very large note. In this mode:

- Live-preview styling, syntax coloring, find highlights and the outline are off.
- Reading mode shows a notice and a **Render anyway** button instead of drawing the note.
- **Render anyway** draws on demand. It can take a minute or more. It draws at most the first 20 million characters. The rest stays in the editor.
- Folder search still finds text in the note, but matching is case-sensitive and does not fold Arabic letter forms.
- Word counts are estimates.
- A single line of more than 8 million characters is shown without line wrapping.

## Folder limits

When you open a folder, the app reads every note in it at once. These limits keep that safe:

| Limit | Value |
| ----- | ----- |
| Files listed | At most 5,000 `.md` and `.markdown` files in the whole folder |
| Depth | 12 folder levels |
| One note | 20 MiB. A larger note is left out. Open it with **Open File** |
| All notes together | 100 MiB |
| Symlinks | A link that points outside the folder is skipped |

When a limit is reached, the app tells you:

- "Folder is large — showing the first {n} files" when there are too many files.
- "{n} files could not be shown (unreadable, oversized, or unsafe links)" for files it skipped.
- "Skipped {n} notes over 20 MB. Open them one at a time with Open File." for oversized notes.

## Export limits

| Export | Largest note | Notes |
| ------ | ------------ | ----- |
| HTML | 256 MiB | Images are embedded |
| PDF | 64 MiB | Has a time limit, below |
| EPUB | 64 MiB | |

Past the limit, the export stops and the message names the limit. An export over 5 MiB shows a message that it may take a while. The message stays until the export finishes or you cancel.

A PDF has a time limit that grows with the size: 30 seconds plus 10 seconds per MiB, at most 5 minutes. If the limit is reached, the message says it took too long.

## Other limits

| What | Limit |
| ---- | ----- |
| Highlight length | 5,000 characters each |
| Highlights per note | 500 |
| `annotations.json` | 2 MB |
| Math expression | 32 KB |
| Code block that gets syntax colors | 256 KB |
| A line previewed in Edit mode | 5,000 characters |
| Characters read to decide a line's direction | 8,192 |
| Recent files | 5 |
| **Continue reading** shelf | 4 notes |
| Reading positions kept | 30 notes |
| Reading minutes kept | 730 days |
| Notes in a recovery snapshot | 20 |
| Zoom | 60% to 200% |
| Reading text size | 80% to 200% |
| Reading width | 48 to 120 characters |
| Auto-save delay | About 15 seconds after you stop typing |
| Delete-highlight **Undo** | 6 seconds |
| Retry on a locked file | About 0.4 seconds |
| Window crash loop | Two reloads in one minute, then the app asks |
| Manual update check | Once a minute at most |

## The profile folder

The app keeps its own files in a profile folder, separate from your notes.

| System | Location |
| ------ | -------- |
| Windows | `%APPDATA%\bpmdrtlreader` |
| Linux | `~/.config/bpmdrtlreader`, or `$XDG_CONFIG_HOME/bpmdrtlreader` |

| File or folder | What it holds |
| -------------- | ------------- |
| `settings.json` | Your preferences. See [What the app remembers](#what-the-app-remembers) |
| `capabilities.json` | Opaque grants mapped to the files and folders you picked, so the app can reopen them |
| `annotations.json` | Your highlights and margin notes, keyed by an opaque note id |
| `reading-stats.json` | Reading minutes per day, for the streak line |
| `recovery\` | Snapshots of unsaved notes. See [Recover unsaved work](USER_GUIDE.md#recover-unsaved-work) |
| `logs\` | Local diagnostic logs. See [Privacy](PRIVACY.md#logs-and-crash-dumps) |
| Other files | Electron's own profile state |

If `settings.json` is missing or damaged, the app uses default settings. Your notes are not affected. Delete `settings.json` at any time to reset every preference. A damaged file is set aside, not deleted.

The portable Windows build keeps its data in a `BP-MD-RTL-Reader-data` folder beside the `.exe`, so the app and its settings, highlights and grants travel together, for example on a USB stick. On its first start it copies your data from `%APPDATA%\bpmdrtlreader` once; the original stays for an installed copy. If the folder beside the `.exe` cannot be written, for example on a read-only drive, it uses `%APPDATA%\bpmdrtlreader` instead. On another computer, or after the drive letter changes, open your folders again: a grant names the path it was given.

[Privacy](PRIVACY.md#what-the-app-stores) explains what each file contains. [Install](INSTALL.md#uninstall) explains how to remove the folder.

## What the app remembers

The app saves how you left it, in `settings.json`:

- **Look and layout.** Theme, zoom, Reading or Edit mode, whether the sidebar and inspector are open, interface language and direction, calendar, kashida, italics color, reading size and width, and whether margin notes are folded.
- **Settings.** Window title, auto-hide top bar, hide status bar, auto-save, follow system color scheme, automatic update check and daily reading goal.
- **Recent files.** Up to five. The app stores names and relative display paths, never note content.
- **Window.** Size, position and maximized state, kept inside a screen that is currently visible.
- **Last session.** A grant for your last folder and its active note. On launch the app rereads the folder from disk and opens that note. It does not restore standalone files, tabs, or unsaved edits.
- **Reading positions.** For each note, how far you were, so the welcome screen can show **Continue reading** with a percentage and a relative time. The app records a position while you read in Reading mode. The editor keeps its own scroll position for the session only.

Two more files hold reading features:

- **Highlights and margin notes** are in `annotations.json`. See [Highlights and margin notes](USER_GUIDE.md#highlights-and-margin-notes).
- **Reading streak.** `reading-stats.json` holds one total per day. Minutes count while Reading mode is on screen in a visible window. The daily goal only decides what the welcome line says. Nothing ever prompts you. The same minutes draw a 12-week heat grid beside the line, with one square per day.

Unsaved edits are never written to `settings.json`. They go to the recovery snapshot instead.

If you install an older version over a newer one, the older version does not know the newer settings. It resets them to their defaults the next time it saves. Nothing else changes. `annotations.json` and `reading-stats.json` stay in place for the next newer version.

## Good to know

A file or folder name can be written with a precomposed `é` or with an `e` followed by a combining accent. When both spellings lead to the same file, the app treats them as one note. When they are two real files, as Windows and Linux allow, they stay two notes.
