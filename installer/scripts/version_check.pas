{ ============================================================================
  version_check.pas  —  Semantic-version parsing, comparison & registry probe.

  Pure logic (no UI). #included into the [Code] section of setup.iss AND of
  tests/installer/selftest.iss, and mirrored 1:1 by the PowerShell functions in
  tests/installer/logic-sim.ps1 (Compare-VersionInt / Get-InstallAction).

  CompareVersion(V1, V2) returns:
      -1  when V1 < V2
       0  when V1 = V2
      +1  when V1 > V2
  (The PowerShell mirror's CompareVersion returns the symbols '<' '=' '>';
   the integer form lives in Compare-VersionInt. Keep both in sync.)
  ============================================================================ }

{ Returns the substring of S up to (but excluding) the first Delim, and removes
  that token + the delimiter from S. If Delim is absent, returns all of S and
  leaves S empty. }
function VC_NextToken(var S: string; const Delim: string): string;
var
  P: Integer;
begin
  P := Pos(Delim, S);
  if P = 0 then
  begin
    Result := S;
    S := '';
  end
  else
  begin
    Result := Copy(S, 1, P - 1);
    Delete(S, 1, P + Length(Delim) - 1);
  end;
end;

{ True when S is a non-empty run of ASCII digits. }
function VC_IsNumeric(const S: string): Boolean;
var
  I: Integer;
begin
  Result := Length(S) > 0;
  for I := 1 to Length(S) do
    if (S[I] < '0') or (S[I] > '9') then
      Result := False;
end;

{ Trim and strip an optional leading 'v'/'V'. }
function VC_StripLeadingV(const S: string): string;
begin
  Result := Trim(S);
  if (Length(Result) > 0) and ((Result[1] = 'v') or (Result[1] = 'V')) then
    Result := Copy(Result, 2, Length(Result) - 1);
end;

{ Compare two dotted numeric cores (e.g. '1.2.0' vs '1.2'). Missing components
  are treated as 0, so '1.2' = '1.2.0'. }
function VC_CompareCore(const A, B: string): Integer;
var
  Ca, Cb, Ta, Tb: string;
  Na, Nb: Integer;
begin
  Ca := A;
  Cb := B;
  Result := 0;
  while ((Ca <> '') or (Cb <> '')) and (Result = 0) do
  begin
    Ta := VC_NextToken(Ca, '.');
    Tb := VC_NextToken(Cb, '.');
    Na := StrToIntDef(Ta, 0);
    Nb := StrToIntDef(Tb, 0);
    if Na < Nb then
      Result := -1
    else if Na > Nb then
      Result := 1;
  end;
end;

{ Compare two pre-release strings per SemVer precedence rules:
    - identifiers compared left-to-right on '.';
    - numeric identifiers compared numerically;
    - numeric identifiers rank lower than alphanumeric;
    - a larger set of fields wins when all preceding fields are equal. }
function VC_ComparePre(const A, B: string): Integer;
var
  Pa, Pb, Ta, Tb: string;
  Na, Nb: Integer;
  IsNa, IsNb, HasA, HasB: Boolean;
begin
  Pa := A;
  Pb := B;
  Result := 0;
  while ((Pa <> '') or (Pb <> '')) and (Result = 0) do
  begin
    HasA := Pa <> '';
    HasB := Pb <> '';
    Ta := VC_NextToken(Pa, '.');
    Tb := VC_NextToken(Pb, '.');
    if HasA and (not HasB) then
      Result := 1
    else if (not HasA) and HasB then
      Result := -1
    else
    begin
      IsNa := VC_IsNumeric(Ta);
      IsNb := VC_IsNumeric(Tb);
      if IsNa and IsNb then
      begin
        Na := StrToIntDef(Ta, 0);
        Nb := StrToIntDef(Tb, 0);
        if Na < Nb then
          Result := -1
        else if Na > Nb then
          Result := 1;
      end
      else if IsNa and (not IsNb) then
        Result := -1
      else if (not IsNa) and IsNb then
        Result := 1
      else
      begin
        if CompareStr(Ta, Tb) < 0 then
          Result := -1
        else if CompareStr(Ta, Tb) > 0 then
          Result := 1;
      end;
    end;
  end;
end;

function CompareVersion(const V1, V2: string): Integer;
var
  A, B, CoreA, CoreB, PreA, PreB: string;
  C, P: Integer;
  HasPreA, HasPreB: Boolean;
