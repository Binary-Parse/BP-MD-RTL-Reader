# Keyboard shortcuts

This page lists every shortcut in BP MD RTL Reader. Press `Ctrl+/` in the app to open the same list, or press `Ctrl+K` to find any command in the command palette.

## Contents

- [How shortcuts work](#how-shortcuts-work)
- [General](#general)
- [File](#file)
- [Editing](#editing)
- [Edit mode](#edit-mode)
- [Tables](#tables)
- [View](#view)
- [Find bar](#find-bar)
- [Tabs, file tree, menus and command palette](#tabs-file-tree-menus-and-command-palette)
- [Actions without a shortcut](#actions-without-a-shortcut)

## How shortcuts work

- On Windows and Linux the modifiers are `Ctrl` and `Shift`. macOS is not built.
- A shortcut is the letter printed on the key, on every keyboard layout (QWERTY, QWERTZ, AZERTY). On a layout without Latin letters, such as Arabic, it is the key in the same position as on a US keyboard. `Ctrl++` also zooms in where `+` has a key of its own.
- While a dialog or the command palette is open, its own buttons own the keyboard. App shortcuts do nothing until it closes. `Esc` still closes it.
- In Reading mode, editing shortcuts such as `Ctrl+B` do nothing and tell you to press `Ctrl+E`.

## General

| Shortcut | Action |
| -------- | ------ |
| `Ctrl+K` or `Ctrl+P` | Open the command palette (commands and open files) |
| `Ctrl+/` | Show the keyboard shortcuts panel |
| `Esc` | Close the topmost open item: command palette, dialog, find bar, menu, context menu, direction menu, reader-controls panel or highlight bar. With none open, leave fullscreen |

## File

| Shortcut | Action |
| -------- | ------ |
| `Ctrl+O` | Open a file |
| `Ctrl+Shift+O` | Open a folder |
| `Ctrl+N` | New note |
| `Ctrl+Shift+N` | New daily note, named for today (`YYYY-MM-DD`, or the Hijri Umm al-Qura date when that calendar is on) |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As… |
| `Ctrl+W` | Close the current tab |
| `Alt+F4` | Close the window |

## Editing

| Shortcut | Action |
| -------- | ------ |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` or `Ctrl+Shift+Z` | Redo |
| `Ctrl+X` | Cut |
| `Ctrl+C` | Copy |
| `Ctrl+V` | Paste |
| `Ctrl+A` | Select all (in the note, or in a text field when one has focus) |
| `Ctrl+B` | Bold the selection (toggles) |
| `Ctrl+I` | Italic the selection (toggles) |
| `Ctrl+1` to `Ctrl+6` | Set the heading level 1 to 6. The same level again turns the line into a paragraph |
| `Ctrl+L` | Insert a link around the selection |
| `Ctrl+F` | Find in the note |

Wiki-links, footnotes, highlights, subscript, superscript, lists, callouts and tables have no shortcut. Use the formatting toolbar or the command palette. Most are toggles. Applying them again removes the formatting.

## Edit mode

These work only in the editor.

| Shortcut | Action |
| -------- | ------ |
| `Enter` | Continue a list, task list or quote on the next line |
| `Enter` on an empty list item | Remove the marker and leave the list |
| `Tab` | Indent the line. In a table, move to the next cell |
| `Shift+Tab` | Outdent the line. In a table, move to the previous cell |
| `Alt+↑` or `Alt+↓` | Move the line up or down |
| `Ctrl+Shift+K` | Delete the line |
| `Ctrl+[` or `Ctrl+]` | Outdent or indent the line |

The editor also has the standard CodeMirror editing keys. This table lists the ones that matter most.

## Tables

| Shortcut | Action |
| -------- | ------ |
| `Tab` | Move to the next cell. In the last cell, add a row |
| `Shift+Tab` | Move to the previous cell |

The row and column controls (**+ Row**, **− Row**, **+ Col**, **− Col**) appear above the editor while the cursor is inside a table. In a list, `Tab` and `Shift+Tab` indent and outdent the item instead.

## View

| Shortcut | Action |
| -------- | ------ |
| `Ctrl+E` | Switch between Reading mode and Edit mode |
| `Ctrl+\` | Toggle the sidebar |
| `Ctrl+Shift+I` | Toggle the inspector |
| `Ctrl+Shift+D` | Cycle the theme: Paper, Ink, Sepia, Oasis |
| `Ctrl+Shift+L` | Cycle the direction of the note: Auto, RTL, LTR |
| `Ctrl+D` | Flip one block. In Edit mode it is the block under the cursor. In Reading mode it is the block under the pointer, or the first one in view. A pinned block goes back to Auto |
| `Ctrl+=` | Zoom in |
| `Ctrl+-` | Zoom out |
| `Ctrl+0` | Reset zoom to 100% |
| `Ctrl+Shift+T` | Auto-hide the top bar. Browsers use this chord for "reopen closed tab" |
| `Ctrl+Shift+B` | Hide the bottom status bar. Ignored while a text field has focus |
| `Ctrl+,` | Open Settings |
| `F11` | Toggle fullscreen |

The expand button at the right end of the top bar does the same as `F11`.

## Find bar

| Shortcut | Action |
| -------- | ------ |
| `Enter` | Go to the next match |
| `Shift+Enter` | Go to the previous match |
| `Esc` | Close the bar and return to the note |

## Tabs, file tree, menus and command palette

These keys work when the item has focus. In the right-to-left interface, the left and right arrows swap so they follow what you see.

| Where | Key | Action |
| ----- | --- | ------ |
| **Tab strip** | `←` or `→` | Move to the neighboring tab and open it |
| **Tab strip** | `Delete` or `Backspace` | Close the tab |
| **File tree** | `↑` or `↓` | Move between rows |
| **File tree** | `Enter` or `Space` | Open a note, or open or close a folder |
| **File tree** | `→` or `←` | Open (`→`) or close (`←`) a folder |
| **File tree** | `Delete` or `Backspace` on a folder root | Close that folder |
| **Menus** | `↑`, `↓`, `Home`, `End` | Move between items |
| **Menus** | `Tab` | Close the menu |
| **Menus** | `Esc` | Close the menu |
| **Right-click menu** | `↑`, `↓`, `Enter`, `Esc` | Move, run, close |
| **Command palette** | `↑` or `↓` | Move between results |
| **Command palette** | `Enter` | Run the selected result |
| **Command palette** | `Esc` | Close |

## Actions without a shortcut

These live in the menu bar and the command palette (`Ctrl+K`). The palette spells some of them a little differently, for example **Export EPUB** and **Load demo notes**:

- **Export HTML**, **Export PDF**, **Export EPUB…**
- **Load Demo Notes**
- **Check for Updates…**
- **Toggle Arabic Interface (العربية)**
- **Toggle Arabic Kashida Justification**
- **Toggle Italic Recolour**
- **Theme: Paper**, **Theme: Ink**, **Theme: Sepia**, **Theme: Oasis**
- **Flip current block direction** and **Reset all block directions to auto**
- **Zoom In**, **Zoom Out**, **Reset Zoom**

Right-click menus are described in the [User guide](USER_GUIDE.md#use-the-right-click-menus).
