# BP MD RTL Reader — Task Breakdown (TASK.md)

> **Derived from:** [`PLAN.md`](./PLAN.md) v1.0 → [`SPEC.md`](./SPEC.md) v1.1 · **Status:** Active · **Branch:** `claude/ultracode-effort-IKrV3`
> **Methodology:** strict TDD (RED → GREEN → REFACTOR). **No production line is written before a failing test.**
> **How to read a card:** Objective → Files → RED (write these tests first) → GREEN (minimal impl) → REFACTOR → Edge cases→test → Acceptance (checkable) → DoD.

---

## Conventions

| Item | Convention |
|---|---|
| Task ID | `T-<BacklogID>` (e.g. `T-B11`). Subtasks `T-B11.1`. |
| Status | `☐ todo · ◐ wip · ☑ done · ⛔ blocked` |
| Test files | unit → `tests/unit/<name>.test.js` (Vitest); e2e → `tests/<name>.spec.js` (Playwright) |
| Pure modules | live under `src/**`, no DOM/Electron, mutation-tested (Stryker ≥90%) |
| New main modules | `src/main/**`; wired via `bootstrap()` DI seam |
| New renderer modules | `src/renderer/**`; wired via `EditorPort`/`electronAPI` |
| Global DoD (every task) | TDD order in history · unit ≥95% cov · Stryker ≥90% touched · e2e+visual+axe green · 0 runtime network · DI seams intact |

**Definition of Done (DoD) — reused by every card:**
- [ ] Failing test committed/staged **before** implementation.
- [ ] Lowest-layer unit tests + (if integrated) e2e.
- [ ] Owned edge cases (EC-*) each have a named test.
- [ ] Coverage ≥95% / mutation ≥90% on touched modules; all gates green.

---

# PHASE 1 — Stop the bleeding (M1)

## ☐ T-B11 — Navigation guard
**Objective:** external link clicks open in the OS browser; the renderer never navigates away from `index.html`.
**Files:** `main.js` (createWindow), **new** `src/main/navigation.js` (pure), `tests/unit/navigation.test.js`, `tests/links.spec.js`, `tests/__mocks__` / `main-harness.js`.

**RED — unit (`navigation.test.js`)** — author `classifyNavigation(url, appUrl)` spec:
- [ ] `https://x` → `{action:'external'}`
- [ ] `http://x` → `{action:'external'}`
- [ ] `mailto:a@b` / `tel:+1` → `{action:'external'}`
- [ ] exact `appUrl` (the real `file://…/index.html`) → `{action:'allow'}`
- [ ] `file:///etc/passwd` → `{action:'block'}`
- [ ] `javascript:…`, `data:…`, `blob:…`, custom scheme → `{action:'block'}` (EC-B5)
- [ ] substring trap `file:///x/index.html.evil/` → **not** allowed (exact match) (EC-B6)

**RED — bootstrap seam (`main-window-*` / harness):**
- [ ] `will-navigate` **and** `will-redirect` handlers registered.
- [ ] external → `event.preventDefault()` + `shell.openExternal(url)` once.
- [ ] allow → no preventDefault, no openExternal.
- [ ] block (non-http) → preventDefault, **no** openExternal.

**RED — e2e (`links.spec.js`):** clicking a rendered `https` link keeps `location` on `index.html` and triggers external open (mock).

**GREEN:** implement `classifyNavigation`; wire both events in `createWindow`; `setWindowOpenHandler` stays deny + https-only.
**REFACTOR:** all link-scheme policy lives in `navigation.js` (shared with T-B12).
**Edge → test:** EC-B5 → scheme cases; EC-B6 → substring case.
**Acceptance (SPEC §8.2 B11):** ☐ link→OS browser ☐ renderer URL unchanged ☐ http/file/internal unit-covered.

## ☐ T-B12 — Full context menu
**Objective:** a relevant right-click menu appears everywhere (link, image, selection, editable, empty), with spellcheck.
**Files:** `main.js` (context-menu handler), **new** `src/main/context-menu.js` (`buildContextMenuTemplate(params, policy)`), `tests/unit/main-window-contextmenu.test.js` (extend), `tests/unit/context-menu.test.js`.

