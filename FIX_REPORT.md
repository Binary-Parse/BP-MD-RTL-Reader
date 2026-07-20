# BP MD RTL Reader Audit Remediation Report

## Summary

Remediation is in progress for the 60 findings documented in `AUDIT_REPORT.md` (0 Critical, 7 High, 44 Medium, 9 Low). The application is fully offline and local-only; security effort is calibrated to that deployment model while still closing every documented security boundary.

Current status after three verified batches: **25 Fixed, 3 Partially Fixed, 32 In Progress**. Final repository-wide validation remains pending.

## Baseline vs. Post-Fix

| Gate | Baseline | Post-fix |
|---|---|---|
| Starting point | `9649ba37016984cc32ee8b9a67ed4a10af86c77f` on `master`; pre-existing untracked `AUDIT_REPORT.md`, `assets/d7c23e25-0dd9-48a0-a08a-e1867b047600.png`, and `tsconfig.json` | Pending |
| Runtime | Node `v24.18.0`; npm `11.16.0` | Pending |
| Security lint | Exit 0 with 85 warnings | Pending |
| Tests | `npm test`: 1,174 unit and 724 Playwright tests passed after a managed-sandbox `spawn EPERM` rerun in a permitted context | Pending |
| Build | `npm run dist`: Windows x64, ia32, arm64 NSIS and portable outputs passed; Node emitted one `DEP0190` warning | Pending |
| Typecheck | Not configured: no script and no local/global `tsc` | Pending (will remain explicitly N/A unless a finding requires a real type contract) |

## Status Table

| ID | Severity | Status | Files touched | Verified |
|---|---|---|---|---|
| SEC-001 | High | Partially Fixed | installer NSIS/Inno + tests | Y (Inno compile unavailable) |
| SEC-002 | Medium | Partially Fixed | installer NSIS/Inno + tests | Y (Inno compile unavailable) |
| SEC-003 | Medium | Fixed | `main.js`, `preload.js`, capabilities/settings/renderer + tests | Y |
| SEC-004 | Medium | Fixed | document store/main + tests | Y |
| SEC-005 | Medium | Fixed | protocol/main + tests | Y |
| SEC-006 | Medium | Fixed | main/main-logic + tests | Y |
| SEC-007 | Medium | Fixed | Claude workflow + tests | Y |
| SEC-008 | Low | Fixed | macOS entitlements/build config + tests | Y (static on Windows) |
| FE-001 | Medium | In Progress | — | N |
| FE-002 | Medium | In Progress | — | N |
| FE-003 | Medium | In Progress | — | N |
| FE-004 | Medium | In Progress | — | N |
| FE-005 | Medium | In Progress | — | N |
| FE-006 | Medium | In Progress | — | N |
| BE-001 | Medium | Fixed | main/main-logic + tests | Y |
| BE-002 | Medium | Fixed | main/renderer + tests | Y |
| BE-003 | Medium | Fixed | main + tests | Y |
| DATA-001 | High | Fixed | document store/main/renderer + tests | Y |
| DATA-002 | High | Fixed | renderer + tests | Y |
| DATA-003 | High | Fixed | renderer + tests | Y |
| DATA-004 | High | Fixed | main/preload/renderer + tests | Y |
| DATA-005 | Medium | Fixed | renderer + tests | Y |
| DATA-006 | Medium | Fixed | main/renderer + tests | Y |
| DATA-007 | High | Fixed | renderer + tests | Y |
| DATA-008 | High | Fixed | table editor + tests | Y |
| DATA-009 | Medium | Fixed | main/document store + tests | Y |
| DATA-010 | Medium | Fixed | main/preload/renderer + tests | Y |
| DATA-011 | Medium | Partially Fixed | Inno installer + tests | Y (Inno compile unavailable) |
| DATA-012 | Low | Fixed | main/preload/renderer + tests | Y |
| ARCH-001 | Medium | In Progress | — | N |
| ARCH-002 | Medium | Fixed | renderer/session + tests | Y |
| QUAL-001 | Low | Fixed | frontmatter + tests | Y |
| QUAL-002 | Medium | Fixed | tags + tests | Y |
| QUAL-003 | Medium | Fixed | outline/renderer + tests | Y |
| QUAL-004 | Low | Fixed | version/main + tests | Y |
| PERF-001 | Medium | In Progress | — | N |
| PERF-002 | Medium | In Progress | — | N |
| PERF-003 | Medium | In Progress | — | N |
| DEP-001 | Medium | In Progress | — | N |
| DEP-002 | Medium | In Progress | — | N |
| DEP-003 | Low | In Progress | — | N |
| TEST-001 | Medium | In Progress | — | N |
| TEST-002 | Medium | In Progress | — | N |
| TEST-003 | Medium | In Progress | — | N |
| TEST-004 | Medium | In Progress | — | N |
| TEST-005 | Low | In Progress | — | N |
| TEST-006 | Medium | In Progress | — | N |
| TEST-007 | Medium | In Progress | — | N |
| TEST-008 | Medium | In Progress | — | N |
| TEST-009 | Low | In Progress | — | N |
| CONF-001 | Medium | In Progress | — | N |
| CONF-002 | Medium | In Progress | — | N |
| CONF-003 | Medium | In Progress | — | N |
| CONF-004 | Medium | In Progress | — | N |
| DOC-001 | Low | In Progress | — | N |
| DOC-002 | Medium | In Progress | — | N |
| DOC-003 | Medium | In Progress | — | N |
| DOC-004 | Medium | In Progress | — | N |
| DOC-005 | Medium | In Progress | — | N |
| DOC-006 | Low | In Progress | — | N |

