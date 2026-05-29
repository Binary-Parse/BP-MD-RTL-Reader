<#
  path_validate.test.ps1 — Pester unit tests for IsValidPath / Test-InstallDir
  (mirror of installer/scripts/dir_validate.pas). Drive existence and free space
  are injected (-ExistingDrives / -FreeBytes) so the tests are deterministic on
  any machine and exercise every branch.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'logic-sim.ps1')
}

Describe 'IsValidPath — spec cases' {
    It 'C:\Program Files\Marqam is valid' { IsValidPath 'C:\Program Files\Marqam' -ExistingDrives @('C') | Should -BeTrue }
    It 'C:\ (drive root) is invalid'      { IsValidPath 'C:\' -ExistingDrives @('C') | Should -BeFalse }
    It 'X:\Marqam (missing drive) invalid'{ IsValidPath 'X:\Marqam' -ExistingDrives @('C') | Should -BeFalse }
}

Describe 'IsValidPath — shape rules' {
    It 'empty string is invalid'              { IsValidPath '' -ExistingDrives @('C') | Should -BeFalse }
    It 'whitespace-only is invalid'           { IsValidPath '    ' -ExistingDrives @('C') | Should -BeFalse }
    It 'trailing backslash is invalid'        { IsValidPath 'C:\Marqam\' -ExistingDrives @('C') | Should -BeFalse }
    It 'bare drive (C:, no slash) invalid'    { IsValidPath 'C:' -ExistingDrives @('C') | Should -BeFalse }
    It 'too short (3 chars, non-drive) invalid' { IsValidPath 'a\b' -ExistingDrives @('C') | Should -BeFalse }
    It '>= 200 chars is invalid'              { IsValidPath ('C:\' + ('a' * 210)) -ExistingDrives @('C') | Should -BeFalse }
    It 'existing drive folder is valid'       { IsValidPath 'C:\Apps\Marqam' -ExistingDrives @('C') | Should -BeTrue }
    It 'UNC path (no drive letter) is valid'  { IsValidPath '\\server\share\Marqam' -ExistingDrives @('C') | Should -BeTrue }

    # Drive-set override must actually drive the decision (pins the existence check
    # and the $null -eq $ExistingDrives short-circuit):
    It 'C:\ rejected when C is not in the provided drive set' {
        IsValidPath 'C:\Apps\Marqam' -ExistingDrives @('Z') | Should -BeFalse
    }
    It 'D:\ accepted when D IS in the provided drive set' {
        IsValidPath 'D:\Apps\Marqam' -ExistingDrives @('D') | Should -BeTrue
    }
}

Describe 'Test-InstallDir — shape + free-space validation' {
    It 'valid path + ample space -> Ok, no reason' {
        $r = Test-InstallDir -Path 'C:\Apps\Marqam' -FreeBytes (500MB) -ExistingDrives @('C')
        $r.Ok | Should -BeTrue
        $r.Reason | Should -Be ''
    }
    It 'invalid path -> not Ok, reason invalid-path' {
        $r = Test-InstallDir -Path 'C:\' -ExistingDrives @('C')
        $r.Ok | Should -BeFalse
        $r.Reason | Should -Be 'invalid-path'
    }
    It 'insufficient space -> not Ok, reason insufficient-space' {
        $r = Test-InstallDir -Path 'C:\Apps\Marqam' -FreeBytes (10MB) -ExistingDrives @('C')
        $r.Ok | Should -BeFalse
        $r.Reason | Should -Be 'insufficient-space'
    }
    It 'exactly 250 MB free -> Ok (threshold is "less than")' {
        (Test-InstallDir -Path 'C:\Apps\Marqam' -FreeBytes (250MB) -ExistingDrives @('C')).Ok | Should -BeTrue
    }
    It 'one byte below 250 MB -> insufficient' {
        (Test-InstallDir -Path 'C:\Apps\Marqam' -FreeBytes (250MB - 1) -ExistingDrives @('C')).Ok | Should -BeFalse
    }
    It 'FreeBytes=0 is honoured (not overridden by a disk query)' {
        (Test-InstallDir -Path 'C:\Apps\Marqam' -FreeBytes 0 -ExistingDrives @('C')).Ok | Should -BeFalse
    }
    It 'fails OPEN when the free-space query throws (disk unreadable)' {
        Mock Get-FreeBytes { throw 'cannot read disk' }
        (Test-InstallDir -Path 'C:\Apps\Marqam' -ExistingDrives @('C')).Ok | Should -BeTrue
    }
}
