{ ============================================================================
  registry-mock.test.pas — hermetic test of the ARP DisplayVersion read +
  install-action decision. A mock replaces the real registry so the test is
  deterministic on any machine. #included by selftest.iss.

  The production GetInstalledVersion(UninstallKey) reads HKLM/HKCU; here we feed
  DetermineInstallAction the value the mock "reads", exercising the same decision
  branch the installer uses (fresh / same / older / newer).
  ============================================================================ }

var
  Mock_KeyExists: Boolean;
  Mock_DisplayVersion: string;

function MockGetInstalledVersion: string;
begin
  if Mock_KeyExists then
    Result := Mock_DisplayVersion
  else
    Result := '';
end;

procedure Test_RegistryDecision;
begin
  { No prior install -> fresh }
  Mock_KeyExists := False; Mock_DisplayVersion := '';
  T_EqStr('reg missing -> fresh',
          DetermineInstallAction(MockGetInstalledVersion, '1.0.0'), 'fresh');

  { Same version installed -> Repair/Cancel prompt }
  Mock_KeyExists := True; Mock_DisplayVersion := '1.0.0';
  T_EqStr('reg 1.0.0 vs setup 1.0.0 -> same',
          DetermineInstallAction(MockGetInstalledVersion, '1.0.0'), 'same');

  { Older installed -> upgrade }
  Mock_DisplayVersion := '0.9.0';
  T_EqStr('reg 0.9.0 vs setup 1.0.0 -> older',
          DetermineInstallAction(MockGetInstalledVersion, '1.0.0'), 'older');

  { Newer installed -> downgrade discouraged }
  Mock_DisplayVersion := '2.5.0';
  T_EqStr('reg 2.5.0 vs setup 1.0.0 -> newer',
          DetermineInstallAction(MockGetInstalledVersion, '1.0.0'), 'newer');
end;
