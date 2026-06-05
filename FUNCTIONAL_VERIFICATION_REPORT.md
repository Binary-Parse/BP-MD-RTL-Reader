# Functional Verification Report — BP-MD-RTL-Reader

**Scope:** every feature graded for *actual runtime behavior* (not just test presence), on two axes — **static wiring** (full path UI→renderer→preload→main→effect) and **runtime behavior** (exercised by a real assertion / live probe). A feature is **WORKS** only if both pass; **PARTIAL** = wired but a sub-capability is missing/unexercised; **BROKEN** = dead path or cannot work.

**Method:** 64 features, one verification agent each, then an **adversarial second pass** on every non-WORKS verdict whose job was to *disprove* it (kill false negatives). 75 agents total. Branch `claude/ultracode-effort-IKrV3` @ `6a17662`, working tree clean. Full unit + e2e (669) + mutation gates passed this session.

> The adversarial pass changed one verdict: **E14 (inline math widget)** PARTIAL→**WORKS** — the skeptic *ran* `f13-single-mode.spec.js` case "I" and saw KaTeX paint inside `.cm-mount`, which the first agent had missed. Every other non-WORKS verdict was upheld after an exhaustive hunt for aliases / dynamic registration / fallbacks.

## Result

| Verdict | Count |
|---|---|
| ✅ WORKS | **55** |
| 🟡 PARTIAL | **6** |
| 🔴 BROKEN | **3** |
| **Total** | **64** |

**Headline:** the app is overwhelmingly functional. The suspicion that "many features are stubbed" is **not** borne out — 86% fully work end-to-end with real test backing. The real defects cluster around **two root causes** plus a few never-implemented items.

---

## 🔴 / 🟡 The 9 findings (everything not fully working)

### Root cause #1 — the `bpmd://` vault-asset pipeline was never wired (drives M13, M14, R10)
The pure resolver `src/main/protocol.js` (`parseBpmdUrl`/`resolveAsset`) was written and unit-tested, CSP (`index.html:10`) and the sanitizer (`trusted.js`) were updated to *allow* the scheme — but the registration glue was never added. `main.js` has **zero** `protocol.*` calls (no `registerSchemesAsPrivileged` / `protocol.handle` / `registerFileProtocol`), never `require`s `./src/main/protocol`, and no renderer code rewrites `![](pic.png)` into a `bpmd://` URL. The module's own header even says *"the registration glue lives in main.js"* — it does not.

| ID | Feature | Verdict | Impact |
|---|---|---|---|
| **M13** | `bpmd://` protocol registration | 🔴 BROKEN | scheme never registered → resolver is dead code |
| **M14** | `bpmd://` asset resolve logic | 🟡 PARTIAL | pure logic is correct + fully tested, but never invoked |
| **R10** | Images (inline + standalone) | 🟡 PARTIAL | generic `<img>` (data:/http/absolute) renders fine; **vault-relative images `![](pic.png)` cannot load** |

**Fix (one change closes all three):** in `main.js` `app.whenReady`, `registerSchemesAsPrivileged([{scheme:'bpmd', ...}])` at top level + `protocol.handle('bpmd', ...)` calling `resolveAsset(url, activeVaultRoot)`; and in the renderer image-render path, rewrite note-relative `src` to `bpmd://vault/<rel>`. Resolver + tests already exist. ~medium.

### Root cause #2 — Save-to-disk doesn't use the IPC writer (M08) ⚠️ most user-impactful
| ID | Feature | Verdict | Impact |
|---|---|---|---|
| **M08** | Save / Save-As file write | 🟡 PARTIAL | **In the packaged Electron app, Ctrl+S on a vault-opened file triggers a *Blob download* of a copy, not an in-place save.** |

The fully-built, tested, atomic `fs:writeFile` IPC handler (`main.js:282` → `document-store.js` atomic write) is **orphaned** — `saveCurrent()`/`saveAs()` (`app.js:1560,1581`) only use the browser File System Access API (`handle.createWritable`/`showSaveFilePicker`) with a Blob-download fallback, and **never call `electronAPI.writeFile`** (zero references in `src/renderer`). Files opened via the Electron vault path get `handle:null`, so save falls through to the download branch. `integration/editor.test.js:127` even *asserts* the Blob fallback fires.

**Fix:** route `saveCurrent`/`saveAs` through `electronAPI.writeFile` when `electronAPI` is present (Electron), keep the FSA/Blob path as the browser fallback. ~medium. **Recommend fixing first** — silent "save makes a download instead of saving" is the kind of bug that loses user work.

### Regression from the CM6-sole-editor migration (R09)
| ID | Feature | Verdict | Impact |
|---|---|---|---|
| **R09** | Wikilinks | 🟡 PARTIAL | render + click-navigation work in the legacy preview pane, but that pane is **hidden** in the CM6 surface (`index.html:875`). `renderCmBlock` (`app.js:1734`) only handles table/mermaid/callout/image — **no wikilink case**, so a paragraph `[[link]]` stays raw, non-clickable text in the live editor; `navWikilink` is unreachable there. |

**Fix:** add a wikilink decoration/anchor case to the CM6 live-preview path so `[[link]]` renders clickable and routes to `navWikilink`. ~small.

### Never implemented (M12, R11)
| ID | Feature | Verdict | Notes |
|---|---|---|---|
| **R11** | Footnotes | 🔴 BROKEN | `marked` core + `gfm:true` does **not** support footnotes; `marked-footnote` is not a dependency and no extension/CSS/transformer exists. `[^1]` renders as literal text. Fix: add `marked-footnote` (vendored) + register it. ~small. |
| **M12** | Navigation back/forward/history | 🔴 BROKEN | **No such feature exists** at any layer (no buttons, no stack, no IPC). NB: this entry was a *manifest mislabel* — the hint conflated `src/main/navigation.js` (a URL allow/external/block **security policy**, which works) with document history. Treat as "not a feature," not a broken stub. Build only if desired. ~large. |

