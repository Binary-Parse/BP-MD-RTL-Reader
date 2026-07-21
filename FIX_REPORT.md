# BP MD RTL Reader Audit Remediation Report

## Summary

This report covers all 60 findings documented in `AUDIT_REPORT.md` (0 Critical, 7 High, 44 Medium, 9 Low). The application is fully offline and local-only; security effort was calibrated to that deployment model while still closing every documented security boundary.

Remediation is **60 Fixed, 0 Partially Fixed, 0 Deferred, 0 Not Applicable**. All documented findings have complete source remediations, and every configured final validation gate passes.

| Status | Critical | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|
| Fixed | 0 | 7 | 44 | 9 | 60 |
| Partially Fixed | 0 | 0 | 0 | 0 | 0 |
| Deferred | 0 | 0 | 0 | 0 | 0 |
| Not Applicable | 0 | 0 | 0 | 0 | 0 |

## Baseline vs. Post-Fix

| Gate | Baseline | Post-fix |
|---|---|---|
| Starting point | `9649ba37016984cc32ee8b9a67ed4a10af86c77f` on `master`; follow-up completion work began at `4481f412cb999ca4b6272eeb6fe191edd3a539fd`; pre-existing untracked `AUDIT_REPORT.md`, `assets/d7c23e25-0dd9-48a0-a08a-e1867b047600.png`, and `tsconfig.json` | Final source/test configuration at `880b21f`; all three pre-existing untracked files remain untouched and uncommitted |
| Runtime | Node `v24.18.0`; npm `11.16.0` | Same Node/npm versions |
| Security lint | Exit 0 with 85 warnings over the narrower baseline scope | Exit 0; exact reviewed 169-finding fingerprint over expanded runtime/tooling/config/HTML scope; 0 new or moved findings |
| Tests | `npm test`: 1,174 unit and 724 browser Playwright tests passed after a managed-sandbox `spawn EPERM` rerun in a permitted context | Final `npm test`: 1,312/1,312 unit, 706/706 browser Playwright, and 3/3 production-Electron tests passed |
| Build | `npm run dist`: Windows x64, ia32, arm64 NSIS and portable targets passed; Node emitted one `DEP0190` warning | `npm run dist` passed for x64/ia32/arm64 and produced the multi-architecture NSIS/portable outputs; 3/3 architecture-specific `app.asar` archives passed inspection; checksums were generated for 9 release executables, including the verified Inno artifact |
| Typecheck | Not configured: no script and no local/global `tsc` | N/A: still no typecheck script and no local/global `tsc`; the pre-existing untracked `tsconfig.json` was not treated as project configuration |
| Coverage | Not separately captured at baseline | Fresh `npm run coverage`: unit 95.76% statements / 90.14% branches / 96.43% functions / 97.05% lines; renderer 88.36% statements / 76.43% functions with required-source completeness; merged 91.35% statements / 95.93% branches / 87.46% functions / 93.29% lines |
| Mutation | Not separately captured at baseline | Fresh `npm run test:mutation`: 6,642 mutants across 48 files; 86.49% overall; all 48 T1/T2/T3 per-file floors passed |
| Installer/security/provenance | Not separate baseline gates | Pester 74 passed / 0 failed / 4 destructive state checks skipped; all 80 installer mutants killed; compiled Pascal self-test 23/23; real production Inno build passed; offline `npm audit` found 0 vulnerabilities; exact vendor bytes and license inventory passed |

**No-regression conclusion:** every baseline gate that passed also passes at the final source state. The exact top-level `npm test`, security lint, coverage, mutation, Windows package, package-content, verified Inno, Pester/Pascal, vendor, license, and offline dependency-audit gates all exited 0. The first historical final `npm test` run exposed one stale RTL/ink golden after intentional contrast/icon changes; the actual/expected/diff images were reviewed, only that golden was regenerated, and subsequent complete suites—including the final 1,312 + 706 + 3 run—passed.

## Status Table

| ID | Severity | Status | Files touched | Verified |
|---|---|---|---|---|
| SEC-001 | High | Fixed | installer NSIS/Inno + tests | Y |
| SEC-002 | Medium | Fixed | installer NSIS + tests | Y |
| SEC-003 | Medium | Fixed | `main.js`, `preload.js`, capabilities/settings/renderer + tests | Y |
| SEC-004 | Medium | Fixed | document store/main + tests | Y |
| SEC-005 | Medium | Fixed | protocol/main + tests | Y |
| SEC-006 | Medium | Fixed | main/main-logic + tests | Y |
| SEC-007 | Medium | Fixed | Claude workflow + tests | Y |
| SEC-008 | Low | Fixed | macOS entitlements/build config + tests | Y (static on Windows) |
| FE-001 | Medium | Fixed | renderer markup/app + accessibility/browser tests | Y |
| FE-002 | Medium | Fixed | bidi/renderer styles + unit/browser tests | Y |
| FE-003 | Medium | Fixed | callouts/bidi/styles + accessibility tests | Y |
| FE-004 | Medium | Fixed | export/app + unit/browser tests | Y |
| FE-005 | Medium | Fixed | editor preview guards/widgets + unit tests | Y |
| FE-006 | Medium | Fixed | responsive/motion styles/app + browser tests | Y |
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
| DATA-011 | Medium | Fixed | Inno installer + tests | Y |
| DATA-012 | Low | Fixed | main/preload/renderer + tests | Y |
| ARCH-001 | Medium | Fixed | renderer styles/controllers + main IPC/window controllers | Y |
| ARCH-002 | Medium | Fixed | renderer/session + tests | Y |
| QUAL-001 | Low | Fixed | frontmatter + tests | Y |
| QUAL-002 | Medium | Fixed | tags + tests | Y |
| QUAL-003 | Medium | Fixed | outline/renderer + tests | Y |
| QUAL-004 | Low | Fixed | version/main + tests | Y |
| PERF-001 | Medium | Fixed | renderer tabs/app + browser tests | Y |
| PERF-002 | Medium | Fixed | search/app + unit/browser tests | Y |
| PERF-003 | Medium | Fixed | renderer math/highlight/limits + unit tests | Y |
| DEP-001 | Medium | Fixed | package/lock, vendor sync/manifest/assets/licenses + tests | Y |
| DEP-002 | Medium | Fixed | package allowlist, notices/licenses + tests | Y |
| DEP-003 | Low | Fixed | package/lock + audit/vendor/unit/browser checks | Y |
| TEST-001 | Medium | Fixed | Electron config/runtime spec, main bootstrap + CI | Y |
| TEST-002 | Medium | Fixed | renderer manifest/collector/config + CI | Y |
| TEST-003 | Medium | Fixed | coverage wrappers/metadata/merge/config + CI | Y |
| TEST-004 | Medium | Fixed | production IPC security spec | Y |
| TEST-005 | Low | Fixed | fast-check production property tests | Y |
| TEST-006 | Medium | Fixed | axe tests + accessible theme/control styles | Y |
| TEST-007 | Medium | Fixed | performance/click outcome tests | Y |
| TEST-008 | Medium | Fixed | package matrix, verification/checksum scripts | Y (CI matrix static; Windows package local) |
| TEST-009 | Low | Fixed | mutation tiers/locale logic + focused tests | Y |
| CONF-001 | Medium | Fixed | ESLint config, exact reviewed baseline/runner + tests | Y |
| CONF-002 | Medium | Fixed | CI checkout + Gitleaks history invocation | Y |
| CONF-003 | Medium | Fixed | CI pinned Gitleaks version/SHA-256 verification | Y |
| CONF-004 | Medium | Fixed | pinned compiler/payload policies, deterministic build staging + tests | Y |
| DOC-001 | Low | Fixed | README/build/agent truth + consistency test | Y |
| DOC-002 | Medium | Fixed | workflow documentation + consistency test | Y |
| DOC-003 | Medium | Fixed | privacy/security/changelog/network disclosures | Y |
| DOC-004 | Medium | Fixed | user guide/changelog behavior contract | Y |
| DOC-005 | Medium | Fixed | canonical data map + installer messaging | Y |
| DOC-006 | Low | Fixed | contributor globs, generated license inventory + CI | Y |

