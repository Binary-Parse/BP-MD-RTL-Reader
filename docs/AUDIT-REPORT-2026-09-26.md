# Hostile Full-App Audit — BP MD RTL Reader v1.3.1

> **Editor's note (2026-09-27):** the audited tree carried the draft label `v1.3.1` in
> `package.json` at audit time; that label was retired before release and the audited work
> ships as **v1.3.0** (see the consolidation note atop CHANGELOG.md). The 1.3.1 references
> below are historical record, not a shipped version.

**Date:** 2026-09-26 · **Target:** `main @ ae8c10d` (v1.3.1; working tree carries one untracked `AGENTS.md`) · **Scope:** all of `src/main` (16 files), `src/preload`, full renderer incl. the 5,485-line `app.js` (two dedicated auditors), markdown/export pipeline, bidi/RTL core, tests/CI/gate scripts/packaging/supply chain, plus live execution of every release gate including two the prior passes had not run.

**Method:** an 18-agent adversarial workflow — 8 hostile dimension finders, 8 independent skeptic agents that re-read the code and attempted to **refute every finding** (3 findings died, 1 was downgraded), a gates runner executing the project's own checks, and a completeness critic whose gap list drove two additional follow-up checks by the lead auditor (a full `npm run coverage` run at HEAD and an installer-vs-PRIVACY.md claims check). Dynamic evidence throughout: hostile-input harnesses under the OS temp dir against the real modules and the vendored DOMPurify 3.4.13 / marked 18.0.6 / KaTeX 0.17.0 / mermaid 11.16.1 runtimes; a real `.epub` built and validated with an independent extractor; live SPKI-pin verification; simulated two-session capability/annotation reproduction. **Retraction discipline:** every lead was confirmed or explicitly refuted; refuted findings are retained in Appendix B. No repository file was modified by this audit (scratch harnesses lived under `%TEMP%`; snapshot baselines were deliberately not regenerated).

**Severity rubric:** P1 = untrusted input → code execution / large-scale data loss / shipped license violation. P2 = realistic security bypass, data-loss-adjacent defect on a common path, core feature broken for the target audience, **release gate red**. P3 = hardening gap, user-visible defect on an uncommon path, maintainability hazard on a hot path, compliance drift. P4 = minor bugs, doc drift, hygiene.

---

## 1. Executive summary

The security architecture continues to hold under attack — every bypass the finders constructed against the protocol handlers, capability registry, CSP/Trusted-Types stack, sanitizer pipeline, TLS pinning, and window/permission surface was re-verified as fail-closed (§4). No P1 was found. But the audit found **42 confirmed findings: 2 P2, 21 P3, 19 P4**, clustering into five themes:

1. **Two release gates are red at HEAD — one of them never re-run by the 2026-09-24 passes.** `npm run coverage` **fails**: unit coverage 93.28% statements / 88.23% branches / 92.8% functions vs the 95/90/95 floors, dragged down by `src/main` at 85.5% statements (`document-store.js` 71.2% statements / 63.6% branches). And `npm run test:e2e` fails 8 `@visual` specs by marginal pixel overage (e.g. 5251 vs 5000 `maxDiffPixels`) against baselines last committed at `ac2cf77` (2026-09-21) — **seven rendering-affecting commits have landed since** (radius tokens, continue-reading shelf, highlight UI/inspector, reading streak, floating copy button, the 09-24 fix pass). The failures map cleanly onto those intentional changes (e.g. `code-math` ↔ the floating copy button `daaecba`, `chrome-geometry` toast-clear ↔ statusbar work); they are stale baselines, not detected regressions — but nobody regenerated them, and a real regression would present identically.
2. **`docs/PRE-RELEASE-REVIEW.md`'s closure banner ("all gate items closed") is false for at least 10 items.** Gate-filed items RTL-M1, RTL-M2, RTL-M3, RTL-M4, RTL-M5, RTL-M6, RTL-M7, F8, S-H2's demanded containment re-check, and S-M1's grant-merge are all still open in code — several reproduced dynamically. The appendices only ever closed RTL-H1–H4 and the seven P3s; the header claim is doc drift, and it is hiding live RTL and data-safety defects (§5).
3. **The close/data-safety flow can still be defeated by ordinary gestures.** A double Alt+F4 (or any superseded save dialog) clobbers `window._saveDialogOpen` behind the visible dialog — autosave then persists content the user is about to decline — and kills the 20-second close failsafe (DATA-03). Save-All failures during close abort with zero feedback (DATA-05). A single rejected promise during session restore silently disables autosave and crash-recovery for the whole session (DATA-04).
4. **Identity instability breaks the flagship workflow quietly:** every vault note's highlights/margin notes are orphaned on every restart because `sessionOnly` capability ids rotate while annotations are keyed `doc:<documentId>` (DATA-01, P2) — only the vault workflow is broken; dialog-opened loose files keep their annotations.
5. **Export artifacts ship visible defects:** every exported HTML/PDF/EPUB with math renders each formula twice and unstyled (no KaTeX CSS/fonts in any artifact), mermaid SVGs degrade to schema-invalid EPUB chapters (camelCase tag lowercasing), and EPUB is the one artifact that still carries author-controlled remote references (tracking channel).

**Confirmed findings by domain:**

| Domain | P2 | P3 | P4 |
|---|---|---|---|
| Release gates / QA | 1 (GATE-01) | 2 | 2 |
| Data integrity / safety | 1 | 4 | 1 |
| Security hardening | 0 | 3 | 4 |
| RTL / bidi correctness | 0 | 5 | 2 |
| UX / export correctness | 0 | 4 | 4 |
| Performance | 0 | 1 | 0 |
| Compliance / docs / hygiene | 0 | 2 | 6 |

### Top findings

