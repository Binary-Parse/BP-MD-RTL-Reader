; ============================================================================
;  BP MD RTL Reader — pinned Inno Setup 6.3.3 installer
;  Compiler: ISCC.exe   |   Output: dist\BP MD RTL Reader Setup.exe   |   x64-only
;
;  Build:   build\installer\build-installer.ps1 (the only supported entry point)
;
;  The product name is "BP MD RTL Reader" (matches package.json productName /
;  appId com.binaryparse.bpmdrtlreader / the bundled BP MD RTL Reader.exe),
;  published by Binary Parse.
; ============================================================================

; ---- Version (overridable from the build script: /DAppVersion=x.y.z) --------
#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif

; ---- Verified source --------------------------------------------------------
; build-installer.ps1 creates and hashes a clean staging tree that exactly
; matches source-manifest-policy.json. Direct compilation is intentionally
; rejected so an ambient recursive source directory cannot be packaged.
#ifndef VerifiedStaging
  #error Use build/installer/build-installer.ps1 to compile a verified payload.
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
#define MyAppURL       "https://github.com/Binary-Parse/BP-MD-RTL-Reader"

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
OutputBaseFilename=BP-MD-RTL-Reader-{#AppVersion}-Windows-Inno-x64
SetupIconFile=assets\icon.ico
WizardImageFile=assets\wizard-banner.bmp
WizardSmallImageFile=assets\wizard-small.bmp
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
ChangesAssociations=yes
#ifdef ReleaseSigning
SignTool=bpmd
SignedUninstaller=yes
#endif
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
; --- Optional, non-destructive .md / .markdown registration -----------------
; The app-owned ProgID supplies the dedicated document icon and Open-with entry.
; The extension defaults are deliberately left unchanged.
Root: HKA; Subkey: "Software\Classes\BP.MD.RTLReader.Markdown"; ValueType: string; ValueName: ""; ValueData: "Markdown Document"; Flags: uninsdeletekey; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\BP.MD.RTLReader.Markdown\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\resources\markdown-file-icon.ico,0"; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\BP.MD.RTLReader.Markdown\shell"; ValueType: string; ValueName: ""; ValueData: "open"; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\BP.MD.RTLReader.Markdown\shell\open"; ValueType: string; ValueName: ""; ValueData: "Open with BP MD RTL Reader"; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\BP.MD.RTLReader.Markdown\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExe}"" ""%1"""; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "BP.MD.RTLReader.Markdown"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "BP.MD.RTLReader.Markdown"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatemd

; Retain the explicit context-menu verbs for classic and current Explorer menus.
Root: HKA; Subkey: "Software\Classes\.md\shell\Open with BP MD RTL Reader"; ValueType: string; ValueName: ""; ValueData: "Open with BP MD RTL Reader"; Flags: uninsdeletekey; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.md\shell\Open with BP MD RTL Reader"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\resources\markdown-file-icon.ico,0"; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.md\shell\Open with BP MD RTL Reader\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExe}"" ""%1"""; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\shell\Open with BP MD RTL Reader"; ValueType: string; ValueName: ""; ValueData: "Open with BP MD RTL Reader"; Flags: uninsdeletekey; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\shell\Open with BP MD RTL Reader"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\resources\markdown-file-icon.ico,0"; Tasks: associatemd
Root: HKA; Subkey: "Software\Classes\.markdown\shell\Open with BP MD RTL Reader\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExe}"" ""%1"""; Tasks: associatemd
[UninstallDelete]
; Leftovers the app may write INTO its own program directory (logs, caches).
; User-data folders are removed conditionally in [Code] (app-data choice),
; never here, because [UninstallDelete] is unconditional.
Type: filesandordirs; Name: "{app}\logs"
Type: dirifempty;     Name: "{app}"

[Run]
Filename: "{app}\{#MyAppExe}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

; ============================================================================
[Code]
#include "scripts\version-check.pas"
#include "scripts\dir-validate.pas"
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
  gCleanupFailures: string;
  gAppOnlyRadio: TNewRadioButton;
  gDeleteDataRadio: TNewRadioButton;
  gAppOnlyNote: TNewStaticText;
  gDeleteDataNote: TNewStaticText;
  gActionButton: TNewButton;

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
    { ONE label only. With MB_OKCANCEL, Inno renders Cancel as a TaskDialog COMMON
      button that never takes a custom label: TaskDialog.pas sets ButtonIDs := [IDOK]
      and then fails with "Invalid ButtonLabels" unless Length(ButtonLabels) = 1. }
    Choice := TaskDialogMsgBox(
      Format('BP MD RTL Reader %s is already installed', [Installed]),
      'What would you like to do?' + #13#10#13#10 +
      'Repair — reinstall the current version.' + #13#10 +
      'Cancel — exit Setup without changes.',
      mbConfirmation, MB_OKCANCEL, ['&Repair'], 0);
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
      mbCriticalError, MB_OKCANCEL, ['&Force install (downgrade)'], 0);  { one label — see above }
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