## Detailed Remediation Log

### SEC-001 / SEC-002 / DATA-011 — Installer command execution and profile defaults

- **Status:** Partially Fixed (implementation complete; Inno compilation unavailable locally)
- **Severity:** High / Medium / Medium
- **Root cause:** Elevated installers consume registry-controlled uninstall command/location data; Inno silent uninstall defaults to deleting profile data.
- **Change made:** Removed NSIS and Inno registry-command execution entirely. Detection now reads only `DisplayVersion` from the hive matching the selected privilege mode; same-version Inno setup offers Repair/Cancel. Silent uninstall preserves profile data unless `/DELETEUSERDATA` is explicit, and interactive preservation is the default.
- **Files touched:** `installer/installer.nsh:1-38`; `installer/scripts/version_check.pas:206-235`; `installer/setup.iss:139-237`; `tests/installer/installer_security.test.ps1:1-49`; `tests/installer/logic-sim.ps1:117-143`; `tests/installer/registry_mock.test.ps1:1-53`; `tests/installer/registry_mock.test.pas:1-44`; `tests/installer/run-tests.ps1:31-37`; `FIX_REPORT.md`.
- **Verification:** RED: installer tests reported 7 intended failures and 61 passes. GREEN: `pwsh -NoProfile -File tests/installer/run-tests.ps1 -SkipMutation` reported 68 passed, 0 failed, 4 opt-in destructive tests skipped. `npx electron-builder --win nsis --x64` built the real x64 NSIS installer, exit 0. `npm test` reported 1,174 unit and 724 Playwright tests passed. `npm run lint:security` remained at the 85-warning baseline with no errors.
- **Risk & notes:** Risky installer batch. No real installation, uninstallation, registry mutation, or profile deletion was performed. `tests/installer/run-pascal-self-test.ps1` exited 2 because Inno Setup 6.3+ is not installed; therefore the Inno half is not yet dynamically compiler-verified. Removing the “Remove” button differs from the audit recommendation deliberately: it eliminates the elevated registry-command sink instead of attempting brittle command ownership/signature parsing.