## Detailed Remediation Log

### [SEC-001] Elevated installers execute user-writable registry commands

- **Status:** Fixed
- **Severity:** High
- **Root cause:** Both elevated installer paths treated uninstall command strings from registry metadata as executable instructions.
- **Change made:** Removed NSIS and Inno registry-command execution entirely. Detection reads only `DisplayVersion` from the hive matching the selected privilege mode; same-version Inno setup now offers Repair/Cancel and never launches an installed uninstall string. This intentionally differs from the recommendation: deleting the command sink is safer and smaller than attempting brittle parsing, ownership, and signature checks on an arbitrary command line.
- **Files touched:** `installer/installer.nsh:1-37`; `installer/scripts/version_check.pas:185-218`; `installer/setup.iss:133-190,228-263`; `installer/build-policy.ps1:1-146`; `installer/toolchain-policy.json:1-6`; `tests/installer/installer_security.test.ps1:1-126`; `tests/installer/logic-sim.ps1:117-143`; `tests/installer/registry_mock.test.ps1:1-61`; `tests/installer/registry_mock.test.pas:1-44`; `tests/installer/run-pascal-self-test.ps1:1-55`; `tests/installer/run-tests.ps1:31-37`.
- **Verification:** Verified by Pester/standalone Pascal-model tests that reject `ExecWait`, `UninstallString`, and `QuietUninstallString` and exercise Repair/Cancel version behavior; the final Pester suite passed 74 with 4 destructive machine-state checks intentionally skipped, all 80 installer mutants were killed, and the compiled Pascal self-test passed 23/23. The exact trusted Inno Setup 6.3.3 compiler then compiled the complete production installer successfully.
- **Risk & notes:** Risky installer/toolchain work was isolated in dedicated commits. No real install/uninstall or registry mutation was performed. Compilation exercises the actual Inno source and included Pascal scripts without touching installed application state.

### [SEC-002] Registry-controlled install location reaches elevated PowerShell source

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The custom NSIS flow forwarded a registry-derived install location into electron-builder's elevated uninstall path, where it could reach generated PowerShell source.
- **Change made:** Removed all registry-sourced uninstall command/location handling from the NSIS include. The installer no longer passes a registry-derived `_?=` location or invokes a prior uninstall command; profile cleanup is confined to the current uninstaller's fixed application profile target.
- **Files touched:** `installer/installer.nsh:1-37`; `tests/installer/installer_security.test.ps1:89-108`.
- **Verification:** Static Pester assertions reject executable registry values, `ExecWait`, and forwarded uninstall locations; a real x64 electron-builder NSIS installer and the full Windows packaging matrix built successfully.
- **Risk & notes:** The exact tainted source-to-sink chain was removed rather than filtered. This finding is NSIS-specific; the real multi-architecture NSIS artifact built successfully, so the separate unavailable Inno toolchain does not limit its status.

### [DATA-011] Inno uninstall defaults can silently delete profile data

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Silent and default interactive uninstall choices selected destructive application-profile cleanup.
- **Change made:** Both Windows installers now preserve the application profile by default. Deletion requires an explicit `/DELETEUSERDATA` switch for unattended removal or an affirmative interactive choice; prompts distinguish settings/recent paths/grants/logs from Markdown files stored elsewhere.
- **Files touched:** `installer/installer.nsh:15-31`; `installer/setup.iss:228-263`; `installer/scripts/cleanup.pas:1-49`; `tests/installer/installer_security.test.ps1:111-125`; `tests/installer/logic-sim.ps1:117-143`; `docs/PRIVACY.md:15-29`; `docs/USER_GUIDE.md:194-211`.
- **Verification:** Installer tests assert preserve-by-default and explicit deletion semantics; Pester logic simulations cover silent, interactive, and explicit-delete plans. A failing real Inno compile exposed the unsupported `CmdLineParamExists` call; a focused failing Pester contract was added, the parser was replaced with `ParamCount`/`ParamStr`/`CompareText`, and the final 74-pass Pester suite, 80/80 installer mutation run, 23/23 compiled Pascal self-test, and real production compile all passed. No destructive uninstall was run against real data.
- **Risk & notes:** This intentionally changes the unsafe audited default while preserving an explicit removal option. Existing externally stored Markdown is never an installer cleanup target. Verification compiles the path but deliberately does not execute an uninstall against real data.

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

### [FE-001] Generated controls and file tree violate keyboard/ARIA patterns

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Dynamic navigation used click-only generic elements and incomplete ARIA ownership/focus patterns.
- **Change made:** Converted search cards, tabs, outline entries, tags, recents, heading items, and palette options to native controls; added a valid tablist/listbox/combobox/tree structure, accessible labels/names, tab Delete/arrow behavior, tree roving focus, palette active-descendant state, and root locale metadata.
- **Files touched:** `index.html:174-181,1852-1854,1924-2002,2051-2100`; `src/renderer/app.js:998-1002,1109-1140,1204-1259,1508-1694,2024-2048,2849-2917`; `tests/accessibility.spec.js:1-137`; `tests/audit-remediation.spec.js:1-61`.
- **Verification:** Full unit gate passed (68 files, 1,221 tests). Accessibility suite passed 10/10. Focused UI contract suite passed 5/5. The wider browser regression set passed 152/153 before one intentionally stale `lang="ar"` assertion was corrected; the corrected RTL suite passed 12/12.
- **Risk & notes:** Native button conversions retain existing CSS and click behavior. Tab close remains pointer-accessible via its visual affordance and keyboard-accessible via Delete/Backspace on the selected tab, avoiding an invalid nested-button tab pattern.

