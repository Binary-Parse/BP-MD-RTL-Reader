; ============================================================================
;  BP MD RTL Reader — pinned Inno Setup 6.3.3 installer
;  Compiler: ISCC.exe   |   Output: dist\BP MD RTL Reader Setup.exe   |   x64-only
;
;  Build:   installer\build-installer.ps1 (the only supported entry point)
;
;  The product name is "BP MD RTL Reader" (matches package.json productName /
;  appId com.binaryparse.bpmdrtlreader / the bundled BP MD RTL Reader.exe),
;  published by Binary Parse.
; ============================================================================

; ---- Version (overridable from the build script: /DAppVersion=x.y.z) --------
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

; ---- Verified source --------------------------------------------------------
; build-installer.ps1 creates and hashes a clean staging tree that exactly
; matches source-manifest-policy.json. Direct compilation is intentionally
; rejected so an ambient recursive source directory cannot be packaged.
#ifndef VerifiedStaging
  #error Use installer/build-installer.ps1 to compile a verified payload.
#endif
#ifndef SourceDir
  #error The verified staging directory was not supplied.
#endif

; ---- Stable identity --------------------------------------------------------
; The AppId GUID below also appears (single-brace form) in the [Code] constant
; UNINSTALL_KEY. If you ever regenerate it, change BOTH places.
#define RawGuidNoBrace "32586DF8-1F67-400F-9D8B-6426C3D5B405"
#define MyAppName      "BP MD RTL Reader"
#define MyAppExe       "BP MD RTL Reader.exe"
#define MyPublisher    "Binary Parse"
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
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExe}

; ---- Output -----------------------------------------------------------------
OutputDir=..\dist
OutputBaseFilename=BP MD RTL Reader Setup
SetupIconFile=assets\icon.ico
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
Name: "associatemd";  Description: "Add an ""Open with BP MD RTL Reader"" entry to .md and .markdown files"

[Files]
; This recursion is confined to the freshly-created, exact-manifest staging tree.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#MyAppName}";              Filename: "{app}\{#MyAppExe}"; IconFilename: "{app}\{#MyAppExe}"
Name: "{group}\Uninstall {#MyAppName}";    Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}";        Filename: "{app}\{#MyAppExe}"; IconFilename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Registry]
; --- Optional, non-destructive .md / .markdown context-menu verb -------------
; Adds a labelled "Open with BP MD RTL Reader" verb WITHOUT hijacking the default handler.
; HKA = auto hive (HKLM per-machine / HKCU per-user). uninsdeletekey removes the
; whole verb subtree on uninstall.
Root: HKA; Subkey: "Software\Classes\.md\shell\Open with BP MD RTL Reader"; ValueType: string; ValueName: ""; ValueData: "Open with BP MD RTL Reader"; Flags: uninsdeletekey; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.md\shell\Open with BP MD RTL Reader"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExe},0"; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.md\shell\Open with BP MD RTL Reader\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExe}"" ""%1"""; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\shell\Open with BP MD RTL Reader"; ValueType: string; ValueName: ""; ValueData: "Open with BP MD RTL Reader"; Flags: uninsdeletekey; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\shell\Open with BP MD RTL Reader"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#MyAppExe},0"; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\shell\Open with BP MD RTL Reader\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExe}"" ""%1"""; Tasks: associatemd

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
  { electron-builder NSIS uninstall key for BP MD RTL Reader — a UUID v5 derived
    from the appId 'com.binaryparse.bpmdrtlreader' (package.json nsis.guid is left
    unset, so electron-builder uses the derived UUID). Lets THIS installer detect
    an app already installed by the electron-builder NSIS installer. Stable unless
    the appId changes; verify with: reg query HKLM\...\Uninstall /s /f "BP MD RTL Reader" }
  EB_NSIS_KEY   = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\4f0623fc-2d71-59f2-b165-b36fb9982268';
  APP_VERSION   = '{#AppVersion}';

var
  gKeepUserData: Boolean;

{ --- Detect only a version in the registry hive appropriate to this setup's
      privilege mode. Registry command strings are never read or executed. ---- }
function DetectInstalled: string;
begin
  Result := GetInstalledVersion(UNINSTALL_KEY, IsAdminInstallMode);
  if Result <> '' then Exit;
  Result := GetInstalledVersion(EB_NSIS_KEY, IsAdminInstallMode);
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
        Format('BP MD RTL Reader %s is already installed', [Installed]),
        'What would you like to do?' + #13#10#13#10 +
        'Repair — reinstall the current version.' + #13#10 +
        'Cancel — exit Setup without changes.',
        mbConfirmation, MB_OKCANCEL, ['&Repair', 'Cancel'], 0);
      Result := (Choice = IDOK);
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
      'A newer version of BP MD RTL Reader is already installed',
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
      'Upgrading BP MD RTL Reader',
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
function HasCommandLineParam(const Expected: string): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
  begin
    if CompareText(ParamStr(I), Expected) = 0 then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

function InitializeUninstall: Boolean;
begin
  Result := True;
  if UninstallSilent then
    gKeepUserData := not HasCommandLineParam('/DELETEUSERDATA')
  else if HasCommandLineParam('/DELETEUSERDATA') then
    gKeepUserData := False
  else
    gKeepUserData :=
      MsgBox('Keep your BP MD RTL Reader settings and data?' + #13#10#13#10 +
             'Yes  — keep your app profile (%APPDATA%\BP MD RTL Reader: settings, recent paths, grants, and logs) and remove only the program.' + #13#10 +
             'No   — remove that app profile too. Markdown files saved elsewhere are never removed.',
             mbConfirmation, MB_YESNO or MB_DEFBUTTON1) = IDYES;
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
