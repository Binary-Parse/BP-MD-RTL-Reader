# <!-- BINARY PARSE v0.3.0 — generated CLAUDE.md template. Keep ≤ 200 lines. -->

# Project Memory — `MD Reader RTL` (Marqam)

This file is read by Claude Code at session start and prepended to every
subagent. Keep it short, factual, pointer-heavy.

## Pipeline (BINARY PARSE v0.3.0)

The 6-stage pipeline runs via `pipeline-run`. Stages 4-5 may delegate to
Superpowers (if installed) for brainstorming + TDD discipline.

1. (Optional) `spec-kit-integration` skill if `.specify/spec.md` exists
2. `prompt-rewriter` (haiku) → `01-rewritten.md`
3. `classifier` (haiku) → `02-classification.json`
4. `explorer` (haiku) → `03a-explore.json`, then
   `researcher` (opus, x-high) → `03b-research.md`
5. `planner` (sonnet) → `04-plan.json` — **human approval gate**
6. `implementer` (sonnet) → `05-impl.json` — up to 3 attempts
7. `verifier` (haiku) → `06a-verify.json`
8. `reviewer` (sonnet, fresh ctx) → `06b-review.json` — up to 2 cycles
9. (If UI touched) `design-reviewer` (sonnet) → `06d-design-review.json`
10. (If graph MCP available) `codebase-graph-reviewer` (sonnet) → `06e-graph-review.json`
11. `judge` (opus, max-effort) → `06c-judge.json` — **no retries**
    Applies 14-Gate Ship Gate Matrix.

## Hard rules

1. **Never push.** `git push` denied. User pushes.
2. **Never write secrets.** `.env*`, `.git/`, `.ssh/`, `*.pem`, `id_rsa*` blocked.
3. **Never run destructive shell.** `rm -rf`, `curl|sh`, `mkfs`, `dd if=` blocked.
4. **One task = one commit.** Conventional Commits.
5. **Logic-bearing changes are TDD.** Red → green → refactor.
6. **Web evidence required at evaluation stages.**
7. **Stop on cap.** Implementation ≤ 3 attempts; Reviewer ≤ 2 cycles; Judge no retry.
8. **CLAUDE.md ≤ 200 lines.** Hook-enforced.
9. **No UI ships without Playwright screenshot** in run artifacts.
10. **No HTTP endpoint ships without OpenAPI 3.2 spec.**
11. **No migration ships without `down` path** AND migrate→rollback→migrate cycle passing.

## Stack

- Language: `JavaScript (vanilla ES2020+)`
- Framework: `none` — single-file HTML/CSS/JS; no build step
- Test runner: `none`
- Lint / format: `none`
- Package manager: `none` — CDN-only (`marked.js` via jsdelivr)
- DB schema tool: `none`

> NOTE: The About modal in `marqam-app.html` (line 2480) claims "Built with
> React · CodeMirror · Tauri". This is placeholder/aspirational text. The
> actual code uses none of these; Tauri window-control handlers show a toast
> only (stubs, lines 2566-2574).

## Project Overview

**Marqam** is a bilingual (English + Arabic) markdown reader/editor.
Single source file: `marqam-app.html` (2617 lines). No install, no build.
Runs directly in Chromium 86+ (requires File System Access API).
Desktop packaging via Tauri is planned but window controls are stubs.
Version: 0.1 · prototype.

## Architecture

```
State (global object)
  └─ MENU_DEFS / PALETTE_COMMANDS / THEMES constants
       └─ direct DOM manipulation via $ helper (getElementById alias)
```

**Layout:** CSS Grid — `app` (3 rows: titlebar 36 px | body 1fr | statusbar 26 px);
body is 3-column grid (sidebar 240 px | editor 1fr | inspector 280 px);
columns reverse in RTL mode.

**Editor modes:** `live` (preview only) | `split` (source + preview) | `source` (raw textarea).

**Themes:** `paper` (light) | `ink` (dark) | `sepia` — toggled via `app[data-theme]`.

**Data flow:** `openVault()` → `State.files` populated → `renderTree()` →
`renderFile(idx)` → editor DOM updated + TOC built.

**State properties:** `files[]`, `activeFile`, `vaultName`, `theme`,
`direction`, `editorMode`, `recents[]`, `sidebarVisible`, `inspectorVisible`,
`findHits[]`, `findIdx`.

## Key Conventions

- **Naming:** functions `camelCase`, constants `UPPER_SNAKE_CASE`,
  CSS classes/data-attrs `kebab-case`, DOM ids `camelCase`.
