<#
  logic-sim.ps1 — PowerShell mirror of the Inno Setup Pascal installer logic.

  Mirrors:
    build/installer/scripts/version-check.pas  -> Compare-VersionInt / CompareVersion / Get-InstallAction / Get-InstalledVersion
    build/installer/scripts/dir-validate.pas   -> IsValidPath / Test-InstallDir
    build/installer/scripts/cleanup.pas        -> Get-CleanupPlan / Get-UninstallTargets

  Dot-source this file (it defines functions only; no side effects). It powers:
    - the Pester unit tests (*.test.ps1)
    - the mutation engine (mutation-runner.ps1)

  Compatible with Windows PowerShell 5.1 and PowerShell 7+ (no ?? / ?. / ternary).
#>

Set-StrictMode -Version Latest

# ----- version-check.pas mirror ---------------------------------------------

function ConvertTo-NormalizedVersion {
    param([string]$V)
    if ($null -eq $V) { $V = '' }
    $v = $V.Trim()
    if ($v.StartsWith('v') -or $v.StartsWith('V')) { $v = $v.Substring(1) }
    $plus = $v.IndexOf('+')
    if ($plus -ge 0) { $v = $v.Substring(0, $plus) }   # drop build metadata
    return $v
}

function Test-NumericIdentifier {
    param([string]$S)
    return ($S -match '^[0-9]+$')
}

function Compare-PreRelease {
    # SemVer pre-release precedence. Returns -1 / 0 / +1.
    param([string]$A, [string]$B)
    $aIds = $A -split '\.'
    $bIds = $B -split '\.'
    $n = [Math]::Max($aIds.Count, $bIds.Count)
    for ($i = 0; $i -lt $n; $i++) {
        $hasA = $i -lt $aIds.Count
        $hasB = $i -lt $bIds.Count
        if ($hasA -and (-not $hasB)) { return 1 }       # more fields => higher
        if ((-not $hasA) -and $hasB) { return -1 }
        $x = $aIds[$i]; $y = $bIds[$i]
        $xn = Test-NumericIdentifier $x
        $yn = Test-NumericIdentifier $y
        if ($xn -and $yn) {
            $ix = [int]$x; $iy = [int]$y
            if ($ix -lt $iy) { return -1 }
            if ($ix -gt $iy) { return 1 }
        } elseif ($xn -and (-not $yn)) {
            return -1                                   # numeric < alphanumeric
        } elseif ((-not $xn) -and $yn) {
            return 1
        } else {
            $c = [string]::CompareOrdinal($x, $y)
            if ($c -lt 0) { return -1 }
            if ($c -gt 0) { return 1 }
        }
    }
    return 0
}

function Compare-VersionInt {
    # Returns -1 (V1<V2), 0 (equal), +1 (V1>V2). Mirrors Pascal CompareVersion.
    param([string]$V1, [string]$V2)
    $a = ConvertTo-NormalizedVersion $V1
    $b = ConvertTo-NormalizedVersion $V2

    $aParts2 = $a -split '-', 2
    $aCore = $aParts2[0]
    $aPre  = if ($aParts2.Count -gt 1) { $aParts2[1] } else { '' }

    $bParts2 = $b -split '-', 2
    $bCore = $bParts2[0]
    $bPre  = if ($bParts2.Count -gt 1) { $bParts2[1] } else { '' }

    $aNums = $aCore -split '\.'
    $bNums = $bCore -split '\.'
    $n = [Math]::Max($aNums.Count, $bNums.Count)
    for ($i = 0; $i -lt $n; $i++) {
        $na = if ($i -lt $aNums.Count) { [int]($aNums[$i] -as [int]) } else { 0 }
        $nb = if ($i -lt $bNums.Count) { [int]($bNums[$i] -as [int]) } else { 0 }
        if ($na -lt $nb) { return -1 }
        if ($na -gt $nb) { return 1 }
    }

    $aHas = -not [string]::IsNullOrEmpty($aPre)
    $bHas = -not [string]::IsNullOrEmpty($bPre)
    if ((-not $aHas) -and (-not $bHas)) { return 0 }
    if ($aHas -and (-not $bHas)) { return -1 }          # 1.0.0-beta < 1.0.0
    if ((-not $aHas) -and $bHas) { return 1 }
    return (Compare-PreRelease $aPre $bPre)
}

function CompareVersion {
    # Symbol form expected by the spec's unit tests: '<' '=' '>'.
    param([string]$V1, [string]$V2)
    $r = Compare-VersionInt $V1 $V2
    if ($r -lt 0) { return '<' }
    if ($r -gt 0) { return '>' }
    return '='
}

function Get-InstallAction {
    # 'fresh' | 'same' | 'older' | 'newer'. Mirrors DetermineInstallAction.
    param([string]$Installed, [string]$Setup)
    if ([string]::IsNullOrWhiteSpace($Installed)) { return 'fresh' }
    $r = Compare-VersionInt $Installed $Setup
    if ($r -eq 0) { return 'same' }
    if ($r -gt 0) { return 'newer' }
    return 'older'
}

