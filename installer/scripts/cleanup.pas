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

{ Remove the per-user data folders Marqam writes to.

  The app persists ALL of its state via Electron app.getPath('userData') =
  %APPDATA%\Marqam (roaming): settings, recent files, window/zoom/theme state
  (Chromium 'Local Storage'), and any user notes. %LOCALAPPDATA%\Marqam holds
  only transient caches (GPUCache, etc.). The app does NOT use a dedicated
  'notes' subfolder, so "keep my data" must preserve the whole roaming folder
  rather than a single notes\ child.

  KeepUserData mirrors Get-CleanupPlan in logic-sim.ps1:
    True  -> keep the roaming data folder; clear only the transient local caches.
    False -> remove everything (roaming + local). }
procedure DeleteUserData(KeepUserData: Boolean);
var
  RoamDir, LocalDir: string;
begin
  RoamDir  := ExpandConstant('{userappdata}\Marqam');
  LocalDir := ExpandConstant('{localappdata}\Marqam');
  if KeepUserData then
    CU_DelTree(LocalDir)              { keep roaming settings/notes; drop only caches }
  else
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
  CU_DelFile(ExpandConstant('{userstartup}\Marqam.lnk'));
  CU_DelFile(ExpandConstant('{commonstartup}\Marqam.lnk'));
  CU_DelFile(ExpandConstant('{userdesktop}\Marqam.lnk'));
  CU_DelFile(ExpandConstant('{commondesktop}\Marqam.lnk'));

  { Start-menu program group. }
  CU_DelTree(ExpandConstant('{autoprograms}\Marqam'));
  CU_DelTree(ExpandConstant('{commonprograms}\Marqam'));

  { Application settings. }
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Marqam');
  RegDeleteKeyIncludingSubkeys(HKLM, 'Software\Marqam');

  { File-association verbs ('Open with Marqam') in both hives. }
  RegDeleteKeyIncludingSubkeys(HKLM, 'Software\Classes\.md\shell\Open with Marqam');
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\.md\shell\Open with Marqam');
  RegDeleteKeyIncludingSubkeys(HKLM, 'Software\Classes\.markdown\shell\Open with Marqam');
  RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\.markdown\shell\Open with Marqam');
end;