- **RTL:** `isArabicHeavy()` scans first 2000 chars for Arabic Unicode
  (U+0600–U+06FF); auto-flips direction; user override via `Ctrl+Shift+L`.
  Arabic emphasis uses `font-weight: 600` instead of italic.
- **Font stack:** Inter (UI), Fraunces (serif brand), JetBrains Mono (code),
  IBM Plex Sans Arabic (Arabic script) — all Google Fonts.
- **Markdown:** `marked.js` CDN; extended with custom wikilink tokenizer for
  `[[target|display]]` syntax; `navWikilink()` handles cross-file navigation.
- **Async:** `async/await` for all File System Access API calls
  (`openVault`, `openSingleFile`, `saveCurrent`, `saveAs`).
- **Errors:** `try/catch` around file APIs; `showToast()` for user feedback.
- **Sections:** JS divided by `==== SECTION TITLE ====` comment dividers.

## Known Gaps

- **Find & Replace:** Find (`Ctrl+F`) works; Replace UI not wired (line 2303 toast).
- **Tags pane:** sidebar tab present; `renderTag()`/`searchTags()` are stubs.
- **Search pane:** sidebar tab present; vault-wide search not implemented.
- **loadDemo():** referenced in File menu; implementation is a stub.
- **Tauri window controls:** minimize/maximize/close show toast only (lines 2566-2574).
- **Session persistence:** no `localStorage`/`IndexedDB`; state is volatile.
- **Drag-drop:** HTML5 events defined; wiring unverified (scan incomplete).
- **Wikilink navigation:** `navWikilink()` exists; cross-file resolution unverified.

## Keyboard Shortcuts (summary)

**File:** `Ctrl+Shift+O` Open Folder · `Ctrl+O` Open File · `Ctrl+N` New Note ·
`Ctrl+Shift+N` New Daily Note · `Ctrl+S` Save · `Ctrl+Shift+S` Save As ·
`Ctrl+W` Close Tab

**Edit:** `Ctrl+B` Bold · `Ctrl+I` Italic · `Ctrl+L` Link · `Ctrl+K Ctrl+W` Wikilink ·
`Ctrl+F` Find · `Ctrl+H` Find & Replace (UI stub) · `Ctrl+Z/Y` Undo/Redo

**View:** `Ctrl+K` Command Palette · `Ctrl+\` Toggle Sidebar ·
`Ctrl+Shift+I` Toggle Inspector · `Ctrl+Shift+D` Cycle Theme ·
`Ctrl+Shift+L` Flip RTL/LTR · `Ctrl+/` Shortcuts modal

## Domain-specific rules (auto-loaded by domain detection)

- Frontend tasks → `.claude/rules/frontend-design.md`
- Backend HTTP/DB → `.claude/rules/backend-rigor.md`
- All code → `.claude/rules/code-rigor.md`
- Observable services → `.claude/rules/observability-baseline.md`
- Ship gates (14) → `.claude/rules/ship-gate-matrix.md`
- Security baseline → `.claude/rules/security-baseline.md`
- Code style → `.claude/rules/code-style.md`

## How to run things

- **Open:** Load `marqam-app.html` directly in Chrome 86+ or Edge 86+.
  No install. No build step. No server required.
- **File access:** File System Access API (`showDirectoryPicker`,
  `showOpenFilePicker`, `showSaveFilePicker`). Falls back to `<input type="file">`.
- **Test:** no test runner — manual browser testing only.
- **Lint / format:** none configured.
- **Build:** none — ship `marqam-app.html` as-is.
- **Desktop:** Tauri wrapping planned; currently stubs only.

## Pointers

- Entry point → `marqam-app.html` (all markup + styles + JS, 2617 lines)
- State object → line ~1545 (`const State = { ... }`)
- MENU_DEFS / PALETTE_COMMANDS / THEMES → lines ~1545-1596
- Wikilink extension → lines 1596-1610
- File API handlers → lines 1813-1871
- Keyboard dispatcher → lines 2579-2606
- RTL logic → lines 1615-1662
- Tauri stubs → lines 2566-2574
- Run artifacts → `.claudedoc/runs/<run_id>/`

## Running the pipeline

```text
/pipeline-run "<your task in plain English>"
```

Orchestrator stops at planner for approval. Reply:
- `:approve` — proceed
- `:edit "<changes>"` — request edits
- `:abort` — stop

Resume:
```text
/pipeline-resume <run_id> [--from=<stage>]
```

## Notes for humans

- This file is committed; `.claudedoc/` is gitignored.
- New rules go in `.claude/rules/` with single-line pointer here.
- Verify install: `node scripts/verify.js`.
