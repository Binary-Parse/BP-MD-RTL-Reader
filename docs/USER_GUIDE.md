# User guide

This guide shows how to do each task in BP MD RTL Reader. If you are new, start with [Getting started](GETTING_STARTED.md). For key lists see [Keyboard shortcuts](KEYBOARD_SHORTCUTS.md). For privacy see [Privacy](PRIVACY.md).

![A note in Reading mode with the file tree, the rendered text and the inspector](assets/theme-paper.png)

## Contents

- [The window at a glance](#the-window-at-a-glance)
- [Open notes and folders](#open-notes-and-folders)
- [Write and format](#write-and-format)
- [Work with Arabic and right-to-left text](#work-with-arabic-and-right-to-left-text)
- [Search and navigate](#search-and-navigate)
- [Highlights and margin notes](#highlights-and-margin-notes)
- [Export](#export)
- [Change settings](#change-settings)
- [Recover unsaved work](#recover-unsaved-work)

## The window at a glance

| Area | What it does |
| ---- | ------------ |
| **Top bar** | Sidebar toggle, the **BP** mark (opens About), the menu bar, a search field that opens the command palette, the **Read** / **Edit** switch, the direction switch, the theme button, the **Aa** reading controls, fullscreen, the inspector toggle and the window controls. |
| **Tab row** | One tab per open file. A `●` marks unsaved changes. A thin colored bar on the tab shows the note's direction: indigo for left-to-right, orange-red for right-to-left. The `+` button starts a new note. |
| **Sidebar** | Three tabs: **Files** (your folder tree, with read time and progress for each note), **Tags** and **Search**. Three buttons at the bottom open a folder, open a file or start a new note. Toggle it with `Ctrl+\`. |
| **Note area** | Reading mode shows a clean render on a paper-like sheet. Edit mode shows the live-preview editor on the same sheet. In a wide window, margin notes sit beside the text. |
| **Formatting toolbar** | Appears above the editor in Edit mode. It is hidden in Reading mode. |
| **Inspector** | The note's title, path, word count, read time and progress, then its **Outline**, **Properties** and **Notes**. Toggle it with `Ctrl+Shift+I`. |
| **Status bar** | Folder, encoding, format, direction, cursor position, word count, zoom level and theme. Click the zoom level to reset it to 100%. A thin line along its top edge shows how far you have read. |

Both the top bar and the status bar can be hidden. See [Change settings](#change-settings).

The sidebar and the inspector start closed on a fresh install. The app remembers whether you opened them.

## Open notes and folders

### Open a file or a folder

- **Open a file.** Press `Ctrl+O`, or choose **File → Open File…**. Each file opens in its own tab.
- **Open a folder.** Press `Ctrl+Shift+O`, or choose **File → Open Folder…**. Every `.md` and `.markdown` file appears in the **Files** tree, sorted alphabetically. A second folder is added next to the first. Each folder is a named root that you can close on its own.
- **Drop files on the window.** You can drop `.md`, `.markdown` and `.txt` files. Each opens as a tab.
- **Double-click a file.** In your file manager, double-click a `.md` file to open it in a new tab. This needs a file association. See [Install](INSTALL.md#set-up-file-association).
- **Pick a recent note.** The welcome screen lists your recent files (up to five) and a **Continue reading** shelf with your four latest notes.

The **Open File** dialog lists `.md` and `.markdown` files. A `.txt` file opens when you drop it on the window, but you can only save notes as `.md` or `.markdown`.

If you have no notes yet, choose **File → Load Demo Notes**. The demo notes open next to anything you have open. Nothing is closed.

### Folders update live

While a folder is open, the app watches it for changes. The tree and any open notes react when files change on disk.

If you have unsaved edits in a note and the file changes on disk, a banner appears with two buttons: **Keep my edits** and **Reload from disk**. Save refuses to overwrite a file that changed behind your back.

The watcher cannot run on a mapped network drive such as `Z:\notes`. See [Troubleshooting](TROUBLESHOOTING.md#folder-on-a-network-drive).

### Large notes

A note can be up to 100 MB. The size decides how it opens. Details are in [Files and limits](FILES_AND_LIMITS.md#size-tiers).

| Size | What happens |
| ---- | ------------ |
| Up to 5 MB | Opens normally. |
| 5 to 20 MB | Opens, and a message says the note is large. The preview is not redrawn while you type. It is drawn when you switch to Reading mode. |
| 20 to 100 MB | The app asks first, then opens the note in large-file mode. |
| Over 100 MB | Not opened. A message names the limit. |

In large-file mode, live-preview styling, find highlights and the outline are off. Reading mode shows a notice with a **Render anyway** button. It draws the first 20 million characters on demand, which can take a minute or more.

### Where the app keeps its own data

Your notes stay where you saved them. The app keeps its own files, such as `settings.json` and `capabilities.json` (the grants that let it reopen the files and folders you chose), in a separate profile folder. [Files and limits](FILES_AND_LIMITS.md#the-profile-folder) lists every file.

## Write and format

### Edit and read

There is one editor. Your text renders as you work: headings, bold and italic text, links, callouts, tables, math and images all look formatted. The line under your cursor shows the raw Markdown. Move the cursor away and that line renders too. There are no separate source or split views.

Press `Ctrl+E`, or use the **Read** and **Edit** buttons, to switch modes:

- **Reading mode** is a clean, read-only render. The formatting toolbar is hidden. Editing shortcuts such as `Ctrl+B` do nothing and tell you to press `Ctrl+E`.
- **Edit mode** shows the live-preview editor.

The app remembers your mode for the next launch.

![The live-preview editor with the formatting toolbar, a rendered note and the table controls](assets/editor.png)

### Use the formatting toolbar

The tools are toggles. Applying a style again removes it. Changing a heading level or list type replaces the old marker instead of stacking a new one. With nothing selected, an inline style wraps the word under the cursor. A button lights up when the cursor is inside that kind of text.

| Group | Tools |
| ----- | ----- |
| **Headings** | The **H** drop-down sets H1 to H6. You can also press `Ctrl+1` to `Ctrl+6`. Choosing the current level again turns the line back into a paragraph. |
| **Inline** | Bold (`Ctrl+B`), italic (`Ctrl+I`), strikethrough, underline, inline code, highlight, subscript, superscript and **Clear formatting**. |
| **Insert** | Link (`Ctrl+L`), wiki-link, math and footnote. A footnote adds a `[^1]` reference and a definition at the end of the note. |
| **Blocks** | Blockquote, callout, bulleted list, numbered list, task list, and indent and outdent. |
| **Big blocks** | Code block, table, image and horizontal rule. These always land on their own line. They never split the text you are on. |

In Reading mode, a floating copy button stays next to the code block that is in view. Click it to copy that block's exact source.

In Edit mode, `Enter` continues a list or a quote. `Enter` on an empty item ends the list. `Tab` and `Shift+Tab` indent and outdent a line. The editor also has the usual CodeMirror chords, such as `Alt+↑` and `Alt+↓` to move a line.

### Work with tables

When the cursor is inside a table, a controls bar appears with **+ Row**, **− Row**, **+ Col** and **− Col**. `Tab` and `Shift+Tab` move between cells. `Tab` in the last cell adds a row.

Column alignment follows the direction of the table. `:--` aligns a column to the start of the cell, `--:` to the end, and `:-:` to the center. In a left-to-right table, the start is the left. In an Arabic table, the start is the right, so the table is a mirror image. If you set the direction by hand, the alignment moves with it. Exports do the same.

### Save your work

- **Save** (`Ctrl+S`) writes the note back to its file. It keeps the file's byte-order mark, line endings and final-newline style. In a file that mixes CRLF and LF, every line you did not edit keeps its own ending.
- **Save As** (`Ctrl+Shift+S`) asks for a destination, writes there, and makes that file the tab's new save target. The note's highlights, margin notes and reading position come with it. The original file keeps its own. A note saved out of an open folder becomes a normal tab. The folder still lists the original.
- **New notes need Save As.** **File → New Note** (`Ctrl+N`) and **File → New Daily Note** (`Ctrl+Shift+N`) create unsaved notes that live only in memory. The first save opens **Save As**. A new note starts empty. A daily note is named for today (`YYYY-MM-DD`, or the Hijri date when that calendar is on). If a note with that name is already open, the app switches to it instead of making a new one. The app does not look for it on disk.
- **Auto-save** writes notes that came from disk about 15 seconds after you stop typing. It does not save new notes. It is on by default.

If a save fails, the message names the cause: another program is using the file or it is read-only, the disk is full, or the folder is gone. The app retries for a moment first, because antivirus and sync tools sometimes hold a file briefly.

If the file changed on disk since you opened it, Save refuses to overwrite it. The banner lets you keep your edit or reload the disk copy.

A note in the legacy Windows-1256 (Arabic) code page keeps that encoding. If you type a character that code page cannot hold, such as an emoji, Save refuses and offers to save the file as UTF-8 instead. If the app cannot tell a file's encoding for certain, a bar above the note names its guess and offers **Keep** *encoding* or **Reopen as** *encoding*. The note is not saved until you answer. [Files and limits](FILES_AND_LIMITS.md#encodings) lists the encodings.

Closing a tab with unsaved changes, closing the window, or replacing your folders with another folder or recent item asks first.

## Work with Arabic and right-to-left text

The app decides direction for each block of text, so a note that mixes Arabic and English reads correctly. [Right-to-left text](RTL.md) explains the rules. This section shows what you can do.

![An Arabic note rendered right-to-left, with a mirrored blockquote and a right-to-left outline](assets/rtl-arabic.png)

### Let the app detect direction

Do nothing. When you open a note that is mostly Arabic, the layout flips to right-to-left with Arabic-aware fonts and alignment. Each paragraph, heading and list item then gets its own direction. Code blocks and math are not counted.

### Set the direction of one note

Press `Ctrl+Shift+L`, or use the **Auto · RTL · LTR** switch in the top bar. It cycles **Auto**, **RTL**, **LTR** and back to **Auto**. RTL and LTR force every block of that note. The choice applies to the active tab only. The app clears it when you relaunch, and each note reopens in Auto.

To make a note open in a fixed direction every time, add a `direction` key to its front matter:

```markdown
---
direction: rtl
---
```

### Set the direction of one block

In Reading mode, a small round badge appears in the margin next to the block under the pointer. **ع** means right-to-left and **A** means left-to-right. A dashed badge means the block is on Auto. A filled badge means it is pinned. Click the badge and choose **Right to left**, **Left to right** or **Auto**.

In Edit mode, press `Ctrl+D` to flip the block under the cursor. Press it again to return the block to Auto.

The pin is saved in the note as one hidden line above the block, `<!-- dir: rtl -->` or `<!-- dir: ltr -->`. Other Markdown apps hide it. To remove every pin in a note, run **Reset all block directions to auto** from the command palette. `Ctrl+Z` brings them back.

### Switch the interface to Arabic

Choose **View → Arabic → Arabic Interface (العربية)**, or run **Toggle Arabic Interface (العربية)** from the command palette. The whole interface switches to Arabic with a right-to-left layout. Your notes are not affected. Toggle it again to return to English.

### Other Arabic options

- **Calendar.** Gregorian or Hijri (Umm al-Qura). It is used for daily-note names and dates.
- **Kashida.** Justifies Arabic paragraphs by spreading the space between letters instead of between words.
- **Italics color.** Shows italic text in the accent color in Reading mode. On by default.
- **Note language.** A screen reader uses the language in a `lang` key in the front matter, such as `lang: fa`, `lang: ur` or `lang: he`. Without one, the app names no language and leaves the choice to the screen reader. Exported HTML and EPUB name the language from the script.

Calendar, kashida and italics color are in Settings under **Arabic**.

## Search and navigate

### Find in the open note

Press `Ctrl+F`. The find bar shows a hit counter. Press `Enter` for the next match and `Shift+Enter` for the previous one. Every match is highlighted in both modes. `Esc` closes the bar and returns to the note. An Arabic search without tashkeel also finds the word written with tashkeel.

### Search across your folders

Open the **Search** tab in the sidebar. It searches file names and contents across all open folders and shows snippets. Click a result to open it.

### Use the command palette

Press `Ctrl+K` or `Ctrl+P`. The command palette searches every menu command and your open files. Use `↑` and `↓` to move, `Enter` to run, and `Esc` to close.

![The command palette listing commands with their shortcuts](assets/command-palette.png)

### Use tags

Write `#tag` anywhere in a note. The **Tags** tab shows every tag across your open folders, sorted by how often it appears. Click a tag to search for it.

Tags are Unicode-aware, so `#تأمل` works. Code blocks and inline code are not scanned. Numbers such as `#123` and colors such as `#fff` are not tags.

### Link notes with wiki-links

Write `[[Note title]]` to link to another open note. Write `[[Note title|text to show]]` to show different text. Click the link to jump to the note.

The app matches the link to a file name. It ignores case, ignores `.md`, and folds Arabic vowel marks. A link finds only notes that are open or listed in an open folder. If it finds nothing, a message says so.

### Use the outline and the inspector

The inspector (`Ctrl+Shift+I`) has three parts:

- **Outline.** Every heading in the note, numbered. Click one to jump.
- **Properties.** File name, word count, estimated read time, direction, encoding and line endings (LF or CRLF).
- **Notes.** Your highlights and margin notes for this note. See [Highlights and margin notes](#highlights-and-margin-notes).

### Use the right-click menus

Right-click opens a themed menu. You can drive it with `↑`, `↓`, `Enter` and `Esc`. What it offers depends on where you click:

| Where | What you get |
| ----- | ------------ |
| **A note** | Undo, redo, cut, copy and paste while editing. Open and copy on a link. Copy and save on an image. New Note, Find, Command Palette and Settings. The **Auto-hide top bar** and **Hide status bar** toggles. A **Direction** row (Auto, RTL, LTR), theme swatches, and text size buttons **A−** and **A+**. |
| **Selected text in Reading mode** | **Highlight**, **Add Note…** and **Search library for "…"**. |
| **Selected text in Edit mode** | A **Format** group: Bold, Italic, Strikethrough, Inline Code and Link. |
| **A tab** | Close, Close Other Tabs, Close All Tabs, Duplicate Note, Reveal in File Explorer and Copy Path. **Save** appears when the tab has unsaved changes. |
| **A file in the tree** | Open Note, Reveal in File Explorer and Copy Path. |
| **A wiki-link** | Open Note and Copy Name. |

## Highlights and margin notes

### Add a highlight or a note

In Reading mode, select text, then choose **Highlight** or **Note** from the bar that appears. You can also right-click the selection. A highlight is saved straight away. **Note** lets you write a margin note about the passage.

A highlight is one run of text inside one paragraph. A selection that crosses a paragraph boundary, or a bold, italic or code boundary, cannot be highlighted. The app says so.

Each highlight is limited to 5,000 characters. A note can hold up to 500 highlights.

### Find and remove them

Highlights show as cards in the margin, level with their passage. Click a card to jump to the passage. Click its **×** to delete it. The arrow at the top of the margin folds the cards into small markers. The app remembers that choice. When the margin is too narrow, markers show instead.

The inspector's **Notes** section lists them too, newest first. After you delete a highlight, **Undo** stays on screen for six seconds.

The app stores highlights in `annotations.json` and finds them again by their own text. If you edit the passage, the highlight stays saved and a message says the passage changed. Your highlights are not part of the note file. They stay in the profile folder.

## Export

Use the **File** menu or the command palette:

| Export | Result |
| ------ | ------ |
| **Export HTML** | One self-contained `.html` file with embedded styles and the right `lang` and `dir`. |
| **Export PDF** | A PDF rendered offline in an isolated window. |
| **Export EPUB…** | An EPUB 3 book. Right-to-left notes get right-to-left page progression. |

Things to know:

- **Direction is kept.** All three exports keep the per-block direction you see in Reading mode.
- **Images.** Exports replace every image that is not embedded in the note with a placeholder, `[Image: alt text]`. Remote images are never fetched.
- **Your highlights.** If the note has your highlights or margin notes, HTML and PDF ask first: **Export without them** (the default) or **Include them**. Included notes appear in a "Notes" section at the end. Closing the question cancels the export. EPUB never includes them.
- **Size.** An export over 5 MB warns that it may take a while. Limits and timeouts are in [Files and limits](FILES_AND_LIMITS.md#export-limits).
- **Temporary file.** A PDF export writes a temporary file named `bpmd-export-<id>.html` in your system temp folder and deletes it afterward. See [Privacy](PRIVACY.md#temporary-files).

## Change settings

Choose **View → Settings…**, or press `Ctrl+,`.

| Setting | What it does |
| ------- | ------------ |
| **Window title** | **File name** (default) shows the open note in the taskbar and Alt+Tab, with a leading `•` while it has unsaved changes. **App name** shows only "BP MD RTL Reader". The title is visible to anyone who can see your screen. |
| **Auto-hide top bar** | Hides the top bar until you move the pointer to the top edge. Off by default. `Ctrl+Shift+T`. |
| **Hide bottom status bar** | Removes the status bar and gives its row to the note. Off by default. `Ctrl+Shift+B`. |
| **Auto-save** | Saves notes that came from disk about 15 seconds after you stop typing. On by default. New notes still need Save As. |
| **Follow system colour scheme** | On a first run with no saved theme, the app opens light or dark to match your system. Choosing a theme turns this off. |
| **Daily reading goal** | Under **Reading**. Off, 10, 20 or 30 minutes. The default is 10. It sets the target in the `5-day streak · Today 12 of 20 min` line on the welcome screen. **Off** hides that line. |
| **Arabic Interface (العربية)** | Under **Arabic**. Switches the whole interface to Arabic. Off by default. |
| **Calendar** | Under **Arabic**. Gregorian (default) or Hijri (Umm al-Qura). |
| **Kashida Justification** | Under **Arabic**. Justifies Arabic paragraphs between letters. |
| **Recolour Italics** | Under **Arabic**. Shows italics in the accent color in Reading mode. On by default. |
| **Check for updates automatically** | Under **Updates**. Off by default. When on, the app checks for a newer release when it starts and then every 24 hours while it runs. It only tells you. It never downloads anything. See [Privacy](PRIVACY.md#network-access). |

### Change how it looks

- **Theme.** Click the theme button or press `Ctrl+Shift+D` to cycle Paper, Ink, Sepia and Oasis. You can also pick a theme in the right-click menu or run **Theme: Paper** (and the others) from the command palette. The app remembers your choice. On the very first run it follows your system until you pick one. With Windows High Contrast on, the app uses the system colors.
- **Zoom.** `Ctrl+=`, `Ctrl+-` and `Ctrl+0` zoom the whole interface from 60% to 200%. The status bar shows the level. Click it to reset to 100%.
- **Reading size and width.** The **Aa** button opens a small panel. Text size runs from 80% to 200%. Content width runs from 48 to 120 characters. These shape only the note, and the app remembers them.
- **Fullscreen.** Press `F11` or use the expand button. `Esc` leaves fullscreen.

| Paper | Ink | Sepia | Oasis |
| :---: | :-: | :---: | :---: |
| ![Paper theme: a light page](assets/theme-paper.png) | ![Ink theme: a dark page](assets/theme-ink.png) | ![Sepia theme: a warm paper page](assets/theme-sepia.png) | ![Oasis theme: a warm dark page](assets/theme-oasis.png) |

### Hide the bars safely

> [!WARNING]
> While the top bar is auto-hidden, you cannot drag the window. A frameless window moves by its top bar. Move the pointer to the top edge to bring the bar back, then drag. Or press `Ctrl+Shift+T`.

Browsers use `Ctrl+Shift+T` to reopen a closed tab. Here it hides the top bar. Press it again to undo.

If the window ever becomes unusable, quit the app and start it once with `--reset-chrome`. This clears both toggles and leaves every other setting alone. See [Troubleshooting](TROUBLESHOOTING.md#the-window-has-no-top-bar-or-status-bar).

## Recover unsaved work

The app protects unsaved notes in three ways.

1. **Recovery snapshots.** While you work, the app copies your unsaved notes to a recovery snapshot in the profile folder. It does this about every 10 seconds, for up to 20 notes. A large note (over 5 MB) is copied at most every 30 seconds, and only when it changed. If a note is too big to copy, a message tells you once. Save that note yourself.
2. **The restore prompt.** If the app closes without a chance to save, such as a crash or a power cut, the next launch asks **Recover unsaved notes?** Choose **Restore** to reopen them as unsaved tabs. Then use **Save As** to keep them. The snapshot is removed only when you choose **Restore** or **Discard**. If you close the prompt, your work stays recoverable for the next launch.
3. **Normal exits.** When you close the app normally, you choose whether to save or discard. Nothing is offered again after a clean exit.

The snapshot holds the full text of your unsaved notes in a plain JSON file. See [Privacy](PRIVACY.md#what-the-app-stores).

A crashed window reloads by itself and shows the same prompt. If it crashes more than twice in one minute, the app asks whether to reload or quit. A window that stops responding asks whether to wait or reload. When Windows logs off or shuts down, the app stores your latest unsaved text first. It does not delay the shutdown.

Unsaved content is not part of session restore. On launch, the app reopens your last folder and active note. It does not reopen standalone files or individual tabs.
