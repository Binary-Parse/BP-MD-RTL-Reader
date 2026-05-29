# BP MD RTL Reader

A bilingual (English + Arabic) Markdown reader and editor for the desktop.
Built on Electron. Local-first — your notes never leave your machine.

> **Status:** v1.0.0 · Windows desktop build via electron-builder (NSIS installer + portable). macOS/Linux not packaged but the renderer runs anywhere Chromium 86+ runs.

---

## Features

- **Bilingual rendering** — auto-detects Arabic-heavy text and flips the layout to RTL; manual override with `Ctrl+Shift+L`.
- **Three themes** — Paper (light), Ink (dark), Sepia. Cycle with `Ctrl+Shift+D`.
- **Three editor modes** — Live preview, Split source/preview, Source-only.
- **Wikilinks** — `[[target|alias]]` syntax with cross-file navigation.
- **Command palette** — `Ctrl+K`. Find — `Ctrl+F`.
- **File-association support** — double-click a `.md` file in Explorer (Windows) or drop one on the dock (macOS).
- **Vault mode** — open a folder of Markdown files; navigate via sidebar tree, search across all files.
- **Local-first observability** — crashes and uncaught errors are written to `<userData>/logs/marqam.log` (rotated at 1 MiB, last 3 kept). Nothing is sent to any server.

---

## Install

### Pre-built (Windows)

Grab the latest `BP MD RTL Reader Setup 1.0.0.exe` (NSIS installer) or `BP MD RTL Reader 1.0.0.exe` (portable) from your distribution channel. Run. (A standalone Inno Setup build, `BP MD RTL Reader Setup.exe`, is also produced by `installer\build-installer.ps1`.)

### From source

Requires Node 24+ and npm 11+.

```bash
git clone <repo-url>
cd "MD Reader RTL"
npm install     # postinstall fetches Playwright browsers
npm start       # launches Electron
```

---

## Run

```bash
npm start
```

Launches the Electron app with `index.html` as the renderer.

---

## Test

```bash
npm run test:unit              # Vitest unit tests (138+ tests, ~0.5 s)
npm run test:unit:coverage     # + v8 coverage report → coverage/node/
npm run test:smoke             # Playwright smoke (15 tests, ~30 s)
npm run test:e2e               # Full Playwright sweep (~467 tests, ~15 min)
npm run test:mutation          # Stryker mutation testing
npm run test:integration       # Playwright integration suite (where wired)
npm run lint:security          # ESLint with security + no-unsanitized plugins
```

CI runs unit + mutation + full E2E + `npm audit` on every push/PR to `main` / `master` via `.github/workflows/ci.yml`.

---

## Build

```bash
npm run dist                   # electron-builder → Windows NSIS + portable
```

Output lands in `dist/`. The `package.json#build` block controls targets and file associations.

---

## Keyboard shortcuts (selected)

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+O` | Open folder (vault) |
| `Ctrl+O` | Open single file |
| `Ctrl+N` / `Ctrl+Shift+N` | New note / daily note |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save As |
| `Ctrl+B` / `Ctrl+I` / `Ctrl+L` | Bold / Italic / Link |
| `Ctrl+K Ctrl+W` | Insert wikilink |
| `Ctrl+F` / `Ctrl+H` | Find / Find & Replace |
| `Ctrl+K` | Command palette |
| `Ctrl+\` | Toggle sidebar |
| `Ctrl+Shift+I` | Toggle inspector |
| `Ctrl+Shift+D` | Cycle theme |
| `Ctrl+Shift+L` | Flip RTL/LTR |
| `Ctrl+/` | Shortcuts modal |

---

## Architecture

Single-window Electron app. Pure business logic is extracted into modules under `src/`:

```
main.js               # Electron main process — windowing, IPC, file IO
preload.js            # contextBridge exposes electronAPI to renderer
src/main-logic.js     # Pure security/file helpers (allowlist, BOM, path checks)
src/renderer/         # Pure renderer utilities (i18n, theme, search, markdown, state)
index.html           # Renderer entry — UI markup + remaining inline JS
```

IPC channels (all gated through `preload.js#electronAPI`):

| Channel | Direction | Purpose |
| --- | --- | --- |
| `dialog:openFolder` | renderer → main (invoke) | Pick a vault folder |
| `fs:readVault` | renderer → main (invoke) | Read `.md` files from an allowlisted folder |
| `window-close` / `-minimize` / `-maximize` | renderer → main (send) | Custom titlebar controls |
| `edit:command` | renderer → main (send) | Native copy/cut/paste/undo/redo via webContents |
| `open-external-file` | main → renderer (send) | Deliver file content for OS-level file-association opens |
| `log:error` | renderer → main (send, rate-limited 100/min) | Forward renderer-side errors to local log |

### Security boundaries

- `nodeIntegration: false`, `contextIsolation: true` in BrowserWindow.
- All renderer access to filesystem and shell is via `electronAPI` (preload bridge); the renderer can never call `fs` directly.
- `fs:readVault` enforces an allowlist seeded only by `dialog:openFolder`, rejects UNC/network paths, caps directory size (5 000 files, 10 MiB per file, 100 MiB cumulative), and rejects symlinks that escape the vault root.

---

## Privacy

BP MD RTL Reader is local-first. There is no telemetry, no analytics, no crash-upload, no auto-update phone-home. The renderer loads `marked.js`, `DOMPurify`, and font assets from CDNs (jsdelivr, Google Fonts) on first run when online — these are content-only fetches, no identifiers attached.

---

## Project status

Active development. See `AUDIT_REPORT_2026-05-28.md` for the current test-suite audit and outstanding hardening work.

---

## License

License not yet declared. Treat as **all rights reserved** until a `LICENSE` file is added.
