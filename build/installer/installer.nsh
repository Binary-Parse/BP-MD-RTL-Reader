; Custom NSIS hooks for BP MD RTL Reader.
;
; electron-builder owns same-product upgrades. This include deliberately does
; not read or execute uninstall COMMANDS from the registry: an elevated setup
; must never turn user-writable ARP metadata into a command-execution boundary.
; v1.2.1 added a READ-ONLY inspection of the same keys' DisplayVersion values;
; T13 presents that state on a maintenance wizard PAGE with radio choices
; (never a modal MessageBox), and its remove choice OPENS the Windows
; "Installed apps" settings page (a shell constant, never a registry command).

!include "FileFunc.nsh"
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
; NOTE: electron-builder's bundled NSIS ships a STRIPPED FileFunc.nsh without
; ${VersionCompare} — the dotted-version comparison below is self-contained.

!ifndef BUILD_UNINSTALLER

; ── Numeric dotted-version compare (self-contained; the bundled FileFunc has no
;    ${VersionCompare}). Result: OUT = 0 equal · 1 = A newer · 2 = B newer.
;    Supports 1-4 numeric components ("1.2.0"); missing components count as 0.
!macro BpmdVersionCompare A B OUT
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  StrCpy $0 "${A}"
  StrCpy $1 "${B}"
  StrCpy ${OUT} "0"
  StrCpy $2 "1"                ; component index
bpmd_vc_loop:
  ; --- next numeric component of A into $3, advance $0 past the '.' ---
  StrCpy $3 "0"
  StrCpy $4 0
bpmd_vc_a1:
  StrCpy $5 "$0" 1 $4
  ${If} $5 == ""
    StrCpy $0 ""
    Goto bpmd_vc_a2
  ${EndIf}
  ${If} $5 == "."
    IntOp $4 $4 + 1
    StrCpy $0 "$0" "" $4
    Goto bpmd_vc_a2
  ${EndIf}
  IntOp $3 $3 * 10
  IntOp $3 $3 + $5
  IntOp $4 $4 + 1
  Goto bpmd_vc_a1
bpmd_vc_a2:
  ; --- next numeric component of B into $6, advance $1 past the '.' ---
  ; ($6 is the VALUE, $4 is the scan index — never mix them: a draft that used
  ;  $4 for both made every compare report "upgrade".)
  StrCpy $6 "0"
  StrCpy $4 0
bpmd_vc_b1:
  StrCpy $5 "$1" 1 $4
  ${If} $5 == ""
    StrCpy $1 ""
    Goto bpmd_vc_cmp
  ${EndIf}
  ${If} $5 == "."
    IntOp $4 $4 + 1
    StrCpy $1 "$1" "" $4
    Goto bpmd_vc_cmp
  ${EndIf}
  IntOp $6 $6 * 10
  IntOp $6 $6 + $5
  IntOp $4 $4 + 1
  Goto bpmd_vc_b1
bpmd_vc_cmp:
  ; $3 = installed component, $6 = setup component
  ${If} $3 > $6
    StrCpy ${OUT} "1"
    Goto bpmd_vc_done
  ${EndIf}
  ${If} $3 < $6
    StrCpy ${OUT} "2"
    Goto bpmd_vc_done
  ${EndIf}
  IntOp $2 $2 + 1
  ${If} $2 > 4
    Goto bpmd_vc_done
  ${EndIf}
  Goto bpmd_vc_loop
bpmd_vc_done:
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
; The electron-builder uninstall key is the APP_GUID derived from the appId —
; the same UUID documented (and required to stay in sync) in setup.iss as
; EB_NSIS_KEY; the Inno key is its UNINSTALL_KEY. Only the DisplayVersion
; VALUE is ever read here; no registry string is ever executed.
!define BPMD_EB_UNINSTALL_KEY  "4f0623fc-2d71-59f2-b165-b36fb9982268"
!define BPMD_INNO_UNINSTALL_KEY "{32586DF8-1F67-400F-9D8B-6426C3D5B405}_is1"

Var BpmdDetectedVersion
Var BpmdDetectedSource

; T12: the optional "Add to PATH" choice. $BpmdAddToPath starts at 0; the
; assisted flow sets it from the Git-style radio page after the directory
; choice, and silent installs set it by passing /add-path.
Var BpmdAddToPath
Var BpmdPathPage
Var BpmdPathRadioAdd
Var BpmdPathRadioSkip
Var BpmdPathNote

