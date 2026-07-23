{ ============================================================================
  dir-validate.pas  —  Install-directory validation.

  Pure path-shape logic in IsValidPath() (mirrored by IsValidPath in
  tests/installer/logic-sim.ps1). ValidateInstallDir() adds the disk-space
  check and a user-facing message; it is called from NextButtonClick() on the
  directory page in setup.iss.

  Rules (from the spec):
    - free space >= 250 MB on the target drive
    - path length < 200 characters
    - no trailing backslash
    - reject drive roots ('C:\') and non-existent drives ('X:\...')
  ============================================================================ }

const
  DV_MIN_FREE_MB  = 250;
  DV_MAX_PATH_LEN = 200;

{ True when the drive of Path (e.g. 'C:') exists as a filesystem root. }
function DV_DriveExists(const Path: string): Boolean;
var
  Drive: string;
begin
  Drive := ExtractFileDrive(Path);     { 'C:'  for 'C:\Foo'; '' for UNC/relative }
  if Drive = '' then
  begin
    { UNC path (\\server\share) — accept; DirExists check below is unreliable
      for the bare root, so treat shape as valid here. }
    Result := (Copy(Trim(Path), 1, 2) = '\\');
    Exit;
  end;
  Result := DirExists(Drive + '\');
end;

{ Pure path-shape validation (no disk-space I/O). Unicode-safe: Length() counts
  characters, so Arabic/Chinese folder names validate correctly. }
function IsValidPath(const Path: string): Boolean;
var
  P: string;
begin
  P := Trim(Path);
  Result := False;
  if P = '' then Exit;
  if Length(P) >= DV_MAX_PATH_LEN then Exit;     { too long }
  if P[Length(P)] = '\' then Exit;               { trailing backslash }
  if Length(P) < 4 then Exit;                    { too short — also rejects 'C:' and 'C:\' roots }

  { Drive-letter form 'X:\...': reject non-existent drives. (Bare roots such as
    'C:\' are already rejected above by the trailing-backslash / length checks.) }
  if (Length(P) >= 2) and (P[2] = ':') then
  begin
    if not DV_DriveExists(P) then Exit;          { 'X:\...' — drive not present }
  end;

  Result := True;
end;

{ Full validation used by the wizard. Returns False and fills Msg on failure. }
function ValidateInstallDir(const Path: string; var Msg: string): Boolean;
var
  FreeBytes, TotalBytes: Int64;
  Drive, P: string;
begin
  Result := False;
  Msg := '';
  P := Trim(Path);

  if P = '' then
  begin
    Msg := 'Please choose an installation folder.';
    Exit;
  end;
  if Length(P) >= DV_MAX_PATH_LEN then
  begin
    Msg := Format('The installation path is too long.' + #13#10 +
                  'It must be shorter than %d characters.', [DV_MAX_PATH_LEN]);
    Exit;
  end;
  if P[Length(P)] = '\' then
  begin
    Msg := 'The installation path must not end with a backslash (\).';
    Exit;
  end;
  if not IsValidPath(P) then
  begin
    Msg := 'That installation path is not valid.' + #13#10 +
           'Choose a folder on an existing drive (not a drive root such as C:\).';
    Exit;
  end;

  { Free-space check FAILS OPEN: if the drive can't be read (GetSpaceOnDisk64
    returns False) or the path has no drive letter (UNC), we do NOT block the
    install. This matches Test-InstallDir in logic-sim.ps1, whose disk-query
    catch also allows the install through. }
  Drive := ExtractFileDrive(P);
  if Drive <> '' then
  begin
    if GetSpaceOnDisk64(Drive + '\', FreeBytes, TotalBytes) then
    begin
      if FreeBytes < Int64(DV_MIN_FREE_MB) * 1024 * 1024 then
      begin
        Msg := Format('Not enough free disk space on %s.' + #13#10 +
                      'BP MD RTL Reader needs at least %d MB free.', [Drive, DV_MIN_FREE_MB]);
        Exit;
      end;
    end;
  end;

  Result := True;
end;