**RED — unit:**
- [ ] **link** (`linkURL` set) → "Open Link in Browser" + "Copy Link Address"; Open routes https/mailto only (EC-B5); non-http Open is a no-op.
- [ ] **image** (`mediaType==='image'`) → "Copy Image", "Copy Image Address", "Save Image".
- [ ] **editable** → undo/redo/cut/copy/paste/selectAll with `editFlags` mapped to `enabled`.
- [ ] **selection (non-editable)** → copy(enabled)+selectAll.
- [ ] **empty area** → selectAll fallback (menu always non-empty).
- [ ] **spellcheck** (`misspelledWord` + `dictionarySuggestions`) → suggestion items + "Add to Dictionary".
- [ ] trailing-separator trimmed.

**GREEN:** rebuild handler from `buildContextMenuTemplate`; clipboard for copy-link/image-address.
**REFACTOR:** pure template builder; reuse `navigation.js` policy.
**Edge → test:** EC-B5.
**Acceptance (B12):** ☐ all five contexts ☐ https-only link open ☐ non-http never opened.

## ☐ T-B13 — Sandbox renderer
**Objective:** enable `sandbox:true` without breaking the bridge.
**Files:** `main.js`, `preload.js` (audit), `tests/unit/main-window-contextmenu.test.js` (options), `tests/smoke.spec.js`.

**RED:** ☐ BrowserWindow options test asserts `sandbox:true` (+ `contextIsolation:true`,`nodeIntegration:false`). ☐ e2e probe: `window.require`/`process` undefined in renderer.
**GREEN:** set `sandbox:true`; ensure preload uses only sandbox-safe APIs.
**Acceptance (B13):** ☐ flag asserted ☐ preload functions ☐ no Node in renderer.

**M1 EXIT:** SC3 ☐ · SC4 ☐ · security checklist (nav/sandbox) ☐.

---

# PHASE 2 — Make claims true (M2)

## ☐ T-B3 — Vendor assets (drop CDN)
**Objective:** bundle marked/DOMPurify/fonts; zero runtime network.
**Files:** `index.html` (remove CDN `<script>`/`<link>`+SRI), `package.json` build files, `assets/vendor/**`, `tests/offline-network.spec.js`.
**RED:** ☐ e2e cold-start network probe = **0** external requests (SC2). ☐ airplane-mode render of a fixture `.md` is fully styled (SC1).
**GREEN:** copy `marked`/`dompurify` to `assets/vendor`; reference locally; bundle in `build.files`.
**Acceptance (B3):** ☐ 0 external requests ☐ assets from bundle ☐ SRI removed.

## ☐ T-AI2 — Secure asset protocol + content pipeline
**Objective:** `bpmd://` privileged scheme for vendor + vault images; one `renderTrusted()` stage.
**Files:** **new** `src/main/protocol.js`, **new** `src/renderer/trusted.js`, `main.js` (register scheme), `src/renderer/markdown.js`, `tests/unit/protocol.test.js`, `tests/unit/trusted.test.js`.
**RED — protocol:**
- [ ] `resolveAsset('bpmd://vault/<rel>', root)` returns path under root.
- [ ] `..`/absolute/symlink-escape → denied (reuse `isSymlinkEscape`) (EC-B1).
**RED — pipeline (`trusted.test.js`):**
- [ ] Mermaid output containing `<script>`/`<foreignObject onload>` → stripped (EC-B3).
- [ ] KaTeX with deep macro expansion → bounded by `maxExpand`; `trust:false` blocks `\href` to non-http (EC-B4).
- [ ] link-scheme allow-list applied (EC-B5).
**GREEN:** register `bpmd` as privileged/secure; implement `resolveAsset`; `renderTrusted({md, katexOpts, mermaid})`.
**REFACTOR:** DOMPurify SVG/MathML profile centralised.
**Acceptance:** ☐ protocol root-scoped ☐ Mermaid sanitized ☐ KaTeX bounded ☐ enables strict CSP.
> **Follow-up (from T-B4 review):** the main viewer render (`renderFile`→`parseMarkdown`, `markdown.js`)
> uses a loose DOMPurify config (`ADD_ATTR` only) — it keeps inline `style=`/`<img>`. The strict CSP
> (B4) now backstops the exfil risk (no remote img/font/connect → CSS exfil is dead), but AI2 should
> route the viewer through `trusted.js` `sanitizeHtml` (which `FORBID`s `style`+active img attrs) so the
> sanitizer — not CSP alone — is the control. Defense-in-depth, not currently exploitable.