### [SEC-003] Persisted settings can mint new filesystem capabilities

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Raw paths persisted in renderer-controlled settings were reused as filesystem authority.
- **Change made:** Added a main-owned, separately persisted opaque capability registry; settings/session/recents and every preload filesystem API now carry only capability IDs and display metadata.
- **Files touched:** `src/main/capabilities.js:18-121`; `main.js:252-445,669-685`; `preload.js:16-34`; `src/main/settings.js:23-106`; `src/renderer/app.js:1640-1999,3137-3244`; `src/renderer/session.js:11-33`; capability/settings/IPC unit and renderer integration tests.
- **Verification:** `npm run test:unit` — 1,196 passed; capability/IPC tests cover restart persistence, corrupt IDs, forged payloads, and native-picker grants. `npm run test:e2e` — 724 passed.
- **Risk & notes:** Existing raw-path recents/sessions are intentionally dropped during schema migration; the user must open those files once to receive new opaque capabilities. This is the smallest safe compatibility break for the documented authority flaw.

### [SEC-004] Vault writes use lexical containment and an over-broad target policy

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Renderer-supplied root/relative paths selected write targets with only lexical containment.
- **Change made:** Writes resolve an exact main-issued document capability, canonicalize the existing parent/target, restrict targets to regular Markdown files, preserve conflict tokens, and commit atomically.
- **Files touched:** `src/main/document-store.js:54-130`; `main.js:395-445`; `preload.js:22-27`; write/document-store/capability tests.
- **Verification:** Focused document-store and `main-writefile` tests plus the 1,196-test unit and 724-test e2e gates.
- **Risk & notes:** Non-Markdown targets and forged IDs now fail closed; intended Markdown save behavior is preserved.

### [SEC-005] The `bpmd://` resolver can follow an in-vault link outside the vault

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Protocol resolution performed a lexical join but did not validate the canonical asset after following links.
- **Change made:** Canonicalizes root and candidate, rejects escapes/non-regular files, allowlists raster MIME/extensions, excludes SVG, and caps assets at 5 MiB before serving.
- **Files touched:** `src/main/protocol.js:19-65`; `main.js:148-175`; protocol tests.
- **Verification:** Protocol/main protocol focused tests and both complete unit/e2e gates passed.
- **Risk & notes:** Oversized, special, SVG, and escaping assets no longer render; ordinary local raster images retain behavior.

### [SEC-006] macOS `open-file` bypasses normal file guards

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The macOS application event read the supplied path directly.
- **Change made:** Routes macOS open-file requests through the shared network-path, extension, size, regular-file, and capability-grant path used by native Open File.
- **Files touched:** `main.js:209-233,680-685`; `src/main-logic.js:17-32`; lifecycle/main-logic tests.
- **Verification:** Focused lifecycle tests and complete unit/e2e gates passed; macOS event behavior is verified with injected Electron/fs mocks (not a real macOS host).
- **Risk & notes:** Offline calibration does not change the guard; network paths and invalid files fail closed.

### [SEC-007] Privileged Claude workflow runs mutable action tags

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** A repository-writing workflow executed mutable action tags and requested an unused OIDC token.
- **Change made:** Pinned checkout to `11bd71901bbe5b1630ceea73d27597364c9af683` and Claude Code Action v1.0.178 to `af0559ee4f514d1ef21826982bed13f7edc3c35e`; removed `id-token: write`. Existing contents/PR/issues write and actions read permissions remain because the declared workflow creates branches/PRs, comments, and investigates checks.
- **Files touched:** `.github/workflows/claude.yml:24-48`; `tests/unit/workflow-security.test.js:1-19`.
- **Verification:** RED: 2 workflow-policy tests failed on mutable tags/OIDC. GREEN: both passed; the full-SHA regex covers every `uses:` reference.
- **Risk & notes:** Supply-chain risk affects development automation, not the offline runtime. No workflow was dispatched. The pinned Claude SHA was resolved from the upstream `v1` release before editing; future upgrades must be explicit reviewed commits.

### [SEC-008] macOS build disables several hardened-runtime protections