### [FE-002] Bidi heuristics conflate script membership with strong direction and overwrite language

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Script membership treated digits/marks as strong RTL characters, omitted RTL scripts, and reused `lang` as a font-selection hook.
- **Change made:** Direction now requires a Unicode letter in an expanded RTL script set; neutral digits/marks inherit direction. Author `lang` is preserved, Arabic-script font selection uses `data-script="arabic"`, forced callout direction participates in the bidi pass, and UI locale updates root `lang`.
- **Files touched:** `src/renderer/bidi.js:7-68`; `src/renderer/bidi-dom.js:19-53`; `src/renderer/app.js:998-1002`; `index.html:1123-1139`; bidi unit/browser tests.
- **Verification:** Focused bidi tests passed within the 158-test renderer gate; full unit gate passed; corrected `tests/rtl-perline.spec.js` passed 12/12, including Arabic typography and export direction.
- **Risk & notes:** This deliberately stops inventing Arabic language metadata for Persian/Urdu content. Existing author-provided language remains available to screen readers and spellcheckers.

### [FE-003] Callouts have direction, semantic, and contrast defects

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Generic wrappers, visual-only type cues, independent title direction, and type color on low-contrast backgrounds weakened semantics and readability.
- **Change made:** Callouts are semantic `aside role="note"` elements with type-preserving accessible labels; title direction inherits the wrapper; forced document direction applies to the whole callout; title text uses theme foreground while the type color is confined to the icon/border.
- **Files touched:** `src/renderer/callouts.js:52-99`; `src/renderer/bidi-dom.js:21-53`; `index.html:1152-1171`; callout unit and accessibility tests.
- **Verification:** Callout unit tests passed; all three shipped themes pass the new scoped zero-contrast-violation axe gate; full accessibility suite passed 10/10.
- **Risk & notes:** Custom titles retain their visual text while the accessible label includes both localized type and custom title.

### [FE-004] HTML export loses direction/feature parity and can load remote resources

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Export collapsed forced LTR into auto, omitted live transforms, and generated standalone HTML without a network-denying policy.
- **Change made:** Replaced the Boolean direction option with `auto|rtl|ltr`; preserves a valid front-matter language; runs callout, code-highlight, math, bidi, and optional asynchronous Mermaid transforms; neutralizes non-data media and nonfunctional vault wikilinks; and always embeds a CSP denying network/object/form/base access. Both HTML and PDF use the same asynchronous builder.
- **Files touched:** `src/renderer/export.js:1-107`; `src/renderer/app.js:22,863-915`; `tests/unit/export.test.js:1-131`; `tests/rtl-perline.spec.js:125-135`; `docs/USER_GUIDE.md` documentation update remains in the documentation batch.
- **Verification:** Export/typography unit gate passed 26/26; full unit gate passed; RTL/export browser suite passed 12/12. Mermaid serialization, forced LTR, callouts, highlighting, CSP, language preservation, and media neutralization have direct tests.
- **Risk & notes:** Non-embedded images become explicit text placeholders, which is safer and more truthful than a nominally self-contained artifact that fetches later. This follows the audit's allowed “inline or neutralize” path without adding filesystem reads to export.

### [FE-005] Editor previews use raw regex parsing and mouse-only wikilink widgets

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Custom preview regexes ignored Markdown syntax context/escapes, and wikilink widgets were pointer-only anchors without link mechanics.
- **Change made:** Added one shared syntax-tree guard that rejects code/comment/escape/error ancestors; applied it to custom marks, math, and wikilinks; added escape checks and math bounds; and made wikilinks focusable named anchors with href plus Enter/Space activation and consistent pointer prevention.
- **Files touched:** `src/renderer/editor/syntax-guards.js:1-20`; `src/renderer/editor/inline-marks-preview.js:10-45`; `src/renderer/editor/math-preview.js:12-76`; `src/renderer/editor/wikilink-preview.js:16-73`; focused editor unit tests.
- **Verification:** RED: missing guard and escaped-mark tests failed as intended. GREEN: 39 focused editor tests and the complete 1,221-test unit gate passed.
- **Risk & notes:** Regexes remain only for app-specific constructs that the Markdown grammar does not parse; syntax-tree eligibility now controls where those matches may become decorations.

### [FE-006] Responsive and motion accommodations are incomplete

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Fixed one-row chrome lacked a toolbar overflow strategy, narrow grid overrides conflicted, and motion ignored user preference.
- **Change made:** Made the editor toolbar horizontally scrollable with nonshrinking controls, added specific panel-state grid rules, collapses nonessential titlebar brand/search text at 800 px, applies a global reduced-motion override, and chooses non-smooth outline scrolling when reduced motion is requested.
- **Files touched:** `index.html:780-797,1704-1733`; `src/renderer/app.js:1532-1550`; `tests/audit-remediation.spec.js:43-61`.
- **Verification:** Browser contracts verify 760 px containment/toolbar overflow and reduced transition duration; 5/5 focused UI tests passed.
- **Risk & notes:** Controls remain available in a horizontal toolbar rather than being hidden at narrow widths.

