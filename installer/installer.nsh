; Custom NSIS hooks for BP MD RTL Reader.
;
; electron-builder owns same-product upgrades. This include deliberately does
; not read or execute uninstall commands from the registry: an elevated setup
; must never turn user-writable ARP metadata into a command-execution boundary.

!include "FileFunc.nsh"
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!macro customInit
  ; No custom prior-install command execution. electron-builder's protected
  ; per-machine upgrade path handles the current product identity in place.
!macroend

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
    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}

    RMDir /r "$APPDATA\bpmdrtlreader"
    RMDir /r "$APPDATA\BP MD RTL Reader"
    RMDir /r "$LOCALAPPDATA\bpmdrtlreader"
    RMDir /r "$LOCALAPPDATA\BP MD RTL Reader"
    Call un.BpmdCollectCleanupFailures

    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${Else}
    DetailPrint "Preserved current-account settings and app data."
  ${EndIf}
!macroend

Function un.BpmdSetPrimaryAction
  ${NSD_GetState} $BpmdDeleteDataRadio $R0
  GetDlgItem $R1 $HWNDPARENT 1

  ${If} $R0 == ${BST_CHECKED}
    StrCpy $BpmdDeleteUserData "1"
    SendMessage $R1 ${WM_SETTEXT} 0 "STR:Uninstall and delete app data"
    SetCtlColors $BpmdDeleteDataRadio "B42318" "transparent"
    SetCtlColors $BpmdDeleteDataNote "B42318" "transparent"
    SetCtlColors $BpmdAppOnlyRadio "000000" "transparent"
    SetCtlColors $BpmdAppOnlyNote "444444" "transparent"
  ${Else}
    StrCpy $BpmdDeleteUserData "0"
    SendMessage $R1 ${WM_SETTEXT} 0 "STR:Uninstall app only"
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
  ${If} $installMode == "all"
    SetShellVarContext current
  ${EndIf}
  Call un.BpmdCollectCleanupFailures
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}

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
