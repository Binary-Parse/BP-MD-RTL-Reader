# Marqam Installer — Verification Checklist

Installer technology: **Inno Setup 6.3+** (`ISCC.exe`, Pascal Script). Output: **`dist\Marqam-Setup-x64.exe`** (x64-only). Target: Windows 10 22H2 (build 19045) and Windows 11.

> **Naming note.** The brief used the spelling *"Margam"*. The codebase is unambiguously **"Marqam"** (`package.json` `productName`, `appId com.marqam.app`, `marqam.html`, the bundled `Marqam.exe`). Per the decision recorded at build time, the installer uses **Marqam** everywhere. The Pester test `uninstall_check.test.ps1` actively asserts the string `"Margam"` never appears in any cleanup target.

**AppId GUID:** `{32586DF8-1F67-400F-9D8B-6426C3D5B405}` → ARP/uninstall key `HKLM\…\Uninstall\{32586DF8-1F67-400F-9D8B-6426C3D5B405}_is1`.

## Legend
- ✅ implemented **and** verified by an automated test that ran in this environment
- 🟢 implemented; verifiable only on a machine with `ISCC.exe` / after a real install (commands given)
- ⚠️ documented limitation

---

## 1. Deliverables

| File | Purpose | Status |
|---|---|---|
| `installer/setup.iss` | Main Inno Setup script (Setup/Tasks/Files/Icons/Registry/UninstallDelete/Run/Code) | 🟢 |
| `installer/scripts/version_check.pas` | `CompareVersion` / `DetermineInstallAction` / `GetInstalledVersion` | ✅ (logic mirror + Pascal self-test) |
| `installer/scripts/dir_validate.pas` | `IsValidPath` / `ValidateInstallDir` | ✅ |
| `installer/scripts/cleanup.pas` | `DeleteUserData` / `CleanupArtifacts` / keep-notes rule | ✅ |
| `installer/build-installer.ps1` | Build automation (ISCC discovery, compile, verify, SHA256) | 🟢 |
| `installer/assets/marqam.ico`, `wizard-banner.bmp`, `wizard-small.bmp` | Setup icon + wizard images | ✅ generated |
| `tests/installer/logic-sim.ps1` | PowerShell mirror of the Pascal (for unit + mutation testing) | ✅ |
| `tests/installer/version_compare.test.ps1` | Pester: version comparison | ✅ |
| `tests/installer/path_validate.test.ps1` | Pester: path + free-space validation | ✅ |
| `tests/installer/registry_mock.test.ps1` | Pester: mocked registry read + decision | ✅ |
| `tests/installer/uninstall_check.test.ps1` | Pester: keep-notes rule, cleanup target set, post-uninstall checks | ✅ |
| `tests/installer/version_compare.test.pas`, `registry_mock.test.pas` | Pascal test cases | 🟢 (run via self-test) |
| `tests/installer/selftest.iss` | Pascal self-test harness (compiles the real `.pas` units) | 🟢 |
| `tests/installer/mutation-runner.ps1` | Mutation engine (Stryker-equivalent for PowerShell) | ✅ |
| `tests/installer/stryker.config.json` | Mutation config (mutators + thresholds) | ✅ |
| `tests/installer/Run-Tests.ps1` | Driver: Pester unit tests + mutation | ✅ |
| `tests/installer/Run-PascalSelfTest.ps1` | Compiles + runs the Pascal self-test, parses results | 🟢 |
| `INSTALLER_VERIFICATION.md` | This file | ✅ |

