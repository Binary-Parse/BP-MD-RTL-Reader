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

{ Read DisplayVersion from the ARP/Uninstall key, preferring the per-machine
  hive and falling back to the per-user hive. Returns '' when not present. }
function GetInstalledVersion(const UninstallKey: string): string;
var
  V: string;
begin
  Result := '';
  if RegQueryStringValue(HKLM, UninstallKey, 'DisplayVersion', V) then
    Result := V
  else if RegQueryStringValue(HKCU, UninstallKey, 'DisplayVersion', V) then
    Result := V;
end;
