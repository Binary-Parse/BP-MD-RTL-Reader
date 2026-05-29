; Custom NSIS include for Marqam installer.
; Hooks into electron-builder's macro system:
;   customInit   — runs before install begins (here: detect any prior install)
;   customUnInit — runs before uninstall begins (here: ask about user data)
;
; The electron-builder NSIS template provides ${UNINSTALL_REGISTRY_KEY_2}
; which expands to the registry path under
; "Software\Microsoft\Windows\CurrentVersion\Uninstall\<appId>".

!macro customInit
  ; --- Detect a PER-USER install on the same machine ---------------------
  ; A per-user install lives under HKCU. If the user previously installed
  ; with the old per-machine: false config (or via a sibling channel), the
  ; default electron-builder upgrade check (which only inspects the hive
  ; matching the current build's perMachine setting) misses it. Look in
  ; HKCU explicitly and offer to remove it.
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
  ${If} $R0 != ""
    MessageBox MB_YESNO|MB_ICONQUESTION \
      "An existing user-level Marqam installation was detected.$\n$\nUninstall it before continuing? (Recommended)" \
      /SD IDYES IDYES uninstall_per_user IDNO continue_check_machine
    uninstall_per_user:
      ; /S = silent. _?=$INSTDIR prevents the uninstaller from spawning a
      ; new process so we wait for it to finish.
      ExecWait '"$R0" /S _?=$INSTDIR'
    continue_check_machine:
  ${EndIf}

  ; --- Detect a PER-MACHINE install (handled by template, but belt+braces) ---
  ReadRegStr $R1 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_REGISTRY_KEY_2}" "UninstallString"
  ${If} $R1 != ""
    ; electron-builder's default upgrade flow handles this case; we don't
    ; double-prompt here. Logged for transparency in installer log.
    DetailPrint "Per-machine install detected at $R1 — template will upgrade in place."
  ${EndIf}
!macroend

!macro customUnInit
  ; --- Ask whether to wipe user data (notes/preferences in %APPDATA%) -----
  ; Default electron-builder uninstaller honours deleteAppDataOnUninstall
  ; statically. We give the user an explicit choice instead so they're not
  ; surprised either way.
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Delete user notes and preferences too?$\n$\nThis will remove:$\n  • $APPDATA\Marqam (settings, recent files)$\n$\nYour Markdown files on disk are NOT touched.$\n$\nChoose 'No' to keep them for a future reinstall." \
    /SD IDNO IDYES delete_user_data IDNO keep_user_data
  delete_user_data:
    RMDir /r "$APPDATA\Marqam"
    DetailPrint "Removed $APPDATA\Marqam"
    Goto user_data_done
  keep_user_data:
    DetailPrint "Preserved $APPDATA\Marqam"
  user_data_done:
!macroend