## ✅ T-T1 / T-T3 / T-T2 — Correct + self-hosted fonts
**Done:** vendored woff2 in `assets/vendor/fonts/` (10 files + `LICENSES.md`, via @fontsource `--no-save`).
Variable fonts (Fraunces opsz+wght normal+italic, Inter wght normal+italic, JetBrains wght normal+italic)
cover all T1 weights in one file each; IBM Plex Sans Arabic ships 4 static weights (400/500/600/700).
`@font-face` block + `font-synthesis: none` (T2) on body; Google Fonts CDN `<link>`/preconnects removed.
**Files:** `index.html` (@font-face + font-synthesis), `assets/vendor/fonts/**`, `tests/unit/fonts-selfhost.test.js`, `tests/offline-network.spec.js`.
**Acceptance (T1/T2/T3):** ✅ real weights ✅ no faux-bold/oblique (real italics vendored — review caught body `<em>` would render upright) ✅ local fonts, 0 network (offline probe loads all families incl. italics).

## ✅ T-B4 — CSP
**Done:** strict CSP meta in `index.html` `<head>`: `default-src 'self'; script-src 'self';
style-src 'self' 'unsafe-inline'; img-src 'self' data: bpmd: file:; font-src 'self' data:;
connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`. The XSS lock is
`script-src 'self'` (no inline/eval/remote). Both inline scripts externalized (overlaps F12):
the FOUC theme-boot → `src/renderer/theme-boot.js`, the whole app module → `src/renderer/app.js`
(imports rebased; via one-shot `scripts/externalize-app.mjs`). `style-src` keeps `'unsafe-inline'`
DELIBERATELY — KaTeX emits inline `style=` in its math HTML (documented concession; the script
lock is the real win). accessibility.spec axe load moved CDN→local (`addInitScript`, CSP-exempt).
coverage excludes app.js/theme-boot.js (e2e-tested glue, as the inline script always was).
**Files:** `index.html`, `src/renderer/{app,theme-boot}.js`, `scripts/externalize-app.mjs`, `vitest.config.js`, `tests/unit/csp.test.js`, `tests/csp.spec.js`, `tests/accessibility.spec.js`.
**Acceptance (B4):** ✅ present ✅ 0 violations (csp e2e) ✅ no inline script (csp.test.js) + CSP ENFORCED (injected inline script does not run).

**M2 EXIT:** SC1 ✅ · SC2 ✅ (offline probe + CSP) · CSP active ✅ · fonts correct ✅.

---

# PHASE 3 — Core feature real (M3) · gate **Q2**

## ☐ T-AI1 — Transactional DocumentStore
**Objective:** single main-process authority over file identity + durability.
**API (target):**
```ts
class DocumentStore {
  open(realpath): Promise<{meta, body?}>      // lazy body
  read(relPath): Promise<string>
  write(relPath, content, baseHash): Promise<{ok}|{error:'conflict'|'unauthorized-path'|'gone'|'enospc'}>
  list(root): AsyncIterable<NoteMeta>          // bounded, cycle-safe
  watch(root, cb): Disposable                  // emits 'changed'
}
```
**Files:** **new** `src/main/document-store.js`, helpers in `src/main-logic.js`, `tests/unit/document-store.test.js`.
**RED (pure first):**
- [ ] write preserves **BOM** (read-strip, write-restore), **EOL** style, final-newline (EC-A1).
- [ ] `write` with stale `baseHash`/mtime → `{error:'conflict'}`; never overwrites (EC-A2).
- [ ] atomic: writes temp in same dir, rename; simulated crash leaves original intact (EC-A3).
- [ ] `write` path with `..`/symlink resolving outside root → `unauthorized-path` (EC-A4).
- [ ] `list` terminates on symlink cycle (visited realpath set); honors depth + whole-tree file/byte caps (EC-A5).
- [ ] `open` returns meta without body; body loaded on demand (EC-A6).
- [ ] deleted/disk-full → `gone`/`enospc` (EC-A7).
**GREEN:** implement store; emit `changed`/`conflict`.
**REFACTOR:** route `fs:readVault` through store; pure encoding/path helpers mutation-tested.
**Acceptance:** all EC-A tests green; ≥90% mutation on store.

