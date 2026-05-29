; ============================================================================
;  Marqam — Inno Setup 6.3+ installer
;  Compiler: ISCC.exe   |   Output: dist\Marqam-Setup-x64.exe   |   x64-only
;
;  Build:   installer\build-installer.ps1
;  Manual:  ISCC.exe /DAppVersion=1.0.0 installer\setup.iss
;
;  The product name is "Marqam" (matches package.json productName / appId
;  com.marqam.app / the bundled Marqam.exe). The original brief used the
;  spelling "Margam"; that was reconciled to "Marqam" per the codebase.
; ============================================================================

; ---- Version (overridable from the build script: /DAppVersion=x.y.z) --------
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

; ---- Source of the packaged app (electron-builder --dir output) -------------
; Relative to this .iss file (installer\..\dist\win-unpacked). Overridable with
; /DSourceDir=...  Must contain Marqam.exe + the Electron runtime.
#ifndef SourceDir
  #define SourceDir "..\dist\win-unpacked"
#endif

; ---- Stable identity --------------------------------------------------------
; The AppId GUID below also appears (single-brace form) in the [Code] constant
; UNINSTALL_KEY. If you ever regenerate it, change BOTH places.
#define RawGuidNoBrace "32586DF8-1F67-400F-9D8B-6426C3D5B405"
#define MyAppName      "Marqam"
#define MyAppExe       "Marqam.exe"
#define MyPublisher    "Marqam"
#define MyAppURL       "https://github.com/"

