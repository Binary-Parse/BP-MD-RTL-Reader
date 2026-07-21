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
  ; interactive Yes response; /SD IDNO keeps unattended uninstall non-destructive.
  ClearErrors
  ${GetOptions} $CMDLINE "/DELETEUSERDATA" $R0
  ${IfNot} ${Errors}
    Goto delete_user_data
  ${EndIf}

  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Delete the BP MD RTL Reader app profile too?$\n$\nThis removes:$\n  • $APPDATA\BP MD RTL Reader (settings, recent paths, grants, and logs)$\n$\nMarkdown files saved elsewhere are NOT touched.$\n$\nChoose 'No' to keep the profile for a future reinstall." \
    /SD IDNO IDYES delete_user_data IDNO keep_user_data

  delete_user_data:
    RMDir /r "$APPDATA\BP MD RTL Reader"
    DetailPrint "Removed $APPDATA\BP MD RTL Reader"
    Goto user_data_done

  keep_user_data:
    DetailPrint "Preserved $APPDATA\BP MD RTL Reader"

  user_data_done:
!macroend