; T13: the maintenance page — an existing installation is presented as a wizard
; page with radio choices (the Python/MSI maintenance pattern, Git-style radio
; + sub-caption), never as a wall of text in a modal MessageBox.
Var BpmdMaintMode          ; "" none · "upgrade" · "same" · "downgrade"
Var BpmdMaintPage
Var BpmdMaintVersionLine
Var BpmdMaintRadioA
Var BpmdMaintRadioB

!ifndef VERSION
  !define VERSION "0.0.0"
!endif

; Localized prompt bodies are selected at RUNTIME by $LANGUAGE (1025 ar / else en)
; inside customInit — LangString-per-language would warn 6040 for every language
; table electron-builder ships that we do not translate.

!macro BpmdDetectInstalledVersion
  StrCpy $BpmdDetectedVersion ""
  StrCpy $BpmdDetectedSource ""
  StrCpy $0 ""

  ; electron-builder installs (per-machine HKLM, then per-user HKCU)
  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BPMD_EB_UNINSTALL_KEY}" "DisplayVersion"
  ${If} $0 != ""
    StrCpy $BpmdDetectedVersion $0
    StrCpy $BpmdDetectedSource "nsis"
  ${Else}
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BPMD_EB_UNINSTALL_KEY}" "DisplayVersion"
    ${If} $0 != ""
      StrCpy $BpmdDetectedVersion $0
      StrCpy $BpmdDetectedSource "nsis"
    ${Else}
      ; Inno installs — reported, not raced: the Inno installer manages its own.
      ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BPMD_INNO_UNINSTALL_KEY}" "DisplayVersion"
      ${If} $0 != ""
        StrCpy $BpmdDetectedVersion $0
        StrCpy $BpmdDetectedSource "inno"
      ${Else}
        ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BPMD_INNO_UNINSTALL_KEY}" "DisplayVersion"
        ${If} $0 != ""
          StrCpy $BpmdDetectedVersion $0
          StrCpy $BpmdDetectedSource "inno"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  ; T12: silent installs opt into the PATH entry with /add-path (the assisted
  ; flow asks on its own Git-style radio page later in the wizard). The
  ; T13 maintenance page owns every existing-installation decision.
  StrCpy $BpmdAddToPath "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/add-path" $R1
  ${IfNot} ${Errors}
    StrCpy $BpmdAddToPath "1"
  ${EndIf}
!macroend

