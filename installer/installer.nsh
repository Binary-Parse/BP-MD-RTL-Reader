; Custom NSIS include for BP MD RTL Reader installer.
; Hooks into electron-builder's macro system:
;   customInit   — runs before install begins (here: detect any prior install and prompt the
;                  user to uninstall it first, so we upgrade in place instead of duplicating)
;   customUnInit — runs before uninstall begins (here: ask about user data)
;
; IMPORTANT: electron-builder defines ${UNINSTALL_REGISTRY_KEY} and ${UNINSTALL_REGISTRY_KEY_2}
; as the FULL registry subkey path, i.e. "Software\Microsoft\Windows\CurrentVersion\Uninstall\<key>"
; (see NsisTarget.js). A previous version of this file prefixed that path AGAIN, producing a
; bogus double path that never matched — which is exactly why the installer "did not detect the
; existing app" and installed a second copy. Use the variables DIRECTLY.

; Uninstall a previously-installed copy found at <rootKey>\<regSubkey>, if any.
;
; Registry values electron-builder actually writes (verified on a real install):
;   UninstallString      = "<dir>\Uninstall BP MD RTL Reader.exe" /allusers
;   QuietUninstallString = "<dir>\Uninstall BP MD RTL Reader.exe" /allusers /S
;   InstallLocation      = (empty!)
; So we must NOT re-quote the string (it is already quoted and carries /allusers), and we cannot
; rely on InstallLocation. We prefer QuietUninstallString (adds /S → silent, so customUnInit's
; "delete user data?" prompt auto-answers its IDNO default and notes are kept), and pass _?=<dir>
; so the uninstaller runs IN PLACE and ExecWait actually blocks until it finishes.
!macro RemovePreviousInstall rootKey regSubkey
  ClearErrors
  ReadRegStr $R0 ${rootKey} "${regSubkey}" "QuietUninstallString"
  ${If} $R0 == ""
    ; Older installs may lack QuietUninstallString — fall back to UninstallString + /S.
    ClearErrors
    ReadRegStr $R0 ${rootKey} "${regSubkey}" "UninstallString"
    ${IfNot} ${Errors}
    ${AndIf} $R0 != ""
      StrCpy $R0 '$R0 /S'
    ${EndIf}
  ${EndIf}
  ${If} $R0 != ""
    ReadRegStr $R1 ${rootKey} "${regSubkey}" "InstallLocation"
    ${If} $R1 == ""
      StrCpy $R1 "$INSTDIR" ; InstallLocation is empty → the install dir is the (default) target
    ${EndIf}
    DetailPrint "Removing the previous BP MD RTL Reader install…"
    ; $R0 is used DIRECTLY (already quoted). _?=<dir> runs the uninstaller in place so ExecWait
    ; blocks until it finishes; omit it only if we truly have no directory to point at.
    ${If} $R1 != ""
      ExecWait '$R0 _?=$R1'
    ${Else}
      ExecWait '$R0'
    ${EndIf}
  ${EndIf}
!macroend

; Set the "previous install found" flag ($R5) if an uninstall entry exists at
; <rootKey>\<regSubkey>. Detection is separate from removal so we can prompt ONCE for any
; number of registered copies instead of per key/hive.
!macro DetectPreviousInstall rootKey regSubkey
  ClearErrors
  ReadRegStr $R0 ${rootKey} "${regSubkey}" "UninstallString"
  ${IfNot} ${Errors}
  ${AndIf} $R0 != ""
    StrCpy $R5 "1"
  ${EndIf}
!macroend

!macro customInit
  ; The per-machine template only inspects HKLM for an upgrade, so a leftover PER-USER (HKCU)
  ; install — or an install registered under the legacy key — is missed and ends up duplicated.
  ; Detect ANY prior install across both hives and both the current + legacy uninstall keys.
  StrCpy $R5 "0"
  !insertmacro DetectPreviousInstall HKCU "${UNINSTALL_REGISTRY_KEY}"
  !insertmacro DetectPreviousInstall HKLM "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    !insertmacro DetectPreviousInstall HKCU "${UNINSTALL_REGISTRY_KEY_2}"
    !insertmacro DetectPreviousInstall HKLM "${UNINSTALL_REGISTRY_KEY_2}"
  !endif

  ${If} $R5 == "1"
    ; An existing install was detected — give the user the choice to remove it first.
    ; /SD IDYES makes a SILENT upgrade (/S) auto-remove the old copy, so unattended
    ; upgrades never leave a duplicate; an interactive install shows this prompt.
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "An existing installation of BP MD RTL Reader was detected.$\n$\nUninstall the previous version before continuing?$\n$\nYour notes and preferences are kept either way.$\n$\nChoose 'No' to install over the existing copy." \
      /SD IDYES IDYES bp_remove_prev IDNO bp_keep_prev
    bp_remove_prev:
      !insertmacro RemovePreviousInstall HKCU "${UNINSTALL_REGISTRY_KEY}"
      !insertmacro RemovePreviousInstall HKLM "${UNINSTALL_REGISTRY_KEY}"
      !ifdef UNINSTALL_REGISTRY_KEY_2
        !insertmacro RemovePreviousInstall HKCU "${UNINSTALL_REGISTRY_KEY_2}"
        !insertmacro RemovePreviousInstall HKLM "${UNINSTALL_REGISTRY_KEY_2}"
      !endif
      Goto bp_prev_done
    bp_keep_prev:
      DetailPrint "Keeping the existing BP MD RTL Reader install (user declined uninstall)"
    bp_prev_done:
  ${EndIf}
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