## ☐ T-B1 — `fs:writeFile` IPC (atomic, allow-listed) · **Q2**
**Files:** `preload.js` (+`writeFile`), `main.js` (`fs:writeFile` handler → AI1), `index.html` (`saveCurrent`/`saveAs`), `tests/unit/main-ipc.test.js`, `tests/integration/editor.test.js`.
**RED:** ☐ edit→save→disk byte-match (encoding preserved). ☐ path outside allow-list → `unauthorized-path`. ☐ stale write → conflict surfaced to renderer. ☐ autosave debounce (if Q2=autosave) fires once per quiet period.
**GREEN:** add bridge method + handler; wire save; **Q2** decision implemented (rec: autosave + manual flush + "saved" indicator).
**Acceptance (B1):** ☐ byte-match ☐ crash-safe ☐ unauthorized rejected.

## ☐ T-B2 — Recursive vault
**Files:** `main.js` (`fs:readVault` via AI1), `src/main-logic.js` (`filterAndSortMdFiles`+relPath), `tests/unit/main-logic.test.js`, `tests/unit/main-ipc.test.js`.
**RED:** ☐ nested vault returns all `.md` with correct `relPath`. ☐ depth bound. ☐ whole-tree caps. ☐ symlink-escape rejected.
**GREEN:** recursion through store; relPath in results.
**Acceptance (B2):** ☐ nested coverage ☐ bounded ☐ symlink-safe.

## ☐ T-F1 — Folder tree UI
**Files:** `index.html` (`renderTree`→hierarchical), `tests/integration/sidebar.test.js`, `tests/click-audit-all.spec.js`.
**RED:** ☐ hierarchy build from `relPath[]`. ☐ collapse/expand toggles + persists. ☐ keyboard nav (arrows/Enter). ☐ RTL filenames isolated (`<bdi>`/`dir`). ☐ selecting a leaf renders that note.
**GREEN:** tree model + render; folders collapsible.
**Acceptance (F1):** ☐ hierarchy ☐ collapse ☐ keyboard ☐ RTL names ☐ selection.

**M3 EXIT:** SC5 ☐ · nested vault+tree ☐.

---

# PHASE 4 — RTL correctness (M4)

## ☐ T-R1 — Per-line/block direction
**Files:** **new** `src/renderer/bidi.js` (`resolveDirection(text, inherited)`), `index.html`/render pipeline, `tests/unit/bidi.test.js`, `tests/rtl-fixes.spec.js`.
**RED:** ☐ first-strong char sets block dir. ☐ neutral-only line inherits context, not forced LTR (EC-C1). ☐ maps to `dir="auto"`+`unicode-bidi:plaintext`.
**GREEN:** apply per-block; remove whole-doc flip (keep manual toggle).
**Acceptance:** mixed AR/EN blocks correct.

## ☐ T-R2 — Bidi isolation everywhere
**Files:** `src/renderer/markdown.js` (renderers), `src/renderer/bidi.js` (`isolate(run)`), `tests/rtl-adversarial.spec.js`, snapshot fixtures.
**RED (snapshots):** inline code / link / number / tag isolated inside **list, blockquote, callout, table cell, paragraph** (the Obsidian failure set).
**GREEN:** wrap inline neutral/opposite runs in `<bdi>`.
**Acceptance:** snapshots stable for all block types.

## ☐ T-R3/R4/R5 — Arabic typography & numerals
**Files:** `index.html` CSS, `src/renderer/i18n.js` (`hasTashkeel`, numerals), `tests/unit/arabic.test.js`, `tests/visual.spec.js`.
**RED:** ☐ Arabic `line-height ≥1.8`; ☐ ≥2.0 when tashkeel present (`hasTashkeel`). ☐ no `letter-spacing` on Arabic. ☐ numerals toggle maps Western↔Arabic-Indic. ☐ numbers render LTR in RTL block.
**GREEN:** Arabic type defaults + ligatures; `numerals` setting.
**Acceptance (R3/4/5):** all above green.