- **Status:** Fixed
- **Severity:** Low
- **Root cause:** App and helpers shared broad DYLD, unsigned-memory, and disabled-library-validation exceptions plus app-only file entitlements.
- **Change made:** Removed the three unsupported exceptions; retained JIT; added a separate helper plist containing only JIT; retained user-selected file/bookmark access only on the main app.
- **Files touched:** `build/entitlements.mac.plist:1-13`; `build/entitlements.mac.inherit.plist:1-10`; `package.json:118-121`; `tests/unit/build-config.test.js:30-55`.
- **Verification:** RED: entitlement policy test failed on the shared plist. GREEN: 5 build-config and 2 workflow-security tests passed. Package references and plist contents are statically verified.
- **Risk & notes:** No macOS host/signing identity is available, so signed launch and notarization remain a manual platform verification item. Under the offline threat model this is defense-in-depth; removing unevidenced exceptions is still appropriate.

### [BE-001] Recursive vault enumeration can exceed the 5,000-file cap

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The old walker gathered an unbounded candidate list before applying limits.
- **Change made:** Candidate insertion stops exactly at 5,000 and cumulative bytes are bounded while producing a structured `truncated` result.
- **Files touched:** `main.js:306-390`; `src/main-logic.js:6-32`; IPC/main-logic tests.
- **Verification:** Boundary tests cover exact cap and cumulative truncation; complete unit/e2e gates passed.
- **Risk & notes:** Large local folders now return a partial, explicitly marked snapshot instead of exhausting resources.

### [BE-002] One unreadable entry aborts a vault and failure/empty paths leave stale UI state

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Per-entry errors escaped the scan and renderer state was committed before a successful current scan.
- **Change made:** Skips and counts unreadable/oversized/escaped/special entries; commits active watcher/root only after the newest successful scan; empty scans explicitly clear tree, editor, and welcome state.
- **Files touched:** `main.js:306-390`; `src/renderer/app.js:1673-1705,3030-3075`; IPC/watcher/e2e tests.
- **Verification:** Fault-injected scan tests, watcher reconciliation tests, and complete unit/e2e gates passed.
- **Risk & notes:** The UI can display a partial vault while reporting skipped categories; no real data is modified.

### [BE-003] Window-scoped IPC listeners accumulate when windows are recreated

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Global IPC listeners were installed in each `createWindow()` call.
- **Change made:** Registers sender-scoped window-control listeners once with the other bootstrap IPC handlers.
- **Files touched:** `main.js:235-250`; `tests/unit/main-close-protocol.test.js`; main bootstrap tests.
- **Verification:** Listener-count and ownership tests plus complete unit/e2e gates passed.
- **Risk & notes:** Multiple-window behavior is safer without changing the single-window product flow.

### [DATA-001] Production saves bypass conflict tokens and encoding/EOL preservation

- **Status:** Fixed
- **Severity:** High
- **Root cause:** Production IPC omitted the tested document-store metadata contract.
- **Change made:** Reads return BOM/EOL/final-newline/hash metadata; saves submit base hash and encoding metadata to the atomic store and return refreshed metadata.
- **Files touched:** `src/main/document-store.js:16-130`; `main.js:395-445`; `src/renderer/app.js:1645-1658,1835-1879`; document/write/e2e tests.
- **Verification:** Conflict, BOM, CRLF, final-newline and successful-save tests plus both full gates passed.
- **Risk & notes:** A concurrent on-disk edit now yields a conflict instead of an overwrite.

### [DATA-002] An edit made while Save is pending can be marked clean but remain unsaved

- **Status:** Fixed
- **Severity:** High
- **Root cause:** Save completion cleared dirty state without proving the submitted revision was still current.
- **Change made:** Every editor change increments a revision; save/save-as capture revision and content and clear dirty only if both remain unchanged after the await.
- **Files touched:** `src/renderer/app.js:1835-1933,2055-2062`; renderer save tests.
- **Verification:** Race regression tests and complete unit/e2e gates passed.
- **Risk & notes:** Later edits remain visibly dirty and require a subsequent save.

### [DATA-003] Opening a vault, recent vault, or demo discards dirty work without confirmation

- **Status:** Fixed
- **Severity:** High
- **Root cause:** Workspace replacement routes mutated state without a shared dirty guard.
- **Change made:** Centralized `mayAbandonWorkspace()` and applied it before successful folder, recent, demo, browser-picker, and browser-directory replacements.
- **Files touched:** `src/renderer/app.js:1667-1768,1960-2046`; renderer tests.
- **Verification:** Focused dirty-workspace tests and complete e2e gate passed.
- **Risk & notes:** Canceling leaves the current workspace untouched.

