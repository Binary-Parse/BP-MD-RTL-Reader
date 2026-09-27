# Comprehensive App Audit — BP MD RTL Reader v1.2.2

**Date:** 2026-09-20 · **Target:** `main @ 6a2d743` (v1.2.2, working tree clean) · **Scope:** Security, Code Quality, Performance, UX/UI (incl. RTL correctness & accessibility), Compliance/Licensing/Repo hygiene
**Method:** Five parallel deep-dive reviews over the full source (all of `src/main`, `src/preload`; renderer incl. the 4,295-line `app.js`); dynamic testing of pure modules and the vendored marked/DOMPurify/KaTeX/highlight.js pipeline from scratch harnesses (temp dir, repo untouched); measured micro-benchmarks with the repo's real modules; execution of the app's own verification suites; a one-off ESLint correctness pass; and verification of every finding from the prior audit (`docs/AUDIT-REPORT-2026-09-03.md`, v1.1.0).
**Retraction discipline:** every lead was confirmed or explicitly retracted against source; corrections are listed in Appendix C. No repository file was modified by this audit.

---

## 1. Executive summary

The application is in **unusually good shape for its size**. The security architecture — sandbox + contextIsolation + no nodeIntegration, CSP with Trusted Types, DOMPurify hardening on every render sink, capability-brokered filesystem access, a TLS-pinned opt-in update check, Electron fuses that are actually verified post-build — held against every bypass the audit constructed, including dynamic tests of the vendored pipeline. Test infrastructure (93 unit suites, 70 e2e specs, mutation tiers, a11y lane, pinned SAST baseline) is far above par for a vanilla-JS Electron app. All four P0s from the 2026-09-03 audit are genuinely fixed, with **no regressions** found.

The audit nevertheless found **66 findings: 0 Critical, 12 High, 20 Medium, 22 Low, 12 Info**. They cluster into five themes:

1. **The repo's own release gates are red on the committed tree** (§3). Three unit tests fail, the security-lint baseline mismatches, and `vendor:check`/`license:inventory` report drift. Either CI is not enforcing these gates or the 1.2.2 release shipped over them.
2. **Silent failure in the exact features that exist to protect data** (§5): the autosave loop discards every write outcome; the main-process dirty ledger is write-only while three comments claim otherwise; `recovery:pop` destroys a corrupt snapshot before parsing it.
3. **The flagship bidi algorithm mis-fires on ordinary bilingual content** (§7): the 60% dominance override both fails to fire in the 50–60% band and falsely fires when URLs/code identifiers dominate the letter count; code fences flip their Arabic container blocks to LTR; and no search surface applies Arabic text normalization.
4. **The render pipeline re-runs from zero at document scale** (§6): every 150ms typing pause re-runs marked→DOMPurify→innerHTML→highlight→KaTeX→bidi→TOC over the whole document (measured: ~0.35s at 50KB, ~3s at 250KB, ~13s at 1MB); unlabeled code fences trigger `highlightAuto` across 192 languages at 15–170ms per block.
5. **Compliance artifacts lag the shipped code** (§8): stale version tables, a stale license inventory (gate failing), an SBOM that predates the current lockfile, and the 20 KaTeX fonts mislabeled MIT where upstream declares OFL-1.1.

**Severity rubric:** Critical = exploitable by untrusted input to code exec / large-scale data loss, or a shipped license violation. High = security bypass under realistic conditions, data-loss-adjacent defect on a common path, core-feature broken for the target audience, or perf cost that materially degrades normal use. Medium = hardening gaps, user-visible defects on uncommon paths, maintainability hazards on hot paths, compliance drift. Low = minor bugs, doc drift, hygiene. Info = observations and verified-positive results.

| Domain | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|
| Release gates | 0 | 1 | 0 | 0 | 0 |
| Security | 0 | 1 | 1 | 5 | 3 |
| Code quality | 0 | 3 | 3 | 4 | 3 |
| Performance | 0 | 3 | 4 | 2 | 2 |
| UX/UI | 0 | 4 | 4 | 4 | 0 |
| Compliance | 0 | 0 | 5 | 4 | 4 |

### Top 10 findings

| # | ID | Finding | Sev |
|---|---|---|---|
| 1 | AUD-01 | Release gates fail on the committed tree (3 unit tests, lint baseline, vendor check, license inventory) | High |
| 2 | SEC-01 | Capability grants persist forever with no revocation — a renderer compromise reaches every folder ever opened | High |
| 3 | UX-01 | Bidi dominance rule mis-fires in both directions around the 60% threshold (letter-counts URLs/code as "English prose") | High |
| 4 | UX-02 | Code fences flip their Arabic container blocks (callouts/lists/quotes) to LTR | High |
| 5 | UX-03 | No Arabic text normalization (tashkeel/hamza/ta-marbuta) in any search surface | High |
| 6 | QA-01 | Autosave discards write outcomes — persistent save failures never surface to the user | High |
| 7 | PERF-01 | Full render pipeline re-runs per 150ms tick; cost linear-to-superlinear in document size (measured) | High |
| 8 | PERF-02 | Unlabeled code fences trigger `highlightAuto` over 192 languages: 15–170ms per block, every render | High |
| 9 | UX-04 | Multi-folder session restore silently drops every folder but the last-opened one | High |
| 10 | QA-03 | Triplicated render pipeline with six real divergences (three are live bugs) | High |

---

## 2. What was verified as solid (selected)