begin
  A := VC_StripLeadingV(V1);
  B := VC_StripLeadingV(V2);

  { Drop build metadata (everything from a '+'), which never affects precedence. }
  P := Pos('+', A);
  if P > 0 then A := Copy(A, 1, P - 1);
  P := Pos('+', B);
  if P > 0 then B := Copy(B, 1, P - 1);

  { Split core / pre-release on the first '-'. }
  CoreA := A; PreA := '';
  P := Pos('-', A);
  if P > 0 then
  begin
    CoreA := Copy(A, 1, P - 1);
    PreA := Copy(A, P + 1, Length(A) - P);
  end;

  CoreB := B; PreB := '';
  P := Pos('-', B);
  if P > 0 then
  begin
    CoreB := Copy(B, 1, P - 1);
    PreB := Copy(B, P + 1, Length(B) - P);
  end;

  C := VC_CompareCore(CoreA, CoreB);
  if C <> 0 then
  begin
    Result := C;
    Exit;
  end;

  HasPreA := PreA <> '';
  HasPreB := PreB <> '';
  if (not HasPreA) and (not HasPreB) then
    Result := 0
  else if HasPreA and (not HasPreB) then
    Result := -1            { 1.0.0-beta  <  1.0.0 }
  else if (not HasPreA) and HasPreB then
    Result := 1             { 1.0.0       >  1.0.0-beta }
  else
    Result := VC_ComparePre(PreA, PreB);
end;

{ Decide what the installer should do given the currently-installed version
  (empty string = nothing installed) and the version being installed.
  Returns: 'fresh' | 'same' | 'older' | 'newer'
    fresh -> no prior install
    same  -> identical version present  (offer Repair / Remove)
    older -> an older version present   (upgrade in place)
    newer -> a newer version present    (downgrade — discouraged) }
function DetermineInstallAction(const Installed, Setup: string): string;
var
  C: Integer;
begin
  if Trim(Installed) = '' then
  begin
    Result := 'fresh';
    Exit;
  end;
  C := CompareVersion(Installed, Setup);
  if C = 0 then
    Result := 'same'
  else if C > 0 then
    Result := 'newer'
  else
    Result := 'older';
end;

{ Try one (RootKey, SubKey): if DisplayVersion exists and is non-empty, set V
  and the best uninstaller command (QuietUninstallString preferred, so the right
  silent switch is used for whichever installer wrote the key) and return True. }
function VC_TryKey(const RootKey: Integer; const SubKey: string; var V, U: string): Boolean;
begin
  Result := False;
  V := '';
  U := '';
  if RegQueryStringValue(RootKey, SubKey, 'DisplayVersion', V) and (V <> '') then
  begin
    if not RegQueryStringValue(RootKey, SubKey, 'QuietUninstallString', U) then
      RegQueryStringValue(RootKey, SubKey, 'UninstallString', U);
    Result := True;
  end;
end;

{ Read DisplayVersion (+ uninstaller command) for SubKey across BOTH hives and
  BOTH registry views. A per-machine x64 install writes to the HKLM 64-bit view;
  a per-user install to HKCU; reading only the default view misses it. Returns
  '' (and empty UninstStr) when the key is absent everywhere. }
function GetInstalledInfo(const SubKey: string; var UninstStr: string): string;
var
  V, U: string;
begin
  Result := '';
  UninstStr := '';
  if VC_TryKey(HKLM64, SubKey, V, U) then begin Result := V; UninstStr := U; Exit; end;
  if VC_TryKey(HKLM32, SubKey, V, U) then begin Result := V; UninstStr := U; Exit; end;
  if VC_TryKey(HKCU64, SubKey, V, U) then begin Result := V; UninstStr := U; Exit; end;
  if VC_TryKey(HKCU32, SubKey, V, U) then begin Result := V; UninstStr := U; Exit; end;
end;

{ Split a registry uninstall command (e.g. '"C:\..\unins000.exe" /SILENT' or
  '"C:\..\Uninstall Marqam.exe" /allusers /S') into the executable path and its
  argument string, honouring a leading quoted path. }
procedure SplitCommand(const Cmd: string; var Exe, Params: string);
var
  S: string;
  P: Integer;
begin
  S := Trim(Cmd);
  Exe := '';
  Params := '';
  if S = '' then Exit;
  if S[1] = '"' then
  begin
    P := Pos('"', Copy(S, 2, Length(S) - 1));   { closing quote, relative to pos 2 }
    if P = 0 then begin Exe := Copy(S, 2, Length(S) - 1); Exit; end;
    Exe := Copy(S, 2, P - 1);
    Params := Trim(Copy(S, P + 2, Length(S)));
  end
  else
  begin
    P := Pos(' ', S);
    if P = 0 then
      Exe := S
    else
    begin
      Exe := Copy(S, 1, P - 1);
      Params := Trim(Copy(S, P + 1, Length(S)));
    end;
  end;
end;