| # | ID | Finding | Sev |
|---|---|---|---|
| 1 | GATE-01 | Unit coverage gate red at HEAD: 93.28/88.23/92.8 vs 95/90/95 floors; `src/main` at 85.5% | **P2** |
| 2 | DATA-01 | Vault-note highlights/margin notes orphaned after every restart (rotating `doc:cap-*` keys; orphans accumulate toward the 2 MiB store cap) | **P2** |
| 3 | DATA-03 | Double-close / superseded save dialog clobbers `_saveDialogOpen` → autosave writes behind a pending Don't-Save; also kills the 20 s close failsafe | P3 |
| 4 | SEC-01 | `fs:reopenDocument` re-pins a granted path through a post-grant symlink to any target, no escape/extension/containment re-check (S-H2 residue) | P3 |
| 5 | DATA-04 | `restoreSettings().then(...)` has no rejection handler — one render throw and autosave + crash recovery are silently dead all session | P3 |
| 6 | CMP-01 | CI trust surface: Actions disabled while README badge says "CI gated"; no enforced secret scan exists anywhere in the release runbook | P3 |
| 7 | UX-01 | All three exports embed KaTeX output with no KaTeX CSS/fonts → duplicated, mis-laid-out math in every artifact | P3 |
| 8 | QA-01 | Real-Electron lane is 6 specs / 23 tests; save, conflict, recovery, watcher, autosave, capability flows never run against real Electron | P3 |
| 9 | RTL-01/02/03/05 | Four gate-filed RTL-Mediums still open (table code-letter counting, AUTO `State.direction='ltr'` pin, per-line code counting, scheme-less URL flips) | P3 |
| 10 | GATE-02 | `release-preflight` staleness gate checks only `sbom.json` — the OSV vulnerability scan can predate the lockfile and still pass | P3 |

---

## 2. Release-gate status (executed 2026-09-26 at HEAD)

| Gate | Result | Detail |
|---|---|---|
| `npm run lint:security` | **pass** | 221 exact reviewed findings; 0 new or moved; fingerprint `c3851c5f` matches baseline |
| `npm run vendor:check` | **pass** | Vendored assets match locked sources (SHA-256 incl. fonts + EnVar.dll) |
| `npm run license:inventory` | **pass** | Inventory `sourceSha256` matches current lockfile (`6cb59b3b`), 849 entries |
| `npm run dupcheck` | **pass** | jscpd: 0.47% duplication, 7 clones (threshold 1%) |
| `npm audit --audit-level=moderate` | **pass** | 0 vulnerabilities |
| `npm run test:unit` | **pass** | 109 files / 2041 tests |
| `npm run test:electron` | **pass** | 6 specs / 23 tests |
| `npm run test:e2e` | **FAIL** | 841 passed / 8 failed — all 8 are `@visual` screenshot specs exceeding `maxDiffPixels` by marginal amounts (e.g. 5251 vs 5000, ratio 0.01): `visual` paper theme, `rtl-fixes` ×3 (LTR-paper, RTL-paper, AC3-RTL-Arabic), `rtl-perline` mixed per-line, `code-math` render, `callouts-outline` render, `chrome-geometry` toast-clear-24px. Baselines last committed `ac2cf77` (2026-09-21); 7 rendering-affecting commits since. Attribution by commit correspondence (see GATE-01 note below); baselines not regenerated — audit is read-only. |
| `npm run audit:secrets` | **pass** | gitleaks 8.30.1, full tree (~720 MB): 0 first-party findings (67 in `node_modules`, informational) |
| `npm run coverage` *(run by lead auditor after the critic flagged it was skipped)* | **FAIL** | Unit leg aborts: statements 93.28% < 95%, branches 88.23% < 90%, functions 92.8% < 95%. Worst: `src/main` 85.52% stmts / 79.33% branches — `document-store.js` 71.16%/63.59%, `annotations-store.js` 82.05%, `github-tls.js` 85.18%, `context-menu.js` 89.13% (funcs 66.66%). **GATE-01.** The 2026-09-24 pass's green tallies were test counts; the coverage gate itself was not re-run after `ae8c10d` added code. |

Working tree at audit time: `git status --porcelain` = `?? AGENTS.md` only (see HYG-03). `git rev-parse HEAD` = `ae8c10dea0e35a4b982707ef7c922dcc3b98d21b`.

**Visual-failure disposition (critic challenge, resolved by evidence):** `git log` shows no `src/renderer/styles/` commit after the baseline commit `ac2cf77` except the rendering commits themselves (989a662 radius tokens, 0dcb6d7 shelf, 01ca755 highlight UI, 5ac3c05 streak, daaecba copy button, ae8c10d fixes). Each failing spec maps to one of those features; every failure is a marginal overage just past a 0.4%-of-frame threshold. High-confidence disposition: stale baselines. Residual risk (a real regression hiding among them) is noted but not evidenced.

---

## 3. What was verified as solid (selected, all with dynamic or line-level evidence)