### [ARCH-001] Renderer and UI monoliths concentrate unrelated responsibilities

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** High-level DOM, state, persistence, rendering, and lifecycle orchestration remain concentrated in large entry files.
- **Change made:** Extracted shared renderer resource limits and Markdown syntax guards, expanded the dedicated export pipeline into a deterministic sync/async boundary, and replaced full-tab rerendering with a narrow state update. The 1,748-line inline application stylesheet was moved byte-for-byte into ordered `base`, `themes`, `components`, and `responsive` stylesheets (only font URLs changed to remain relative), and those files were added to the packaged payload. File/vault open-save-recent-session orchestration is now owned by an injected workspace controller, and persistence/debounce/restore policy is owned by an injected settings controller. Privileged dialog/file/settings/export handlers and vault-watcher state now live in an injected IPC controller; BrowserWindow security options, close protocol, navigation, and native menu wiring live in an injected window controller. `app.js` and `main.js` retain composition/lifecycle roles and delegate across explicit boundaries.
- **Files touched:** `index.html:13-24`; `package.json:42-51`; `src/renderer/styles/base.css:1-79`; `src/renderer/styles/themes.css:1-38`; `src/renderer/styles/components.css:1-1575`; `src/renderer/styles/responsive.css:1-56`; `src/renderer/workspace-controller.js:1-530`; `src/renderer/settings-controller.js:1-150`; `src/renderer/app.js:1-2938` (controller integration at `27-28,104,1735-1762,2819,2875-2925`); `src/main/ipc-controller.js:1-486`; `src/main/window-controller.js:1-131`; `main.js:1-303` (imports/composition at `19-20,177-218`); `config/renderer-coverage-files.json:1-62`; `config/mutation-tiers.json:1-64`; `stryker.config.json:1-69`; `vitest.mutation.config.js:1-16`; `config/security-lint-baseline.json:1-10`; `scripts/rem-convert.mjs:1-44`; `AGENTS.md:45-66,194-204,327-344`; `docs/BUILD.md:37-44,144-152`; `tests/unit/architecture-boundaries.test.js:1-41`; `tests/unit/main-controller-boundaries.test.js:1-39`; `tests/unit/workspace-controller.test.js:1-787`; `tests/unit/settings-controller.test.js:1-288`; `tests/unit/fonts-selfhost.test.js:1-69`; `tests/unit/typography-rem.test.js:1-79`; `src/renderer/limits.js:1-23`; `src/renderer/editor/syntax-guards.js:1-20`; `src/renderer/export.js:1-107`.
- **Verification:** A read-only byte comparison against the pre-extraction inline CSS passed after normalizing only the required relative font path. Architecture/font/typography/CSP contracts passed 23/23; focused workspace/settings tests passed 39/39; selected workspace/settings browser flows passed 48/48. Final `npm test` passed 1,312 unit, 706 browser, and 3 production-Electron tests. Fresh unit coverage passed at 95.76% statements, 90.14% branches, 96.43% functions, and 97.05% lines; merged coverage passed at 91.35% statements and 87.46% functions. Full mutation testing covered 6,642 mutants across 48 files and passed at 86.49% overall: settings 95.50%, workspace 75.00% (T2 floor 75%), IPC 87.70%, and window 92.54% (T1 floor 85%). Security lint retained its exact reviewed 169-finding gate with zero new or moved findings.
- **Risk & notes:** Cascade order, selectors, declarations, CSP, inline SVG markup, opaque document/vault capabilities, restore race protection, save conflicts, native close approval, watcher teardown, PDF offline isolation, and BrowserWindow sandbox options are preserved. `main.js` is 303 lines after extraction versus 718 immediately before this batch; `app.js` is 2,938 lines after extraction versus approximately 3,400 before the renderer-controller batch. The mutation-only Vitest config excludes only two raw-source meta-tests (`vendor-provenance` byte equality and `main-controller-boundaries` line count) because Stryker rewrites those files in its sandbox; the ordinary unit, coverage, and CI suites still execute both tests.

### [PERF-001] Every edit rebuilds all tabs across the full vault inventory

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** `applyEditorInput` called the full inventory-backed `renderTabs()` on each keystroke.
- **Change made:** Added `updateTabState(idx)` and changed the edit hot path to mutate only the active tab's dirty/conflict/title/marker state while preserving the stable tab node.
- **Files touched:** `src/renderer/app.js:1204-1259,2147-2155`; `tests/audit-remediation.spec.js:24-31`.
- **Verification:** Browser test retains an object reference to the active tab, types in CodeMirror, proves node identity is unchanged, and observes the dirty class; 5/5 UI contract tests passed.
- **Risk & notes:** Full rerenders remain for structural tab operations, where they are appropriate; only the keystroke path changed.

### [PERF-002] Vault-wide search rescans all content on every input event

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Every input event synchronously lowercased every file and rendered an unbounded result list.
- **Change made:** Added a 150 ms generation-checked debounce, caches normalized name/content per unchanged file object, retains the five-snippet per-file cap, and caps total result cards at 100.
- **Files touched:** `src/renderer/search.js:6-49`; `src/renderer/app.js:1089-1158,3050`; `tests/unit/search.test.js:20-99`.
- **Verification:** Direct 150-file cap test passes; all sidebar integration/browser regressions passed within the 152/153 run (the sole failure was unrelated stale bidi metadata), and full unit gate passed.
- **Risk & notes:** A worker/index would add significant lifecycle complexity for an offline 100 MiB-bounded store; caching, debounce, generation, and result bounds remove the documented interaction-path amplification without that overreach.

### [PERF-003] Large math and code inputs lack per-expression/per-block bounds before synchronous preprocessing

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** A single token could allocate amplified hex/array intermediates and enter synchronous KaTeX/highlight work up to the whole-file cap.
- **Change made:** Added allocation-free UTF-8 byte measurement and 32 KiB math/256 KiB code limits before preprocessing; oversized constructs remain literal/skipped; hex decoding writes directly into one pre-sized typed array; live math preview shares the expression limit.
- **Files touched:** `src/renderer/limits.js:1-23`; `src/renderer/math.js:14-45`; `src/renderer/highlight.js:10-29`; `src/renderer/editor/math-preview.js:12-31`; focused math/highlight tests.
- **Verification:** Direct 40 KiB math and 300 KiB code tests prove KaTeX/highlighter are not invoked; the original 13 red focused failures became 158/158 green; full unit gate passed.
- **Risk & notes:** Limits are conservative defense-in-depth for local files; source remains visible and editable instead of failing the entire document.

### [DEP-001] Shipped browser libraries are outside lockfile and audit provenance

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Runtime JavaScript, CodeMirror, and inline Lucide symbols were committed as opaque assets without exact package sources or a reproducibility check.
- **Change made:** Added exact source packages to the lockfile, a deterministic vendor synchronizer/checker, a machine-readable source/version/SHA-256 manifest, reproducible CodeMirror and highlight.js builds, direct copies for DOMPurify/KaTeX/marked/Mermaid, and Lucide symbol generation from an explicit name map. Upgraded marked from 18.0.4 to the compatible 18.0.6 patch while preserving the established major versions of the other already-vendored libraries.
- **Files touched:** `package.json:13-16,157-196`; `package-lock.json`; `scripts/sync-vendor.js:1-201`; `scripts/highlight-entry.mjs:1-5`; `assets/vendor/vendor-manifest.json`; generated `assets/vendor/{codemirror,dompurify,highlight,katex,marked,mermaid}/**`; `index.html:1769-2067`; `tests/unit/vendor-provenance.test.js:1-38`.
- **Verification:** `npm run vendor:check` rebuilt/compared all governed assets and reported an exact match; focused provenance tests passed 3/3; full unit suite passed 1,221/1,221; focused smoke/remediation Playwright passed 20/20 after installing Playwright 1.61.1's matching Chromium revision.
- **Risk & notes:** Risky dependency/vendor batch, isolated in its own commit. The first focused browser attempt could not launch because only the old Playwright browser revision was cached; it reached no app code. Installing the exact new revision resolved that environmental failure. No major package upgrade was taken merely to chase “latest.”

