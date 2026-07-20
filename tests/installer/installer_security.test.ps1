<#
  installer_security.test.ps1 — regression tests for SEC-001, SEC-002 and
  DATA-011. These assertions inspect the real installer sources instead of a
  copied command runner so registry-controlled text cannot regain an elevated
  execution sink unnoticed.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:Nsis = Get-Content -Raw (Join-Path $RepoRoot 'installer\installer.nsh')
    $script:Inno = Get-Content -Raw (Join-Path $RepoRoot 'installer\setup.iss')
    $script:Version = Get-Content -Raw (Join-Path $RepoRoot 'installer\scripts\version_check.pas')
}

Describe 'Elevated installer command boundaries' {
    It 'NSIS never executes an uninstall command or install location read from the registry' {
        $Nsis | Should -Not -Match '(?m)^\s*ExecWait\b'
        $Nsis | Should -Not -Match 'QuietUninstallString'
        $Nsis | Should -Not -Match 'InstallLocation'
        $Nsis | Should -Not -Match 'RemovePreviousInstall'
    }

    It 'Inno detects versions but exposes no registry-command execution path' {
        $Inno | Should -Not -Match 'gExistingUninstaller'
        $Inno | Should -Not -Match 'RunExistingUninstaller'
        $Inno | Should -Not -Match '\bSplitCommand\s*\('
        $Inno | Should -Not -Match '\bExec\s*\(Exe\s*,'
        $Version | Should -Not -Match 'QuietUninstallString'
        $Version | Should -Not -Match 'UninstallString'
    }

    It 'same-version setup offers repair or cancel without an elevated Remove action' {
        $Inno | Should -Match 'Repair.*reinstall the current version'
        $Inno | Should -Not -Match 'Remove.*uninstall BP MD RTL Reader from this PC'
        $Inno | Should -Not -Match "\['&Repair',\s*'Re&move'"
    }
}

Describe 'Profile-preserving uninstall defaults' {
    It 'Inno silent uninstall preserves data unless DELETEUSERDATA is explicit' {
        $Inno | Should -Match "gKeepUserData\s*:=\s*not CmdLineParamExists\('/DELETEUSERDATA'\)"
        $Inno | Should -Match 'MB_YESNO or MB_DEFBUTTON1'
    }

    It 'NSIS silent uninstall preserves data and supports explicit deletion' {
        $Nsis | Should -Match '/SD IDNO'
        $Nsis | Should -Match '/DELETEUSERDATA'
    }
}