- **Renderer hardening held under attack.** Dynamic tests against the *vendored* DOMPurify 3.4.13: `java&#9;script:`, `jav&#x0A;ascript:`, `&colon;`, `vbscript:`, protocol-relative, `data:text/html` — all stripped (`trusted.js:10` regexp is applied after DOMPurify's own whitespace normalization, closing the classic bypass). Mermaid runs `securityLevel:'strict'` + `htmlLabels:false` + an SVG sanitizer that forbids `foreignObject`. KaTeX is `trust:false, maxExpand:1000, maxSize:500` with `annotation-xml` forbidden. highlight.js output is sanitized and size-capped.
- **`bpmd://` path handling.** Encoded traversal (`%2e%2e`), backslashes, UNC, drive letters, `....` tricks — all rejected; `vaultId` is split before decoding; double realpath containment; image-extension allowlist + 5MB cap; only currently-open vaults are served. Windows `path.relative` case handling verified.
- **Window/permission surface.** Deny-all permissions (except fullscreen), no webview attach, deny-all `window.open` with `shell.openExternal` restricted to `https?|mailto|tel`, `will-navigate` exact-match that rejects query/fragment/case variants, context-menu nonce scheme single-use and sender-bound with no replay path found.
- **Prior audit remediation.** All 4 P0s fixed (physical-key shortcuts, re-open conflict path, 3-way save prompt, 20s close failsafe); ~47 findings total: **26 FIXED / 14 PARTIAL / 6 NOT FIXED / 1 N/A**; **no regressions**. Details in §9.
- **Test/quality culture.** Zero TODO/FIXME/console.log in `src/`; DI seams on all main-side controllers; atomic writes (tmp+fsync+rename); encoding-faithful saves (UTF-8/UTF-16LE/BE/CP-1256); comment quality with dated rationale; jscpd duplication only 0.57%; gitleaks clean over tree, history, and dangling objects.
- **Perf hygiene done right:** correct 150ms debounces with stale-guard and generation guard, truly lazy Mermaid (3.57MB) and CM6, WeakMap search cache with early exit, no listener accumulation found (PERF-11), watcher events coalesced.

---

## 3. Release-gate status (commands executed 2026-09-20)

| Gate | Result | Detail |
|---|---|---|
| `npm run test:unit` | **FAIL** | 1,620 passed / **3 failed** (see AUD-01) |
| `npm run lint:security` | **FAIL** | "baseline mismatch: fingerprint `216c1216…` does not match reviewed `1faaec2b…`" (206 problems: 20 errors, 186 warnings — the errors include `mermaid.js:31` `no-unsanitized/property`, which is in the *reviewed* baseline) |
| `npm run vendor:check` | **FAIL** | "Vendored assets are out of sync: codemirror.min.js, highlight.min.js, src/renderer/index.html" |
| `npm run license:inventory` | **FAIL** | "Dependency license inventory is stale" — recorded lockfile SHA-256 ≠ current `package-lock.json` |
| `npm run dupcheck` | PASS | 8 exact clones, 56 lines (0.57%) |
| `node scripts/audit-secrets-fulltree.js` | PASS | 0 first-party findings (67 in `node_modules` only — upstream, ungated, not shipped) |

### AUD-01 — The repository's own gates are red on the committed tree — **High**

Working tree was clean (`git status` empty at HEAD `6a2d743`), so these are committed-state failures, not audit artifacts:

1. `tests/unit/version-consistency.test.js:48` — `build/installer/setup.iss:14` pins the fallback `#define AppVersion "1.2.1"` while `package.json` is 1.2.2. (The build script always passes `/DAppVersion`, so shipped installers are labeled correctly — the *direct-compile* fallback the test exists to guard is wrong.)
2. `tests/unit/docs-consistency.test.js` — `docs/BUILD.md` still documents the 1.2.1 artifact names; `docs/dependency-license-inventory.json` deep-equality fails against the inventory computed from the current lockfile.
3. `lint:security` baseline fingerprint drift — the pinned, reviewed baseline (206 findings, `config/security-lint-baseline.json`) no longer matches what the tree produces. Either code changed after pinning without review, or tooling versions moved; either way the "no unreviewed security findings" guarantee is currently unenforced.
4. `vendor:check` reports three vendored assets out of sync with their `node_modules`-derived expectations (note: potentially environment-sensitive — e.g. esbuild output bytes — but CI would run the same check).

**Impact:** the README advertises "CI-gated" checks; a red gate trains maintainers to ignore gates, and the stale inventory is itself a compliance artifact (CMP-02). **Recommendation:** make all six gates green before any further change (bump the setup.iss fallback, regenerate the inventory + BUILD.md artifact names, re-pin the lint baseline after reviewing the delta, re-sync vendor), and treat red CI as release-blocking again.

---

## 4. Security

Threat model: untrusted Markdown content (XSS goal), the local filesystem, and crafted `settings.json`/`capabilities.json` at rest. Renderer compromise is the central scenario.

### SEC-01 — Capability grants persist forever with no revocation — **High** (Confirmed; dynamically tested)

- `src/main/capabilities.js:118-127` — the registry API has **no revoke/expiry/pruning**; every grant is reloaded at every startup (`:30-47`) and `fs:readVault` bulk-grants a per-file capability for every `.md` file found, permanently (`ipc-controller.js:258-277`).
- `fs:readVault(vaultId)` resolves through the **persisted** registry, not the set of currently-open vaults (`ipc-controller.js:168-178`) — a vault closed long ago can be silently re-enumerated by its old ID. `fs:closeVault` (`:314-317`) only drops the watcher.
- The renderer legitimately holds `documentId`/`vaultId` material (open tabs, `settings.recents[]`, `lastSession.vaults[]` — `settings.js:93-104`), so no user gesture is needed to use them.
- Dynamic test: after a simulated restart, old grants resolve; re-reading an old vault ID would re-scan the full folder.

**Impact (given an XSS):** read/write access to every markdown file in every folder the user *ever* opened, including folders not currently open — silently and with no further interaction. This is the single most consequential chain in the app (see blast-radius assessment below). **Recommendation:** scope `fs:readVault` to currently-open vaults; add revocation on vault close; prune grants by last-use or age; treat `capabilities.json` as a session cache, not a lifetime authority.

### SEC-02 — `fs:writeFile` conflict check is renderer-optional — **Medium** (Confirmed; dynamically tested; **High when chained with SEC-01**)

`src/main/document-store.js:224` — `if (baseHash != null && …)` means an omitted `baseHash` skips the conflict check entirely; `ipc-controller.js:319-344` passes it through verbatim. Dynamic tests: write without `baseHash` → silent overwrite; write with the hash obtained from a prior `fs:readFile` (which returns `meta.hash` to the renderer) → also succeeds. The write *target* is safe (always main's capability record; extension + containment re-checked in `validateWriteTarget`, `document-store.js:162-174`), which is why this is not Critical on its own. **Recommendation:** require `baseHash` for existing files and compare against a main-side copy of the last-read hash rather than a renderer echo.

### SEC-03 — Trusted Types default policy keeps `style`; CSP allows `unsafe-inline` styles — **Low** (Confirmed; dynamically tested)

`trusted-types-policy.js:20-26` sanitizes default-policy sinks with `ADD_ATTR: ['style', …]`; dynamic test: `<div style="position:fixed;inset:0;…">` survives verbatim (needed by KaTeX on the math path). Every *current* note-content sink uses the hardened profile (`trusted.js:26` forbids `style`) or `escapeHtml` — no live injection today. **Recommendation:** drop `style` from the default policy; confine style-bearing sanitization to the math policy that already returns a Trusted Type.

### SEC-04 — PDF export temp file: predictable name, non-atomic, symlink-following — **Low**

`ipc-controller.js:419-425` — renderer HTML written via plain `fs.promises.writeFile` to `%TEMP%/bpmd-export-<Date.now()>-<seq>.html`. Same-user processes can scrape note contents before the `finally` unlink, and `writeFile` follows a pre-planted symlink at the predicted path. The render window itself is inert (`javascript:false`, sandboxed, network-filtered). **Recommendation:** `crypto.randomUUID()` name + `O_EXCL`, or write under `userData`.

### SEC-05 — `capabilities.json` accepted at load with syntactic validation only — **Low** (Confirmed; dynamically tested)

`capabilities.js:24-47` — hand-forged records (arbitrary absolute paths; documents outside their claimed vault) load and grant real read/write authority for the next session. Containment is enforced at grant time but not re-checked at load. Requires prior write access to userData — hygiene, not a standalone exploit. **Recommendation:** re-verify existence + containment at load; drop failures.

### SEC-06 — Single hardcoded TLS leaf pin, no backup — **Low** (availability)

`github-tls.js:7-9` — one SHA-256 leaf fingerprint; GitHub rotates leaf certs regularly, so the opt-in update check will report `network` errors after rotation (it fails closed — no security downgrade). **Recommendation:** pin a stable intermediate's SPKI or ship a backup pin.

### SEC-07 — `save-image` → `downloadURL` with no `will-download` handler — **Info**

`window-controller.js:190-193`. Reachable only for http(s) images via right-click (CSP `img-src` blocks remote images today); Electron's default save dialog mediates. Fragile coupling if CSP or the scheme allowlist ever widens — keep the scheme gate load-bearing.

### SEC-08 — `app://` handler lacks the realpath check `bpmd://` has — **Info**

`protocol.js:104-121`. All traversal forms rejected by string logic (tested); residual exposure is a symlink inside `src/renderer/`/`resources/vendor/` — in packaged builds that tree is read-only asar. Consistency fix only.

### SEC-09 — `update:check` returns `html_url` to the renderer — **Info**

`ipc-controller.js:488`; the renderer only toasts version strings — dead data. Remove it so no future change can hand a network-sourced URL to an open-dispatch path.

### SEC-10 — Lockfile pins vulnerable dev versions of exactly the two sanitization-critical libraries — **Low** (see also CMP-01/CMP-05)

`package-lock.json` still resolves dompurify **3.4.12** (GHSA-55q2-fjhq-7xh7) and mermaid **11.15.0** (5 GHSAs) while `package.json` and the vendored, *shipped* runtimes are 3.4.13 / 11.16.1. Nothing vulnerable ships (`build.files` excludes `node_modules`), but the unit-test tree exercises older versions than users receive. **Recommendation:** refresh the lockfile so tests test what ships.

### SEC-11 — Wikilink alias interpolated unescaped into renderer HTML — **Low** (defense-in-depth; dynamically tested)

`markdown/markdown.js:22-24, 41-43` — the target has quotes stripped (attribute breakout impossible — tested), but `t.alias` is raw. `[[a|<img src=x onerror=alert(1)>]]` currently survives only as a stripped `<img src="x">` because every downstream consumer sanitizes; one unsanitized sink later this becomes the injection point. **Recommendation:** escape the alias.

### Renderer-XSS blast radius (net assessment)

An XSS was **not demonstrated** — DOMPurify + Trusted Types + sandbox held against every constructed payload. If one occurs anyway (future regression, vendored-library 0-day), it **would** achieve: full read of every ever-granted vault (SEC-01), silent overwrite of every ever-granted `.md` file (SEC-01+SEC-02), exfiltration via `window.open('https://…')` → `shell.openExternal` (visible but effective), UI defacement via inline CSS (SEC-03), recovery-snapshot poisoning, clipboard path writes. It would **not** achieve: code execution in main/renderer (sandbox, contextIsolation, no node, devTools off when packaged), touching any file outside granted `.md` paths, remote content loads (`connect-src 'self'`), or navigating the window away (exact-match guard). Net: "lose every note you ever opened" — data destruction/exfiltration, not machine compromise.

---

## 5. Code quality

### QA-01 — Autosave discards write outcomes; persistent save failures are invisible — **High**

`app.js:4148-4151` — `try { await workspaceController.writeThrough(f); saved = true; } catch (_) {}`. `writeThrough` **never throws**; it returns `'ok' | 'conflict' | 'error' | 'nosave'` (`workspace-controller.js:378-439`) — so on `'error'` (disk full, path gone) the user gets **no toast, ever**, the tab dot behaves as if healthy, and `saved = true` is even set on failure. On `'conflict'`, the tab ⚠ appears but the active file's resolution banner only renders on the next `renderFile` (i.e., after a tab switch). Contrast the manual-save path, which toasts reasons (`wc:465-472`). **Recommendation:** branch on the outcome; toast (rate-limited) on `'error'`; call `renderFile` for the active file on `'conflict'`.

### QA-02 — The main-side dirty ledger is write-only, and three comments describe behavior that does not exist — **High**

`window-controller.js:90-93` populates `dirtyCountBySender`; **nothing ever reads it** (grep across `src/` + `tests/`). The 20s force-close (`:281-291`) fires identically for 0 and 20 dirty files. Yet `window-controller.js:67-69` ("main still knows the truth…"), `preload/index.js:21-24` ("source of truth for the close failsafe"), and `app.js:1991-1993` all claim it arms the failsafe. The prior audit's P1-7 was "remediated" with a data structure instead of a behavior. **Recommendation:** consume it (log the dirty count when the failsafe fires; or delay one retry cycle when count>0) — or delete it and fix the three comments.

### QA-03 — Triplicated render pipeline: six real divergences — **High** (as a defect class)

The same pipeline exists in `renderReadingContent` (`app.js:2186-2208`), `renderFile` (`:2239-2334`), and the input-debounce closure (`:2897-2925`). Line-by-line diff:

1. "note" label localized only in `renderFile` (`:2284`); the others hardcode English (`:2193`, `:2909`) — the meta line flips to English on entering Reading mode and on every debounced edit under the Arabic UI. **Live bug.**
2. Word-count label chosen by **document** language in `renderFile` (`:2286`, `'كلمة' : 'words'`) but **UI** locale in the others (`tl('status.nWords')`) — and the existing `status.words` catalog key has zero consumers. **Live bug** (visible language flip between initial render and first edit).
3. `aria-hidden="true"` on doc-meta only in the Reading copy — Reading mode hides word count from screen readers, Edit mode doesn't.
4. Wikilink click wiring exists in copies 1–2 but **not** the debounce copy — in the CM6-load-failure lane, wikilinks die after the first keystroke. **Live bug.**
5. Copies 1/3 update `propRead/readTime/wordCount`; copy 2 updates none (stale inspector in Reading mode).
6. Dirty marker conditional in copies 1–2, unconditional in copy 3.

**Recommendation:** extract one `renderNoteInto(file, {mode})`; items 1, 2, and 4 are fixable bugs today.

### QA-04 — Vault reconcile logic duplicated (~30 lines) with two behavioral deltas — **Medium**

`mergeVaultSlice` (`wc:44-80`) vs the inline merge in `handleVaultChanged` (`wc:744-781`). Differences: keying by `entry.relPath || entry.name` vs raw `relPath`, and (correctly placed) watch-generation re-check + active-file effects in the inline copy. Any fix to the compare logic must currently be made twice. **Recommendation:** have `handleVaultChanged` call `mergeVaultSlice` plus a small effects wrapper.

### QA-05 — Reveal/Copy-Path errors produced main-side, then dropped renderer-side — **Medium**

Main returns `{error:'reveal-failed'|'copy-failed'|…}` (`ipc-controller.js:511-535`); the renderer `await`s inside `try{…}catch(_)` and never inspects the resolved value (`app.js:1686-1695`). The user gets nothing when Explorer fails to open or the clipboard write fails. **Recommendation:** check the error value and toast.

### QA-06 — `recovery:pop` unlinks the snapshot before parsing it — **Medium**

`ipc-controller.js:570-583` — the file is deleted (fire-and-forget) *before* `JSON.parse`; a torn write from the very crash this feature exists for hits the catch-all and returns `{ok:true, files:[]}`: the user's recoverable work is destroyed with no prompt, log, or toast. **Recommendation:** parse first; on failure keep (or rename `.corrupt`) and tell the renderer so the dialog can say so.

### QA-07 — Vault `skipped` counts computed, returned, never shown — **Low**

`skipped = {unreadable, oversized, escaped, special}` survives `normalizeVaultRead` and has zero readers; a failing subdirectory isn't counted at all (`ipc-controller.js:207-211`). Unreadable files simply vanish from the tree. **Recommendation:** surface alongside the existing `truncated` toast.

### QA-08 — CM6 load failure degrades the editor silently — **Low**

`app.js:3010`, `:4274` drop to the textarea fallback with no toast or log marker — the user gets a materially different editor with no explanation (and enters the lane where QA-03 item 4 bites).

### QA-09 — Dead code census (script-verified) — **Low**

Exactly one fully-dead top-level function in `app.js`: `clipboardCopy` (`:1421-1424`). Plus dead imports/vars found by the correctness lint (QA-15): `resolveDirection` imported-unused in `app.js:10` and `bidi-dom.js:18`, `appEl` (`app.js:124`), `_ctxItems` (`:1472`), `_folderName` (`:2706`), `err` (`:4072`), `e` in `theme-boot.js:13,23`. **Retraction:** the textarea-fallback lane (`ensureSourceFocus`, `handleBlockquoteEnter`, `replaceInTextarea`) is *not* dead — it is the live CM6-failure fallback, wired unconditionally. `stepCaret` (bidi.js) is dead in production (CM6 handles caret motion) though unit-tested.

### QA-11 — Proxy-store subscribers bypassed by array mutation; session snapshot not persisted on one close path — **Low**

`state.js:14-20` fires only on top-level assignment; `State.files.push/splice` mutate silently and rely on well-placed manual `persistSettings()` calls — `closeTab`'s non-active branch (`app.js:2099`) misses one. `_lastDirtyReport` caches before send (`:1996-1999`) so a failed report is never retried (moot while the ledger is write-only — a trap once QA-02 is fixed).

### QA-12 — Shortcut map: five surfaces, all drift-guarded, none unified — **Info**

`MENU_DEFS`, `PALETTE_COMMANDS`, `CTX_ROLE_DISPLAY`, `APP_COMMAND_DISPLAY`, `showShortcuts` + the keydown chain; e2e guards CA19/CA20 (`click-audit-all.spec.js:651-799`) cover all five. The guard checks specific chords, not completeness (documented as deliberate).

### QA-14 — "Full Arabic parity" residuals — **Medium** (cumulative)

Six context-menu **role** labels are English literals with no `tr()` (`app.js:1524-1527, 1551, 1572`); hardcoded toasts at `:553, :563, :881`; static literals "Type to search." (`:1828`), "No matches…" (`:1837`), "No document opened." (`:2176`), "No headings." (`:2380`), "No tags found." (`:2670`); the disk-change conflict toast (`wc:790`) and legacy-recent toast (`wc:690`) are English-only. All are one catalog key away.

### QA-15 — ESLint runs security rules only; no correctness rules exist — **Medium**

`eslint.config.mjs` has no `eslint:recommended` — `no-undef`/`no-unused-vars`/`no-dupe-keys` etc. are never checked. A one-off pass (ESLint `Linter` API, full recommended set, temp harness) over all 57 `src` files found **135 problems**, of which the genuine ones are ~10 dead vars/imports (see QA-09) and 5 useless escapes; the rest are the deliberate `catch (_)` convention (~90) and missing-global false positives (`NodeFilter`, `Response`, `AbortSignal`). Verdict: no latent *correctness* bugs found — but the gap that let `clipboardCopy` survive unflagged is real. **Recommendation:** add `js.configs.recommended` to the config with `argsIgnorePattern: '^_'` and a new reviewable baseline.

### QA-16 — Error-handling architecture — **Info** (assessment: sound)

Errors cross IPC as *values*, never thrown across the bridge; renderer `window.onerror`/`unhandledrejection` → rate-limited `log:error` → rotated local log. The only user-visible error surface is the toast — the gaps are precisely the swallow points filed as QA-01/05/06/07/QA-08. Silent-catch census: 39 catch blocks in `app.js`, 20 in `ipc-controller.js`; ~27 renderer blocks are legitimately best-effort; worst five: autosave (`app.js:4149`), `recovery:pop` (`ipc:580`), reveal/copy-path double-swallow (`app.js:1688/1693` + `ipc:519/532`), silent CM6 degrade (`:3010/:4274`), skipped-file vanish (`ipc:209/268`).

---

## 6. Performance

Benchmarks ran the repo's **actual modules and exact vendored builds** (marked/DOMPurify/KaTeX/hljs loaded the way `index.html` loads them; jsdom 29 for DOM stages — DOM numbers are upper bounds vs Chromium, string/regex/crypto stages are engine-accurate). Fixtures: mixed Arabic/English markdown; 2,000×20KB IO set; 5,000×10KB search corpus; 5,000-entry tree. Windows 11, Node 24, real SSD (Defender realtime included — the honest end-user case).

### PERF-01 — Full pipeline re-runs per 150ms debounce tick; linear-to-superlinear in document size — **High** (Measured)

Every typing pause ≥150ms re-runs `parseFrontMatter → marked (+5 inline extensions + footnotes) → DOMPurify → noteContent.innerHTML → rewriteVaultImages → callouts → hljs → KaTeX → bidi DOM walk → table frames → TOC` over the **entire** document (`app.js:2896-2925`; same on open at `:2267-2323`). No block cache, no diffing (verified: no other write path to `noteContent.innerHTML`).

| Doc size | marked | DOMPurify | innerHTML | hljs | KaTeX | bidi | **Total** | DOM nodes |
|---|---|---|---|---|---|---|---|---|
| 10 KB | 1.6ms | 11.3 | 9.6 | 14.2 | 45.7 | 22.9 | **~97ms** | 1,171 |
| 50 KB | 4.7 | 27.8 | 29.6 | 28.5 | 131 | 72.7 | **~351ms** | 5,094 |
| 100 KB | 10.2 | 57.3 | 57.1 | 101 | 136 | 113 | **~811ms** | ~7,000 |
| 250 KB | 80.3 | 229 | 269 | 250 | 1,217 | 718 | **~3.0s** | 31,797 |
| 1 MB | 1,086 | 1,020 | 1,087 | 1,327 | 4,224 | 3,369 | **~13.4s** | 111,994 |

Typical notes (5–30KB) sit in the 30–150ms range — borderline perceptible; the 10MB file cap permits documents far into the pathological range. **Recommendation:** block-level cache keyed on marked lexer blocks (or morphdom-style diffing of the sanitized tree); at minimum skip KaTeX/hljs/bidi for blocks whose source didn't change; move word-count/read-time off the render path.

### PERF-02 — `highlightAuto` across 192 languages for unlabeled fences: 15–170ms **per block, per render** — **High** (Measured)

`markdown/highlight.js:29-31` — fences with no/unknown language fall back to `hljs.highlightAuto`; the vendored bundle registers 192 languages. Measured on the real bundle: 211-char snippet = 15.6ms; 120-line block = **169ms** (named-language highlight of the same inputs: 0.18–2.99ms — ~80× cheaper). A note with ten unlabeled fences adds ~0.2–1.5s to *every* render. **Recommendation:** default unlabeled fences to plain text (or a ~10-language detection subset), or lazy-detect after first paint.

### PERF-03 — `fs:readVault`: serialized per-file work + O(N²) registry churn; ~750 files/s; gates session restore — **High at the 5,000-file cap / Medium at 1,000** (Measured)

Per file (`ipc-controller.js:231-277`): `lstat` → `grantDocument` (realpathSync + statSync + **linear `.find`** over all documents, `capabilities.js:96`) → `readDocumentCapability` (**`listDocuments().map()` copies the whole registry + builds a new Set per file**, `ipc-controller.js:62-66`) → `docStore.read` (readFileSync + decode incl. full UTF-8 double-validation + 2 EOL regexes + SHA-1 + second statSync). **Correction to the initial briefing:** the walk is async and yields — the main loop breaths in ~1.3ms sync slices; the problem is cumulative wall-clock/CPU, not one long block. Measured: 2,000×20KB files → 2.68s end-to-end (**~750 files/s**); projected ~6.7s + ~1.1s of quadratic registry copying at the 5,000 cap; ~100MB then cloned over IPC. `restoreLastSession` awaits the full read before CM6/autosave/recovery mount (`app.js:4244-4279`), so a restored max-size vault ≈ 7s to usable editor. **Recommendation:** hoist the allow-set out of the loop; index grants by path (Map) instead of `.find`; hash lazily; send paths/sizes eagerly and content lazily (or parallelize reads on the threadpool).

### PERF-04 — Eager full-content memory model, doubled by the search cache — **Medium** (Measured)

`fs:readVault` returns every file's full content; the renderer keeps all of it in `State.files` (100MB cumulative cap verified). First search materializes `contentLower` — a full lowercase copy per file, cached for the object's life (`search.js:6-16`): at cap that is ~98MB of extra UTF-16 strings. **Recommendation:** lazy content fetch, or share the lowered string and drop the duplicate; cap cache entries.

### PERF-05 — Every tree expand/collapse rebuilds all rows **and** re-regex-scans the full content of every vault file — **Medium** (Measured)

`renderTree` (`app.js:2520-2651`) rebuilds the entire flattened DOM per click (data layer measured trivial: `buildForest`+`flattenTree` = 2.3ms at 5,000; row-DOM loop ~291ms in jsdom for 5,077 rows). The hidden cost: `renderTree` ends with `renderTags()` → `extractTagsFromFiles(State.files)` — a Unicode regex scan over **up to 100MB of content** (`app.js:2649, 2665-2667`; `tags.js:29-40`) on every click, file add, tab close, and watcher event. **Recommendation:** extract tags once per file revision; skip `renderTags` on pure expand/collapse; render only visible rows.

### PERF-06 — Cold vault search blocks the UI thread 100–320ms at cap — **Medium** (Measured)

5,000×10KB corpus: cold (WeakMap miss) scan = 99–162ms depending on hit density; at the 100MB cap a no-match query ≈ 320ms of blocked typing. Warm scans are 0.5–36ms; the 150ms debounce + generation guard are correct but don't help the post-pause scan itself. **Recommendation:** build the lowered index incrementally at load (or in idle chunks / a worker).

### PERF-07 — 1.42MB of blocking JS before first paint, 76% of it highlight.js — **Medium**

`index.html:20-26` — four classic blocking `<script>` tags: marked 43KB + DOMPurify 29KB + KaTeX 271KB + **highlight.js 1,080KB** (192 languages), plus KaTeX CSS over `file://` (no gzip). Mermaid (3.57MB) and CM6 (534KB) are correctly lazy. **Recommendation:** lazy-load hljs (and ideally KaTeX) on first fence/math token, or ship the ~10-language common bundle.

### PERF-08 — Per-keystroke fast path is O(document) — **Low** (Measured)

`codemirror-adapter.js:99` serializes the whole doc (`doc.toString()`) per keystroke; `app.js:2891-2894` then `slice` + `split('\n')` for Ln/Col. 0.009ms @10KB → 0.81ms @1MB per keystroke. Use `state.doc.lineAt(pos)`.

### PERF-09 — Bidi DOM pass scales linearly; `isolateInlineRuns` dominates — **Low** (Measured; a component of PERF-01)

Full `applyBidi` on 67KB rendered mixed HTML: 83ms (jsdom) — block direction 16.9ms, inline isolation 58.1ms. The TreeWalker already skips CODE/PRE/KaTeX/Mermaid parents (`bidi-dom.js:98-99`). Scope it to changed blocks alongside PERF-01.

### PERF-10 — Recovery loop rewrites full dirty content every 10s even when unchanged — **Info** (Measured)

`app.js:4159-4172` serializes all dirty files each tick; atomic write measured 9.7ms @5MB + 2× IPC copies. Snapshot only changed revisions, or skip identical hashes.

### PERF-11 — Listener lifecycle is benign — **Info** (verified)

The "129 addEventListener vs 2 removeEventListener" ratio raised as a lead is a **non-finding**: per-render listeners die with the replaced DOM; the e2e memory test's <20-listener-growth assertion matches the mechanism. No accumulation path found.

### Existing perf-gate coverage

`f13-cm6-perf.spec.js` (10k-line build <100ms; keystroke <16ms; scaling ratio) and `performance.spec.js` (10k-word render <1s; 100-heading <500ms; zoom; memory bounds) are real gates. **Not covered anywhere:** vault load at scale, session-restore latency, sidebar search, tree rebuild at 5k, renderTags rescan, highlightAuto cost, documents >100KB, autosave/recovery IO.

---

## 7. UX / UI / RTL correctness

### UX-01 — The dominance rule mis-fires in both directions around the 60% threshold — **High** (executed traces)

`bidi.js:54` (`BLOCK_DOMINANCE = 0.6`), `:71-73`. Letter-counting (every Latin letter — **including URL paths and code identifiers** — counts as "LTR prose", `:60-64`) produces two failure modes on ordinary bilingual content:

- **Dead band 50–60%:** a 53%-Arabic paragraph renders RTL; prepend one English word and Arabic share drops to ~50% — first-strong now says LTR and the 60% veto never fires → the block **flips RTL→LTR** from a one-word edit. The function's own doc comment promises the opposite behavior in this exact scenario (`bidi.js:36-44, 50-53`).
- **URL/code false dominance:** `راجع https://docs.example.com/en-us/azure/devops/pipelines/processes للمزيد من التفاصيل` — an Arabic sentence whose URL letters outweigh the Arabic (28% Arabic) → **forced LTR**.

Adversarial table (executed against the real module; selected rows): 53%Ar/Ar-first → RTL ✓; same +1 English word → **LTR ✗**; `API دليل المستخدم` (80% Ar) → RTL ✓; Arabic sentence + long URL → **LTR ✗**; English + one Arabic word → LTR ✓; `#تقنية و #tech` → RTL ✓. **Recommendation:** count word tokens (strip URLs/identifiers before counting) and/or lower the override to simple majority so "Arabic-majority block reads RTL" holds without a dead band.

### UX-02 — Code fences flip their Arabic container blocks to LTR — **High** (jsdom trace)

`bidi-dom.js:21` includes `li, blockquote, .callout` in the block selector and computes dominance from `el.textContent` (`:41`) — **including nested `<pre><code>` text**. Trace: an Arabic callout with a 4-line JS fence (18 Arabic vs 75 Latin letters) receives `dir="ltr"` — Arabic title left-aligned, `data-script="arabic"` stripped (`:50-51`), losing the Arabic font. The common "Arabic note explaining a snippet" pattern breaks exactly when code is present. (The `pre` itself is correctly forced LTR by CSS.) **Recommendation:** exclude descendant `pre`/`code`/`.mermaid`/`.katex` text when resolving container direction.

### UX-03 — No Arabic text normalization in any search surface — **High**

Vault search is `toLowerCase()` + `indexOf` (`search.js:13-29`); find-in-document is a `'gi'` regex over rendered text nodes (`app.js:1167-1188`) and over raw source in CM6 (`codemirror-adapter.js:170-174`). None strip tashkeel (U+064B–0652), fold أ/إ/آ→ا, align ة/ه, or fold ى/ي. For the target audience this is a daily miss: `محمد` doesn't find `مُحَمَّد`, `اسلام` doesn't find `إسلام`. **Recommendation:** one shared normalizer applied to haystack and query in all three surfaces.

### UX-04 — Multi-folder session restore silently drops every folder but one — **High**

`session.js:25-37` persists exactly one vault (`:14-18` admits it); `restoreLastSession` reads `lastSession.vaults?.[0]` (`wc:800`) and opens exactly one tab. A 3-folder user restarting gets one root back; the other roots, tabs, and loose files vanish with **no toast**. The multi-folder feature's session story is unfinished (B3/B4). **Recommendation:** persist all open vaults + per-file `open` flags; short term, toast when more folders existed at quit.

### UX-05 — `--gold` fails WCAG as code-token text color in Paper and Sepia — **Medium** (computed)

`--gold: #A8842C` (`base.css:72`; sepia inherits it) consumed as text color for `hljs-number/built_in/symbol` at 13px on `--paper-deep` (`components.css:1340`): **2.86:1 (Paper), 2.59:1 (Sepia)** vs 4.5:1 required; also below the 3:1 non-text bar for the warning-callout icon. Ink lifts it to `#D5B461` (7.99:1). Why CI missed it: the axe gate filters to critical/serious, full-page scans never run in sepia, and the demo fixture has no numeric literals in code. All main text pairs pass AA in all three themes (computed: ink 13.4/12.15/10.63; ink-soft 7.56/8.25/6.98; ink-mute 5.04/5.29/5.22 — the earlier sepia fix holds). **Recommendation:** darken Paper/Sepia `--gold` (~`#8A6A1E` ≈ 4.6:1); add per-theme full-page scans + a numeric-literal fixture.

### UX-06 — Sepia theme block missing v1.2/palette tokens it doesn't share with Paper — **Low**

`themes.css:29-46` redeclares only surfaces/inks/accent; `--backdrop/--caution/--gold/--teal/--plum/--green/--close-red` inherit Paper's `:root` values (Ink redeclares `--backdrop/--caution`). Inherited `--gold` is Sepia's worst pair (UX-05). **Recommendation:** give Sepia its own accent set; pin token pairs in a contrast unit test.

### UX-07 — Documentation drift: six confirmed items — **Medium**

1. `USER_GUIDE.md:77` — "Zoom … the rest of the interface stays put": false; zoom is app-wide by design (`app.js:1906-1930`; the zoom e2e asserts chrome scales).
2. `USER_GUIDE.md:45-47` — references **¶ / ⌂ buttons** that don't exist in the v10 UI.
3. `KEYBOARD_SHORTCUTS.md:23` — daily note "(YYYY-MM-DD)" ignores the Hijri naming option.
4. `KEYBOARD_SHORTCUTS.md:66` — "Flip text direction (LTR ⇄ RTL)" describes a 2-state toggle; actual is 3-state Auto→RTL→LTR.
5. `KEYBOARD_SHORTCUTS.md:74` — "Fullscreen has no keyboard shortcut yet": F11 is bound.
6. Settings docs omit the Auto-save setting that is in the dialog; the "Aa" reader popover and Arabic-UI toggle are undocumented.

**Recommendation:** one docs pass; extend the existing `docs-consistency` test to pin these.

### UX-08 — Settings dialog holds 4 groups while Arabic options live only in the View menu; `numerals` is fully orphaned — **Medium**

Locale/calendar/kashida/italic-recolor are View-menu-only (`app.js:977-986` vs `showSettings` `:3606-3646`). The `numerals` setting is worse than dormant: main persists/validates it (`settings.js:26,84`), `applyNumerals` exists (`i18n.js:47-64`), **no renderer code ever calls it and no UI exists** — hand-editing `settings.json` does nothing. **Recommendation:** wire it or delete it (also QA-10); move the Arabic options into Settings.

### UX-09 — Mermaid: no render timeout, no visible failure state — **Medium**

`mermaid.js:23` — `await mermaid.render` with no timeout, blocks subsequent diagrams sequentially; on failure sets `data-mermaid-error='1'` which **no CSS rule or message consumes** — the user sees raw mermaid source with no explanation. **Recommendation:** `Promise.race` timeout (~5–10s) + styled error caption (EN+AR).

### UX-10 — Command palette renders the entire vault on empty query — **Medium**

`filterPalette` (`app.js:3696-3700`) pushes every `State.files` entry when the query is empty — Ctrl+K on a 5,000-file vault builds thousands of buttons in one `innerHTML` write (sidebar search caps at 100 by contrast). **Recommendation:** cap file entries (~50 + "keep typing") or require ≥1 character.

### UX-11 — Find-in-document: count not announced; dual-surface semantics differ — **Low**

`#findInfo` has no `aria-live` and `0/0` is unlocalized (`index.html:686`); Edit mode searches **raw markdown**, Reading mode searches **rendered text** — same query, different counts. Both wrap, both highlight-all, both case-insensitive, both share the UX-03 normalization gap.

### UX-12 — No broken-image handling for `bpmd://` vault images — **Low**

No `img` error handling anywhere — a moved/deleted vault image shows Chromium's bare broken-image icon with no filename. **Recommendation:** one-shot `error` listener → styled placeholder naming the relative path.

### UX-13 — Failure paths are quiet: watcher re-read errors, autosave (see QA-01), toasts overwrite each other — **Low**

`handleVaultChanged`'s re-read failure returns silently (`wc:727-735`); the single toast element means "Saved as X" is instantly replaced by the next toast (`app.js:355-364`) — no stacking/queue.

### UX-14 — Assorted papercuts — **Low**

Unlocalized strings (`rtlBtn` tooltip `index.html:460`; CM6 `aria-label` `codemirror-adapter.js:145`); `viewModeBtn` starts `aria-pressed="true"` while the default mode is edit (`index.html:459` vs `app.js:80`); **wikilinks resolve the first filename match across all folders** (`app.js:2828-2835`) — with `todo.md` in folders A and B, `[[todo]]` from A opens B's file; `slugify` turns tashkeel into hyphens (`كِتَاب` → `ك-ت-اب`) making anchors unstable across vocalization; `stepCaret` dead in production (also QA-09).

### Verified notably good (RTL/a11y)

Per-line CM6 direction decorations mirror the reading model (`line-direction.js`); FSI/PDI-isolated window titles with Trojan-Source rationale (`app.js:576-593`); focus stack + pure trap math + roving tabindex (tabs/tree/tables, RTL-aware arrow mirroring); toasts are `role=status aria-live`; locale catalogs exactly parallel (EN 300 = AR 300 keys, zero gaps); physical-key shortcuts keep every chord on Arabic layouts; Arabic-Indic digits and `٫`/`٬` separators render correctly without isolation (verified visually in Chromium); KaTeX errors render inline red via `throwOnError:false`.

---

## 8. Compliance, licensing, privacy, hygiene

### CMP-01 — THIRD-PARTY-NOTICES version table stale (2 of 8 entries) — **Medium**

Notices say DOMPurify **3.4.12** and Mermaid **11.15.0**; `vendor-manifest.json` + `package.json` + the shipped tree say **3.4.13 / 11.16.1**. The two stale rows are exactly the two packages that had open advisories at the old versions. Not a license violation (terms unchanged) — but the notice is the artifact distributors rely on. **Recommendation:** update the rows; cite `vendor-manifest.json` for all rows as the CodeMirror row already does.

### CMP-02 — License inventory stale vs lockfile (gate failing) — **Medium**

`docs/dependency-license-inventory.json` records a lockfile SHA-256 that no longer matches `package-lock.json` (recomputed; the repo's own `npm run license:inventory` fails — part of AUD-01). The lockfile moved on 2026-09-03 without regenerating. **Recommendation:** `npm run license:inventory:update` + commit.

### CMP-04 — The 20 KaTeX math fonts are mislabeled MIT; upstream declares them SIL OFL-1.1 — **Medium**

`LICENSE-AUDIT.md:877/881` inherits the npm package's MIT declaration, but upstream states the fonts are OFL with Reserved Font Names (KaTeX issue #339, katex.org/docs/font). The 20 shipped `resources/vendor/katex/fonts/*.woff2` are not listed in `resources/vendor/fonts/LICENSES.md` (which covers only the 4 UI families). De-facto redistribution remains compliant (OFL permits bundling unmodified fonts; an OFL-1.1.txt ships inside the app), but the attribution chain is wrong-if-audited. **Recommendation:** add a KaTeX-fonts OFL row to `LICENSES.md` naming © Khan Academy and the RFN; correct LICENSE-AUDIT if retained.

### CMP-05 — SBOM and OSV scan predate the current lockfile — **Medium**

`.secreports/sbom.json` + `osv-scanner.txt` (2026-08-22) catalog mermaid 11.15.0 / dompurify 3.4.12; the lockfile (2026-09-03) has 11.16.1/3.4.13. Drift happens to be in the safe direction, but nothing enforces a rescan on lockfile change. **Recommendation:** wire syft/OSV into release preflight. Related (CMP-06, Low): the OSV report's "(dev)" suffix understated that dompurify/mermaid findings were also the *vendored, shipped* versions at scan time — accurate labeling matters; the remaining 19 findings are genuinely build/test-only (brace-expansion, undici ×8, nanoid, js-yaml, tar, fast-uri, postcss — all transitively under Playwright/stryker/electron-builder tooling, no shipped-artifact reachability).

### CMP-08 — "Signed installers / notarized" is not verifiable from the repo — **Medium**

README states it; in-repo evidence: `win.signtoolOptions` sets only a publisherName *expectation*; `-RequireSigned` exists in `build-installer.ps1` but requires credentials; `docs/BUILD.md:227-231` itself says signing is manual. No CI signing, no published thumbprint/notarization record. **Recommendation:** publish the Authenticode thumbprint + notarization record with releases, or soften the README wording.

### CMP-03 — LICENSE-AUDIT.md path drift — **Low**

References `assets/vendor/**` throughout; the real tree is `resources/vendor/**`. Mitigating: the file is git-ignored, never committed — maintainer-facing only. Regenerate if kept as evidence.

### CMP-07 — No shipped-artifact SBOM — **Low**

The syft SBOM covers the lockfile; minified vendored bundles aren't cataloged as components. Compensating: `vendor-manifest.json` per-file SHA-256 + `verify-package-contents.js`. **Recommendation:** run syft against the unpacked build, or publish vendor-manifest + src list as the release SBOM.

### CMP-09 — README documents the wrong settings directory — **Low**

README:121 says `%APPDATA%\BP MD RTL Reader`; actual userData is `%APPDATA%\bpmdrtlreader` (Electron default for the package name; PRIVACY.md has it right). The spaced form exists only as an uninstaller cleanup alias.

### CMP-10 — CHANGELOG claim contradicts the postinstall script — **Low**

1.2.1 says "`npm install` no longer downloads Playwright's Chromium by default"; `ensure-playwright-browser.js:15-17` skips only for `CI` or an env var — a plain developer install still downloads ~120MB. CONTRIBUTING.md matches the code; the CHANGELOG doesn't. (Also QA-13.)

### CMP-11/12/13/14 — Info

(11) Log "error messages" could in principle embed note fragments (KaTeX parse errors embed source) — no live path found; optional redaction or a PRIVACY caveat. (12) PRIVACY's "legacy aliases" are uninstaller-cleanup scope only, not read paths — wording. (13) The tracked Nebula design prototype loads Google Fonts from CDN — latent contradiction with the 0-network posture if its CSS is ever lifted into `src/renderer`; add a do-not-copy banner; the 12 tracked screenshots add ~6MB to clones. (14) `offline-network.spec.js` asserts only a filtered subset of blocked external requests — make it `expect(external).toEqual([])`.

### Privacy-claims verification (all 10 audited claims VERIFIED)

No telemetry (renderer has zero network APIs in use) ✓ · crashReporter `uploadToServer:false` (`index.js:56`) ✓ · update check user-initiated, metadata-only, pinned to api.github.com, `redirect:'error'`, 15s timeout ✓ · CSP `connect-src 'self'` + offline e2e proof ✓ · data in `%APPDATA%\bpmdrtlreader` ✓ · `settings.json` exactly as documented, paths only ✓ · uninstaller 3-choice flow, `/S` preserves, `/DELETEUSERDATA` scoped, never deletes notes (verified in `installer.nsh` + Pester tests) ✓ · logs local, rotating 1MiB×3, capped/rate-limited (residual note: CMP-11) ✓ · window-title filename + opt-out ✓ · `numerals` dormant disclosure honest ✓.

### Repo hygiene (git-verified)

Everything that should be ignored is ignored and absent from history: `dist/` (3.5GB local), `out/`, `reports/`, `test-results/`, `.secreports/`, `.claude/` (one local Bash permission, no secrets), `.cursor/`, `.superpowers/`, `.video_agent/`, the stray `assets/d7c23e25-….png` (identified: an untracked 1254×1254 AI-generated icon mockup), and `tests/installer/BP-MD-RTL-Reader-SelfTest.exe` (explicitly ignored — **retracting** the earlier "tracked binary" lead). History clean (14.04MiB pack, no accidental blobs). Only tracked bulk: `design/` (~6.3MB, CMP-13) and visual snapshots (deliberate, `linguist-generated`).

---

## 9. Prior-audit remediation verification (docs/AUDIT-REPORT-2026-09-03.md, v1.1.0 → v1.2.2)

**Headline: all 4 P0s fixed; ~47 findings → 26 FIXED / 14 PARTIAL / 6 NOT FIXED / 1 N/A; no regressions.** All 24 headline CHANGELOG claims for 1.2.1/1.2.2 map to real code; two are overstated (Arabic parity — QA-14; Chromium download — CMP-10).

### P0 (4/4 fixed)

| Prior | Finding | Status | Evidence |
|---|---|---|---|
| P0-1 | Arabic keyboard layout kills shortcuts | **FIXED** | physical `e.code` matching (`app.js:3808-3879`) |
| P0-2 | Re-opening an open dirty file wipes edits | **FIXED** | conflict branch keeps in-memory copy + banner (`app.js:2786-2805`) |
| P0-3 | Close prompt has no Save option | **FIXED** | themed 3-way dialog (`app.js:739-795`), used at all close paths |
| P0-4 | Window can become unclosable | **FIXED** (caveat QA-02) | 20s failsafe (`window-controller.js:77-85, 281-291`) — but the dirty ledger it presupposes is write-only |

### P1 highlights (19 findings: 12 fixed, 5 partial, 2 not fixed)

**Fixed:** save-as cancel toast · per-surface context menus · app-command menu gating · Ctrl+Y global · find Enter/Shift+Enter · ⌘→Ctrl runtime swap · toolbar i18n · themed confirm dialogs · sepia icon · focus-visible policy · multi-encoding save (UTF-16/CP-1256 faithful re-encode) · Ctrl+P palette. **Partial:** standalone-file conflict still save-time-only (no watcher for single files, `ipc-controller.js:281-298`); renderer-crash path still force-closes un-prompted (recovery mirror caps loss); role labels untranslated (QA-14). **Not fixed:** `<u>F</u>ile` Alt-underlines with zero `altKey` handling (`index.html:436-439`); macOS still Edit-only system menu (`window-controller.js:36-57`).

### P2 highlights

Fixed: save-as vault-exit toast · letter-spacing RTL fix · tokenized colors · status/banner i18n · RTL arrows · CLI open errors surfaced · multi-file opens. **Not fixed / partial:** F3/F4 unbound · silent EOL normalization of mixed files (still no notification, `document-store.js:25-32`) · PDF temp leak on crash (SEC-04) · single TLS pin (SEC-06) · `skipped` files silent (QA-07) · `numerals` dormant (UX-08) · settings scatter (UX-08).

---

## 10. Remediation roadmap

### P0 — before the next commit lands (days)

1. **Make all six gates green** (AUD-01, CMP-02): `setup.iss` fallback → 1.2.2; regenerate license inventory + BUILD.md artifact names; review and re-pin the security-lint baseline; re-sync vendor.
2. **Autosave outcome handling** (QA-01): branch on `writeThrough` results; toast on error; re-render active file on conflict.
3. **`recovery:pop` parse-before-delete** (QA-06).
4. **Bidi fixes** (UX-01, UX-02): exclude code/pre text from container dominance; token-based counting or majority threshold. Regression-table inputs are in §7.
5. **Arabic search normalization** (UX-03) across all three surfaces.

### P1 — this cycle (weeks)

6. Capability revocation + open-vault scoping; main-side mandatory `baseHash` (SEC-01, SEC-02).
7. Unify the render pipeline (QA-03 — fixes three live bugs); consume-or-delete the dirty ledger (QA-02).
8. Kill `highlightAuto` (plain-text default or subset) + lazy-load hljs/KaTeX (PERF-02, PERF-07).
9. Multi-vault + per-tab session persistence (UX-04).
10. `readVault` dequadraticification + lazy content (PERF-03, PERF-04).
11. Compliance refresh: notices versions, KaTeX-font OFL attribution, SBOM/OSV rescan at release (CMP-01, CMP-04, CMP-05).
12. Surface swallowed errors: reveal/copy-path, skipped files, watcher failures, CM6 degrade (QA-05, QA-07, QA-08, UX-13).
13. Block-level render caching (PERF-01) — the structural fix; pair with PERF-05/PERF-09.

### P2 — next cycle

`--gold` contrast + per-theme full-page axe scans (UX-05/06) · docs pass (UX-07) · settings reorganization + numerals decision (UX-08) · mermaid timeout/error UI (UX-09) · palette result cap (UX-10) · PDF temp hardening + TT `style` removal + registry load re-validation + TLS backup pin (SEC-03/04/05/06) · correctness ESLint rules with reviewable baseline (QA-15) · Arabic-parity residuals (QA-14) · tag extraction caching + tree row virtualization (PERF-05) · search idle-chunking (PERF-06) · signing evidence in releases (CMP-08) · README/CHANGELOG fixes (CMP-09/10) · wikilink vault scoping (UX-14).

### P3 — opportunistic

Info items: remove `html_url` from update:check (SEC-09) · `app://` realpath consistency (SEC-08) · offline test assertion completeness (CMP-14) · Nebula banner + screenshot weight (CMP-13) · dead code cleanup (QA-09) · renderer→main import meta-test · escape wikilink alias (SEC-11).

---

## Appendix A — Verification commands and outcomes (2026-09-20, tree `6a2d743`, clean)

| Command | Outcome |
|---|---|
| `npm run test:unit` | 1,620 pass / 3 fail (`docs-consistency` ×2, `version-consistency` ×1) — AUD-01 |
| `npm run lint:security` | baseline fingerprint mismatch; 206 problems (20E/186W) — AUD-01 |
| `npm run vendor:check` | 3 assets out of sync — AUD-01 |
| `npm run license:inventory` | stale — AUD-01/CMP-02 |
| `npm run dupcheck` | PASS (0.57% duplication) |
| `node scripts/audit-secrets-fulltree.js` | PASS (0 first-party) |
| One-off ESLint `recommended` pass (Linter API, 57 files) | 135 problems; ~15 genuine (QA-09/QA-15), rest `catch (_)` convention + globals false positives |
| Dynamic harnesses (temp dir) | vendored DOMPurify/marked pipeline XSS attempts — all neutralized; `bpmd://` resolver traversal battery — all rejected; capability-registry restart persistence — confirmed (SEC-01); `baseHash` omission overwrite — confirmed (SEC-02); atomic-write symlink behavior — does not follow destination symlinks; bidi adversarial table (20 cases) — §7; WCAG contrast computation — §7 |
| Benchmarks (temp dir, repo modules + vendored builds) | PERF-01/02/03/04/05/06/08/09/10 tables |

## Appendix B — Coverage of this audit

Full reads: all `src/main/**` (2,856 lines), `src/preload/index.js`, `src/renderer/app.js` (4,295), `workspace-controller.js`, `bidi.js`/`bidi-dom.js`, markdown pipeline (`trusted.js`, `highlight.js`, `mermaid.js`, `math.js`, `markdown.js`, `export.js`, `callouts.js`), `index.html`, themes/base CSS tokens, `github-tls.js`, `navigation.js`, `protocol*.js`, `capabilities.js`, `document-store.js`, `settings.js`, installer scripts (`installer.nsh`, `setup.iss`, `build-installer.ps1`), `THIRD-PARTY-NOTICES.md`, `PRIVACY.md`, `LICENSE-AUDIT.md`, `CHANGELOG.md`, prior audit (full translation), key e2e specs. Not covered: Playwright e2e lanes (out of scope per plan), packaged-app runtime behavior, actual published release binaries, real screen-reader behavior, NVDA/JAWS.

## Appendix C — Leads investigated and retracted (audit integrity)

1. "Textarea fallback is dead code" — **retracted**: it is the live CM6-failure lane.
2. "129 addEventListener vs 2 remove → listener leak" — **retracted**: all high-frequency listeners die with replaced DOM (PERF-11).
3. "`readVault` blocks the main loop in one sync chunk" — **corrected**: async walk, ~1.3ms sync slices; real issue is cumulative wall-clock + O(N²) churn (PERF-03).
4. "math cap 256KB" — **corrected**: math is 32KB (`limits.js:2`); 256KB is the code cap.
5. "`app.js:911/930` non-literal RegExp" (semgrep) — **retracted**: menu literals; all live `new RegExp` sites escape via `escapeReg`.
6. "Atomic-write symlink TOCTOU" — **disproven** empirically (rename replaces the link; target untouched). The genuinely symlink-following write is the PDF temp file (SEC-04).
7. "`SelfTest.exe` tracked binary" / "dist, .claude, .secreports leak into the repo" — **retracted**: all git-ignored, absent from history.
8. "Digit-run `<bdi>` isolation scrambles Latin filenames" — **retracted** after Chromium ground-truth measurement (renders correctly).
9. "Tashkeel slug collision" — **corrected**: no collision; the issue is unstable anchors.
10. "Sepia main-text contrast risk" — **retracted**: all ink pairs pass AA in sepia; only inherited `--gold` fails.
11. "Locale EN/AR key gaps" — **retracted**: catalogs exactly parallel (300/300).
12. "Dominance veto keeps Arabic paragraph RTL when an English word is prepended" — **corrected to the opposite**: the veto fails to fire in the 50–60% band and the block flips LTR (UX-01) — the bug is real but in the other direction.

---

*Audit performed 2026-09-20 by five parallel deep-dive reviews with independent cross-verification of every High finding against source. Report-only: no repository files were modified.*
