; ============================================================================
;  selftest.iss — Pascal unit-test harness for the BP MD RTL Reader installer logic.
;
;  Compiles the REAL production units (version_check.pas + dir_validate.pas)
;  together with the *.test.pas assertion files and runs every assertion inside
;  InitializeSetup, then cancels (installs nothing). Results go to the setup log
;  and (when not silent) a summary message box.
;
;  Build + run is automated by run-pascal-self-test.ps1, or manually:
;     ISCC.exe selftest.iss
;     BP-MD-RTL-Reader-SelfTest.exe /VERYSILENT /LOG="selftest.log"
;     (then grep the log for "RESULT: N passed, 0 failed")
; ============================================================================

[Setup]
AppName=BP MD RTL Reader SelfTest
AppVersion=1.0.0
DefaultDirName={tmp}\BPMDRTLReaderSelfTest
OutputDir=.
OutputBaseFilename=BP-MD-RTL-Reader-SelfTest
CreateAppDir=no
Uninstallable=no
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
DisableFinishedPage=yes

[Code]
{ --- Production units under test (the actual installer code) --- }
#include "..\..\installer\scripts\version_check.pas"
#include "..\..\installer\scripts\dir_validate.pas"

{ --- Assertion harness --- }
var
  T_Pass, T_Fail: Integer;
  T_Report: string;

procedure T_AddResult(const Ok: Boolean; const Name, Detail: string);
begin
  if Ok then
  begin
    T_Pass := T_Pass + 1;
    T_Report := T_Report + 'PASS  ' + Name + #13#10;
    Log('PASS  ' + Name);
  end
  else
  begin
    T_Fail := T_Fail + 1;
    T_Report := T_Report + 'FAIL  ' + Name + '  ' + Detail + #13#10;
    Log('FAIL  ' + Name + '  ' + Detail);
  end;
end;

procedure T_EqInt(const Name: string; Got, Want: Integer);
begin
  T_AddResult(Got = Want, Name, Format('(got %d, want %d)', [Got, Want]));
end;

procedure T_EqStr(const Name, Got, Want: string);
begin
  T_AddResult(Got = Want, Name, Format('(got "%s", want "%s")', [Got, Want]));
end;

procedure T_True(const Name: string; Cond: Boolean);
begin
  T_AddResult(Cond, Name, '(expected True)');
end;

procedure T_False(const Name: string; Cond: Boolean);
begin
  T_AddResult(not Cond, Name, '(expected False)');
end;

{ Informational line (e.g. a skipped, environment-dependent case) — recorded in
  both the on-screen report and the setup log; does not affect pass/fail counts. }
procedure T_Log(const S: string);
begin
  T_Report := T_Report + S + #13#10;
  Log(S);
end;

{ --- Test cases --- }
#include "version_compare.test.pas"
#include "registry_mock.test.pas"

function InitializeSetup: Boolean;
begin
  T_Pass := 0; T_Fail := 0; T_Report := '';
  Log('=== BP MD RTL Reader installer self-test (Pascal) ===');

  Test_CompareVersion;
  Test_DetermineInstallAction;
  Test_IsValidPath;
  Test_RegistryDecision;

  T_Report := T_Report + Format('RESULT: %d passed, %d failed', [T_Pass, T_Fail]) + #13#10;
  Log(Format('RESULT: %d passed, %d failed', [T_Pass, T_Fail]));

  { Write results to a file next to the exe (robust: does not depend on Inno's
    /LOG flushing, which is unreliable when InitializeSetup returns False). }
  SaveStringToFile(ExpandConstant('{src}\selftest-result.txt'), T_Report, False);

  if not WizardSilent then
    MsgBox(T_Report, mbInformation, MB_OK);

  { This is a test harness — never install anything. }
  Result := False;
end;
