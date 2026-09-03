; Custom NSIS hooks for BP MD RTL Reader.
;
; electron-builder owns same-product upgrades. This include deliberately does
; not read or execute uninstall COMMANDS from the registry: an elevated setup
; must never turn user-writable ARP metadata into a command-execution boundary.
; v1.2.1 adds a READ-ONLY inspection of the same keys' DisplayVersion values so
; the assisted installer can tell the user, in plain language, whether it is
; about to upgrade, repair, or downgrade — and can offer the Remove choice by
; opening the Windows "Installed apps" page (a shell constant, never a registry
; command string).

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
  ; Explicit upgrade/maintenance prompt. READ-ONLY: this macro never reads or
  ; executes an uninstall command string from the registry (see the file header).
  !insertmacro BpmdDetectInstalledVersion
  ${If} $BpmdDetectedVersion == ""
    Return ; fresh install — nothing to tell
  ${EndIf}
  DetailPrint "Existing install: BP MD RTL Reader $BpmdDetectedVersion ($BpmdDetectedSource)"
  ${If} ${Silent}
    ; Silent upgrades keep electron-builder's protected in-place behavior, and
    ; same/downgrade decisions are the caller's responsibility.
    Return
  ${EndIf}

  ; $R9: 0 equal · 1 installed newer (downgrade) · 2 installed older (upgrade)
  !insertmacro BpmdVersionCompare "$BpmdDetectedVersion" "${VERSION}" $R9

  ${If} $R9 == 2
    ; Upgrade: inform, then continue (electron-builder performs the in-place upgrade).
    ${If} $LANGUAGE == 1025
      StrCpy $R1 "توجد نسخة مثبتة من BP MD RTL Reader (الإصدار $BpmdDetectedVersion).$\r$\n$\r$\nسيقوم هذا المثبِّت بترقيتها إلى ${VERSION}.$\r$\n$\r$\n$\r$\n$\r$\nملاحظاتك وإعداداتك محفوظة. هل تريد المتابعة بالترقية؟"
    ${Else}
      StrCpy $R1 "An installed copy of BP MD RTL Reader was found (version $BpmdDetectedVersion).$\r$\n$\r$\nThis installer will upgrade it to ${VERSION}.$\r$\n$\r$\n$\r$\n$\r$\nYour notes and settings are preserved. Continue with the upgrade?"
    ${EndIf}
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "$R1" IDOK bpmd_upgrade_ok
    Abort
    bpmd_upgrade_ok:
      DetailPrint "Upgrading $BpmdDetectedVersion -> ${VERSION}."
  ${ElseIf} $R9 == 0
    ; Same version: maintenance choice. The remove path is guidance to the Windows
    ; "Installed apps" page — this setup never executes an uninstaller taken from
    ; the registry, and the prompt deliberately uses OK/Cancel (repo contract
    ; forbids ambiguous Yes/No prompts in elevated flows).
    ${If} $LANGUAGE == 1025
      StrCpy $R1 "‏BP MD RTL Reader إصدار $BpmdDetectedVersion مثبت بالفعل (نفس إصدار هذا المثبِّت).$\r$\n$\r$\n$\r$\n$\r$\nموافق — إصلاح: إعادة تثبيت هذا الإصدار فوق النسخة الحالية.$\r$\n$\r$\nإلغاء — الخروج. ولإزالة التطبيق افتح «التطبيقات المثبتة» (الإعدادات ◂ التطبيقات)."
    ${Else}
      StrCpy $R1 "BP MD RTL Reader $BpmdDetectedVersion is already installed (same as this installer).$\r$\n$\r$\n$\r$\n$\r$\nOK — Repair: reinstall this version over the existing copy.$\r$\n$\r$\nCancel — exit Setup. To REMOVE the app, open Windows «Installed apps» (Settings ▸ Apps) instead."
    ${EndIf}
    MessageBox MB_OKCANCEL|MB_ICONQUESTION "$R1" IDOK bpmd_same_repair
    Abort
    bpmd_same_repair:
      DetailPrint "Repairing over the existing installation."
  ${Else}
    ; Downgrade: warn loudly, allow only an explicit OK.
    ${If} $LANGUAGE == 1025
      StrCpy $R1 "توجد نسخة أحدث من BP MD RTL Reader ($BpmdDetectedVersion).$\r$\n$\r$\nهذا المثبِّت يحمل الإصدار ${VERSION}.$\r$\n$\r$\n$\r$\n$\r$\nالتنزيل إلى إصدار أقدم غير مستحسن وقد يُفسد الإعدادات الأحدث.$\r$\n$\r$\nموافق — فرض التنزيل. إلغاء — الخروج من المثبِّت."
    ${Else}
      StrCpy $R1 "A NEWER version of BP MD RTL Reader ($BpmdDetectedVersion) is installed.$\r$\n$\r$\nThis installer carries version ${VERSION}.$\r$\n$\r$\n$\r$\n$\r$\nDowngrading is not recommended and may corrupt newer settings.$\r$\n$\r$\nOK — force the downgrade. Cancel — exit Setup."
    ${EndIf}
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$R1" IDOK bpmd_dg_force
    Abort
    bpmd_dg_force:
      DetailPrint "Forced downgrade requested by the user."
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