### Dead code (M15 — no user impact)
| ID | Feature | Verdict | Notes |
|---|---|---|---|
| **M15** | Document-store CRUD | 🟡 PARTIAL | `write()` + `watch()` are live and proven; **`read()` and `listMarkdown()` are never called** at runtime — `main.js` does its own `fs.readdir/readFile` recursion in `fs:readVault`. Cleanliness only; either adopt the store methods or drop them. ~small. |

### Minor (M01 — likely works, just unproven)
| ID | Feature | Verdict | Notes |
|---|---|---|---|
| **M01** | Open file via dialog (single `.md`) | 🟡 PARTIAL | "Open Folder" is fully IPC + tested. "Open File" uses the browser `showOpenFilePicker` (+ hidden `<input>` fallback), not IPC; its pick→content→`addFile` branch is only confirmed *not to throw*, never asserted to actually load content (can't drive a native picker headlessly). Functionally fine in Electron/Chromium; just an untested branch. ~small. |

---

## Prime-suspect scorecard (the 5 flagged before the run)
| Suspect | Predicted | Confirmed |
|---|---|---|
| `bpmd://` protocol not registered in `main.js` | BROKEN | ✅ **BROKEN** (M13) — confirmed by hand + 2 agents + adversarial |
| Zoom UI | suspect | ✅ **WORKS** — `setZoom` drives `documentElement.style.fontSize` (`app.js:1081`), wired to menu/palette/`Ctrl±0`/persistence |
| Demo / welcome notes loading | suspect | ✅ **WORKS** — `loadDemo()` builds real notes, wired to 4 triggers |
| Drag-and-drop file open | suspect | ✅ **WORKS** — `initDragDrop()` registers `dragover`/`drop`, called at init |
| Find UI (post-CM6) | suspect | ✅ **WORKS** (E12) — `setSearchHighlight`→`.cm-searchMatch`, next/prev/close all verified |

4 of 5 suspects cleared; only `bpmd://` was a true defect (and it cascades to M14 + R10).

---

## Prioritized fix list
1. **M08 Save-to-disk** (medium) — route Electron save through `fs:writeFile`. *Highest user impact.*
2. **M13/M14/R10 bpmd:// pipeline** (medium, one fix) — register the scheme + rewrite vault image paths.
3. **R09 Wikilink navigation in CM6** (small) — add wikilink case to the live-preview path.
4. **R11 Footnotes** (small) — vendor + register `marked-footnote`.
5. **M15 dead `read`/`listMarkdown`** (small, cleanup) — adopt or remove.
6. **M01 / E14 test gaps** (small) — add the missing real assertions; product already works.
7. **M12 nav history** — only if the feature is actually wanted (it was never specced).

## Fixes applied (post-verification)
All real defects were fixed and locked in with tests; gates re-run green.

| ID | Fix | Tests added | Files |
|---|---|---|---|
| **M08** | `saveCurrent` now writes vault files in place via the `fs:writeFile` IPC bridge (handle → IPC → Blob-download fallback, in that order); vault files carry a `vaultRoot`. | `functional-fixes.spec.js` [M08]×3 | `src/renderer/app.js` |
| **M13/M14** | `main.js` registers the `bpmd` scheme as privileged before ready (`registerSchemesAsPrivileged`) and attaches `protocol.handle('bpmd', …)` → `resolveAsset` against the active vault root (traversal-guarded, allow-list re-checked); `activeVaultRoot` tracked on `fs:readVault`. | `main-bpmd-protocol.test.js` ×7 | `main.js`, `tests/unit/main-harness.js` |
| **R10** | Renderer rewrites note-relative `<img>` srcs to `bpmd://vault/<rel>` (decode-then-encode per segment) in the preview, the live-update path, and the CM6 image widget. | `functional-fixes.spec.js` [R10]×3 | `src/renderer/app.js` |
| **R09** | New regex-based `createWikilinkPreview` CM6 plugin renders `[[wikilinks]]` as clickable anchors off the active line, wired to `navWikilink`. | `wikilink-preview.test.js` ×9, `functional-fixes.spec.js` [R09] | `src/renderer/editor/wikilink-preview.js`, `codemirror-adapter.js`, `app.js` |
| **R11** | New `footnoteExtension()` marked plugin: `[^id]` refs + `[^id]:` defs → numbered end-of-doc list with backlinks; registered in `configureMarked`; styled in `index.html`. | `footnotes.test.js` ×14 | `src/renderer/footnotes.js`, `markdown.js`, `index.html` |

**Not fixed (intentional):** M15 (dead `read`/`listMarkdown` — internal cleanup, no user impact), M01 (untested branch, product works), M12 (never-specced feature). M14's resolver is now live (invoked by the M13 handler), so it is effectively WORKS.

**Gates after fixes:** unit 1100+ pass · e2e **676 pass** (was 669) · coverage **97.3/92.8/95.7/97.9** (gate 95/88/95/95) · mutation aggregate **≥85** with `footnotes.js` at **86%** and `wikilink-preview.js` in scope. New mutable modules added to `stryker.config.json`.

## Verification of the verification
- All 5 prime suspects individually confirmed above (not folded into a count).
- `bpmd://`: grep proved zero protocol registration in `main.js` **and** the resolver has zero non-test callers — definitive.
- WORKS verdicts carry runtime artifacts (e2e/unit `file:case` with real assertions), e.g. M02/M03/M09/M11/E12/R07 cite concrete state/DOM checks; E14's flip came from a live test run.
- Counts reconcile: 55 + 6 + 3 = 64 = manifest size.