{ --- Uninstall: offer app-only, full-cleanup, or cancel up front. ------------ }
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

procedure UpdateUninstallChoice;
begin
  gActionButton.Caption := 'Uninstall';
  if gDeleteDataRadio.Checked then
  begin
    gKeepUserData := False;
    gDeleteDataRadio.Font.Color := clRed;
    gDeleteDataRadio.Font.Style := [fsBold];
    gDeleteDataNote.Font.Color := clRed;
    gAppOnlyRadio.Font.Color := clWindowText;
    gAppOnlyRadio.Font.Style := [];
    gAppOnlyNote.Font.Color := clGrayText;
  end
  else
  begin
    gKeepUserData := True;
    gAppOnlyRadio.Font.Color := clHighlight;
    gAppOnlyRadio.Font.Style := [fsBold];
    gAppOnlyNote.Font.Color := clHighlight;
    gDeleteDataRadio.Font.Color := clWindowText;
    gDeleteDataRadio.Font.Style := [];
    gDeleteDataNote.Font.Color := clGrayText;
  end;
end;

procedure UninstallChoiceChanged(Sender: TObject);
begin
  UpdateUninstallChoice;
end;

function ShowUninstallChoiceForm: Boolean;
var
  Form: TSetupForm;
  Heading, Intro, SafetyNote: TNewStaticText;
  CancelButton: TNewButton;
begin
  Form := CreateCustomForm();
  try
    Form.Caption := 'Uninstall BP MD RTL Reader';
    Form.ClientWidth := ScaleX(520);
    Form.ClientHeight := ScaleY(330);
    Form.Position := poScreenCenter;

    Heading := TNewStaticText.Create(Form);
    Heading.Parent := Form;
    Heading.Left := ScaleX(28);
    Heading.Top := ScaleY(24);
    Heading.Width := ScaleX(464);
    Heading.Height := ScaleY(28);
    Heading.Caption := 'Choose what to remove';
    Heading.Font.Size := 14;
    Heading.Font.Style := [fsBold];

    Intro := TNewStaticText.Create(Form);
    Intro.Parent := Form;
    Intro.Left := ScaleX(28);
    Intro.Top := ScaleY(58);
    Intro.Width := ScaleX(464);
    Intro.Height := ScaleY(22);
    Intro.Caption := 'Select whether BP MD RTL Reader should keep its app data.';
    Intro.Font.Color := clGrayText;

    gAppOnlyRadio := TNewRadioButton.Create(Form);
    gAppOnlyRadio.Parent := Form;
    gAppOnlyRadio.Left := ScaleX(36);
    gAppOnlyRadio.Top := ScaleY(94);
    gAppOnlyRadio.Width := ScaleX(448);
    gAppOnlyRadio.Height := ScaleY(22);
    gAppOnlyRadio.Caption := 'Remove app only';
    gAppOnlyRadio.Checked := True;

    gAppOnlyNote := TNewStaticText.Create(Form);
    gAppOnlyNote.Parent := Form;
    gAppOnlyNote.Left := ScaleX(60);
    gAppOnlyNote.Top := ScaleY(120);
    gAppOnlyNote.Width := ScaleX(420);
    gAppOnlyNote.Height := ScaleY(22);
    gAppOnlyNote.Caption := 'Keep settings and app data for a future reinstall.';

    gDeleteDataRadio := TNewRadioButton.Create(Form);
    gDeleteDataRadio.Parent := Form;
    gDeleteDataRadio.Left := ScaleX(36);
    gDeleteDataRadio.Top := ScaleY(158);
    gDeleteDataRadio.Width := ScaleX(448);
    gDeleteDataRadio.Height := ScaleY(22);
    gDeleteDataRadio.Caption := 'Remove app and all app data';

    gDeleteDataNote := TNewStaticText.Create(Form);
    gDeleteDataNote.Parent := Form;
    gDeleteDataNote.Left := ScaleX(60);
    gDeleteDataNote.Top := ScaleY(184);
    gDeleteDataNote.Width := ScaleX(420);
    gDeleteDataNote.Height := ScaleY(40);
    gDeleteDataNote.AutoSize := False;
    gDeleteDataNote.WordWrap := True;
    gDeleteDataNote.Caption := 'Delete settings, recent paths, permissions, logs, profile data, and cache for this Windows account.';

    SafetyNote := TNewStaticText.Create(Form);
    SafetyNote.Parent := Form;
    SafetyNote.Left := ScaleX(28);
    SafetyNote.Top := ScaleY(238);
    SafetyNote.Width := ScaleX(464);
    SafetyNote.Height := ScaleY(22);
    SafetyNote.Caption := 'Your Markdown documents are never deleted.';
    SafetyNote.Font.Style := [fsBold];

    gActionButton := TNewButton.Create(Form);
    gActionButton.Parent := Form;
    gActionButton.Left := ScaleX(238);
    gActionButton.Top := ScaleY(282);
    gActionButton.Width := ScaleX(180);
    gActionButton.Height := ScaleY(28);
    gActionButton.ModalResult := mrOk;
    gActionButton.Default := True;

    CancelButton := TNewButton.Create(Form);
    CancelButton.Parent := Form;
    CancelButton.Left := ScaleX(426);
    CancelButton.Top := ScaleY(282);
    CancelButton.Width := ScaleX(66);
    CancelButton.Height := ScaleY(28);
    CancelButton.Caption := 'Cancel';
    CancelButton.ModalResult := mrCancel;
    CancelButton.Cancel := True;

    gAppOnlyRadio.OnClick := @UninstallChoiceChanged;
    gDeleteDataRadio.OnClick := @UninstallChoiceChanged;
    UpdateUninstallChoice;
    Form.ActiveControl := gAppOnlyRadio;
    Result := Form.ShowModal() = mrOk;
  finally
    Form.Free();
    gAppOnlyRadio := nil;
    gDeleteDataRadio := nil;
    gAppOnlyNote := nil;
    gDeleteDataNote := nil;
    gActionButton := nil;
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
    Result := ShowUninstallChoiceForm;