### [DEP-002] Packaged applications omit required project and third-party license texts

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The electron-builder allowlist omitted the root license/notices, the font directory contained only a link to OFL-1.1, and runtime bundles lacked their complete license corpus.
- **Change made:** Included `LICENSE` and `THIRD-PARTY-NOTICES.md` explicitly; shipped the official OFL-1.1 text and font copyrights; generated a complete license-text aggregate for the vendored runtime dependency closure; and updated notices with exact source versions and verification commands.
- **Files touched:** `package.json:41-47`; `THIRD-PARTY-NOTICES.md:6-63`; `assets/vendor/THIRD-PARTY-LICENSES.txt`; `assets/vendor/fonts/LICENSES.md:1-21`; `assets/vendor/fonts/OFL-1.1.txt:1-80`; `scripts/sync-vendor.js:140-201`; `tests/unit/vendor-provenance.test.js:23-33`.
- **Verification:** A real `electron-builder --dir --win --x64` package succeeded; listing `dist/win-unpacked/resources/app.asar` proved it contains `LICENSE`, `THIRD-PARTY-NOTICES.md`, `assets/vendor/THIRD-PARTY-LICENSES.txt`, `assets/vendor/fonts/OFL-1.1.txt`, and the vendor manifest. Provenance tests passed 3/3.
- **Risk & notes:** License inclusion affects package contents only. The OFL text was taken from SIL's official OFL 1.1 plaintext; no installed application or user data was touched.

### [DEP-003] Direct development dependencies are stale, ranged, and partially implicit

- **Status:** Fixed
- **Severity:** Low
- **Root cause:** Direct tools used compatible ranges, 19 had newer compatible releases, and Istanbul libraries imported by project scripts were available only transitively.
- **Change made:** Applied controlled compatible updates, pinned every direct dependency to an exact version, declared the two directly imported Istanbul libraries, and added exact packages for vendor provenance. Electron remains on major 42 (updated to 42.7.0) and jscpd remains on major 4 (updated to 4.2.5); breaking majors were neither required by an advisory nor justified for this local remediation.
- **Files touched:** `package.json:157-196`; `package-lock.json`; `tests/unit/vendor-provenance.test.js:35-38`.
- **Verification:** Fresh `npm audit --json` reports 0 vulnerabilities; `npm ls --depth=0 --json` resolves all declared direct packages; the exact-version unit assertion passes; full unit, vendor, focused browser, and x64 package-directory gates pass.
- **Risk & notes:** Risky dependency batch. The initial install summary transiently printed three vulnerabilities while npm reconciled the tree; the post-install authoritative audit is clean. Deprecated transitive packages not selected by project code remain controlled by their upstream tools; no unverified breaking-major migration was introduced.

### [TEST-001] Browser-only tests did not exercise the Electron runtime boundary

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The default Playwright suite loaded `index.html` directly and could not prove BrowserWindow, preload, IPC, native lifecycle, or main-process filesystem composition.
- **Change made:** Added a dedicated production-Electron Playwright configuration and runtime spec that launches `electron .` against a temporary user-data directory, then proves context isolation/sandbox/preload exposure, settings and note persistence, visible startup, and the real renderer-to-main close IPC. The package test command and CI now include this lane; the Electron entry guard keys off `process.versions.electron` so the packaged runtime boots while Node imports remain injectable.
- **Files touched:** `playwright.electron.config.js:1-12`; `tests/electron/runtime-boundary.spec.js:1-88`; `package.json:18-25`; `main.js:710-716`; `.github/workflows/ci.yml:235-266`.
- **Verification:** `npm run test:electron` launched the production app and passed 3/3 tests in 2.3 seconds. Browser-only tests remain as the fast renderer lane.
- **Risk & notes:** Tests use temporary user data and a temporary Markdown file; no real profile or document is mutated. Cross-platform package launch remains represented by native CI runners rather than claimed from Windows alone.

### [TEST-002] Renderer coverage was excluded from the normal CI gate and measured only observed files

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Coverage collected one bespoke spec and silently omitted unobserved renderer modules.
- **Change made:** Added an expected-source manifest covering all 38 renderer JavaScript files, auto-coverage instrumentation for the complete non-visual Playwright suite, completeness validation, aggregate renderer floors, and explicit critical-file floors for `app.js`, `theme-boot.js`, and the CodeMirror adapter. CI runs the collector as part of the combined gate.
- **Files touched:** `config/renderer-coverage-files.json:1-40`; `playwright.config.js:8-69`; `scripts/generate-renderer-coverage.js:1-252`; `.github/workflows/ci.yml:197-233`; `tests/unit/remediation-tooling.test.js:30-32`.
- **Verification:** Fresh final `npm run coverage` merged 26,640 renderer entries from 665 JSON files and reported 88.36% statements / 76.43% functions; critical files were `app.js` 88.12%, `theme-boot.js` 100%, and the CodeMirror adapter 100% statements against 45%, 80%, and 35% floors. The complete ordinary browser suite independently passed 706/706.
- **Risk & notes:** Visual snapshots stay in their reproducible container lane and are intentionally excluded from the long coverage collection; every renderer source is still required in the coverage map.

### [TEST-003] Advertised combined coverage did not combine and tolerated missing/stale inputs

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The merge script treated inputs opportunistically and no command guaranteed both coverage sides came from the same current commit.
- **Change made:** Added commit/timestamp metadata, non-empty and completeness checks, a unit wrapper that corrects Vitest's duplicate-CommonJS overwrite artifact through a direct-module shard, shared thresholds, a mandatory unit→renderer→merge command, and combined statement/function floors.
- **Files touched:** `config/coverage-thresholds.json:1-8`; `scripts/coverage-metadata.js:1-47`; `scripts/run-unit-coverage.js:1-96`; `scripts/merge-coverage.js:1-69`; `vitest.config.js:1-53`; `package.json:20-32`; `tests/unit/remediation-tooling.test.js:34-47`.
- **Verification:** Fresh final `npm run coverage` passed unit coverage at 95.76% statements / 90.14% branches / 96.43% functions / 97.05% lines and the required same-run merge at 91.35% statements / 95.93% branches / 87.46% functions / 93.29% lines. The earlier negative-path check also proved the merge rejects a pre-commit unit artifact.
- **Risk & notes:** The two-pass unit merge differs from the audit recommendation because it addresses a confirmed Vitest 4 CommonJS coverage-overwrite artifact while retaining the unchanged 95/90/95/95 project thresholds; it does not exclude source or relax coverage.