**M4 EXIT:** SC7 (non-table) ☐.

---

# PHASE 5 — Accessibility (M5)

| Task | Files | RED tests | EC | Acceptance |
|---|---|---|---|---|
| ☐ T-F2 | `index.html`, `tests/accessibility.spec.js` | every icon button has `aria-label`; Arabic runs get `lang="ar"` | EC-C6 | axe: controls named |
| ☐ T-F3 | `index.html` (`#toast`) | toast `role="status"`/`aria-live="polite"`; SR announces save/error | — | announced |
| ✅ T-F4 | `src/renderer/focus.js`, `index.html`, `tests/{unit/focus,focus-trap}` | focus trapped (`trapTab`) + restored via `_focusStack` (nested palette→modal); dialogs `role=dialog aria-modal`; nested Esc order | EC-C7 | keyboard-safe |
| ✅ T-F5 | `src/renderer/focus.js`, `index.html`, `tests/focus-trap.spec.js` | dropdown Up/Down/Home/End roving (`rovingNext`), Esc→opener, Tab closes; mouse-open keeps editor focus + still keyboard-navigable | — | menus operable |
| ✅ T-T4 | `index.html` CSS, `scripts/rem-convert.mjs`, `tests/{unit/typography-rem,typography-zoom}` | chrome font-sizes in `rem` (16px base); app-wide zoom scales the `:root` rem base so the whole UI scales while the `.app` frame stays viewport-sized (no off-screen clip); dropdown scrolls internally at high zoom | — | scalable |
| ✅ T-T5 | `index.html` CSS, `scripts/rem-convert.mjs` | 11px (0.6875rem) legibility floor on all chrome labels (20 bumped); scales with T4 | — | legible |

**M5 EXIT:** SC8 ☐ (axe 0 serious/critical; keyboard-only traversal; visible focus).

---

# PHASE 6 — Persistence & docs (M6)

## ☐ T-B5 — Persist app state
**Files:** **new** `src/main/settings.js` (load/save/migrate), `main.js`, `tests/unit/settings.test.js`.
**RED:** ☐ round-trip `Settings` (SPEC §4.3). ☐ corrupt/truncated JSON → defaults, no crash (EC-D1). ☐ unknown future `version` → migrate/clamp. ☐ window bounds off-screen → clamped to visible display (EC-D2).
**GREEN:** versioned store under `userData`; main owns it.
**Acceptance:** relaunch restores theme/zoom/mode/panels/recents/window/last-session.

## ☐ T-F8 — Persist UI prefs
**Files:** `index.html` (read/write via bridge), `tests/integration/*`.
**RED:** ☐ direction/zoom/mode/panels persisted+restored.
**Acceptance:** prefs survive relaunch.

## ☐ T-B8 — Reconcile docs
**Files:** `README.md`, `docs/PRIVACY.md`, `CHANGELOG.md`.
**RED:** (doc-lint/manual) claims match behavior — save semantics, persisted data list, offline.
**Acceptance:** no overstated claims.

**M6 EXIT:** session restore verified ☐ · docs reconciled ☐.

---

# PHASE 7 — Editor rewrite, flagship (M7) · gate **Q1, Q4**

## ☐ T-AI3 — EditorPort + adapters
**API:**
```ts
interface EditorPort {
  load(content, opts): void; getValue(): string;
  getSelection(): Range; setSelection(r): void;
  setDecorations(decos): void; onChange(cb): Disposable;
  find(query, opts): Match[]; setLineDirection(line, dir): void;
}
```
**Files:** **new** `src/renderer/editor/editor-port.js`, `textarea-adapter.js`, `codemirror-adapter.js`; `src/renderer/bidi.js` (extend).
**RED:** ☐ UI suites run against a **mock EditorPort**. ☐ `BidiService` caret stepping across RTL/LTR boundary is logical (EC-C2). ☐ IME composition: no token re-render mid-compose, no caret jump (EC-C3). ☐ Arabic heading → URL-safe slug (EC-C5).
**GREEN:** define port; `TextareaAdapter` (parity) behind flag, then `CodeMirrorAdapter`. **Q1**=CM6, **Q4**=drop Split.
**Acceptance:** UI depends only on port; BidiService green ≥90% mutation.