; ── T13: maintenance page ────────────────────────────────────────────────────
; First page of the wizard (electron-builder's customWelcomePage slot). Skips
; itself on a fresh install and in silent mode; otherwise presents the version
; state and radio choices. The remove path OPENS the Windows "Installed apps"
; settings page (a shell constant) — this setup never executes an uninstall
; command string read from the registry (see the file header).
!macro customWelcomePage
  Page custom BpmdMaintenancePageCreate BpmdMaintenancePageLeave
!macroend

Function BpmdMaintenancePageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}
  !insertmacro BpmdDetectInstalledVersion
  ${If} $BpmdDetectedVersion == ""
    Abort ; fresh install — the wizard starts at the license page
  ${EndIf}

  ; $R9: 0 equal · 1 installed newer (downgrade) · 2 installed older (upgrade)
  !insertmacro BpmdVersionCompare "$BpmdDetectedVersion" "${VERSION}" $R9
  ${If} $R9 == 2
    StrCpy $BpmdMaintMode "upgrade"
  ${ElseIf} $R9 == 0
    StrCpy $BpmdMaintMode "same"
  ${Else}
    StrCpy $BpmdMaintMode "downgrade"
  ${EndIf}
  DetailPrint "Existing install: BP MD RTL Reader $BpmdDetectedVersion ($BpmdDetectedSource); mode: $BpmdMaintMode"

  ${If} $LANGUAGE == 1025
    nsDialogs::SetRTL 1
    !insertmacro MUI_HEADER_TEXT "‏BP MD RTL Reader مثبّت بالفعل" "اختر ما تريد فعله"
    StrCpy $BpmdMaintVersionLine "الموجود على هذا الجهاز: $BpmdDetectedVersion · هذا المثبّت: ${VERSION}"
    ${If} $BpmdMaintMode == "downgrade"
      StrCpy $R3 "الخروج من المثبِّت (موصى به)"
      StrCpy $R4 "النسخة المثبتة أحدث — لا يُجرى أي تغيير."
      StrCpy $R5 "فرض التنزيل إلى ${VERSION}"
      StrCpy $R6 "غير مستحسن — قد يُفسد الإعدادات الأحدث."
    ${ElseIf} $BpmdMaintMode == "same"
      StrCpy $R3 "إصلاح — إعادة تثبيت ${VERSION}"
      StrCpy $R4 "تثبيت نفس الإصدار فوق النسخة الحالية (موصى به)."
      StrCpy $R5 "إزالة النسخة الحالية"
      StrCpy $R6 "يفتح صفحة «التطبيقات المثبتة» في إعدادات ويندوز ثم يخرج."
    ${Else}
      StrCpy $R3 "الترقية إلى ${VERSION}"
      StrCpy $R4 "موصى به — ملاحظاتك وإعداداتك محفوظة."
      StrCpy $R5 "إزالة النسخة الحالية"
      StrCpy $R6 "يفتح صفحة «التطبيقات المثبتة» في إعدادات ويندوز ثم يخرج."
    ${EndIf}
  ${Else}
    !insertmacro MUI_HEADER_TEXT "BP MD RTL Reader is already installed" "Choose what to do"
    StrCpy $BpmdMaintVersionLine "On this computer: $BpmdDetectedVersion · this installer: ${VERSION}"
    ${If} $BpmdMaintMode == "downgrade"
      StrCpy $R3 "Exit Setup (recommended)"
      StrCpy $R4 "The installed copy is newer — nothing will be changed."
      StrCpy $R5 "Force the downgrade to ${VERSION}"
      StrCpy $R6 "Not recommended — may corrupt newer settings."
    ${ElseIf} $BpmdMaintMode == "same"
      StrCpy $R3 "Repair — reinstall ${VERSION}"
      StrCpy $R4 "Reinstall this version over the existing copy (recommended)."
      StrCpy $R5 "Remove the current copy"
      StrCpy $R6 "Opens the Windows Installed apps page, then exits Setup."
    ${Else}
      StrCpy $R3 "Upgrade to ${VERSION}"
      StrCpy $R4 "Recommended — your notes and settings are preserved."
      StrCpy $R5 "Remove the current copy"
      StrCpy $R6 "Opens the Windows Installed apps page, then exits Setup."
    ${EndIf}
  ${EndIf}

  nsDialogs::Create 1018
  Pop $BpmdMaintPage
  ${If} $BpmdMaintPage == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 2u 300u 12u $BpmdMaintVersionLine
  Pop $BpmdMaintVersionLine
  ${If} $BpmdMaintMode == "downgrade"
    SetCtlColors $BpmdMaintVersionLine "B42318" "transparent"
  ${Else}
    SetCtlColors $BpmdMaintVersionLine "005FB8" "transparent"
  ${EndIf}

  ${NSD_CreateRadioButton} 2u 22u 296u 12u $R3
  Pop $BpmdMaintRadioA
  ${NSD_CreateLabel} 18u 36u 280u 22u $R4
  Pop $R0
  SetCtlColors $R0 "444444" "transparent"

  ${NSD_CreateRadioButton} 2u 66u 296u 12u $R5
  Pop $BpmdMaintRadioB
  ${NSD_CreateLabel} 18u 80u 280u 22u $R6
  Pop $R0
  ${If} $BpmdMaintMode == "downgrade"
    SetCtlColors $R0 "B42318" "transparent"
  ${Else}
    SetCtlColors $R0 "444444" "transparent"
  ${EndIf}

  ${NSD_Check} $BpmdMaintRadioA
  nsDialogs::Show
FunctionEnd

Function BpmdMaintenancePageLeave
  ${NSD_GetState} $BpmdMaintRadioA $R0
  ${If} $BpmdMaintMode == "downgrade"
    ${If} $R0 == ${BST_CHECKED}
      Quit
    ${EndIf}
    DetailPrint "Forced downgrade requested by the user."
    Return
  ${EndIf}
  ${If} $R0 == ${BST_CHECKED}
    ${If} $BpmdMaintMode == "upgrade"
      DetailPrint "Upgrading $BpmdDetectedVersion -> ${VERSION}."
    ${Else}
      DetailPrint "Repairing over the existing installation."
    ${EndIf}
    Return
  ${EndIf}
  ; The remove choice: guide to the Windows "Installed apps" page (a shell
  ; constant — never an uninstall command read from the registry).
  ${If} $LANGUAGE == 1025
    DetailPrint "فتح صفحة «التطبيقات المثبتة» وإنهاء المثبِّت."
  ${Else}
    DetailPrint "Opening the Windows Installed apps page; exiting Setup."
  ${EndIf}
  ExecShell "open" "ms-settings:appsfeatures"
  Quit