### [TEST-004] Legacy IPC security tests exercised a copied handler

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The suite recreated validation logic in test code, so production-handler drift could pass unnoticed.
- **Change made:** Replaced the copied handler with injected production `bootstrap`, captured the registered IPC callback, and drove malformed payload, size, capability, conflict, and metadata paths through that real callback.
- **Files touched:** `tests/ipc-security.spec.js:1-110`.
- **Verification:** `npx playwright test tests/ipc-security.spec.js` passed 3/3; the test assertions now fail when production handler behavior changes.
- **Risk & notes:** The fake filesystem is confined to the test process and performs no real writes.

### [TEST-005] Property-based tests used hand-written loops and fallback copies

- **Status:** Fixed
- **Severity:** Low
- **Root cause:** Random loops did not shrink failures and some properties targeted duplicate fallback implementations.
- **Change made:** Rewrote the suite with `fast-check` arbitraries against imported production functions for bidi direction, table round-trips, and path/file predicates, with deterministic 30-run budgets.
- **Files touched:** `tests/property-based.spec.js:1-67`.
- **Verification:** Focused Playwright property suite passed 3/3; failures now carry fast-check seeds/counterexamples and shrink through the real implementations.
- **Risk & notes:** The bounded run count keeps the browser suite practical while materially improving counterexample quality.

### [TEST-006] Accessibility tests globally suppressed known serious violations

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Axe exclusions converted known contrast/focus defects into permanent blind spots.
- **Change made:** Removed global suppressions; separated filled-control accent color from text/link accent; corrected paper/ink/sepia muted and status colors; fixed palette/modal semantics and focusability; and made axe assertions report the complete critical/serious result set.
- **Files touched:** `tests/accessibility.spec.js:1-130`; `index.html:28-123,694-718,1250-1320,1614-1655`.
- **Verification:** All 10 accessibility scenarios passed unsuppressed, including every theme, CM6, palette, modal, find bar, and callout contrast.
- **Risk & notes:** Visual colors changed only where the audit identified insufficient contrast; accent-fill preserves the intended warm palette while meeting white-text contrast.

### [TEST-007] Performance and click audits asserted weak proxies

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Timers measured scheduling rather than completed rendering, heap/listener checks lacked GC/outcome evidence, and click sweeps tolerated swallowed exceptions without proving state changes.
- **Change made:** Performance tests now await animation frames and visible layout, measure completed zoom operations, use CDP heap/GC evidence, and verify DOM/listener bounds. Click tests assert command-palette results, backdrop dismissal, representative control outcomes, and zero swallowed click exceptions.
- **Files touched:** `tests/performance.spec.js:1-104`; `tests/click-audit-all.spec.js:1-142`; `tests/focus-trap.spec.js:39-47`; `tests/i18n.spec.js:134-141`.
- **Verification:** Combined performance/click focused run passed 63/63; the corrected focus and bidi assertions passed in a 47-test regression set.
- **Risk & notes:** Thresholds remain generous enough for CI variance but now guard completed work and observable outcomes.

### [TEST-008] Installer and cross-platform package behavior were absent from CI

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** CI ran only Ubuntu tests and never built the declared Windows/macOS/Linux target/architecture matrix or inspected release payloads.
- **Change made:** Added native-runner package jobs that build every configured target and architecture, run non-destructive Windows installer logic tests, inspect every generated `app.asar` for required licenses and forbidden development payloads, generate SHA-256 manifests, and upload verified artifacts. Added exact `@electron/asar` tooling.
- **Files touched:** `.github/workflows/ci.yml:365-422`; `scripts/verify-package-contents.js:1-65`; `scripts/write-artifact-checksums.js:1-43`; `package.json:14-15,169`; `package-lock.json`; `tests/unit/remediation-tooling.test.js:49-54`.
- **Verification:** CI YAML parsed successfully with PyYAML; package-verification unit tests reject forbidden paths; a fresh `npm run dist` built the x64/ia32/arm64 target set as one multi-architecture NSIS plus one multi-architecture portable executable; final `npm run package:verify` inspected 3/3 architecture-specific `app.asar` archives; `npm run package:checksums` recorded 9 executable artifact hashes, including the separately verified Inno installer.
- **Risk & notes:** CI packages are intentionally unsigned when repository signing credentials are absent; the offline threat model does not justify inventing or weakening signing secrets. Native runner builds provide the missing repository-owned gate; signing/notarization remains conditional external release evidence.

### [TEST-009] Mutation tiers were not enforced and locale behavior was excluded

- **Status:** Fixed
- **Severity:** Low
- **Root cause:** One aggregate score could mask a weak trust-boundary file, and executable locale fallback/direction lived beside an excluded translation table.
- **Change made:** Extracted locale behavior into a mutatable module; declared exact non-overlapping T1/T2/T3 file inventories; added a per-file JSON post-processor (85%/75%/60% floors); retained an independent 80% whole-scope floor; added targeted tests for every initially sub-threshold file; and isolated Stryker from the user's unrelated untracked TypeScript config.
- **Files touched:** `src/renderer/locale-logic.js:1-12`; `src/renderer/locale.js:1-8,126-130`; `config/mutation-tiers.json:1-64`; `scripts/check-mutation-tiers.js:1-61`; `stryker.config.json:1-69`; `vitest.mutation.config.js:1-16`; `package.json:26-27`; `tests/unit/main-controller-boundaries.test.js:1-39`; mutation-focused tests in `tests/unit/{main.vitest,capabilities,navigation,protocol,settings,markdown,table-edit,locale,remediation-tooling}.test.js`.
- **Verification:** Final `npm run test:mutation` instrumented 48 files / 6,642 mutants, ran 1,305 initial tests, scored 86.49% overall, and passed all 48 per-file tier checks. Trust-boundary results included main 87.30%, IPC controller 87.70%, window controller 92.54%, preload 100%, and trusted HTML 94.64%; the lowest configured result, workspace controller 75.00%, met its T2 floor exactly.
- **Risk & notes:** Two Stryker workers were restarted after memory exhaustion, but the runner recovered and completed with exit 0. No product-code test or mutant was suppressed: two raw-source meta-tests are excluded only from the instrumented mutation sandbox because Stryker itself changes the bytes/line counts they assert, while normal unit/coverage/CI still run them. Redundant navigation predicates were simplified only where strict equality made them provably equivalent.