### [DATA-004] Native window-close routes bypass dirty-document confirmation

- **Status:** Fixed
- **Severity:** High
- **Root cause:** Frameless/native close directly closed the BrowserWindow.
- **Change made:** Main prevents unapproved close and requests renderer confirmation; renderer checks dirty state, flushes settings, then sends a one-time close approval.
- **Files touched:** `main.js:237-242,590-601`; `preload.js:13,43`; `src/renderer/app.js:2827-2835`; close-protocol tests.
- **Verification:** Native close/prevent/approve/settings tests and complete unit/e2e gates passed.
- **Risk & notes:** Forced OS termination cannot guarantee a renderer round-trip; ordinary native and custom titlebar close routes now share the confirmation path.

### [DATA-005] Closing a tab removes the file from the vault inventory

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Tab closure spliced the only collection used as the vault inventory.
- **Change made:** Vault snapshots retain inventory records and track independent `open` state; closing a tab marks it closed while tree/search/tags keep the file, and selecting it reopens the tab.
- **Files touched:** `src/renderer/app.js:1190-1225,1645-1658`; watcher/tab integration tests.
- **Verification:** Unit/e2e gates passed, including a real background-tab conflict regression.
- **Risk & notes:** This is a surgical state split within existing file records rather than an unrelated renderer rewrite.

### [DATA-006] A stale watcher read can merge one vault into another

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Asynchronous watcher re-reads lacked stable vault identity/generation checks.
- **Change made:** Main emits opaque vault ID plus generation; renderer validates both before and after the awaited read.
- **Files touched:** `main.js:306-390`; `src/renderer/app.js:3030-3075`; watcher tests.
- **Verification:** Stale/different-vault tests and full unit/e2e gates passed.
- **Risk & notes:** Stale results are silently discarded.

### [DATA-007] Delayed startup restoration can overwrite work begun after launch

- **Status:** Fixed
- **Severity:** High
- **Root cause:** Restore committed after its asynchronous read without checking intervening user intent.
- **Change made:** Captures a workspace epoch and abandons restore if the epoch changes or dirty work exists before commit.
- **Files touched:** `src/renderer/app.js:1641-1672,3226-3244`; session unit/e2e tests.
- **Verification:** Restore/user-intent regressions and complete unit/e2e gates passed.
- **Risk & notes:** Restoration remains best-effort; explicit user actions always win.

### [DATA-008] Table editing corrupts escaped pipes and edge-pipe-less tables

- **Status:** Fixed
- **Severity:** High
- **Root cause:** Plain `split('|')` lost escape and source-span information and always rewrote edge pipes.
- **Change made:** Added escape-aware tokenization with exact cell spans/caret mapping and preserves the row's leading/trailing pipe style.
- **Files touched:** `src/renderer/table-edit.js:15-139`; `tests/unit/table-edit.test.js`.
- **Verification:** 21 focused table tests and complete unit/e2e gates passed.
- **Risk & notes:** Existing table formatting style is preserved.

### [DATA-009] PDF export overwrites the final destination non-atomically

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** PDF bytes were written directly to the chosen destination.
- **Change made:** Writes a sibling temporary file and atomically renames it to the destination, with best-effort temp cleanup.
- **Files touched:** `src/main/document-store.js:69-83`; `main.js:461-493`; PDF export tests.
- **Verification:** Atomic write/rename/failure tests and complete unit gate passed.
- **Risk & notes:** No export was run against user data.

### [DATA-010] Save after native Open File downloads a copy instead of updating the original

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Standalone native files lacked a durable save authority in renderer state.
- **Change made:** Native Open File grants an exact document capability; normal Save writes through it, while native Save As grants the newly selected target.
- **Files touched:** `main.js:271-304,395-445`; `preload.js:20-27`; `src/renderer/app.js:1773-1933`; IPC/save tests.
- **Verification:** Native-open/save/save-as unit tests and complete e2e gate passed.
- **Risk & notes:** Browser-only files retain browser picker/download behavior.