FunctionEnd

; T12/T13: electron-builder's slot between the directory page and the install
; section (assistedInstaller.nsh "customPageAfterChangeDir"). The Git-for-Windows
; pattern: a radio pair with sub-captions, "leave PATH unchanged" checked by
; default — touching the machine PATH is opt-in, never a side effect of
; clicking through the wizard.
!macro customPageAfterChangeDir
  Page custom BpmdPathPageCreate BpmdPathPageLeave
!macroend

Function BpmdPathPageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}

  ${If} $LANGUAGE == 1025
    nsDialogs::SetRTL 1
    !insertmacro MUI_HEADER_TEXT "خيارات إضافية" "اختياري — لا شيء يتغير إن أبقيت الخيار الافتراضي"
    StrCpy $R1 "إضافة BP MD RTL Reader إلى PATH"
    StrCpy $R2 "تشغيل BP MD RTL Reader من أي طرفية (cmd وPowerShell) — تُزال الإضافة تلقائيًا عند إزالة التطبيق."
    StrCpy $R3 "عدم تعديل PATH (الافتراضي)"
    StrCpy $R4 "لا يتغيّر متغيّر PATH في النظام إطلاقًا."
  ${Else}
    !insertmacro MUI_HEADER_TEXT "Additional options" "Optional — nothing changes if you keep the default"
    StrCpy $R1 "Add BP MD RTL Reader to PATH"
    StrCpy $R2 "Run BP MD RTL Reader from any terminal (cmd and PowerShell) — automatically removed when the app is uninstalled."
    StrCpy $R3 "Leave PATH unchanged (default)"
    StrCpy $R4 "The system PATH variable is not modified at all."
  ${EndIf}

  nsDialogs::Create 1018
  Pop $BpmdPathPage
  ${If} $BpmdPathPage == error
    Abort
  ${EndIf}

  ${NSD_CreateRadioButton} 2u 8u 296u 12u $R1
  Pop $BpmdPathRadioAdd
  ${NSD_CreateLabel} 18u 22u 280u 24u $R2
  Pop $BpmdPathNote
  SetCtlColors $BpmdPathNote "444444" "transparent"

  ${NSD_CreateRadioButton} 2u 58u 296u 12u $R3
  Pop $BpmdPathRadioSkip
  ${NSD_CreateLabel} 18u 72u 280u 20u $R4
  Pop $R0
  SetCtlColors $R0 "444444" "transparent"

  ${NSD_Check} $BpmdPathRadioSkip
  nsDialogs::Show
FunctionEnd

Function BpmdPathPageLeave
  ; T14 (post-review): reset BEFORE reading the radio. Next → Back → Next re-runs this Leave
  ; with the default (skip) radio re-checked, and without the reset the variable would keep
  ; its stale "1" — installing onto PATH despite the page showing "leave PATH unchanged".
  StrCpy $BpmdAddToPath "0"
  ${NSD_GetState} $BpmdPathRadioAdd $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $BpmdAddToPath "1"
  ${EndIf}
FunctionEnd

; Runs inside the install section (assisted and silent alike). EnVar::AddValueEx
; appends only when the folder is not already on PATH, respects the value's
; expandable (REG_EXPAND_SZ) form, and the plugin broadcasts WM_SETTINGCHANGE
; itself after a successful write.
!macro customInstall
  ${If} $BpmdAddToPath == "1"
    EnVar::SetHKLM
    EnVar::AddValueEx "PATH" "$INSTDIR"
    Pop $R0
    ${If} $R0 == "0"
      DetailPrint "Added the install folder to the system PATH."
    ${Else}
      DetailPrint "The system PATH was left unchanged (the update failed)."
    ${EndIf}
  ${EndIf}
!macroend

!endif  ; !ifndef BUILD_UNINSTALLER

