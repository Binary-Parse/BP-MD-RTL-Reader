# Edit-Menu Bug Analysis — Marqam v1.0.0

## 1. Framework

**Electron** (v42.3.0) with a custom frameless titlebar (`frame: false`, `nodeIntegration: false`, `contextIsolation: true`).

- Main process: `main.js` (CJS, requires `electron`, `fs`, `path`, `./src/main-logic`)
- Preload: `preload.js` (contextBridge exposes `electronAPI`)
- Renderer: single-file `marqam.html` (3 260 LOC, inline `<script type="module">`)

No native Electron `Menu` is constructed — the menu is a **custom HTML `<div>` dropdown** rendered by `MENU_DEFS` in the renderer (line 1812 in marqam.html).

## 2. Editor Engines

Two parallel DOM nodes, swapped by `setEditorMode(mode)`:

| Mode | Element | Type | File ref |
| --- | --- | --- | --- |
| `source` | `<textarea id="srcTextarea">` (line 1500) | native textarea | tracks user keystrokes |
| `live` / `split` | `<div id="noteContent">` (line 1534) | **render target only — NOT contenteditable** | populated by `marked.parse(...)` output |

This is the first root-cause datum: **in `live` mode the visible content is read-only**. Edit operations only make sense for the `srcTextarea`. The Edit menu is enabled in all modes but has no editable surface to act on in `live`.

## 3. Existing Edit-Command Pipeline (lines 2182-2296)

```
Menu click  →  execEditCmd(cmd)
                  ├─ closeMenu()                              ← LINE 2204
                  └─ electronAPI.editCommand(cmd)             ← LINE 2205 (IPC to main)
                     │
                     ▼
Main process: ipcMain.on('edit:command', (event, cmd) => {
  event.sender.copy() / cut() / paste() / undo() / redo() / selectAll()
})
```

Renderer-side fallback (when `electronAPI` is absent — i.e., Playwright `file://` tests):
- `_lastFocusedEditable` global, populated by a `focusin` listener (lines 2190-2196)
- For `undo`/`redo`: `document.execCommand(cmd)` on the saved element
- For `selectAll`: `srcTextarea.select()` or `range.selectNodeContents(noteContent)`
- For `copy`/`cut`/`paste`: `navigator.clipboard.{readText,writeText}` + manual splice

## 4. Why Each Command Fails (5 root causes)

### Root cause A — `webContents.selectAll()` selects the entire renderer DOM
Chromium's `webContents.selectAll()` is equivalent to pressing Ctrl+A on the **document**, not on a specific element. With `nodeIntegration: false` and our frameless custom titlebar, every visible character on the page (titlebar, sidebar tree, every menu label, status bar) ends up in `window.getSelection()`. **This is the Select-All bug as reported.**

### Root cause B — Focus is lost the moment the menu opens
Clicking the "Edit" menu item moves `document.activeElement` from the textarea to a `<div role="menu">`. By the time `execEditCmd` runs:
- `_lastFocusedEditable` (tracked via `focusin`) holds the textarea reference, **but**
- `webContents.copy()` / `cut()` / `paste()` operate on the currently-focused element in Chromium's view — which is now the menu div, not the textarea.

Result: menu-click → `webContents.copy()` → silent no-op (no clipboard write).

Keyboard shortcuts Ctrl+Z/Y/X/C/V bypass the menu, so they reach Chromium directly while the textarea still has focus — those probably still work in `source` mode. Ctrl+A is *intercepted* in the renderer keydown handler (line 3140) and routed through the same broken pipeline.

### Root cause C — `live`/`split` mode has no editable target
The `<div id="noteContent">` is populated via `innerHTML` from sanitised marked output. It is **not** `contenteditable`. Cut/Paste/Undo/Redo on it can't work by design; only Copy and Select All make sense there.

### Root cause D — No edit-menu-disabled-when-not-focused state
The Edit menu is always enabled. Clicking it from the welcome screen (no file open) fires `execEditCmd` against a non-existent editable.

### Root cause E — Duplicate-dispatch risk
The renderer keydown listener intercepts Ctrl+A explicitly. Other Ctrl-letter combos rely on Chromium's default. There is no observable duplicate fire today, but the architecture is asymmetric and brittle.

## 5. Why the renderer-fallback path also misbehaves

Even when `electronAPI` is bypassed (e.g., in Playwright):
- `_lastFocusedEditable` is *only* updated for `TEXTAREA` and `INPUT`. The `noteContent` div is never tracked.
- `range.selectNodeContents(noteContent)` works **but** `noteContent` includes any decorative wrappers — works as intended for our renderer, but a single bug in the render pipeline (e.g., adding a footer toolbar inside the `<article id="editor">` parent) would spill the selection.
- The async `navigator.clipboard.readText()` for paste captures `_savedEl` in closure correctly (good), but does not validate `targetEl.isConnected` — a fast file-switch between read-call and resolve would paste into a detached node.

## 6. Fix Strategy

### Stop using `webContents.selectAll()` entirely.
The IPC pipeline for `selectAll` is **removed** — `selectAll` becomes pure renderer code that scopes selection to the *active editor surface*:

| Mode | Target | API |
| --- | --- | --- |
| `source` | `srcTextarea` | `el.focus(); el.select()` |
| `split` | `srcTextarea` (textarea side of split) | same |
| `live` | `noteContent` | `Range.selectNodeContents` + `Selection.addRange` |

### Restore focus before forwarding `cut`/`copy`/`paste`/`undo`/`redo`.
Before the IPC call, the renderer explicitly `focus()`-es the last-known editable. This makes `webContents.<cmd>()` act on the textarea, not the menu div.

### Renderer-side no-op when no editor is focused.
The wrapper returns silently when there is no editor in scope (welcome screen, after closing all tabs).

### Extract the pipeline into `src/renderer/edit-commands.js`.
Pure module, takes injected DOM accessors and an `electronAPI` shim. Vitest-unit-testable, Stryker-mutatable. Wired into `marqam.html` via `import`.

## 7. Test Plan (Phase 3)

| Test file | Cases |
| --- | --- |
| `tests/unit/edit-commands.test.js` | 6 commands × {happy path, no-editor, no-selection (cut/copy), IPC available vs absent, post-menu focus restore} = ~30 unit tests targeting the extracted module |
| `tests/edit-electron-bridge.spec.js` (already exists) | Integration via Playwright (left as regression net) |
| `tests/integration/edit-cmds.test.js` (already exists, 10 tests) | Integration via Playwright in `file://` mode |
| (new) `tests/edit-menu-flow.spec.js` | E2E: open file → type → Select All → assert selection scoped to editor (no titlebar / sidebar selected) |

## 8. Mutation Plan (Phase 4)

- Stryker scope already includes `src/renderer/**/*.js` (commit `52cb4e5`).
- New module `src/renderer/edit-commands.js` is automatically picked up.
- Current campaign break-threshold: 90 %. Aim for ≥ 90 % on the new module first run; iterate killer tests until met.

## 9. Out of Scope (explicit)

- Native Electron `Menu` construction — too disruptive; the custom titlebar is a deliberate UX decision.
- Making `noteContent` `contenteditable` — would require rewriting save/render pipeline.
- CodeMirror/Monaco swap — out of scope.
- Cross-platform Cmd accelerator (macOS) — desktop build is Win-only today; the keydown handler already uses `ctrlKey || metaKey` aliased as `cmd`.