## ☐ T-F13 — Unified Live Preview (CM6)
**Files:** `codemirror-adapter.js`, `index.html` (mount, remove 3-mode switch), `tests/editor-live-preview.spec.js`.
**RED (e2e):** ☐ inactive line renders formatted; ☐ active (cursor) line shows raw tokens; ☐ Source toggle works; ☐ selection+scroll preserved across edits; ☐ per-line direction + cursor correct in mixed text; ☐ `Ctrl+F` via `EditorPort.find` over decorated tokens (EC-C4); ☐ perf: 10k-line doc <100ms initial, <16ms/keystroke region.
**GREEN:** CM6 decorations (inactive tokens→ZWSP); wire find/save/selection through port.
**Acceptance (F13):** all RED pass; old modes removed.

## ☐ T-R9 — Bidi tables + cursor
**Files:** `codemirror-adapter.js`/table renderer, `bidi.js`, `tests/rtl-adversarial.spec.js`.
**RED:** ☐ RTL table mirrors column order; ☐ each cell `dir=auto`; ☐ arrow-key cell traversal is **logical** (EC-C2); ☐ snapshot + interaction.
**Acceptance (R9):** mixed-direction table correct + navigable.

**M7 EXIT:** SC6 ☐ · SC7 tables ☐ · single editing mode ☐.

---

# PHASE 8 — Rendering baseline (M8) · gate **Q3**

| Task | Files | RED | EC |
|---|---|---|---|
| ☐ T-F9 | `markdown.js`, `trusted.js`, `tests/renderer.spec.js`, `visual.spec.js` | code highlight + KaTeX render + snapshot; KaTeX `trust:false`/limits | EC-B4 |
| ☐ T-F14 | `markdown.js` (callout ext), tests | `> [!NOTE]`/TIP/IMPORTANT/WARNING/CAUTION render with icon/role | — |
| ☐ T-F15 | `markdown.js` | GFM `- [ ]`/`- [x]` checkboxes render (+toggle if editable) | — |
| ☐ T-F16 | `trusted.js` (mermaid lazy) | mermaid renders; SVG sanitized | EC-B3 |
| ☐ T-F7 | `index.html` (buildTOC), `bidi.js` | outline h1–h6; scroll-sync active item; Arabic slugs | EC-C5 |
| ✅ T-B6/F6 | `main.js` (`export:pdf`), `preload.js` (`exportPDF`), `index.html` (`buildExportDoc`/`exportPDF` + File-menu/palette), `tests/{unit/main-export-pdf,export-pdf}` | PDF export of current note via offscreen render of the standalone export doc; ISOLATED offline session hard-blocks all non-local requests (SC2) + CSP meta; temp-file (no data:-URL size cap); 30s timeout; sanitized content only | — |

**M8 EXIT:** SC9 ☐.

---

# PHASE 9 — RTL moats (M9)

| Task | Files | RED | Differentiator |
|---|---|---|---|
| ✅ T-R7 (core) | `index.html` (drop `.app-body` ltr lock; `data-i18n`; content LTR anchor on `.editor`; logical reveal-strip insets), `src/renderer/{locale,app}.js`, `tests/{r7-rtl-ui,unit/locale}` | UI mirrors layout+glyphs when `uiDirection=rtl` (sidebar→right, chevrons flip); primary chrome (menus + sidebar tabs) localizes via `uiLocale`/`locale.js`; persisted (F8); content/code/math stay LTR; RTL chrome visual snapshot. **Catalog expansion** (dropdown items, inspector/status/palette strings) = follow-up. | **unique** |
| ☐ T-R8 | `index.html` (`newDailyNote`), `src/renderer/i18n.js` (Hijri) | Daily Note name+title in Hijri when `calendar=hijri` | unique |
| ✅ T-R10 | `index.html` CSS, `src/{main/settings,renderer/app}.js`, `tests/{unit/settings,r10-kashida}` | Arabic blocks ragged by default; optional kashida justification (`text-justify: inter-character` on RTL prose blocks) toggled via View ▸ Arabic + palette, persisted (`arabicKashida` setting, F8); prose-only (headings/cells stay ragged) | unique |
| ☐ T-R6 | front-matter parse, `bidi.js` | `direction:` front-matter honored; manual per-line override (hotkey) inserts/clears isolate | parity built-in |