!ifdef BUILD_UNINSTALLER
Var BpmdDeleteUserData
Var BpmdCleanupFailures
Var BpmdChoicePage
Var BpmdAppOnlyRadio
Var BpmdDeleteDataRadio
Var BpmdAppOnlyNote
Var BpmdDeleteDataNote
Var BpmdResultPage

!macro customUnWelcomePage
  UninstPage custom un.BpmdChoicePageCreate un.BpmdChoicePageLeave
!macroend

!macro customUninstallPage
  UninstPage custom un.BpmdCleanupResultPageCreate
!macroend

!macro customUnInit
  ; Silent uninstall preserves profile data unless an explicit destructive
  ; switch is supplied. Support electron-builder's compatibility switch too.
  StrCpy $BpmdDeleteUserData "0"
  StrCpy $BpmdCleanupFailures ""
  ${GetParameters} $R0

  ClearErrors
  ${GetOptions} $R0 "/DELETEUSERDATA" $R1
  ${IfNot} ${Errors}
    StrCpy $BpmdDeleteUserData "1"
  ${EndIf}

  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    StrCpy $BpmdDeleteUserData "1"
  ${EndIf}

  ${If} ${Silent}
    ${If} $BpmdDeleteUserData == "1"
      DetailPrint "Silent uninstall will remove current-account app data."
    ${Else}
      DetailPrint "Silent uninstall will preserve current-account app data."
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ; T12: remove this folder from the system PATH. DeleteValue is a no-op when
  ; the value is absent, so a PATH that never contained the folder is left
  ; byte-identical; it runs outside the data-deletion choice because the PATH
  ; entry belongs to the app itself, not to the profile data.
  EnVar::SetHKLM
  EnVar::DeleteValue "PATH" "$INSTDIR"
  Pop $R0

  ${If} $BpmdDeleteUserData == "1"
    ; Electron profile data always belongs to the Windows account that launched
    ; the app, even when the program itself was installed for all users.
    SetShellVarContext current

    RMDir /r "$APPDATA\bpmdrtlreader"
    RMDir /r "$APPDATA\BP MD RTL Reader"
    RMDir /r "$LOCALAPPDATA\bpmdrtlreader"
    RMDir /r "$LOCALAPPDATA\BP MD RTL Reader"
    Call un.BpmdCollectCleanupFailures

    SetShellVarContext all
  ${Else}
    DetailPrint "Preserved current-account settings and app data."
  ${EndIf}
!macroend

Function un.BpmdSetPrimaryAction
  ${NSD_GetState} $BpmdDeleteDataRadio $R0
  GetDlgItem $R1 $HWNDPARENT 1
  SendMessage $R1 ${WM_SETTEXT} 0 "STR:Uninstall"

  ${If} $R0 == ${BST_CHECKED}
    StrCpy $BpmdDeleteUserData "1"
    SetCtlColors $BpmdDeleteDataRadio "B42318" "transparent"
    SetCtlColors $BpmdDeleteDataNote "B42318" "transparent"
    SetCtlColors $BpmdAppOnlyRadio "000000" "transparent"
    SetCtlColors $BpmdAppOnlyNote "444444" "transparent"
  ${Else}
    StrCpy $BpmdDeleteUserData "0"
    SetCtlColors $BpmdAppOnlyRadio "005FB8" "transparent"
    SetCtlColors $BpmdAppOnlyNote "005FB8" "transparent"
    SetCtlColors $BpmdDeleteDataRadio "000000" "transparent"
    SetCtlColors $BpmdDeleteDataNote "444444" "transparent"
  ${EndIf}
FunctionEnd

Function un.BpmdChoiceChanged
  Pop $R0
  Call un.BpmdSetPrimaryAction
FunctionEnd