- **Renderer hardening held, again.** Re-run against the *vendored* pipeline: tab/newline/entity/control-char `javascript:`/`vbscript:`, protocol-relative, `/\`, `\\`, `data:text/html` on navigators — all stripped; `data:` stripped from non-media elements; wikilink target attribute injection still closed; footnote/marked state, `==mark==`/sub/sup renderers escape correctly; math placeholder forgery inert; mermaid `securityLevel:'strict'` + timeout + sanitizer drops `script`/`foreignObject`/handler attacks; meta-refresh/link/base/iframe/srcdoc/noscript/template and mXSS vectors stripped; EXPORT_CSP holds for HTML; PDF session filter blocks `file:`/remote on main frame + subresources + meta-refresh; zip-store byte layout verified against an independent .NET extractor (mimetype-first, CRCs, EOCD, UTF-8 flag, overflow throws); epub OPF/nav/container well-formed.
- **`bpmd://` and `app://` handlers:** `%2e%2e`, `../` variants, `..%5C`, drive-absolute, UNC, `%00`, dot-segment, case, short-names, trailing dot/space, host variants (`ui:80`, `ui%2fevil`) — all fail closed at realpath/MIME/5MB steps; symlinked and junction targets rejected; Chromium's dot-segment normalization still contained. `protocol-controller.js` (the one main file no finder owned by name) was read by the lead auditor: thin, correct wiring — per-vaultId root resolution, open-roots re-authorization, memoized root realpath, 404-on-everything. One fail-open-if-unwired nuance: `isAuthorizedPath` is skipped silently if not injected (`protocol-controller.js:28`) — internal DI contract, always wired in `index.js`; noted, not filed.
- **Capability model:** forged/ghost/UNC/non-.md records dropped at load; `sessionOnly` records verified never serialized (flush/reload probed); promote-on-re-grant works; persisted records confer nothing without a dialog/CLI gesture or reopen's disk re-validation.
- **TLS pinning:** hostname allow-list exact, no redirect following (`redirect:'error'` + raw `https.request`), empty-pins/no-cert/broken-chain all fail closed, chain walk cycle-safe; both `DEFAULT_CERT_PINS` verified **live** against api.github.com's presented chain (leaf valid to 2026-11-27).
- **Window surface:** navigation classifier exact-match (query/fragment/case/data:/javascript:/file: blocked or correctly external); deny-all `window.open` with `isExternallyOpenable` restriction; permissions deny-all-but-fullscreen; `will-attach-webview` prevented; context-menu nonce single-use, sender-bound, index-bounded, main-derived; close-failsafe confirm-during-armed-timer races safe in the single-flow case.
- **Encoding/atomic-write core:** four-encoding round-trips (UTF-8, UTF-8+BOM, UTF-16LE/BE incl. BOM-less parity, cp1256) byte-faithful with stale-`baseHash` conflicts firing correctly; atomic write's error-cleanup verified not to poison the target (Windows EPERM-on-readonly-rename path traced); `hashContent`'s weak fallback unreachable in production; `fs.watch` vault-delete error path verified non-crashing on win32; reading-stats date math DST-safe.
- **Four-encoding + grant probes** (live harnesses against real modules): reopen/grant authority flows, structured-clone semantics, two-session annotation rotation — every reported defect below was **reproduced before filing**, and the skeptics re-reproduced them independently.
- **Supply chain:** all 10 workflow action pins spot-checked against upstream (`git ls-remote`) — all resolve to claimed tags; vendor manifest re-hashed green; Inno toolchain pin (iscc 6.3.3 + SHA-256 + signer) genuinely asserted by Pester; `verify-electron-fuses`/`verify-package-contents` fail closed; `merge-coverage` freshness gate (kind+commit+6 h) real — and renderer coverage cannot mask unit regressions (unit leg aborts first, which is exactly how GATE-01 surfaced).
- **Prior fixes verified real:** RTL-H1/H2/H4 (digit/bdi isolation, widget `dirKey` identity) reproduced dynamically; UX-01's 0.5-dominance + URL-strip fix kills the old 50–60% dead band for scheme'd URLs; UX-02 container code exclusion; QA-01 autosave outcome surfacing; F1 identity addressing at all merge sites; QA-05, UX-10, UX-12, F4, F5 recovery peek-then-clear, S-M3 PDF filter, SEC-09 literal release URL, CMP-01/02/04/05/08/10/14, R-F9 vendor provenance.
- **Lead-auditor follow-ups on critic gaps:** installer-vs-`PRIVACY.md` — uninstaller deletes only fixed well-known dirs (`$APPDATA\bpmdrtlreader` etc., account-scoped), `/S` preserves data unless `/DELETEUSERDATA`/`--delete-app-data`; no cleanup target is derived from recents or grants — **claim holds**. Static DOM-id contract: 140 JS-referenced ids extracted; the 35 not present in `index.html` are all runtime-generated modal internals (self-built dialog HTML), no static drift found.

---

## 4. Findings — P2