end;

procedure ShowCleanupIncompleteForm(const Failures: string);
var
  Form: TSetupForm;
  Heading, Explanation, SafetyNote: TNewStaticText;
  Paths: TNewMemo;
  CloseButton: TNewButton;
begin
  Form := CreateCustomForm();
  try
    Form.Caption := 'BP MD RTL Reader Uninstall';
    Form.ClientWidth := ScaleX(520);
    Form.ClientHeight := ScaleY(310);
    Form.Position := poScreenCenter;

    Heading := TNewStaticText.Create(Form);
    Heading.Parent := Form;
    Heading.Left := ScaleX(28);
    Heading.Top := ScaleY(24);
    Heading.Width := ScaleX(464);
    Heading.Height := ScaleY(28);
    Heading.Caption := 'Some app data could not be removed';
    Heading.Font.Size := 13;
    Heading.Font.Style := [fsBold];
    Heading.Font.Color := clRed;

    Explanation := TNewStaticText.Create(Form);
    Explanation.Parent := Form;
    Explanation.Left := ScaleX(28);
    Explanation.Top := ScaleY(62);
    Explanation.Width := ScaleX(464);
    Explanation.Height := ScaleY(38);
    Explanation.AutoSize := False;
    Explanation.WordWrap := True;
    Explanation.Caption := 'The app was uninstalled, but Windows kept the paths below. Close programs using them, then remove the folders manually.';

    Paths := TNewMemo.Create(Form);
    Paths.Parent := Form;
    Paths.Left := ScaleX(28);
    Paths.Top := ScaleY(108);
    Paths.Width := ScaleX(464);
    Paths.Height := ScaleY(92);
    Paths.Text := Failures;
    Paths.ReadOnly := True;
    Paths.ScrollBars := ssVertical;

    SafetyNote := TNewStaticText.Create(Form);
    SafetyNote.Parent := Form;
    SafetyNote.Left := ScaleX(28);
    SafetyNote.Top := ScaleY(214);
    SafetyNote.Width := ScaleX(464);
    SafetyNote.Height := ScaleY(22);
    SafetyNote.Caption := 'Your Markdown documents were not touched.';
    SafetyNote.Font.Style := [fsBold];

    CloseButton := TNewButton.Create(Form);
    CloseButton.Parent := Form;
    CloseButton.Left := ScaleX(402);
    CloseButton.Top := ScaleY(258);
    CloseButton.Width := ScaleX(90);
    CloseButton.Height := ScaleY(28);
    CloseButton.Caption := 'Close';
    CloseButton.ModalResult := mrOk;
    CloseButton.Default := True;
    Form.ActiveControl := CloseButton;
    Form.ShowModal();
  finally
    Form.Free();
  end;
end;

{ --- Uninstall: perform the complete cleanup after files are removed. ------- }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    gCleanupFailures := DeleteUserData(gKeepUserData);
    CleanupArtifacts;
    if gCleanupFailures <> '' then
    begin
      Log('Unable to remove all requested app-data paths:' + #13#10 + gCleanupFailures);
      if not UninstallSilent then
        ShowCleanupIncompleteForm(gCleanupFailures);
    end;
  end;
end;
