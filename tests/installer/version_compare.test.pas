{ ============================================================================
  version_compare.test.pas — Pascal assertions for the production version &
  path logic in installer/scripts/version_check.pas and dir_validate.pas.

  Included by selftest.iss, which compiles these together with the REAL units
  and supplies the T_* assertion harness (T_EqInt / T_EqStr / T_True / T_False).
  This exercises the exact Pascal the installer runs — not a reimplementation.
  ============================================================================ }

procedure Test_CompareVersion;
begin
  T_EqInt('1.0.0 < 1.0.1',              CompareVersion('1.0.0', '1.0.1'), -1);
  T_EqInt('2.0.0 > 1.9.9',              CompareVersion('2.0.0', '1.9.9'),  1);
  T_EqInt('1.0.0 = 1.0.0',              CompareVersion('1.0.0', '1.0.0'),  0);
  T_EqInt('1.0.0-beta < 1.0.0',         CompareVersion('1.0.0-beta', '1.0.0'), -1);
  T_EqInt('1.0.0 > 1.0.0-beta',         CompareVersion('1.0.0', '1.0.0-beta'),  1);
  T_EqInt('1.0.10 > 1.0.9 (numeric)',   CompareVersion('1.0.10', '1.0.9'),  1);
  T_EqInt('1.2 = 1.2.0 (zero-pad)',     CompareVersion('1.2', '1.2.0'),     0);
  T_EqInt('v1.0.1 > v1.0.0 (strip v)',  CompareVersion('v1.0.1', 'v1.0.0'), 1);
  T_EqInt('alpha < beta (prerelease)',  CompareVersion('1.0.0-alpha', '1.0.0-beta'), -1);
  T_EqInt('alpha.1 < alpha.2',          CompareVersion('1.0.0-alpha.1', '1.0.0-alpha.2'), -1);
end;

procedure Test_DetermineInstallAction;
begin
  T_EqStr('empty -> fresh',  DetermineInstallAction('',      '1.0.0'), 'fresh');
  T_EqStr('equal -> same',   DetermineInstallAction('1.0.0', '1.0.0'), 'same');
  T_EqStr('older -> older',  DetermineInstallAction('0.9.0', '1.0.0'), 'older');
  T_EqStr('newer -> newer',  DetermineInstallAction('2.0.0', '1.0.0'), 'newer');
end;

{ Find a drive letter (D..Z) with no filesystem root, so the "non-existent
  drive" assertion is deterministic even on machines that happen to have an X:
  drive (mapped share, USB, RAM disk). Returns '' if every letter exists. }
function FirstAbsentDriveLetter: string;
var
  C: Integer;
begin
  Result := '';
  for C := Ord('D') to Ord('Z') do
    if not DirExists(Chr(C) + ':\') then
    begin
      Result := Chr(C);
      Exit;
    end;
end;

procedure Test_IsValidPath;
var
  L: string;
begin
  T_True ('valid Program Files path',       IsValidPath('C:\Program Files\BP MD RTL Reader'));
  T_False('drive root C:\ rejected',        IsValidPath('C:\'));
  T_False('trailing backslash rejected',    IsValidPath('C:\BP MD RTL Reader\'));
  T_False('empty rejected',                 IsValidPath(''));

  L := FirstAbsentDriveLetter;
  if L <> '' then
    T_False('nonexistent drive ' + L + ':\ rejected', IsValidPath(L + ':\BP MD RTL Reader'))
  else
    T_Log('SKIP nonexistent-drive test (no absent drive letter D..Z)');
end;
