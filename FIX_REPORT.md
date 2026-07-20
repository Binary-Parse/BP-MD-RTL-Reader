# BP MD RTL Reader Audit Remediation Report

## Summary

Remediation is in progress for the 60 findings documented in `AUDIT_REPORT.md` (0 Critical, 7 High, 44 Medium, 9 Low). The application is fully offline and local-only; security effort is calibrated to that deployment model while still closing every documented security boundary.

Current status: 60 findings in progress. No finding is classified Fixed until its implementation and relevant verification are complete.

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

The complete 60-row table will be populated as batches are verified. Until then, all findings retain **In Progress** status.

## Detailed Remediation Log

### SEC-001 / SEC-002 / DATA-011 — Installer command execution and profile defaults

- **Status:** Partially Fixed (implementation complete; Inno compilation unavailable locally)
- **Severity:** High / Medium / Medium
- **Root cause:** Elevated installers consume registry-controlled uninstall command/location data; Inno silent uninstall defaults to deleting profile data.
- **Change made:** Removed NSIS and Inno registry-command execution entirely. Detection now reads only `DisplayVersion` from the hive matching the selected privilege mode; same-version Inno setup offers Repair/Cancel. Silent uninstall preserves profile data unless `/DELETEUSERDATA` is explicit, and interactive preservation is the default.
- **Files touched:** `installer/installer.nsh:1-38`; `installer/scripts/version_check.pas:206-235`; `installer/setup.iss:139-237`; `tests/installer/installer_security.test.ps1:1-49`; `tests/installer/logic-sim.ps1:117-143`; `tests/installer/registry_mock.test.ps1:1-53`; `tests/installer/registry_mock.test.pas:1-44`; `tests/installer/run-tests.ps1:31-37`; `FIX_REPORT.md`.
- **Verification:** RED: installer tests reported 7 intended failures and 61 passes. GREEN: `pwsh -NoProfile -File tests/installer/run-tests.ps1 -SkipMutation` reported 68 passed, 0 failed, 4 opt-in destructive tests skipped. `npx electron-builder --win nsis --x64` built the real x64 NSIS installer, exit 0. `npm test` reported 1,174 unit and 724 Playwright tests passed. `npm run lint:security` remained at the 85-warning baseline with no errors.
- **Risk & notes:** Risky installer batch. No real installation, uninstallation, registry mutation, or profile deletion was performed. `tests/installer/run-pascal-self-test.ps1` exited 2 because Inno Setup 6.3+ is not installed; therefore the Inno half is not yet dynamically compiler-verified. Removing the “Remove” button differs from the audit recommendation deliberately: it eliminates the elevated registry-command sink instead of attempting brittle command ownership/signature parsing.

## Deferred & Not Applicable

None classified at this stage.

## New observations

None at this stage.

## Commit map

Pending first verified batch commit.
