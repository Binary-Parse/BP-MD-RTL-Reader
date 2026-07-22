{ ============================================================================
  cleanup.pas  —  Complete uninstall cleanup.

  Included into the [Code] section of setup.iss. Invoked from
  CurUninstallStepChanged(usPostUninstall). Mirrored (for the keep-data decision
  and the target list) by Get-CleanupPlan / Get-UninstallTargets in
  tests/installer/logic-sim.ps1.

  NOTE on user-data scope: cleanup intentionally resolves AppData for the
  Windows account running the uninstaller. It never enumerates other profiles.
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

{ Remove the fixed per-user data folders BP MD RTL Reader writes to.

  The app persists ALL of its state via Electron app.getPath('userData') =
  %APPDATA%\bpmdrtlreader (roaming): settings, recent paths, filesystem grants,
  local logs, window/zoom/theme state, and Chromium profile storage. The three
  title-cased/local paths are supported legacy aliases.
  User-authored Markdown remains wherever the user saved it and is never an
  installer cleanup target.

  KeepUserData mirrors Get-CleanupPlan in logic-sim.ps1:
    True  -> keep all app-data targets.
    False -> remove all four fixed current-account targets. }
function CU_DeleteAndCheck(const Path: string): string;
begin
  CU_DelTree(Path);
  if DirExists(Path) then
    Result := Path
  else
    Result := '';
end;

procedure CU_AddFailure(var Failures: string; const Path: string);
begin
  if Path = '' then
    Exit;
  if Failures = '' then
    Failures := Path
  else
    Failures := Failures + #13#10 + Path;
end;

function DeleteUserData(KeepUserData: Boolean): string;
var
  RoamLowerDir, RoamTitleDir, LocalLowerDir, LocalTitleDir: string;
begin
  Result := '';
  if KeepUserData then
    Exit;

  RoamLowerDir := ExpandConstant('{userappdata}\bpmdrtlreader');
  RoamTitleDir := ExpandConstant('{userappdata}\BP MD RTL Reader');
  LocalLowerDir := ExpandConstant('{localappdata}\bpmdrtlreader');
  LocalTitleDir := ExpandConstant('{localappdata}\BP MD RTL Reader');

  CU_AddFailure(Result, CU_DeleteAndCheck(RoamLowerDir));
  CU_AddFailure(Result, CU_DeleteAndCheck(RoamTitleDir));
  CU_AddFailure(Result, CU_DeleteAndCheck(LocalLowerDir));
  CU_AddFailure(Result, CU_DeleteAndCheck(LocalTitleDir));
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