function Get-InstalledVersion {
    # Mirrors mode-scoped GetInstalledVersion. A per-machine installer trusts
    # only HKLM version metadata; a current-user installer trusts only HKCU.
    param(
        [ValidateSet('Machine', 'User')]
        [string]$InstallMode = 'Machine',
        [string[]]$SubKeys = @(
            'Software\Microsoft\Windows\CurrentVersion\Uninstall\{32586DF8-1F67-400F-9D8B-6426C3D5B405}_is1',
            'Software\Microsoft\Windows\CurrentVersion\Uninstall\4f0623fc-2d71-59f2-b165-b36fb9982268'
        )
    )
    $hive = if ($InstallMode -eq 'Machine') { 'HKLM:' } else { 'HKCU:' }
    foreach ($sub in $SubKeys) {
        try {
            $p = Get-ItemProperty -Path ($hive + '\' + $sub) -ErrorAction Stop
            if ($null -ne $p.DisplayVersion) { return [string]$p.DisplayVersion }
        } catch {
            # key absent in this mode's protected hive/path — keep looking
        }
    }
    return ''
}

# ----- dir-validate.pas mirror ----------------------------------------------

$script:DV_MIN_FREE_MB  = 250
$script:DV_MAX_PATH_LEN = 200

function IsValidPath {
    # Pure path-shape check. $ExistingDrives lets tests be deterministic.
    param(
        [string]$Path,
        [string[]]$ExistingDrives = $null
    )
    if ($null -eq $Path) { $Path = '' }
    $p = $Path.Trim()
    if ([string]::IsNullOrEmpty($p)) { return $false }
    if ($p.Length -ge $script:DV_MAX_PATH_LEN) { return $false }   # too long
    if ($p.EndsWith('\')) { return $false }                       # trailing backslash
    if ($p.Length -lt 4) { return $false }                        # too short / root (covers 'C:' and 'C:\')

    if (($p.Length -ge 2) -and ($p[1] -eq ':')) {
        $drive = $p.Substring(0, 1).ToUpper()
        if ($null -eq $ExistingDrives) {
            $ExistingDrives = @((Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue).Name)
        }
        if ($ExistingDrives -notcontains $drive) { return $false } # nonexistent drive
    }
    return $true
}

function Get-FreeBytes {
    # Free bytes on the drive of $Path. Throws if the drive can't be queried
    # (its own function so tests can Mock the query failure deterministically).
    param([string]$Path)
    $qualifier = (Split-Path -Qualifier $Path).TrimEnd(':')
    $d = Get-PSDrive -Name $qualifier -ErrorAction Stop
    return [long]$d.Free
}

function Test-InstallDir {
    # Full validation: shape + >= 250 MB free. $FreeBytes -lt 0 => query the disk.
    # Mirrors ValidateInstallDir, INCLUDING fail-open: if the free-space query
    # fails, the install is allowed through rather than blocked.
    param(
        [string]$Path,
        [long]$FreeBytes = -1,
        [int]$MinFreeMB = 250,
        [string[]]$ExistingDrives = $null
    )
    if (-not (IsValidPath -Path $Path -ExistingDrives $ExistingDrives)) {
        return [pscustomobject]@{ Ok = $false; Reason = 'invalid-path' }
    }
    if ($FreeBytes -lt 0) {
        try {
            $FreeBytes = Get-FreeBytes -Path $Path
        } catch {
            return [pscustomobject]@{ Ok = $true; Reason = '' }   # fail-open: disk unreadable
        }
    }
    if ($FreeBytes -lt ([long]$MinFreeMB * 1MB)) {
        return [pscustomobject]@{ Ok = $false; Reason = 'insufficient-space' }
    }
    return [pscustomobject]@{ Ok = $true; Reason = '' }
}

# ----- cleanup.pas mirror ----------------------------------------------------

function Get-CleanupPlan {
    # Mirrors DeleteUserData. KeepUserData=$true preserves every supported
    # current-account profile/cache alias; $false removes the exact allowlist.
    param([bool]$KeepUserData)
    $targets = @(
        '{userappdata}\bpmdrtlreader'
        '{userappdata}\BP MD RTL Reader'
        '{localappdata}\bpmdrtlreader'
        '{localappdata}\BP MD RTL Reader'
    )
    if ($KeepUserData) {
        return [pscustomobject]@{ Delete = @(); Preserve = $targets }
    }
    return [pscustomobject]@{ Delete = $targets; Preserve = @() }
}

function Get-UninstallTargets {
    # The exact set CleanupArtifacts removes. Tests assert this matches the .pas.
    return [pscustomobject]@{
        Files = @(
            '{userstartup}\BP MD RTL Reader.lnk',
            '{commonstartup}\BP MD RTL Reader.lnk',
            '{userdesktop}\BP MD RTL Reader.lnk',
            '{commondesktop}\BP MD RTL Reader.lnk'
        )
        Dirs = @(
            '{userappdata}\bpmdrtlreader',
            '{userappdata}\BP MD RTL Reader',
            '{localappdata}\bpmdrtlreader',
            '{localappdata}\BP MD RTL Reader',
            '{autoprograms}\BP MD RTL Reader',
            '{commonprograms}\BP MD RTL Reader'
        )
        RegKeys = @(
            'HKCU\Software\BP MD RTL Reader',
            'HKLM\Software\BP MD RTL Reader',
            'HKLM\Software\Classes\.md\shell\Open with BP MD RTL Reader',
            'HKCU\Software\Classes\.md\shell\Open with BP MD RTL Reader',
            'HKLM\Software\Classes\.markdown\shell\Open with BP MD RTL Reader',
            'HKCU\Software\Classes\.markdown\shell\Open with BP MD RTL Reader',
            'HKLM\Software\Classes\BP.MD.RTLReader.Markdown',
            'HKCU\Software\Classes\BP.MD.RTLReader.Markdown'
        )
        RegValues = @(
            'HKLM\Software\Classes\.md\OpenWithProgids|BP.MD.RTLReader.Markdown',
            'HKCU\Software\Classes\.md\OpenWithProgids|BP.MD.RTLReader.Markdown',
            'HKLM\Software\Classes\.markdown\OpenWithProgids|BP.MD.RTLReader.Markdown',
            'HKCU\Software\Classes\.markdown\OpenWithProgids|BP.MD.RTLReader.Markdown'
        )
    }
}