### GATE-01 · Unit coverage gate fails at HEAD (`npm run coverage` red) — P2
**Loc:** `scripts/run-unit-coverage.js:80` (gate) vs `config/coverage-thresholds.json` (floors). **Found by:** lead auditor, completeness-critic gap (the workflow's gates list ran `test:unit` but not the coverage chain; the critic flagged "a silent coverage slide at HEAD is undetected" — it was).
**Evidence:** `npm run coverage` → `Unit coverage gate failed: statements 93.28% < 95%; branches 88.23% < 90%; functions 92.8% < 95%`. `src/main` overall: 85.52% statements / 79.33% branches / 89.1% functions. Worst files: `document-store.js` 71.16%/63.59% (uncovered: ~93-399, 431, 437 — the encoding cascade and watcher edges), `annotations-store.js` 82.05%, `github-tls.js` 85.18% (funcs 78.57%), `context-menu.js` (funcs 66.66%).
**Scenario:** AGENTS.md documents the 95/90/95/95 coverage gate as a project invariant, and the 2026-09-24 pass's green tallies (108/1993 unit etc.) were test *counts*. The `ae8c10d` fix pass added code without restoring coverage; any release built from HEAD violates the project's own gate undetected, and the renderer-coverage and merge legs never even run (the chain aborts at the unit leg).
**Fix:** restore coverage of the main-process additions from the 09-24 pass (the uncovered `document-store.js` ranges are concrete targets), or consciously re-tier the thresholds; add `npm run coverage` to the pre-release runbook checklist so it cannot silently rot again.

### DATA-01 · Vault-note highlights and margin notes are orphaned after every app restart — P2

**Status (2026-09-27): CLOSED.** The shipped fix keys vault annotations on the restart-stable
`vault:<vaultId> <path>` form of `fileKey()` (persistent vault grant + relative path); verified
against the real modules by a two-session regression test (`main-annotations-ipc.test.js` —
open → highlight → fresh bootstrap → rotated document id → highlight re-found). The residual
orphan-hygiene half is also closed: `pruneOrphanDocKeys` now drops `vault:` keys whose vault
grant no longer exists (`annotations-store.js`), so pruned-folder keys stop accumulating toward
the 2 MiB cap.
**Loc:** `src/main/capabilities.js:69` (persist filter) + `src/main/ipc-controller.js:474-477` (`persistGrant:false` per vault file) + `src/renderer/session.js:55` (`fileKey` prefers `doc:<documentId>`). **Found by:** fs-stores finder; **reproduced by the skeptic across two simulated sessions against the real modules.**
**Evidence:** `documents: [...documents.values()].filter((record) => !record.sessionOnly)` — vault reads mint fresh `sessionOnly` records each session; annotations are keyed by the rotating `cap-<uuid>`. Skeptic's harness: session-2 docId ≠ session-1, `annotationsGet` under the new key → 0 highlights, old key persists in `annotations.json` forever.
**Scenario:** User highlights text in a vault note, quits, relaunches: highlights are gone from every vault note, every session leaves dead `doc:cap-*` keys behind, and the orphans count toward the store-wide 2 MiB cap — eventually every `annotations:put` fails `too-large` until `annotations.json` is hand-deleted. Asymmetry: dialog-opened loose files (`persistGrant:true`) keep stable ids, so only the **primary vault workflow** breaks. `USER_GUIDE.md:286-288` promises highlights are saved and re-found. The e2e suite cannot catch it (`reading-mode.spec.js:169` stubs the annotations bridge; nothing restarts between write and read). This is the restart-shaped remainder of gate item F3/S-M5.
**Fix:** key annotations by a restart-stable identity main already holds (`vaultId + record.path`, or the record path) with a one-time migration of existing `doc:cap-*` keys; or persist vault document grants (path+vaultId only) so id dedupe survives restarts.

---

## 5. Findings — P3

### Close-flow / data safety

**DATA-03 · Superseded/double close requests clobber `window._saveDialogOpen` behind a live Save dialog and kill the close failsafe** — `src/renderer/app.js:845` (settle), `:750-753` (supersede abandon loop), `:809` (flag set), `:5280` (autosave gate), `src/main/window-controller.js:287-308` (re-send on every close event). Two finders independently traced the two trigger chains; both skeptics confirmed.
- *Chain A (supersede):* `askSaveChanges` sets `_saveDialogOpen=true` (809), then `openModal` synchronously settles the outgoing dialog, whose settle writes `false` (845) — nothing re-sets it. Escape-dismissed dialogs leave stale settlers in `pendingModalSettlers` (the observer path never deletes them), so any later supersede re-fires the clobber.
- *Chain B (double Alt+F4):* main re-sends `app:request-close` on every close event; `winClose` has no reentry guard, so attempt #2 supersedes dialog #1 exactly as above; additionally winClose #1's abandoned-'cancel' path calls `abortWindowClose()`, deleting the failsafe armed for attempt #2 — a wedged renderer during dialog #2 gets no 20 s force-close (one further Alt+F4 re-arms it: recovery is one extra gesture + 20 s, not an app kill — skeptic's correction).
- *Consequence:* autosave (defaults on, 5 s tick, 15 s idle gate) writes dirty disk-backed files while the visible Save/Don't-Save dialog awaits; a subsequent "Don't Save" persists exactly what the user declined — the invariant the flag's own comment states. No test pins `_saveDialogOpen`.
**Fix:** refcount or token-scope the flag (settle clears only its own token); delete settlers in the observer/Escape path; guard `winClose` against reentry.

**DATA-04 · `restoreSettings().then(...)` has no rejection handler — autosave, recovery loops, recovery offer, and CM6 init silently skipped for the whole session** — `src/renderer/app.js:5423-5459`; `settings-controller.js:136-203` rethrows; `workspace-controller.js:1035-1036` runs the render tail unwrapped. One render-pipeline exception during lastSession restore (a class of bug this codebase has shipped before) and the user types for hours with **no autosave and no crash snapshots**, zero warnings — the QA-01 failure toast never applies because the loop itself is absent. **Fix:** `.then(onFulfilled, onFallback)` so the data-safety loops start regardless; toast on restore failure.

**DATA-02 · Closing a vault silently kills save authority for tabs whose standalone records were merged into it; `fs:reopenDocument` returns `ok:true` but the grant it creates is ignored (S-M1 residue)** — `src/main/ipc-controller.js:176-180` (`sessionDocumentGrants` consulted only in the no-`vaultId` branch), `src/main/capabilities.js:139` (in-memory `vaultId` merge not gated on `persistGrant`). Live probe by finder **and** skeptic against the real modules: `closeVault → ok`, then `write → unauthorized-capability`, `reopenDocument → ok:true`, `read/write → unauthorized-capability` — the exact S-M1 symptom, via a new trigger (the `persistGrant:false` merge). Autosave toasts once (`_autosaveFailNotified`) then fails silently forever, including at close-time Save. **Fix:** `documentGrantActive = vaultGrantActive(vaultId) || sessionDocumentGrants.has(id)` (the S-M1 recommendation, never implemented) and/or stop mutating `existing.vaultId` under `persistGrant:false`.

**DATA-05 · F8 unfixed: Save-All failures during the close flow abort the close with zero feedback** — `src/renderer/components/workspace-controller.js:722` (`if (outcome !== 'ok') return false;` — no toast, no `renderFile`, so `performWriteThrough`'s freshly populated conflict/diskContent banner is never rendered). Contrast: single-file `saveCurrent` (561-578) toasts and renders for the same outcomes. User picks "Save All", one file conflicts → window silently stays open, no banner; user believes everything saved. Gate item F8 ("show the banner/toast for every failure branch") is unimplemented while the gate header claims closure. **Fix:** toast + renderFile per non-ok outcome in `saveAllDirty`.

### Security hardening

**SEC-01 · `fs:reopenDocument` re-pins a granted path through a post-grant symlink to any target; `readDocumentCapability` reads through it with no escape or extension check (S-H2 residue, claimed closed)** — `src/main/ipc-controller.js:549-565` (realpath → `relocateDocument` → `flush()` → grant, no containment check), `:234-237` (no `isSymlinkEscape`, no `.md` re-check — only the vault walk and `dialog:openFile` lanes check), plus the `fs:writeFile` hash fallback (`:599-601` → `currentDiskHash` `:217-220`) reading arbitrary-size files with no `isOversizedFile` guard. A same-user writer (the threat `isSymlinkEscape` exists for) swaps a recent file for a symlink to any ≤10 MB file → next launch's recent-click re-pins, **persists**, grants, and reads the target into the renderer; a `.md`-suffixed target becomes writable for standalone docs; a 4 GB target freeze-OOMs the first save attempt. `bootstrapSessionGrants` (:1008) implements exactly the "moved → require explicit picker grant" rule for vaults — these single-document lanes were left out. **Fix:** lstat + `isSymlinkEscape` against the grant root + `.md` re-test + size guard in `readDocumentCapability`; refuse re-pins that leave the original root; cap `currentDiskHash`.

**SEC-02 · `text:decode` / `export:epub` size caps bound the view length, but Electron IPC clones the whole backing ArrayBuffer — multi-GB main-process allocations from a 1-byte payload** — `src/main/ipc-controller.js:361-362`, `:766-767`. Verified locally: `structuredClone(new Uint8Array(new ArrayBuffer(1048576), 10, 4)).buffer.byteLength === 1048576`. A compromised renderer (the modeled adversary these caps exist for) sends 1-byte views of multi-GB buffers; two or three concurrent calls OOM main — and the allocation happens before the handler's checks can run. **Fix:** renderer-side right-sizing (subarray on exact-size buffers) or a chunked channel; at minimum document the residual and add an in-flight-bytes guard.

**SEC-03 · EPUB export ships author-controlled remote references the HTML/PDF exports block — silent fetch/tracking channel in shared artifacts** — `src/renderer/markdown/export.js:31-58` (`neutralizePassiveResources` handles `img`/`video`/`audio`/`source`/`a` only) + `trusted.js:65-69` (`sanitizeSvg` runs without the app's `ALLOWED_URI_REGEXP`). Reproduced end-to-end: `<svg><image href="https://evil.example/pixel.png"/></svg>` survives into `OEBPS/chapter-1.xhtml`; `<style>fill:url(https://…)</style>` survives via the mermaid path. In-app CSP hides it (broken glyph, nothing suspicious); a reader that resolves remote resources leaks the reader's network location to the note author. `epub.test.js:265` pins that EPUB "carries the image policy of export.js" — the SVG escape violates it. **Fix:** drop/rewrite SVG `image` hrefs and `url(http…)` in `style` during EPUB packaging, or apply `ALLOWED_URI_REGEXP` in `sanitizeSvg`.

### RTL / bidi (all gate-filed, all claimed closed, all still open)

**RTL-01 (RTL-M1)** · `applyTableDirection` counts code letters — Arabic table with a code cell is not mirrored — `src/renderer/bidi-dom.js:80` uses raw `t.textContent` while the sibling pass uses `blockText()` (the UX-02 fix, one line above). Dynamic repro: code-heavy cell flips the table `dir="ltr"` while its own `th`s get `dir="rtl"`; `wireTableNav` reads the table dir, so RTL arrow-key traversal is wrong too. Gate prescribed exactly `blockText(t)`.

**RTL-02 (RTL-M2)** · AUTO mode pins `State.direction='ltr'` for Arabic-majority documents — `src/renderer/app.js:276-280` discards the correctly computed `docDir`; the dir indicator shows LTR for a fully-Arabic note and CM6 widgets (`renderCmBlock` baseDir, `:3923/3949/3990`) disagree with the reading pane on neutral-only blocks. The comment at `:470` claims the opposite of the code.

**RTL-03 (RTL-M6)** · Per-line editor direction counts inline-code letters — `src/renderer/editor/line-direction.js:35` feeds raw `line.text` to `resolveBlockDirection`; ``استخدم `Array.prototype.flatMap.call(arguments)` هنا`` gets a `dir="ltr"` CM6 line decoration while the reading pane renders the same paragraph RTL — the exact parity the module header promises, broken.

**RTL-04 (RTL-M3)** · Edit/source-mode find does no Arabic normalization while Reading mode does — `src/renderer/editor/codemirror-adapter.js:176-187` (raw `escapeReg` regex) vs `app.js:1350-1368` (`normalizeArabic` path). Searching `محمد` finds `مُحَمَّد` in Reading and misses it in Edit on the same note.

**RTL-05 (RTL-M7)** · URL stripping only matches scheme'd URLs — `src/renderer/bidi.js:56` (`URL_TOKEN` requires `://`). Dynamic repro: `راجع docs.example.com/en-us/azure/... للمزيد` flips to LTR from a bare domain mention; short sentences with an email address flip too. **Fix:** strip bare domains/emails before counting.

### UX / export correctness

**UX-01 · Exported HTML/PDF/EPUB embed KaTeX output with no KaTeX CSS or fonts — math renders duplicated and mis-laid-out in every export artifact** — `src/renderer/markdown/export.js:128-186` (template has no `.katex` rules; `EXPORT_CSP` then forbids any external stylesheet) and `epub.js:40-53` (`PAPER_CSS` likewise). Reproduced with the vendored pipeline: export body carries `katex-mathml` + `katex-html` (the MathML copy is hidden only by CSS that never ships), so readers see each formula twice — once right, once collapsed onto the baseline. PDF bakes it in via `printToPDF`. `export.test.js` tests with a fake single-span katex, so the dual output is unpinned. **Fix:** inline an export math stylesheet (hide `.katex-mathml`, lay out `.katex-html`, `@font-face data:` URIs — CSP already permits `font-src data:`) or export MathML only.

**UX-02 · `serializeXhtml` lowercases SVG camelCase tag names — mermaid gradients/clips/filters become unknown elements in EPUB chapters** — `src/renderer/markdown/epub.js:74`. HTML parsing yields `linearGradient`/`clipPath`/`feDropShadow` (the vendored mermaid emits all of them); the chapter writer emits `<lineargradient>` etc. — XML case-sensitive, so `fill="url(#g1)"` resolves to nothing and EPUBCheck schema-validates with errors, contradicting `epub.js`'s own docstring. HTML/PDF unaffected (HTML serialization re-adjusts names). Also: the SVG subtree never gets its `xmlns` back. **Fix:** preserve case (or `XMLSerializer`) for SVG-namespace subtrees.

**UX-03 · Outline (TOC) positions go stale after edits above a heading; `scrollToHeading` trusts the cached pos** — `src/renderer/app.js:3860-3864` (rebuild gated on heading-text change only), `:2739-2754` (`pos` baked into entries), `:3198-3204` (re-resolves only when `pos == null`). Type a paragraph above "الخاتمة", click it in the outline → lands mid-paragraph, on a core everyday path. **Fix:** re-resolve on click by heading text, or rebuild TOC whenever the source changed.

**UX-04 · Edit-menu Copy/Cut/Paste in Reading mode act on the hidden CM6 editor** — `src/renderer/editor/edit-commands.js:76-111` (`cmEdit` has no viewMode guard; only `selectAll` got the Reading treatment). Edit > Copy steals focus to the hidden editor and copies its stale selection; **Paste/Cut invisibly mutate the document** (goes dirty, autosaves) while the user is reading a read-only pane. The module's own test pins "reading mode never focuses the hidden CM6 surface" — for `selectAll` only. **Fix:** branch on `deps.getViewMode() === 'reading'`: Copy → `copyFromSelection`; Cut/Paste → preview-readonly toast.

### Performance / availability

**PERF-01 · `deliverPendingFiles` grants and reads every queued CLI file synchronously with a full-registry atomic write per grant — O(N²) freeze on multi-file Open With / second-instance** — `src/main/index.js:162-178` (sync loop; `grantDocument` defaults `persistGrant:true`), `capabilities.js:148` (`persist()` per new path = temp+fsync+rename of the whole registry), `ipc-controller.js:227-231` (registry copy + Set rebuild per file). Caps bound the count (5000) but not the per-grant cost; hundreds of files = hundreds of fsync-rename cycles plus a tab flood while the window is shown. **Fix:** `persistGrant:false` + promote what the user keeps open (or batch-flush once); chunk delivery.

### Tests / CI / compliance

**QA-01 · Real-Electron coverage is 6 specs / 23 tests; save, conflict, recovery, watcher, autosave, and capability IPC flows are never exercised against real Electron** — `playwright.electron.config.js:5`; grep of the electron lane for save/`fs:writeFile`/autosave/conflict/recovery/capability: 0 hits. 70 chromium-file:// specs never start a main process (17 hand-stub `window.electronAPI`); the unit lane's `tests/__mocks__/electron.cjs` (99 lines) lacks Menu/clipboard/screen/session/protocol. An IPC argument reshape between preload and main is invisible to every lane — the scenario the 1.3.1 "data safety" hardening most needs pinned. **Fix:** one electron-lane spec per data-safety flow (save+conflict, cp1256/UTF-16 round-trip, autosave failure, recovery peek/clear, capability expiry).

**GATE-02 · `release-preflight` staleness gate checks only `sbom.json` — the OSV vulnerability scan can predate the lockfile and still pass** — `scripts/release-preflight.js:72-79,129`: only `sbomPath` is wired; the comment and BUILD.md:241-242 promise "SBOM + OSV newer than the lockfile". Refreshing only the cheap syft step (an inventory tool, no scanning) passes preflight with a stale vulnerability report — exactly the CMP-05 failure mode the gate was added to stop. **Fix:** add `osvPath` with the same mtime comparison (consider grype/semgrep SARIF too).
**Status (2026-09-27): CLOSED.** `osvPath` (`.secreports/osv-scanner.txt`) is wired with the
same mtime rule; each stale artifact is reported individually and `--skip-sbom-staleness`
still covers both deliberately. Pinned by four new cases in `release-preflight.test.js`.

**CMP-01 · CI trust surface is misleading: Actions disabled while README badge says "CI gated"; no enforced secret scanning exists** — `README.md:16` vs `docs/BUILD.md:213-214, 231-233` (Actions disabled, hand-built releases); all of ci.yml's hardening (SHA pins, egress block, gitleaks, npm audit, dependency-review) is dormant; `scripts/audit-secrets-fulltree.js:5` says "CI does not run this" and it is absent from the BUILD.md release runbook (BUILD.md:237-253). The last secret-scan artifacts anywhere are from 2026-08-22 (local, gitignored). *Downgraded from P2 by the skeptic:* BUILD.md discloses the situation twice and the badge item is already a tracked Low in PRE-RELEASE-REVIEW:131 — the residual defect is one contradictory badge + a runbook omission, not an active control being bypassed. **Fix:** correct the badge; add `npm run audit:secrets` + pinned gitleaks to the runbook and `release-preflight`.

**CMP-02 · The documented release runbook cannot produce 8 of the 12 contract artifacts — no macOS/Linux build path exists in docs** — `docs/BUILD.md:248` sequence is `npm run dist` (= `electron-builder --win`) + Inno only; `--mac`/`--linux` appear nowhere in docs (only in the dormant ci.yml matrix), while `release-artifacts.js`/preflight hard-fail on missing macOS dmg/zip + Linux AppImage/deb entries. R-F11 records that 1.3.0 already shipped without them. **Fix:** document the macOS/Linux build steps (with signing/notarization prerequisites) in the release sequence.

---

## 6. Findings — P4

| ID | Finding | Loc | Essence (all CONFIRMED by the dimension skeptic) |
|---|---|---|---|
| VER-01 | `compareVersions` collapses ≥309-digit numeric components to `Infinity` — two distinct huge tags compare equal (update notice suppressed) | `src/main/version.js:18` | `Number()` overflow in strict-SemVer parse; `1.<9×400>.0` vs `1.<8×400>.0` → `0`. Cap component length or BigInt-compare. |
| PROT-01 | `bpmd://` folds `?query`/`#frag` into the file path — vault images with cache-busters always 404 (containment unaffected) | `src/main/protocol.js:13,17` | Split query/fragment off `m[2]` before `decodeURIComponent`. |
| SEC-04 | `export:pdf` accepts an unbounded `payload.html` — the only content channel with no size cap (siblings cap at 10 MB/64 MB; 30 s timeouts + user-confirmed dialog bound it) | `src/main/ipc-controller.js:695` | Add the same `Buffer.byteLength` cap the other channels have. |
| VAL-01 | `settings:set` can persist unbounded `lastSession.vaults[].openPaths` arrays — every other array key is capped | `src/main/settings.js:175` | Cap vaults × openPaths × string length like `recents`/`readingProgress`. |
| POL-01 | Mapped network drives (drive-letter SMB) bypass the UNC-only `isNetworkPath` guard on every grant lane; watcher silently degrades to no-op, contradicting PRIVACY.md:147 | `src/main/main-logic.js:90-92` | Detect via realpath/drive type and reject or document the degradation. |
| HYG-01 | Crash during PDF export orphans note-content temp HTML in `%TEMP%` forever — no sweeper (vault/JSON temps both have one) | `src/main/ipc-controller.js:753-757` | Sweep `bpmd-export-*.html` older than 1 h on export or app ready. |
| HYG-02 | `sweepStaleTempFiles` scans only the vault ROOT — crash-orphaned temps in subdirectories (where notes live, 12-deep walk) are never swept, defeating the sweep's stated purpose | `src/main/document-store.js:241-243` | Sweep the walked tree; also sweep standalone save targets' dirs. |
| VAL-02 | `migrate()` keeps unbounded strings and absurd window dimensions (`w:1e9, h:-1e9` passes through to BrowserWindow; minWidth/minHeight clamps at creation); write amplification on every settings save | `src/main/settings.js:97-108,153-162` | Cap strings (≤1024) and clamp w/h to sane integers in `migrate`. |
| MD-01 | Dangling footnote reference renders an empty numbered footnote + backlink to nothing (GFM/Obsidian render literal text) | `src/renderer/markdown/footnotes.js:87` | Emit items only for ids present in `defs`. |
| UI-01 | Shortcuts sheet splits `Ctrl+K Ctrl+W` into keycaps `[Ctrl] [K Ctrl] [W]` — middle keycap holds two tokens | `src/renderer/app.js:969` | Split on whitespace first, then `+`. |
| REC-01 | `offerRecovery` dedupe loop re-derives the name from the raw snapshot (drops the appended `.md`); loop shape is a latent boot-hang if a bare name ever collides (`.txt` drops make it reachable-in-principle) | `src/renderer/app.js:5387-5393` | Derive from the extension-bearing base inside the loop + iteration cap. |
| UI-02 | File-picker lane lacks the 10 MB pre-check drag-drop has — oversized picks are fully buffered and IPC-cloned before main rejects, then reported as a generic read failure | `src/renderer/app.js:3676-3687` vs `:5200-5203` | Mirror the drop lane's `file.size` check + `skippedSize` toast. |
| DEAD-01 | Persisted `cmEditor` setting is dead (CM6 mounts unconditionally) while still restored/persisted and three comments describe a conditional, default-off mount; `toggleCmEditor` + 4 locale keys are dead code | `src/renderer/app.js:3969-3979,4023-4047`; `settings-controller.js:7,77,179` | Drop the key + dead exports + stale comments, or honor the setting. |
| RTL-06 (RTL-M5) | A query that normalizes to empty (pure tashkeel, length ≥2) matches every file — `indexOf('')` floods vault search with 100 garbage rows | `src/renderer/components/search.js:41` | `if (arabicQuery && !normQuery) return [];` (the gate's prescribed fix). |
| RTL-07 (RTL-M4) | `navWikilink` never matches `[[note.md]]` targets and ignores Arabic normalization — "note not found" for an open note | `src/renderer/app.js:3740-3743` | Strip trailing `.md` from the target; compare `normalizeArabic()` both sides. |
| ED-01 | List continuation inside a blockquote drops the inner marker — Enter after `> - item` yields `> ` only (also loses task boxes) | `src/renderer/editor/list-continuation.js:28-34` | Re-run the task/bullet/ordered match on the quote remainder and compose. |
| GATE-03 | `regen-security-baseline` accepts a same-file same-rule finding swap as "positions only" — a genuinely new finding can enter the reviewed baseline without `--accept` | `scripts/regen-security-baseline.cjs:45-55` | The file\|rule histogram can't catch within-file swaps the docstring claims to refuse; diff positions within buckets and require `--accept` on non-shifts. |
| QA-02 | E2E synchronizes with 577 fixed `waitForTimeout` sleeps under `retries:0`/`workers:1` (worst: bug-fixes-7bugs 89, adversarial-9bugs 54, rtl-adversarial 52); 17 specs hand-stub the bridge | `playwright.config.js:90-91` | Skeptic's corrections: the suite is not sleep-only (101 `toHaveCount`, 145 `waitForSelector`, 46 `waitForFunction`, 42 `expect.poll`) and `performance.spec.js` does assert wall-clock budgets — the residual is the fixed sleeps as a flakiness/slowness-blindness source. Replace sleep-then-read with condition waits. |
| HYG-03 | `AGENTS.md` is untracked — the project's own build/test/commit policy exists only on this workstation; every clone (and every agent session) misses it | repo root | Commit it, or record the local-only intent in `.gitignore`/CONTRIBUTING like LICENSE-AUDIT.md. |

---

## 7. Comparison with prior audits

- **2026-09-20 (66 findings):** the fixes this pass re-verified as genuinely implemented are listed in §3. Newly-discovered regressions **of 09-20-fixed items:** none found — but see the still-open carry-overs below.
- **2026-09-24 passes (PRE-RELEASE-REVIEW appendices + `ae8c10d`):** RTL-H1/H2/H4, close-failsafe single-flow, recovery peek-then-clear, dialog-gated shortcuts, argv caps, recents dedupe — all verified real. **But the header's "all gate items closed" banner is false for at least:** RTL-M1, RTL-M2, RTL-M3, RTL-M4, RTL-M5, RTL-M6, RTL-M7, F8, S-H2 (containment re-check), S-M1 (grant merge) — ten items, each reproduced in code (several dynamically) by this audit. The appendices closed RTL-H1–H4 and the seven P3s only.
- **New since 09-24:** the coverage-gate slide (GATE-01) and the visual-baseline staleness are direct consequences of the 09-24 fix pass adding code and changing rendering without re-running the full gate chain.

## 8. Coverage matrix

| Dimension | Files owned | Method |
|---|---|---|
| main-security | window-controller, protocol(.js/-controller), navigation, capabilities, github-tls, version, preload, index.html CSP/boot, trusted-types-policy/boot | full read + hostile-input harness (temp dir) + 11/11 focused protocol tests + live pin check; `protocol-controller.js` re-read by lead auditor |
| ipc-bootstrap | ipc-controller.js (all 1057 lines), main/index.js, context-menu.js + seams | full read + two live probes (reopen/grant harness, structured-clone check) |
| fs-stores | document-store, main-logic, settings, json-store, annotations-store, reading-stats-store | full read + 4 harnesses (capability-id stability, 4-encoding round-trip, hostile migrate, Windows fs rename behaviors) |
| md-pipeline | all 12 `markdown/` modules + export glue | full read + jsdom harness against vendored runtimes; real `.epub` built + independent-extractor validation |
| app-core-1 | app.js 1–2750 + locale/i18n/dates/theme/state/session/limits/file-predicates | full read (whole file for context) + seam reads |
| app-core-2 | app.js 2750–5485 + window-controller close path, preload, annotations consumers | full read (whole file for context) + seam reads |
| editor-bidi | bidi.js, bidi-dom.js, all 10 editor/ modules, all 10 components/ modules, reading-progress | full read + dynamic bidi battery (jsdom) |
| tests-ci | package.json, 4 workflows, 24 scripts, 5 configs, installer lanes, vendor manifest, docs | full read + live gate executions + `git ls-remote` pin checks |
| gates runner | 9 gates executed at HEAD | + coverage chain run by lead auditor after critic flag |

**Coverage limits (critic output, triaged):** the CSS/visual layer itself (`styles/*.css`, 2,766 lines) got no dedicated aesthetic/functional selector pass (mitigated: no styles commit after baselines except the attributed rendering commits); the CM6 widget path (block/live/math/wikilink/inline-marks previews, table-edit/frame) was owned by editor-bidi as a group with findings but without the md-pipeline hostile-string battery replayed against widget DOM — flagged for the next pass; `USER_GUIDE.md` feature claims (kashida, Hijri, streaks) were not claims-checked against code; `PRIVACY.md` uninstaller claims **were** checked (pass, §3).

## Appendix A — The hostile workflow

18 agents: finders `main-security`, `ipc-bootstrap`, `fs-stores`, `md-pipeline`, `app-core-1`, `app-core-2`, `editor-bidi`, `tests-ci` (effort high) + gates runner; one adversarial skeptic per dimension (effort high) re-reading every cited line with a refute-first brief; a completeness critic. Raw output: 46 findings → 42 CONFIRMED (1 downgraded P2→P3), 3 REFUTED, 0 P1. 725 tool calls, ~1.7 M subagent tokens, ~51 min wall-clock. The lead auditor then ran the two follow-up checks above and merged/verified this report.

## Appendix B — Refuted findings (retained for retraction discipline)

1. **"Chrome auto-hide thresholds never recomputed after zoom"** (app-core-1, P4) — REFUTED: the premise fails for the shipped app. `setAppZoom` always exists in Electron (preload returns a finite factor), so `setZoom` always takes the native `webFrame.setZoomFactor` branch; under Chromium page zoom, CSS-px geometry (titlebar height, `clientY`, cached thresholds) is invariant — the rem-based fallback that *would* change client-space layout is unreachable in the packaged app.
2. **"release-preflight SBOM/OSV artifacts are stale on the committed tree"** (tests-ci, P4) — REFUTED: `.secreports/` is deliberately gitignored (zero tracked files; policy documented in AUDIT-REPORT-2026-09-20 §400); preflight explicitly scopes absent artifacts out, and the runbook refreshes both scans immediately before preflight. The stale local mtimes are workstation state; the true residual (sbom-only check) is GATE-02.
3. **"LICENSE-AUDIT.md tables predate the current lockfile"** (tests-ci, P4) — REFUTED: LICENSE-AUDIT.md is deliberately gitignored local scratch (self-labeled stale in its own header); the *shipped* compliance artifacts (THIRD-PARTY-NOTICES.md, `docs/dependency-license-inventory.json`) carry the lockfile-hash stamp and gate the finding asked for.
