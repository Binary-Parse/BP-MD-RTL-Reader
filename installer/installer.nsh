; Custom NSIS include for BP MD RTL Reader installer.
; Hooks into electron-builder's macro system:
;   customInit   — runs before install begins (here: remove any prior install so we upgrade
;                  in place instead of leaving a duplicate)
;   customUnInit — runs before uninstall begins (here: ask about user data)
;
; IMPORTANT: electron-builder defines ${UNINSTALL_REGISTRY_KEY} and ${UNINSTALL_REGISTRY_KEY_2}
; as the FULL registry subkey path, i.e. "Software\Microsoft\Windows\CurrentVersion\Uninstall\<key>"
; (see NsisTarget.js). A previous version of this file prefixed that path AGAIN, producing a
; bogus double path that never matched — which is exactly why the installer "did not detect the
; existing app" and installed a second copy. Use the variables DIRECTLY.

; Silently uninstall a previously-installed copy found at <rootKey>\<regSubkey>, if any.
; /S = silent (so customUnInit's "delete user data?" prompt auto-answers its IDNO default,
; preserving the user's notes/preferences). _?=<dir> runs the uninstaller in place so we wait.
!macro RemovePreviousInstall rootKey regSubkey
  ClearErrors
  ReadRegStr $R0 ${rootKey} "${regSubkey}" "UninstallString"
  ${IfNot} ${Errors}
  ${AndIf} $R0 != ""
    ReadRegStr $R1 ${rootKey} "${regSubkey}" "InstallLocation"
    DetailPrint "Removing a previous BP MD RTL Reader install ($R0)"
    ${If} $R1 != ""
      ExecWait '"$R0" /S _?=$R1'
    ${Else}
      ExecWait '"$R0" /S'
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  ; The per-machine template only inspects HKLM for an upgrade, so a leftover PER-USER (HKCU)
  ; install — or an install registered under the legacy key — is missed and ends up duplicated.
  ; Remove ANY prior install (both hives, both the current and legacy uninstall keys) first.
  !insertmacro RemovePreviousInstall HKCU "${UNINSTALL_REGISTRY_KEY}"
  !insertmacro RemovePreviousInstall HKLM "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    !insertmacro RemovePreviousInstall HKCU "${UNINSTALL_REGISTRY_KEY_2}"
    !insertmacro RemovePreviousInstall HKLM "${UNINSTALL_REGISTRY_KEY_2}"
  !endif
!macroend

!macro customUnInit
  ; --- Ask whether to wipe user data (notes/preferences in %APPDATA%) -----
  ; Default electron-builder uninstaller honours deleteAppDataOnUninstall statically. We give the
  ; user an explicit choice instead. During a silent upgrade-uninstall (/S) this auto-answers
  ; IDNO, so user data is preserved across upgrades.
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Delete user notes and preferences too?$\n$\nThis will remove:$\n  • $APPDATA\BP MD RTL Reader (settings, recent files)$\n$\nYour Markdown files on disk are NOT touched.$\n$\nChoose 'No' to keep them for a future reinstall." \
    /SD IDNO IDYES delete_user_data IDNO keep_user_data
  delete_user_data:
    RMDir /r "$APPDATA\BP MD RTL Reader"
    DetailPrint "Removed $APPDATA\BP MD RTL Reader"
    Goto user_data_done
  keep_user_data:
    DetailPrint "Preserved $APPDATA\BP MD RTL Reader"
  user_data_done:
!macroend