Function un.BpmdChoicePageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}

  ${If} $LANGUAGE == 1025
    nsDialogs::SetRTL 1
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Choose what to remove" "Select whether BP MD RTL Reader should keep its app data."
  nsDialogs::Create 1018
  Pop $BpmdChoicePage
  ${If} $BpmdChoicePage == error
    Abort
  ${EndIf}

  ${NSD_CreateGroupBox} 0u 0u 300u 48u ""
  Pop $R0
  ${NSD_CreateRadioButton} 10u 8u 278u 12u "Remove app only"
  Pop $BpmdAppOnlyRadio
  ${NSD_CreateLabel} 28u 23u 258u 18u "Keep settings and app data for a future reinstall."
  Pop $BpmdAppOnlyNote

  ${NSD_CreateGroupBox} 0u 54u 300u 54u ""
  Pop $R0
  ${NSD_CreateRadioButton} 10u 62u 278u 12u "Remove app and all app data"
  Pop $BpmdDeleteDataRadio
  ${NSD_CreateLabel} 28u 77u 258u 24u "Delete settings, recent paths, permissions, logs, profile data, and cache for this Windows account."
  Pop $BpmdDeleteDataNote

  ${NSD_CreateLabel} 2u 116u 296u 18u "Your Markdown documents are never deleted."
  Pop $R0

  ${NSD_Check} $BpmdAppOnlyRadio
  ${NSD_OnClick} $BpmdAppOnlyRadio un.BpmdChoiceChanged
  ${NSD_OnClick} $BpmdDeleteDataRadio un.BpmdChoiceChanged
  Call un.BpmdSetPrimaryAction
  nsDialogs::Show
FunctionEnd

Function un.BpmdChoicePageLeave
  Call un.BpmdSetPrimaryAction
FunctionEnd

Function un.BpmdCollectCleanupFailures
  StrCpy $BpmdCleanupFailures ""

  IfFileExists "$APPDATA\bpmdrtlreader\*.*" 0 bpmd_check_roaming_title ; populate $BpmdCleanupFailures when this root remains
    StrCpy $BpmdCleanupFailures "$APPDATA\bpmdrtlreader"
  bpmd_check_roaming_title:

  IfFileExists "$APPDATA\BP MD RTL Reader\*.*" 0 bpmd_check_local_lower ; populate $BpmdCleanupFailures when this root remains
    ${If} $BpmdCleanupFailures == ""
      StrCpy $BpmdCleanupFailures "$APPDATA\BP MD RTL Reader"
    ${Else}
      StrCpy $BpmdCleanupFailures "$BpmdCleanupFailures$\r$\n$APPDATA\BP MD RTL Reader"
    ${EndIf}
  bpmd_check_local_lower:

  IfFileExists "$LOCALAPPDATA\bpmdrtlreader\*.*" 0 bpmd_check_local_title ; populate $BpmdCleanupFailures when this root remains
    ${If} $BpmdCleanupFailures == ""
      StrCpy $BpmdCleanupFailures "$LOCALAPPDATA\bpmdrtlreader"
    ${Else}
      StrCpy $BpmdCleanupFailures "$BpmdCleanupFailures$\r$\n$LOCALAPPDATA\bpmdrtlreader"
    ${EndIf}
  bpmd_check_local_title:

  IfFileExists "$LOCALAPPDATA\BP MD RTL Reader\*.*" 0 bpmd_check_done ; populate $BpmdCleanupFailures when this root remains
    ${If} $BpmdCleanupFailures == ""
      StrCpy $BpmdCleanupFailures "$LOCALAPPDATA\BP MD RTL Reader"
    ${Else}
      StrCpy $BpmdCleanupFailures "$BpmdCleanupFailures$\r$\n$LOCALAPPDATA\BP MD RTL Reader"
    ${EndIf}
  bpmd_check_done:
FunctionEnd

Function un.BpmdCleanupResultPageCreate
  ${If} ${Silent}
    Abort
  ${EndIf}
  ${If} $BpmdDeleteUserData != "1"
    Abort
  ${EndIf}

  ${If} $LANGUAGE == 1025
    nsDialogs::SetRTL 1
  ${EndIf}

  ; Re-check after electron-builder's own uninstall section has finished so a
  ; successful retry cannot produce a stale warning.
  SetShellVarContext current
  Call un.BpmdCollectCleanupFailures
  SetShellVarContext all

  ${If} $BpmdCleanupFailures == ""
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Some app data could not be removed" "BP MD RTL Reader was uninstalled, but Windows kept the paths listed below."
  nsDialogs::Create 1018
  Pop $BpmdResultPage
  ${If} $BpmdResultPage == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 0u 300u 26u "Close any program using these files, then remove the folders manually:"
  Pop $R0
  ${NSD_CreateText} 0u 30u 300u 72u "$BpmdCleanupFailures"
  Pop $R0
  SendMessage $R0 ${EM_SETREADONLY} 1 0
  ${NSD_CreateLabel} 0u 110u 300u 24u "Your Markdown documents were not touched."
  Pop $R0
  nsDialogs::Show
FunctionEnd
!endif