### [CONF-001] Security lint passed despite warnings and omitted executed code

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The lint command excluded executed scripts/configuration, used an incomplete CommonJS override, and returned success for every security warning without a zero-growth contract.
- **Change made:** Expanded the scan to first-party runtime code, executed JavaScript/MJS tooling, both Playwright configs, the ESM Vitest config, and HTML; classified CommonJS and ESM files explicitly; promoted DOM-sink rules to errors; and replaced the raw CLI with an exact reviewed finding fingerprint. The baseline records rule counts and review rationale, while the gate fails on a new, removed, moved, reclassified, fatal, or configuration finding rather than silently tolerating drift.
- **Files touched:** `eslint.config.mjs:1-49`; `scripts/run-security-lint.js:1-74`; `config/security-lint-baseline.json:1-19`; `package.json:34`; `playwright.config.js:32`; `tests/unit/remediation-tooling.test.js:12,72-83`.
- **Verification:** `npm run lint:security` passed with the exact 169-finding reviewed fingerprint and reported zero new/moved findings; focused Vitest passed 7/7 remediation-tooling tests, including rejection of both an added and a moved finding.
- **Risk & notes:** The count rose from 85 to 169 because the executable-tooling/configuration scope is now included (61 file-path heuristic findings plus related script heuristics), not because runtime warnings were added. Existing findings remain visible and fail the gate if their identity changes. The file/path warnings are repository-anchored local build/report operations, and DOM sinks were traced to sanitised, escaped, or fixed templates with hostile-content/CSP coverage. This reviewed-baseline approach follows the audit's zero-new-warning option without blanket suppressions.

### [CONF-002] Gitleaks scanned a shallow working tree rather than committed history

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Checkout depth and directory mode could not establish full reachable-history coverage.
- **Change made:** The lint job checks out full history and runs `gitleaks git . --log-opts="--all"` with redaction and a failing exit code.
- **Files touched:** `.github/workflows/ci.yml:49-74`.
- **Verification:** Workflow YAML parsed successfully; command and `fetch-depth: 0` were verified by configuration inspection. CI execution is required for remote history evidence.
- **Risk & notes:** No local history rewrite or secret rotation was performed; the original audit found no visible secret.

### [CONF-003] CI executed an unverified downloaded Gitleaks archive

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** A versioned URL alone did not authenticate downloaded bytes before extraction/execution.
- **Change made:** Pinned Gitleaks 8.30.1 and verifies the Linux x64 release archive against SHA-256 `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` with strict `sha256sum` before extraction.
- **Files touched:** `.github/workflows/ci.yml:67-74`.
- **Verification:** Workflow YAML parsed successfully; the verified checksum step precedes `tar` and execution. The checksum was cross-checked against the published 8.30.1 release assets.
- **Risk & notes:** A checksum pin is deliberately simpler than introducing another privileged action or key-management path for this offline project.

### [CONF-004] Installer build trusted ambient ISCC and an unverified recursive source tree

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The build selected the first `ISCC.exe` on PATH and recursively consumed a caller-selected package directory after checking only one filename.
- **Change made:** Removed PATH discovery and custom source-tree input. The supported build now requires the exact Inno Setup 6.3.3 compiler in a canonical Program Files installation, a valid Authenticode signature from `Open Source Developer, Martijn Laan`, and the committed SHA-256 of the compiler from the attested immutable release; records that identity in the source manifest; builds a fresh x64 Electron directory using the repository-pinned builder; rejects reparse points, missing files, extra files, Electron-version drift, executable metadata drift, and invalid signatures against a committed exact 74-file policy; copies only verified files into a unique clean staging tree; rechecks every SHA-256 after copy; records the source manifest; compiles into a nonce-scoped output directory; verifies size/hash before publishing the stable filename; rechecks the published hash; and cleans only validated scratch paths. The real Pascal self-test similarly compiles/runs in a nonce-scoped temporary directory. Direct `setup.iss` compilation is rejected unless the verified-staging define is supplied. The audit recommendation's version check was implemented as an exact compiler hash because the genuine `ISCC.exe` has no useful Windows file-version resource (`0.0.0.0`); the signed, attested exact-version binary hash is the stronger binding.
- **Files touched:** `installer/build-installer.ps1:1-113`; `installer/build-policy.ps1:1-146` (scratch allowlist at `138-146`); `installer/toolchain-policy.json:1-6`; `installer/source-manifest-policy.json:1-86`; `installer/setup.iss:5-27,96-98`; `tests/installer/installer_security.test.ps1:1-126` (toolchain/output contracts at `20-84`); `tests/installer/run-pascal-self-test.ps1:1-55` (isolated output at `19-55`).
- **Verification:** The official immutable Inno Setup 6.3.3 release asset was SHA-256 checked, Authenticode validated, and verified against its GitHub artifact attestation before installation. Final Pester passed 74 tests with 4 intentionally skipped destructive post-uninstall state checks; all 80 installer mutants were killed; focused tests reject a noncanonical compiler, wrong compiler hash, invalid signature, unlisted staging files, and unsafe scratch deletion. The trusted compiler produced a 23/23 passing Pascal self-test and successfully built the production installer from a freshly verified 74-file payload. The resulting `BP MD RTL Reader Setup.exe` is 107,272,490 bytes with SHA-256 `4C8411918A752243E0345722327530009DCD5900B14DE8AB7B88A84A9A204C86`.
- **Risk & notes:** This was handled as dedicated risky toolchain work. The application payload is intentionally allowed to be unsigned for local builds (`NotSigned` is recorded); invalid signatures are rejected, and any valid application signature must match `Binary Parse`. Repeated compiler runs exposed transient Windows resource-file contention; nonce-scoped production/test outputs prevent reuse of partially scanned executables, and an unchanged retry completed successfully. The app installer was compiled but never executed, so no real application data or install state was mutated. The signed Inno compiler remains installed as explicitly approved; its standalone download remains in `C:\tmp` and is not a repository artifact.

### [DOC-001] Toolchain, test-count, threshold, and coverage-command documentation is stale

- **Status:** Fixed
- **Severity:** Low
- **Root cause:** Volatile counts and configuration facts were copied into prose and drifted from executable scripts and gates.
- **Change made:** Removed unsupported passing-test totals; aligned Node, Playwright, coverage, mutation, viewport, and command descriptions with executable configuration; and added a consistency test for these claims.
- **Files touched:** `README.md:126-151`; `docs/BUILD.md:1-140`; `AGENTS.md:17-41,157-186,227-247`; `tests/unit/docs-consistency.test.js:1-59`.
- **Verification:** Verified by `tests/unit/docs-consistency.test.js` (3/3) and manual comparison to `package.json`, coverage configuration, Playwright configuration, and mutation tier files.
- **Risk & notes:** No runtime behavior changed; documentation avoids future unqualified test-pass counts.

### [DOC-002] Documentation claims security and release workflows that are not present

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** The agent guide described absent workflow files and generalized `ci.yml` controls to a separate, more privileged Claude workflow.
- **Change made:** Documented only committed `ci.yml` and `claude.yml`, including their distinct triggers, permissions, action pinning, and harden-runner coverage; removed nonexistent CodeQL, Scorecard, and release automation claims.
- **Files touched:** `AGENTS.md:118-122,291-320`; `docs/BUILD.md:126-140`; `tests/unit/docs-consistency.test.js:29-42`.
- **Verification:** Both workflow YAML files parsed successfully with PyYAML; the consistency test verifies documented workflow names against the committed directory.
- **Risk & notes:** This corrects assurance claims rather than adding unrelated release features.

