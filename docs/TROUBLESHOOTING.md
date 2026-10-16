# Troubleshooting

This page lists problems by what you see, with the fix for each. If your problem is not here, see [Report a problem](#report-a-problem) at the end.

## Contents

- [Install and start](#install-and-start)
  - [Windows shows "Windows protected your PC"](#windows-shows-windows-protected-your-pc)
  - [The AppImage does not start](#the-appimage-does-not-start)
  - [The app exits at once when I start it with a switch](#the-app-exits-at-once-when-i-start-it-with-a-switch)
  - [The window has no top bar or status bar](#the-window-has-no-top-bar-or-status-bar)
  - [I cannot drag the window](#i-cannot-drag-the-window)
- [Open and save](#open-and-save)
  - [A bar says the encoding is a guess](#a-bar-says-the-encoding-is-a-guess)
  - [Save fails](#save-fails)
  - [A banner says the note changed on disk](#a-banner-says-the-note-changed-on-disk)
  - [Folder on a network drive](#folder-on-a-network-drive)
  - [A folder shows fewer notes than it holds](#a-folder-shows-fewer-notes-than-it-holds)
  - [My unsaved notes disappeared](#my-unsaved-notes-disappeared)
- [Large notes](#large-notes)
  - [A note opens in large-file mode](#a-note-opens-in-large-file-mode)
  - [Typing lags in a note of 5 to 20 MB](#typing-lags-in-a-note-of-5-to-20-mb)
- [What I see](#what-i-see)
  - [My images do not show](#my-images-do-not-show)
  - [A line runs in the wrong direction](#a-line-runs-in-the-wrong-direction)
  - [A shortcut does nothing](#a-shortcut-does-nothing)
  - [A wiki-link says no note was found](#a-wiki-link-says-no-note-was-found)
  - [I cannot highlight my selection](#i-cannot-highlight-my-selection)
- [Export and update](#export-and-update)
  - [PDF export fails](#pdf-export-fails)
  - [The update check was not made](#the-update-check-was-not-made)
- [Reset and report](#reset-and-report)
  - [Reset all settings](#reset-all-settings)
  - [Find the logs](#find-the-logs)
  - [Report a problem](#report-a-problem)

## Install and start

### Windows shows "Windows protected your PC"

The installers are not code-signed, so SmartScreen warns about them. First check the download against `SHA256SUMS.txt` (see [Check your download](INSTALL.md#check-your-download)). Then choose **More info**, then **Run anyway**.

### The AppImage does not start

Try these in order:

1. Make the file executable: `chmod +x <file>.AppImage`.
2. Install the `.deb` package instead. It installs Chromium's sandbox helper, which an AppImage cannot carry. [The security policy](../SECURITY.md) explains the difference.
3. Run the AppImage from a terminal and read the message it prints. A sandbox error on a recent Ubuntu usually means the system restricts user namespaces.
4. If the message mentions FUSE, install FUSE 2 for your distribution (unsure: this depends on your distribution), or run the `.deb` instead.

### The app exits at once when I start it with a switch

A release build refuses to start with `--remote-debugging-port`, `--remote-debugging-pipe` or `--inspect`. This is deliberate. A debugger could read and drive every page of the app. Start the app without the switch.

### The window has no top bar or status bar

You hid the bars and can no longer reach the menus. To bring them back:

- Press `Ctrl+Shift+T` to show the top bar and `Ctrl+Shift+B` to show the status bar. Or move the pointer to the top edge of the window.
- If the window is unusable, quit the app, then start it once with `--reset-chrome`. For example, on Windows:

  ```powershell
  & "C:\Program Files\BP MD RTL Reader\BP MD RTL Reader.exe" --reset-chrome
  ```

  On Linux, add `--reset-chrome` to the command you use to start the app.

The switch shows both bars again. It leaves every other setting, your recent files and your window position alone. Quit the app first. If the app is already running, the switch is saved for the next start instead of applied at once.

### I cannot drag the window

The top bar is hidden, and a frameless window moves by its top bar. Move the pointer to the top edge, wait for the bar to appear, then drag it. Or press `Ctrl+Shift+T`.

## Open and save

### A bar says the encoding is a guess

The app could not be sure how the file is encoded, for example a UTF-8 note with a damaged byte. The bar names its guess.

- Choose **Keep** *encoding* if the text looks right.
- Choose **Reopen as** *encoding* and pick another encoding if the text shows wrong characters.

The note is not saved until you answer. See [Encodings](FILES_AND_LIMITS.md#encodings).

### Save fails

The message names the cause:

| Message says | What to do |
| ------------ | ---------- |
| Another program is using the file, or it is read-only | Close the other program, or clear the read-only flag. The app already retried for a moment |
| The disk is full | Free some space, then save again |
| Its folder no longer exists | Use **Save As** to pick a new place |
| It was changed on disk | Resolve it with the banner. See the next section |
| It is larger than the limit | A note over 100 MB cannot be saved. See [Size tiers](FILES_AND_LIMITS.md#size-tiers) |
| Only `.md` and `.markdown` files can be saved | Use **Save As** and choose one of those extensions |
| Network locations are not supported | Save to a local folder |

Your text stays in the tab, and the recovery snapshot keeps copying it.

### A banner says the note changed on disk

Another program changed the file while you had unsaved edits. Choose one:

- **Keep my edits.** You keep your version. Save to overwrite the disk copy.
- **Reload from disk.** You get the disk version and lose your unsaved edits.

### Folder on a network drive

The app rejects network paths such as `\\server\share` and `//server/share`. It also rejects symlinks that point outside the folder.

A drive-letter share such as `Z:\notes` looks like a local drive to the app, so it is not rejected. On such a share the folder watcher cannot run. The changed-on-disk banner will not appear for edits made by other programs, and saving uses an atomic rename over the network.

Keep your notes on a local folder, or a properly local-synced folder, for the full safety behavior.

### A folder shows fewer notes than it holds

The app lists only `.md` and `.markdown` files, so `.txt` files are not shown. It also stops at these limits:

- 5,000 files in the folder and its subfolders.
- 12 levels of subfolders.
- 20 MiB for one note, and 100 MiB for all notes together.

The app tells you when it left files out: "Folder is large — showing the first {n} files" or "{n} files could not be shown". Open a note that is too large with **Open File**. See [Folder limits](FILES_AND_LIMITS.md#folder-limits).

### My unsaved notes disappeared

If the app closed without a chance to save, the next launch asks **Recover unsaved notes?** Choose **Restore**. If you closed that prompt, the snapshot is still there, and the next launch asks again.

If you closed the app normally and chose not to save, nothing is kept on purpose. See [Recover unsaved work](USER_GUIDE.md#recover-unsaved-work).

## Large notes

### A note opens in large-file mode

Notes between 20 MiB and 100 MiB open in large-file mode, after the app asks. Reading mode shows a **Render anyway** button instead of drawing the note. Click it to draw the note. It can take a minute or more and shows at most the first 20 million characters. See [Large-file mode](FILES_AND_LIMITS.md#large-file-mode).

### Typing lags in a note of 5 to 20 MB

This is a known limitation. In Edit mode, typing in a note of 5 to 20 MB can lag, about a second per key near 20 MB. Syntax coloring stays on below 20 MB, and that is the cost. Reading mode is not affected.

No known issue affects the content of your notes. To avoid the lag, split the note into files under 5 MB. Reading a large note in Reading mode is fine.

## What I see

### My images do not show

Images show in two cases only: a data URI, or a file inside the folder you opened, written as a relative path. Remote images (`https://…`) never display, by design, so a note cannot make your computer contact a server. A note opened with **Open File** has no folder, so relative images do not load either. See [Images](MARKDOWN_SYNTAX.md#images).

Exports show every image that is not embedded as `[Image: alt text]`.

### A line runs in the wrong direction

Direction is decided per block. See [How direction is decided](RTL.md#how-direction-is-decided). To fix one block, pin it: click its badge in Reading mode, or press `Ctrl+D` in Edit mode. To fix the whole note, use `Ctrl+Shift+L`, or add `direction: rtl` to the front matter.

### A shortcut does nothing

Check these:

- **A dialog or the command palette is open.** Close it with `Esc`.
- **You are in Reading mode.** Editing shortcuts need Edit mode. Press `Ctrl+E`.
- **A text field has focus.** `Ctrl+Shift+B` is ignored there.
- **Your keyboard layout has no Latin letters.** The shortcut is the key in the same position as on a US keyboard.

The full list is in [Keyboard shortcuts](KEYBOARD_SHORTCUTS.md).

### A wiki-link says no note was found

A wiki-link finds notes that are open or listed in an open folder, by file name. Open the folder that holds the target. Case and `.md` do not matter. See [Link notes with wiki-links](USER_GUIDE.md#link-notes-with-wiki-links).

### I cannot highlight my selection

A highlight must sit inside one paragraph and one run of text. A selection that crosses a paragraph, or a bold, italic or code boundary, is not offered a highlight. A highlight can also be at most 5,000 characters. Select a shorter piece of text.

## Export and update

### PDF export fails

The message tells you why:

- **The note is too large.** PDF export is limited to 64 MiB of output.
- **It took too long.** A PDF has a time limit that grows with the size, up to 5 minutes. Try HTML export, or export a smaller note.

See [Export limits](FILES_AND_LIMITS.md#export-limits).

### The update check was not made

The message depends on the cause:

- **"Could not check for updates."** You are probably offline. The rest of the app works. Look at the releases page yourself.
- **"The update check was not made: GitHub's certificate is not one this version knows."** The app only accepts GitHub's answer when its certificate chain matches a key the app knows. If GitHub changed its certificates, this version cannot check. Look at the releases page yourself. A newer release will have updated keys.

See [Privacy](PRIVACY.md#network-access).

## Reset and report

### Reset all settings

Quit the app, then delete `settings.json` from the [profile folder](FILES_AND_LIMITS.md#the-profile-folder). Your notes and highlights are not affected.

### Find the logs

The app writes errors to `logs\bpmdrtlreader.log` inside the profile folder. It keeps the current file and three older ones. The logs stay on your computer.

| System | Folder |
| ------ | ------ |
| Windows | `%APPDATA%\bpmdrtlreader\logs` |
| Linux | `~/.config/bpmdrtlreader/logs` |

Crash dumps, if any, are also written locally. Nothing is uploaded.

### Report a problem

Open an issue on the [GitHub issue tracker](https://github.com/Binary-Parse/BP-MD-RTL-Reader/issues). Say what you did, what you expected and what happened. Attach the log if it helps, after you read it and remove anything private.

Do not report a security problem in a public issue. Use private vulnerability reporting instead. [The security policy](../SECURITY.md) explains how.
