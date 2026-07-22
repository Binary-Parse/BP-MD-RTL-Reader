; Custom NSIS hooks for BP MD RTL Reader.
;
; electron-builder owns same-product upgrades. This include deliberately does
; not read or execute uninstall commands from the registry: an elevated setup
; must never turn user-writable ARP metadata into a command-execution boundary.

!include "FileFunc.nsh"

!macro customInit
  ; No custom prior-install command execution. electron-builder's protected
  ; per-machine upgrade path handles the current product identity in place.
!macroend

!macro customUnInit
  ; Preserve profile data by default, including silent uninstalls. Destructive
  ; removal is available only through the explicit /DELETEUSERDATA switch or an
  ; interactive full-cleanup choice; /SD IDYES keeps unattended uninstall safe.
  ClearErrors
  ${GetOptions} $CMDLINE "/DELETEUSERDATA" $R0
  ${IfNot} ${Errors}
    Goto delete_user_data
  ${EndIf}

  MessageBox MB_YESNOCANCEL|MB_ICONQUESTION|MB_DEFBUTTON1 \
    "Choose how to uninstall BP MD RTL Reader:$\n$\nYes — Uninstall app only$\nRemoves the program and preserves app settings and data for a future reinstall.$\n$\nNo — Uninstall and delete app data$\nAlso removes:$\n  • $APPDATA\BP MD RTL Reader$\n  • $LOCALAPPDATA\BP MD RTL Reader$\n(settings, recent paths, grants, logs, profile storage, and caches)$\n$\nCancel — Exit without making changes.$\n$\nMarkdown files and other documents saved elsewhere are NEVER touched." \
    /SD IDYES IDYES keep_user_data IDNO delete_user_data
  Goto cancel_uninstall

  delete_user_data:
    RMDir /r "$APPDATA\BP MD RTL Reader"
    DetailPrint "Removed $APPDATA\BP MD RTL Reader"
    RMDir /r "$LOCALAPPDATA\BP MD RTL Reader"
    DetailPrint "Removed $LOCALAPPDATA\BP MD RTL Reader"
    Goto user_data_done

  keep_user_data:
    DetailPrint "Preserved $APPDATA\BP MD RTL Reader"
    DetailPrint "Preserved $LOCALAPPDATA\BP MD RTL Reader"
    Goto user_data_done

  cancel_uninstall:
    Quit

  user_data_done:
!macroend