[Setup]
; AppId emits as {32586DF8-...}; the {{ escapes a literal '{' and ISPP fills the GUID.
AppId={{{#RawGuidNoBrace}}
AppName={#MyAppName}
AppVersion={#AppVersion}
AppVerName={#MyAppName} {#AppVersion}
AppPublisher={#MyPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#MyAppName}
VersionInfoCompany={#MyPublisher}

; ---- Install location (force the directory page; allow Browse override) -----
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableDirPage=no
DisableProgramGroupPage=auto
AllowNoIcons=yes
UsePreviousAppDir=yes

; ---- Privileges: admin (per-machine) by default; /CURRENTUSER & dialog allowed
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline dialog

; ---- Platform gate: x64 ONLY, Windows 10 22H2 (build 19045) and Windows 11 --
; "x64compatible" alone would also admit Arm64 Win11 (x64-via-emulation); the
; spec is x64-only, so Arm64 is explicitly excluded. To permit Arm64 emulation
; instead, drop "and not arm64" from both directives.
ArchitecturesAllowed=x64compatible and not arm64
ArchitecturesInstallIn64BitMode=x64compatible and not arm64
MinVersion=10.0.19045

; ---- ARP / Windows "Installed apps" entry -----------------------------------
UninstallDisplayName={#MyAppName} Markdown Reader
UninstallDisplayIcon={app}\{#MyAppExe}

; ---- Output -----------------------------------------------------------------
OutputDir=..\dist
OutputBaseFilename=Marqam-Setup-x64
SetupIconFile=assets\marqam.ico
WizardImageFile=assets\wizard-banner.bmp
WizardSmallImageFile=assets\wizard-small.bmp
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
; Inno Setup 6 scripts are always Unicode -> non-ASCII (Arabic/Chinese) install
; paths and folder names are handled correctly end-to-end.

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "associatemd";  Description: "Add an ""Open with Marqam"" entry to .md and .markdown files"

[Files]
; Package the entire x64 build tree.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}";              Filename: "{app}\{#MyAppExe}"; IconFilename: "{app}\{#MyAppExe}"
Name: "{group}\Uninstall {#MyAppName}";    Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}";        Filename: "{app}\{#MyAppExe}"; IconFilename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Registry]
; --- Optional, non-destructive .md / .markdown context-menu verb -------------
; Adds a labelled "Open with Marqam" verb WITHOUT hijacking the default handler.
; HKA = auto hive (HKLM per-machine / HKCU per-user). uninsdeletekey removes the
; whole verb subtree on uninstall.
Root: HKA; Subkey: "Software\Classes\.md\shell\Open with Marqam"; ValueType: string; ValueName: ""; ValueData: "Open with Marqam"; Flags: uninsdeletekey; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.md\shell\Open with Marqam"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExe},0"; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.md\shell\Open with Marqam\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExe}"" ""%1"""; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\shell\Open with Marqam"; ValueType: string; ValueName: ""; ValueData: "Open with Marqam"; Flags: uninsdeletekey; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\shell\Open with Marqam"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExe},0"; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\shell\Open with Marqam\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExe}"" ""%1"""; Tasks: associatemd

[UninstallDelete]
; Leftovers the app may write INTO its own program directory (logs, caches).
; User-data folders are removed conditionally in [Code] (keep-notes choice),
; never here, because [UninstallDelete] is unconditional.
Type: filesandordirs; Name: "{app}\logs"
Type: dirifempty;     Name: "{app}"

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

; ============================================================================
[Code]
#include "scripts\version_check.pas"
#include "scripts\dir_validate.pas"
#include "scripts\cleanup.pas"

const
  { Single-brace form of AppId — keep the GUID in sync with [Setup] AppId above. }
  UNINSTALL_KEY = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{32586DF8-1F67-400F-9D8B-6426C3D5B405}_is1';
  { electron-builder NSIS uninstall key for Marqam — a UUID v5 derived from the
    appId 'com.marqam.app' (nsis.guid 'Marqam'). Lets THIS installer detect an
    app already installed by the electron-builder NSIS installer. Stable unless
    appId/guid changes; verify with: reg query HKLM\...\Uninstall /s /f Marqam }
  EB_NSIS_KEY   = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\e3a47a7c-4d6c-503c-a136-ddaaea18a540';
  APP_VERSION   = '{#AppVersion}';

var
  gKeepUserData: Boolean;
  gExistingUninstaller: string;

{ --- Detect an existing install (this installer's Inno _is1 key OR the
      electron-builder NSIS key), across both hives and both registry views;
      record its uninstaller command in gExistingUninstaller. ---------------- }
function DetectInstalled: string;
var
  U: string;
begin
  gExistingUninstaller := '';
  Result := GetInstalledInfo(UNINSTALL_KEY, U);
  if Result <> '' then begin gExistingUninstaller := U; Exit; end;
  Result := GetInstalledInfo(EB_NSIS_KEY, U);
  if Result <> '' then gExistingUninstaller := U;
end;

{ --- Run the detected uninstaller silently and wait for it. ----------------- }
function RunExistingUninstaller: Boolean;
var
  Exe, Params: string;
  ResultCode: Integer;
begin
  Result := False;
  if Trim(gExistingUninstaller) = '' then Exit;
  { gExistingUninstaller is the QuietUninstallString when available, so it already
    carries the right silent switch (/SILENT for Inno, /S for NSIS). }
  SplitCommand(gExistingUninstaller, Exe, Params);
  if Exe = '' then Exit;
  { NOTE: an Inno/NSIS uninstaller may relaunch from a temp copy, so
    ewWaitUntilTerminated can return early; benign here because the only caller
    (Action='same' -> Remove) sets Result:=False right after and Setup exits. }
  Result := Exec(Exe, Params, '', SW_SHOW, ewWaitUntilTerminated, ResultCode);
end;

{ --- MANDATORY version detection before any file copy. --------------------- }
function InitializeSetup: Boolean;
var
  Installed, Action: string;
  Choice: Integer;
begin
  Result := True;
  Installed := DetectInstalled;
  Action := DetermineInstallAction(Installed, APP_VERSION);
  Log(Format('Version check: installed="%s" setup="%s" action=%s', [Installed, APP_VERSION, Action]));

  if Action = 'fresh' then
    Exit;                                   { nothing installed — proceed }

  if Action = 'same' then
  begin
    if WizardSilent then
      Exit;                                 { silent: reinstall/repair over the top }
    Choice := TaskDialogMsgBox(
      Format('Marqam %s is already installed', [Installed]),
      'What would you like to do?' + #13#10#13#10 +
      'Repair — reinstall the current version.' + #13#10 +
      'Remove — uninstall Marqam from this PC.' + #13#10 +
      'Cancel — exit Setup without changes.',
      mbConfirmation, MB_YESNOCANCEL, ['&Repair', 'Re&move', 'Cancel'], 0);
    if Choice = IDYES then
      Result := True
    else if Choice = IDNO then
    begin
      RunExistingUninstaller;
      Result := False;                      { stop Setup after launching uninstaller }
    end
    else
      Result := False;
    Exit;
  end;

  if Action = 'newer' then
  begin
    if WizardSilent then
    begin
      Log('Refusing silent downgrade (installed ' + Installed +
          ' > setup ' + APP_VERSION + ').');
      Result := False;                      { never silently downgrade }
      Exit;
    end;
    Choice := TaskDialogMsgBox(
      'A newer version of Marqam is already installed',
      Format('Installed version: %s' + #13#10 +
             'This installer:    %s' + #13#10#13#10 +
             'Downgrading is not recommended and may corrupt newer settings.', [Installed, APP_VERSION]),
      mbCriticalError, MB_OKCANCEL, ['&Force install (downgrade)', 'Cancel'], 0);
    Result := (Choice = IDOK);
    Exit;
  end;

  { Action = 'older'  ->  upgrade in place. }
  if not WizardSilent then
    TaskDialogMsgBox(
      'Upgrading Marqam',
      Format('Upgrading from %s to %s.' + #13#10 +
             'Your notes and settings will be preserved.', [Installed, APP_VERSION]),
      mbInformation, MB_OK, [], 0);
  Result := True;
end;

{ --- Validate the chosen directory when leaving the Select-Dir page. -------- }
function NextButtonClick(CurPageID: Integer): Boolean;
var
  Msg: string;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    if not ValidateInstallDir(WizardDirValue, Msg) then
    begin
      MsgBox(Msg, mbError, MB_OK);
      Result := False;                      { stay on the page }
    end;
  end;
end;

{ --- Uninstall: ask the single keep-data question up front. ----------------- }
function InitializeUninstall: Boolean;
begin
  Result := True;
  if UninstallSilent then
    gKeepUserData := False                  { spec default: silent removes everything }
  else
    gKeepUserData :=
      MsgBox('Keep your Marqam settings and data?' + #13#10#13#10 +
             'Yes  — keep your data folder (%APPDATA%\Marqam: settings, recent files, notes) and remove only the program.' + #13#10 +
             'No   — remove everything, including settings and data.',
             mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
end;

{ --- Uninstall: perform the complete cleanup after files are removed. ------- }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DeleteUserData(gKeepUserData);
    CleanupArtifacts;
  end;
end;