### [DATA-012] Debounced settings writes are not flushed or rejection-handled

- **Status:** Fixed
- **Severity:** Low
- **Root cause:** Fire-and-forget debounce could outlive close and leave unhandled promise rejection.
- **Change made:** Centralized settings snapshots, catches sync/async write failures, cancels the debounce, and awaits a final flush before approved close.
- **Files touched:** `src/renderer/app.js:3137-3172,2827-2835`; close/settings tests.
- **Verification:** Rejection and close-flush tests plus complete unit/e2e gates passed.
- **Risk & notes:** Persistence remains best-effort on forced process termination.

### [ARCH-002] One mutable collection conflates vault inventory, open tabs, search, and session state

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Removing a tab removed the only inventory record and session serialized every inventory item as open.
- **Change made:** Introduced explicit per-record inventory/open state; tab rendering/session use open records while tree/search/tags retain the full inventory.
- **Files touched:** `src/renderer/app.js:1190-1225,1645-1658`; `src/renderer/session.js:17-23`; tab/session/watcher tests.
- **Verification:** Full unit/e2e gates passed.
- **Risk & notes:** Kept the change local to the documented conflation instead of rewriting the renderer state architecture.

### [QUAL-001] Front-matter parsing destroys nesting and can promote nested direction keys

- **Status:** Fixed
- **Severity:** Low
- **Root cause:** Trimming every line promoted indented nested YAML keys to the top-level flat map.
- **Change made:** Defines and enforces a deliberately flat metadata grammar: indented YAML lines are ignored and can never become document directives.
- **Files touched:** `src/renderer/frontmatter.js:8-25`; RTL/frontmatter tests.
- **Verification:** Focused RTL moat tests and complete unit/e2e gates passed.
- **Risk & notes:** This deliberately differs from adding a YAML dependency; the application only consumes flat scalar keys, so refusing nested syntax is smaller and safer.

### [QUAL-002] Reserved tag names can crash tag aggregation

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Plain-object accumulation treated inherited names such as `constructor` as prior values.
- **Change made:** Accumulates with `Map` and converts to a data object only at the API boundary.
- **Files touched:** `src/renderer/tags.js:15-40`; tag tests.
- **Verification:** Reserved-name regressions and complete unit/e2e gates passed.
- **Risk & notes:** Public result shape remains an object.

### [QUAL-003] Outline source mapping misses Setext headings and can jump to the wrong location

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Renderer rescanned only ATX headings and matched duplicate text heuristically.
- **Change made:** Added an exact source-position scanner for ATX and Setext headings, skipping fenced code, and wired editor navigation to those ordered positions.
- **Files touched:** `src/renderer/outline.js:8-37`; `src/renderer/app.js:1398-1418`; outline tests.
- **Verification:** Setext/duplicate/offset tests and complete unit/e2e gates passed.
- **Risk & notes:** Existing slug/outline output remains unchanged; only source jump mapping changes.

### [QUAL-004] Update version comparison is not SemVer-correct

- **Status:** Fixed
- **Severity:** Low
- **Root cause:** The old parser discarded prerelease semantics and coerced malformed segments to zero.
- **Change made:** Implemented strict SemVer 2 precedence (including prerelease/build rules) and returns a typed `invalid-version` response for malformed release metadata.
- **Files touched:** `src/main/version.js:1-46`; `main.js:498-520`; version/update tests.
- **Verification:** 12 focused version/update tests and complete unit/e2e gates passed.
- **Risk & notes:** Differs from adding a SemVer package to avoid dependency churn for one comparison; the narrow parser is fully tested and rejects instead of coercing.

## Deferred & Not Applicable

None classified at this stage.

## New observations

None at this stage.

## Commit map

- `67c1579` — SEC-001, SEC-002, DATA-011 installer remediation.
- `b094561` — SEC-003 through SEC-006; BE-001 through BE-003; DATA-001 through DATA-010 and DATA-012; ARCH-002; QUAL-001 through QUAL-004.
- Workflow/macOS hardening batch — commit pending immediately after this report update.
