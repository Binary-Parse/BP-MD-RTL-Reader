# Getting started

This tutorial takes about ten minutes. You install the app, open some notes, and write your first note in Arabic.

![BP MD RTL Reader in Reading mode: the file tree on the left, a rendered note in the middle, and the inspector on the right](assets/theme-paper.png)

## Contents

- [1. Install the app](#1-install-the-app)
- [2. Look around with the demo notes](#2-look-around-with-the-demo-notes)
- [3. Open your own notes](#3-open-your-own-notes)
- [4. Write your first Arabic note](#4-write-your-first-arabic-note)
- [5. Switch between Reading mode and Edit mode](#5-switch-between-reading-mode-and-edit-mode)
- [Where to go next](#where-to-go-next)

## 1. Install the app

1. Download the package for your system from the [Releases page](https://github.com/Binary-Parse/BP-MD-RTL-Reader/releases).
2. Check the download against `SHA256SUMS.txt`.
3. Run the installer, or start the portable file or AppImage.

The files are not code-signed, so Windows may show a SmartScreen warning. [Install](INSTALL.md) explains which package to choose, how to check it, and what to click.

## 2. Look around with the demo notes

When the app starts, it shows a welcome screen. If you have no notes yet, choose **Try Demo**. You get a small set of English and Arabic sample notes, including an Arabic essay.

You can also choose **File → Load Demo Notes** at any time. Demo notes open next to anything you already have open. Nothing is closed.

The app opens in **Reading mode**. This is a clean, read-only view of your note on a paper-like sheet. Scroll through a note and look at the tabs, the sidebar and the inspector.

## 3. Open your own notes

You have three ways to open notes:

- **Open a file.** Press `Ctrl+O`.
- **Open a folder.** Press `Ctrl+Shift+O`. Every `.md` and `.markdown` file in it appears in the **Files** tree on the left.
- **Drop files on the window.** You can drop `.md`, `.markdown` and `.txt` files.

You can open more than one folder. Each one becomes its own named root in the tree.

The app reads and writes your files in place. There is no import and no library file. See [Files and limits](FILES_AND_LIMITS.md) for the size limits.

## 4. Write your first Arabic note

1. Press `Ctrl+N`. A new, empty note opens in a new tab.
2. Press `Ctrl+E` if the note looks read-only. This switches to **Edit mode**.
3. Type a heading and a paragraph in Arabic:

   ```markdown
   # مذكرات اليوم

   هذه أول ملاحظة لي في **BP MD RTL Reader**. أكتب بالعربية وأضيف بعض الكلمات الإنجليزية مثل Markdown داخل الجملة.
   ```

4. Look at the tab. A small colored tick shows the note's direction. Red means right-to-left.
5. Press `Ctrl+Shift+L` to cycle the direction: Auto, then RTL, then LTR. Press it until the switch says **Auto** again. [Right-to-left text](RTL.md) explains what Auto does.
6. Press `Ctrl+S`. A new note has no file yet, so the app opens **Save As**. Pick a folder and a file name.

> [!NOTE]
> New notes and daily notes live only in memory until you save them. Until then, the app mirrors them to a recovery snapshot. See [Recover unsaved work](USER_GUIDE.md#recover-unsaved-work).

## 5. Switch between Reading mode and Edit mode

Use the **Read** and **Edit** buttons in the top bar, or press `Ctrl+E`.

| Mode | What you get |
| ---- | ------------ |
| **Reading mode** | A clean, read-only render. The formatting toolbar is hidden. The app remembers how far you read each note. |
| **Edit mode** | A live-preview editor. Headings, bold text, links and tables look formatted. The line under your cursor shows the raw Markdown. |

The app remembers your choice for the next launch.

![The Edit mode editor with the formatting toolbar above a rendered note](assets/editor.png)

## Where to go next

- Learn each task in the [User guide](USER_GUIDE.md).
- Press `Ctrl+K` to open the command palette and search every command and open file.
- Press `Ctrl+/` in the app to see the shortcuts, or read [Keyboard shortcuts](KEYBOARD_SHORTCUTS.md).
- Learn what the app can render in [Markdown syntax](MARKDOWN_SYNTAX.md).
- Read what the app stores and sends in [Privacy](PRIVACY.md).
- If something goes wrong, see [Troubleshooting](TROUBLESHOOTING.md).