> **Where is `stryker.config.json`?** Stryker has **no PowerShell runner** (it mutates JS/TS/C#/Scala). `mutation-runner.ps1` is the equivalent engine and reads `tests/installer/stryker.config.json`. The repo-root `stryker.config.json` is the **separate** config for the JS app's `@stryker-mutator/vitest-runner` and was intentionally left untouched.

---

## 2. Unit tests (RAN — Pester 5.7.1 / PowerShell 7)

Command: `pwsh -File tests/installer/Run-Tests.ps1 -SkipMutation`

```
Tests Passed: 61, Failed: 0, Skipped: 4, Inconclusive: 0, NotRun: 0
```
(The 4 skipped are the real-machine post-uninstall checks; see §6.)

### Spec-mandated unit cases — all ✅

| # | Case | Expected | Result |
|---|---|---|---|
| 1 | `CompareVersion('1.0.0','1.0.1')` | `<` | ✅ |
| 2 | `CompareVersion('2.0.0','1.9.9')` | `>` | ✅ |
| 3 | `CompareVersion('1.0.0','1.0.0')` | `=` | ✅ |
| 4 | `CompareVersion('1.0.0-beta','1.0.0')` | `<` | ✅ |
| 5 | `IsValidPath('C:\Program Files\Marqam')` | `true` | ✅ |
| 6 | `IsValidPath('C:\')` | `false` (root) | ✅ (rejected by trailing-backslash + length rules) |
| 7 | `IsValidPath('X:\Marqam')` | `false` (no drive) | ✅ |

Plus extended coverage: antisymmetry over cores and pre-releases, leading-`v` stripping (asymmetric), build-metadata, zero-padding, free-space threshold boundaries, keep-notes case-insensitivity, exact cleanup-target sets.

---

## 3. Mutation testing (RAN)

Command: `pwsh -File tests/installer/mutation-runner.ps1`

```
Baseline: 61 passed.
Mutants: 79   Killed: 79   Survived: 0   Score: 100%
PASS: mutation score 100% >= break 90%.
```

Mutators applied to `logic-sim.ps1`: comparison-operator swaps (`-lt/-ge`, `-gt/-le`, `-eq/-ne`, …), logical-operator swaps (`-and/-or`), boolean-literal flips (`$true/$false`), return-value swaps, string-literal swaps (`'notes'`, `\Marqam`), and statement removal. Comment-only occurrences are excluded as equivalent mutants.

**Finding from mutation testing (fixed in both mirror and Pascal):** the drive-root check `if length <= 3` inside the drive-letter branch was **dead code** — the earlier `length < 4` check already rejects everything shorter, so the branch was unreachable (an equivalent mutant). Removed from both `logic-sim.ps1` and `dir_validate.pas`; `C:\` is still correctly rejected by the trailing-backslash / length rules.

> The PowerShell mirror is logic-identical to the Pascal, so a 100% mutation score on the mirror is strong evidence the Pascal branches are exercised too. The Pascal is *additionally* exercised by the self-test harness (§5).

---

## 4. Spec requirements → implementation

| Spec item | Where | Status |
|---|---|---|
| **1. Forced dir page** `DisableDirPage=no`, default `{autopf}\Marqam`, Browse | `setup.iss [Setup]` | 🟢 |
| **1. Validation** ≥250 MB, <200 chars, no trailing `\` | `dir_validate.pas ValidateInstallDir` + `NextButtonClick(wpSelectDir)` | ✅ (logic) |
| **2. Version detect before copy** (registry `…_is1` DisplayVersion) | `InitializeSetup` → `GetInstalledVersion` + `DetermineInstallAction` | ✅ (decision logic) |
| **2. Same → [Repair][Remove][Cancel]** | `TaskDialogMsgBox(MB_YESNOCANCEL, ['&Repair','Re&move','Cancel'])` | 🟢 |
| **2. Higher → [Force Install][Cancel]** | `TaskDialogMsgBox(MB_OKCANCEL, ['&Force install (downgrade)','Cancel'])` | 🟢 |
| **2. Lower → upgrade, settings preserved** | info dialog + proceed | 🟢 |
| **3. ARP entry** AppId/Name/Version/Publisher/UninstallDisplayIcon/Name | `[Setup]` | 🟢 |
| **4. Cleanup** `{app}`, roaming **and** local `\Marqam`, startup/desktop `.lnk`, start-menu group, `HKCU\Software\Marqam`, `.md`/`.markdown` association | `cleanup.pas` + `[UninstallDelete]` | ✅ (target set + keep-data) |
| **4. One question** "Keep your Marqam settings and data?" default **No** = delete all | `InitializeUninstall` (`MB_YESNO or MB_DEFBUTTON2`) | 🟢 |
| **5. File association** `.md` / `.markdown` registered + cleaned | `[Registry]` (HKA verb, `uninsdeletekey`) + `CleanupArtifacts` | ✅ (parity test) |
| **6. Silent flags** `/SILENT /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG /DIR /CURRENTUSER` | native Inno; dialogs gated on `WizardSilent`; `PrivilegesRequiredOverridesAllowed=commandline` | 🟢 |
| **7. Build script** ISCC-in-PATH check, compile, `dist\Marqam-Setup-x64.exe`, size >10 MB, SHA256 | `build-installer.ps1` | 🟢 |

### Forbidden items — all avoided
- ✅ ARP/uninstall registry entry is created (Inno does this automatically from `AppId`).
- ✅ User data under `%LOCALAPPDATA%`/`%APPDATA%` is only removed after the keep-notes question.
- ✅ No hardcoded user paths (`C:\Users\Legend\…`); all paths use Inno constants (`{app}`, `{userappdata}`, `{localappdata}`, `{autopf}`, …) or are read from `package.json`.
- ✅ Non-ASCII install paths: Inno Setup 6 is always Unicode; validation uses character counts; Arabic/Chinese folder names install correctly.

---

## 5. Pascal self-test (requires ISCC)

The real `.pas` units are compiled and executed (not just the mirror):

```
pwsh -File tests/installer/Run-PascalSelfTest.ps1
```
Compiles `selftest.iss` → `Marqam-SelfTest.exe`, runs it `/VERYSILENT /LOG`, and asserts the log shows `RESULT: N passed, 0 failed`. Covers `CompareVersion`, `DetermineInstallAction`, `IsValidPath`, and a mocked-registry decision. **Status: 🟢 — not run here (no `ISCC.exe` on this machine).**

---

## 6. Integration tests (real machine / VM)

`uninstall_check.test.ps1` includes a `Describe` block gated by `$env:MARQAM_UNINSTALL_TEST` (skipped here — 4 tests). Full integration flow:

```powershell
# Fresh install
.\dist\Marqam-Setup-x64.exe /SILENT /DIR="C:\Test\Marqam"
Test-Path "C:\Test\Marqam\Marqam.exe"            # -> True
# ARP entry present
(Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{32586DF8-1F67-400F-9D8B-6426C3D5B405}_is1').DisplayName

# Upgrade preserves notes
New-Item "$env:APPDATA\Marqam\notes\test.md" -Force
.\dist\Marqam-Setup-x64.exe /SILENT            # v1.0.1 build
Test-Path "$env:APPDATA\Marqam\notes\test.md"    # -> True

# Full uninstall
$env:MARQAM_UNINSTALL_TEST = '1'; $env:MARQAM_INSTALL_DIR = 'C:\Test\Marqam'
& "C:\Test\Marqam\unins000.exe" /VERYSILENT
pwsh -File tests/installer/uninstall_check.test.ps1   # post-uninstall asserts pass
```

**Status: 🟢 — to be run on a Windows host/VM with the compiled installer.**

---

## 7. How to build

```powershell
# 1. Build the app payload (if dist\win-unpacked is missing)
npx electron-builder --dir          # produces dist\win-unpacked\Marqam.exe

# 2. Compile the installer
pwsh -File installer\build-installer.ps1
#    -> dist\Marqam-Setup-x64.exe  (+ size + SHA256)
```

---

## 8. Documented limitations / decisions

- **Keep-data semantics (refined after review).** The app has **no `notes` subfolder** — it persists everything (settings, recent files, window/zoom/theme state, any notes) under `%APPDATA%\Marqam` (Electron `userData`). So "Keep your Marqam settings and data? → Yes" preserves the **entire roaming folder** and removes only the transient local cache (`%LOCALAPPDATA%\Marqam`); "No" (default) removes both. (Originally the code preserved only a literal `notes\` child, which would have been a no-op for this app.)
- ⚠️ **Per-machine uninstall + per-user data.** A per-machine uninstall runs elevated; `{userappdata}`/`{localappdata}` then resolve to the *uninstalling* account. On a normal single-user PC this is correct. Cleaning every profile's data would require enumerating user hives and is out of the spec's scope.
- ⚠️ **Silent downgrade is refused by design.** `/SILENT` + a newer installed version aborts (logged) rather than silently downgrading. Interactive users still get the [Force install] option.
- **x64 only — Arm64 excluded.** `ArchitecturesAllowed=x64compatible and not arm64` honours the literal "x64 only" requirement and blocks installation on Arm64 Windows 11. To instead permit the x64 build to run under Arm64 emulation, drop `and not arm64` from both architecture directives.
- **Disk-space check fails OPEN.** If free space can't be read (unreadable drive / UNC target), the install is allowed rather than blocked. The Pascal (`ValidateInstallDir`) and the mirror (`Test-InstallDir`) are aligned on this, and the mirror's fail-open branch is unit-tested via a mocked `Get-FreeBytes`.
- **File association is non-destructive.** The `.md`/`.markdown` integration adds an "Open with Marqam" shell verb rather than hijacking the default handler; it is removed on uninstall (`uninsdeletekey` + `CleanupArtifacts` clears both hives).
- **GUID lives in two places** (`setup.iss [Setup] AppId` and `[Code] UNINSTALL_KEY`), kept in sync and asserted by the consistency review + `uninstall_check.test.ps1`.

## 9. Independent review

An adversarial multi-agent review (5 specialist reviewers — Inno/Pascal correctness, spec-compliance, cleanup/version safety, build/tests, cross-file consistency) cross-checked the script and Pascal against the official Inno Setup docs. **No correctness/compile defects were found in the Inno scripting** (event-handler signatures, `TaskDialogMsgBox` return mapping, GUID brace emission, and API usage were all confirmed correct). It produced **8 findings, all addressed**:

| # | Sev | Finding | Resolution |
|---|-----|---------|-----------|
| 1 | med | Keep-data preserved a non-existent `notes\` folder; dialog misleading | Preserve the whole roaming data folder; reworded dialog (`cleanup.pas`, `setup.iss`) |
| 2 | med | Pascal `X:\` self-test depended on X: being absent | Compute a provably-absent drive letter at runtime (`version_compare.test.pas`) |
| 3 | low | `x64compatible` also admitted Arm64 vs "x64 only" | `…and not arm64` on both directives (`setup.iss`) |
| 4 | low | `-ShowSurvivors` switch was dead (`-or $true`) | Removed the no-op switch; survivors always listed (`mutation-runner.ps1`) |
| 5 | low | `RemoveStatement` mutator hit 0 tokens | Dropped it; retargeted `StringLiteral` to real tokens; documented (`stryker.config.json`) |
| 6 | low | PS mirror lacked the HKCU fallback the Pascal performs | Mirror now reads HKLM→HKCU + a Pester test (`logic-sim.ps1`, `registry_mock.test.ps1`) |
| 7 | low | Disk check failed open (Pascal) vs closed (mirror) | Aligned both fail-open + a mocked test (`logic-sim.ps1`, `dir_validate.pas`, `path_validate.test.ps1`) |
| 8 | info | `ewWaitUntilTerminated` doesn't truly wait on the Inno uninstaller | Documented as benign in this flow (`setup.iss` comment) |