**M9 EXIT:** Arabic, mirrored UI shippable ☐.

---

# PHASE 10 — Reach & cleanup (M10) · gate **Q5, Q6**

| Task | Files | RED/Check | Notes |
|---|---|---|---|
| ☐ T-B7 | `package.json` build, CI | mac/linux artifacts build; entitlements for user-selected folders | Q5 signing/notarization |
| ✅ T-B9 | `src/main/document-store.js` (`watch`), `main.js`, `preload.js` (`onVaultChanged`), `src/renderer/app.js` (`handleVaultChanged`/`resolveConflict`), `tests/{unit/document-store,unit/main-ipc,b9-vault-watch}` | `fs.watch`(recursive, debounced)→`vault:changed`→renderer re-lists & reconciles; non-dirty files adopt disk content, EOL-normalized compare avoids false conflicts; EC-A2: dirty+diverged → conflict banner (Keep edits / Reload from disk) + ⚠ tab marker, never silent overwrite; watcher closed on window-close/quit | EC-A2 |
| ☐ T-B10 | `src/main-logic.js`, `index.html` | `.txt` consistent across drag-drop + vault filter | |
| ☐ T-F10 | `index.html` | remove double `◆`; hide/disable dead Recent + fake `.sb-stat` pointer | cosmetics |
| ✅ T-F11 | `index.html` CSS, `src/{main/settings,renderer/app}.js`, `tests/f11-t6.spec.js` | italic-recolour OPT-OUT (`italicRecolor` setting, default on; `.no-italic-recolor #noteContent em` → ink colour, slant kept) via View ▸ Typography + palette, persisted; chevrons mirror under `html[dir="rtl"]` (dormant until R7 sets UI dir — scoped to UI, not content) | |
| ✅ T-T6 | `index.html` (`font-optical-sizing: auto` on body) | Fraunces (variable opsz) optical sizing explicitly engaged + guarded (static + e2e tests) — auto = size-driven cut | |
| ✅ T-F12 | `index.html` (zero inline logic — B4), `src/renderer/*` (22 import-testable modules incl. new `export.js`), `app.js` (composition root) | index.html decomposed: the whole inline script externalized in B4; behavior lives in import-testable ES modules (i18n/theme/state/markdown/edit-commands/bidi/bidi-dom/callouts/outline/frontmatter/dates/highlight/math/trusted/mermaid/focus/locale/export/search/…); export subsystem extracted to `export.js` + unit-tested; snapshots stable / behavior unchanged. `app.js` remains the DOM-wiring composition root (further ui/editor sub-splits are incremental). | done last |
| ☐ Q6 | `main.js` | opt-in update-**check** only (no auto-download), privacy-preserving | EC-D3 |

**M10 EXIT:** cross-platform signed builds ☐ · modularized ☐.

---