### [DOC-003] Absolute no-network claims contradict the explicit update request

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** App-wide privacy prose incorrectly generalized the renderer's no-network CSP to the opt-in main-process update check.
- **Change made:** Preserved the accurate no-telemetry/no-automatic-check/no-renderer-network guarantees and documented the sole explicit update action, its GitHub release-metadata GET, request metadata, and absence of note content or update download.
- **Files touched:** `README.md:107-118`; `docs/PRIVACY.md:6-13,69-91`; `SECURITY.md:1-8`; `CHANGELOG.md:36-41`; `THIRD-PARTY-NOTICES.md:33-41`; `tests/unit/docs-consistency.test.js:44-59`.
- **Verification:** Verified by consistency tests and manual trace from renderer menu action through preload IPC to the fixed main-process update endpoint.
- **Risk & notes:** Calibrated for a local/offline app: no hostile-network architecture was introduced; the existing voluntary request is disclosed precisely.

### [DOC-004] User guide overstates save, session, close, and editor-mode behavior

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** User-facing prose described aspirational or legacy behavior rather than the remediated persistence/session state machine.
- **Change made:** Documented Reading/Edit modes, atomic original-file Save and Save As, conflict handling, dirty-close/workspace prompts, the five-entry recent list, and last-vault/active-note restore boundaries; corrected the changelog accordingly.
- **Files touched:** `docs/USER_GUIDE.md:61-80,173-211`; `CHANGELOG.md:28-35`; `tests/unit/docs-consistency.test.js:44-59`.
- **Verification:** Verified by documentation consistency tests plus the save, conflict, dirty-workspace, close, and session unit/Electron tests added for DATA-001 through DATA-007 and DATA-010.
- **Risk & notes:** Documentation follows implemented behavior; it does not promise restoration of unsaved edits, standalone tabs, or every open tab.

### [DOC-005] Data-location and uninstall guarantees are materially inaccurate

- **Status:** Fixed
- **Severity:** Medium
- **Root cause:** Documentation conflated user-selected Markdown locations with the Electron profile and misstated destructive uninstall defaults.
- **Change made:** Established one consistent data map for external Markdown, roaming settings/logs/profile state, and local cleanup targets; documented preserve-by-default uninstall and `/DELETEUSERDATA`; updated NSIS/Inno/Pascal prompt text to call the target an app profile, never a notes directory.
- **Files touched:** `README.md:103-118`; `docs/PRIVACY.md:15-29`; `docs/USER_GUIDE.md:194-211`; `installer/installer.nsh:15-31`; `installer/setup.iss:227-249`; `installer/scripts/cleanup.pas:1-49`; `tests/unit/docs-consistency.test.js:44-59`.
- **Verification:** Verified by docs consistency tests, installer Pester cleanup-policy assertions, and manual cross-check of every named directory against installer source and Electron settings/log paths.
- **Risk & notes:** No real profile or Markdown data was deleted. A per-machine Inno uninstall can address only the elevated user's profile; that caveat is documented.

### [DOC-006] Contributor and license-inventory documentation is not reproducible

- **Status:** Fixed
- **Severity:** Low
- **Root cause:** Runner ownership was described with an over-broad directory rule, while a stale dependency count had no reproducible source or committed artifact.
- **Change made:** Documented exact Vitest, browser Playwright, Electron Playwright, Pester, Pascal, fixture, and helper ownership; added a deterministic lockfile-only license inventory generator, committed its JSON output and lockfile SHA-256, exposed check/update scripts, and made CI verify both vendor provenance and the license inventory.
- **Files touched:** `CONTRIBUTING.md:18-55`; `THIRD-PARTY-NOTICES.md:33-72`; `scripts/dependency-license-inventory.js:1-56`; `docs/dependency-license-inventory.json:1-29`; `package.json:15-20`; `.github/workflows/ci.yml:58-64`; `tests/unit/docs-consistency.test.js:44-59`.
- **Verification:** `npm run license:inventory` reports 855 non-root lock entries and verifies the committed package-lock SHA-256; `npm run vendor:check` verifies bundled bytes; the docs test passes; CI YAML parses.
- **Risk & notes:** The inventory intentionally reports lockfile entries and unique names separately rather than equating either with installed packages. It surfaces one missing lockfile `license` field (`khroma@2.1.0`) instead of guessing.

## Deferred & Not Applicable

No findings are Deferred, Partially Fixed, or Not Applicable.

## New observations

- `package-lock.json` has no `license` field for `khroma@2.1.0`. The deterministic
  inventory records this as missing rather than inventing a classification. This was
  observed while fixing DOC-006 and left out of scope.
- The final Stryker run encountered two worker out-of-memory restarts; Stryker
  recovered, completed all 6,642 mutants across 48 files, passed every threshold,
  and exited 0. This is a local resource-pressure/performance observation, not an app
  correctness failure, and was not chased outside the audited findings.

## Commit map

- `67c1579` — SEC-001, SEC-002, DATA-011 installer remediation.
- `b094561` — SEC-003 through SEC-006; BE-001 through BE-003; DATA-001 through DATA-010 and DATA-012; ARCH-002; QUAL-001 through QUAL-004.
- `75af54b` — SEC-007 and SEC-008 workflow/macOS hardening.
- `ed8363c` — FE-001 through FE-006; ARCH-001; PERF-001 through PERF-003.
- `55ff0ed`, `dab7e0a` — DEP-001 through DEP-003 dependency provenance, licensing, updates, and refreshed vendor assets.
- `691b7e7` — TEST-001 through TEST-009; CONF-002 and CONF-003 assurance gates.
- `d9453b4` — CONF-001 security lint enforcement.
- `a87cb7d` — CONF-004 installer-build hardening.
- `6cc8ea6` — DOC-001 through DOC-006 documentation and reproducibility.
- `821e76d` — reviewed RTL/ink visual golden aligned with FE-001, FE-006, and DEP-001 changes.
- `f6df2fc` — SEC-001, DATA-011, and CONF-004 real Inno toolchain verification; closes the previously partial real-compiler evidence.
- `70eb3a6` — ARCH-001 renderer stylesheet boundary extraction.
- `3ccc76e` — ARCH-001 renderer workspace/settings controller extraction.
- `7b3e754` — ARCH-001 main-process IPC/window controller extraction.
- `78372cb` — CONF-004 nonce-scoped compiler/test outputs and verified publication.
- `880b21f` — ARCH-001 mutation-sandbox handling for raw-source meta-tests.
