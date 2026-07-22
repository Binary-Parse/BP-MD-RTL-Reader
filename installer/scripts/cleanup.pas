{ ============================================================================
  cleanup.pas  —  Complete uninstall cleanup.

  Included into the [Code] section of setup.iss. Invoked from
  CurUninstallStepChanged(usPostUninstall). Mirrored (for the keep-data decision
  and the target list) by Get-CleanupPlan / Get-UninstallTargets in
  tests/installer/logic-sim.ps1.

  NOTE on user-data scope: a per-machine uninstall runs as the elevated user,
  so the roaming/local AppData paths resolve to *that* account. On a normal
  single-user PC this is the right profile; on a shared/multi-user machine a
  per-machine uninstall only clears the uninstalling user's data (known caveat).
  ============================================================================ }

{ Delete a directory tree if it exists (files + subdirs). Safe no-op if absent. }
procedure CU_DelTree(const Path: string);
begin
  if (Path <> '') and DirExists(Path) then
    DelTree(Path, True, True, True);
end;

{ Delete a single file if it exists. Safe no-op if absent. }
procedure CU_DelFile(const Path: string);
begin
  if (Path <> '') and FileExists(Path) then
    DeleteFile(Path);
end;

{ Remove the per-user data folders BP MD RTL Reader writes to.

  The app persists ALL of its state via Electron app.getPath('userData') =
  %APPDATA%\BP MD RTL Reader (roaming): settings, recent paths, filesystem grants,
  local logs, window/zoom/theme state, and Chromium profile storage.
  %LOCALAPPDATA%\BP MD RTL Reader is treated as a transient/legacy cache target.
  User-authored Markdown remains wherever the user saved it and is never an
  installer cleanup target.

  KeepUserData mirrors Get-CleanupPlan in logic-sim.ps1:
    True  -> keep both roaming and local app-data targets.
    False -> remove everything (roaming + local). }
procedure DeleteUserData(KeepUserData: Boolean);
var
  RoamDir, LocalDir: string;
begin
  RoamDir  := ExpandConstant('{userappdata}\BP MD RTL Reader');
  LocalDir := ExpandConstant('{localappdata}\BP MD RTL Reader');
  if not KeepUserData then
  begin
    CU_DelTree(RoamDir);
    CU_DelTree(LocalDir);
  end;
end;

{ Remove shortcuts, the Start-menu folder, app settings and file-association
  registry keys. Each delete is a safe no-op when the target is absent, and the
  HKA-written file associations are also covered by [Registry] uninsdeletekey;
  this is belt-and-braces and also clears the opposite hive. }
procedure CleanupArtifacts;
begin
  { Shortcuts (desktop / startup) for both per-user and all-users layouts. }
  CU_DelFile(ExpandConstant('{userstartup}\BP MD RTL Reader.lnk'));
  CU_DelFile(ExpandConstant('{commonstartup}\BP MD RTL Reader.lnk'));
  CU_DelFile(ExpandConstant('{userdesktop}\BP MD RTL Reader.lnk'));
  CU_DelFile(ExpandConstant('{commondesktop}\BP MD RTL Reader.lnk'));

  { Start-menu program group. }
  CU_DelTree(ExpandConstant('{autoprograms}\BP MD RTL Reader'));
  CU_DelTree(ExpandConstant('{commonprograms}\BP MD RTL Reader'));

  { Application settings. }
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\BP MD RTL Reader');
  RegDeleteKeyIncludingSubkeys(HKLM, 'Software\BP MD RTL Reader');

  { File-association verbs ('Open with BP MD RTL Reader') in both hives. }
  RegDeleteKeyIncludingSubkeys(HKLM, 'Software\Classes\.md\shell\Open with BP MD RTL Reader');
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\.md\shell\Open with BP MD RTL Reader');
  RegDeleteKeyIncludingSubkeys(HKLM, 'Software\Classes\.markdown\shell\Open with BP MD RTL Reader');
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\.markdown\shell\Open with BP MD RTL Reader');
end;