## Appendix A — New files introduced
| File | Task | Kind |
|---|---|---|
| `src/main/navigation.js` | T-B11 | pure (scheme policy) |
| `src/main/context-menu.js` | T-B12 | pure (template builder) |
| `src/main/protocol.js` | T-AI2 | main (bpmd:// resolver) |
| `src/renderer/trusted.js` | T-AI2 | renderer (sanitize pipeline) |
| `src/main/document-store.js` | T-AI1 | main (repository) |
| `src/main/settings.js` | T-B5 | main (versioned store) |
| `src/renderer/bidi.js` | T-R1 | pure (BidiService) |
| `src/renderer/editor/editor-port.js` + adapters | T-AI3 | renderer (ports/adapters) |

## Appendix B — New/extended test files
`navigation.test.js` · `context-menu.test.js` · `protocol.test.js` · `trusted.test.js` · `document-store.test.js` · `settings.test.js` · `bidi.test.js` · e2e: `links.spec.js` · `offline-network.spec.js` · `editor-live-preview.spec.js` (+ extend existing `rtl-*`, `accessibility`, `visual`).

## Appendix C — Master status board
Legend: ☑ done & unit-tested · ◑ partial · ⊘ deferred (needs browser/heavy-dep/binary not available in CI sandbox)

| Phase | Done (☑) | Partial (◑) | Remaining (☐) |
|---|---|---|---|
| P1 | T-B11, T-B12, T-B13 | — | — |
| P2 | T-AI2, T-B3 (marked/DOMPurify/KaTeX/highlight.js/mermaid vendored) | — | T-B4 CSP, T-T1/T3 self-host fonts (in progress) |
| P3 | T-AI1, T-B1, T-B2 | T-F1 (tree builder ☑; collapsible DOM ☐) | — |
| P4 | T-R1, T-R2 (live DOM), T-R3/4/5 (core) | — | — |
| P5 | T-F2, T-F3, T-F4, T-F5, T-T4, T-T5 | — | — |
| P6 | T-B5, T-F8 (persist+restore wired) | — | T-B8 docs |
| P7 | T-AI3 (EditorPort+TextareaAdapter) | — | T-F13 CM6, T-R9 bidi tables |
| P8 | T-F14, T-F7, T-F15, T-F9 (highlight+KaTeX), T-F16 (mermaid), T-B6/F6 (PDF) | — | — |
| P9 | T-R6, T-R8, T-R7-core (locale) | — | T-R7 UI mirroring, T-R10 justification |
| P10 | T-B10, T-F10 | — | T-B7 builds, T-B9 fs.watch, T-F11, T-T6, T-F12, Q6 |

**Test status (after T-F12):** 787 unit tests green · coverage 95.84% stmts / 89.8% branch (gate ✓ 95/88/95/95) · full Playwright e2e **622/622** on win32 · eslint 0 errors. Branch `claude/ultracode-effort-IKrV3` green at every commit. **Remaining:** T-F13 (CodeMirror 6 live-preview — flagship, not started: a standalone editor rewrite — vendored CM6 + decoration engine + remove 3-mode switch), T-B7+Q6 (mac/linux electron-builder config + opt-in update-check — mac/linux *artifact* build is platform-blocked on win32; Q6 logic doable). Linux visual baselines still deferred to the Playwright v1.60.0-jammy Docker pass.

**Test status (after T-F11/T6):** 770 unit tests green · coverage 96.54% stmts / 90.32% branch (gate ✓ 95/88/95/95) · full e2e green on win32 (f11-t6 4/4; no snapshot changes — defaults unchanged) · eslint 0 errors.

**Test status (after Task 5 — fonts + B4 CSP):** 768 unit tests green · coverage 96.45% stmts / 90.17% branch / 95.57% func / 97.47% lines (gate ✓ at 95/88/95/95; app.js/theme-boot.js excluded as e2e-tested glue) · full Playwright e2e 599/599 on win32 under strict CSP (csp e2e proves inline + REMOTE script/img/fetch are refused; KaTeX+mermaid render; accessibility axe loads locally) · eslint 0 errors (app.js now linted, warnings only). Strict CSP active (script-src 'self', no inline script); fonts self-hosted; 0 CDN/network anywhere in shipping code. Local-first holds: offline probe blocks all external network and renders marked/DOMPurify/KaTeX/highlight.js/mermaid from `assets/vendor/` with 0 CDN requests.

### In-progress autonomous build (this branch)
Working order: F16 ✅ → F4+F5 ✅ → T4+T5 ✅ → B6+F6 ✅ → B3-finish/T1/T3/B4 ✅ → R10 ✅ → F11+T6 ✅ → B9 ✅ → R7 ✅(core) → F12 ✅(index.html decomposed in B4 + export.js extracted; app.js = composition root) → F13 → B7+Q6. Linux visual baselines deferred to one final regeneration pass (Playwright v1.60.0-jammy Docker).

---

*End of TASK.md — v1.0. Tracks PLAN.md v1.0 / SPEC.md v1.1. Every task is test-first (SPEC §12).*
