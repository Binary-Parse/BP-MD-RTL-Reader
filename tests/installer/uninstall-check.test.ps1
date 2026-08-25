<#
  uninstall-check.test.ps1
    Part 1 (always): logic tests for the keep-notes rule and the cleanup target
                     set (mirror of cleanup.pas).
    Part 2 (opt-in): real post-uninstall filesystem/registry verification. These
                     run only when $env:BPMDRTL_UNINSTALL_TEST is set (after an
                     actual install+uninstall on a Windows machine/VM), and they
                     read $env:BPMDRTL_INSTALL_DIR for the program path.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'logic-sim.ps1')
}

Describe 'User-data cleanup plan (Get-CleanupPlan)' {
    It 'KeepUserData=$true preserves every current-account app-data alias' {
        $p = Get-CleanupPlan -KeepUserData $true
        $p.Preserve | Should -Contain '{userappdata}\bpmdrtlreader'
        $p.Preserve | Should -Contain '{userappdata}\BP MD RTL Reader'
        $p.Preserve | Should -Contain '{localappdata}\bpmdrtlreader'
        $p.Preserve | Should -Contain '{localappdata}\BP MD RTL Reader'
        $p.Preserve.Count | Should -Be 4
        $p.Delete   | Should -BeNullOrEmpty
    }
    It 'KeepUserData=$false deletes every current-account app-data alias' {
        $p = Get-CleanupPlan -KeepUserData $false
        $p.Delete   | Should -Contain '{userappdata}\bpmdrtlreader'
        $p.Delete   | Should -Contain '{userappdata}\BP MD RTL Reader'
        $p.Delete   | Should -Contain '{localappdata}\bpmdrtlreader'
        $p.Delete   | Should -Contain '{localappdata}\BP MD RTL Reader'
        $p.Delete.Count | Should -Be 4
        $p.Preserve | Should -BeNullOrEmpty
    }
}

Describe 'Cleanup target set (Get-UninstallTargets)' {
    BeforeAll { $script:t = Get-UninstallTargets }

    # Exact, ordered set assertions — every single path/key is pinned, so any
    # mutation of any one entry is caught (not just the "spot-checked" ones).
    It 'shortcut file set is exactly as specified' {
        ($t.Files -join "`n") | Should -Be (@(
            '{userstartup}\BP MD RTL Reader.lnk'
            '{commonstartup}\BP MD RTL Reader.lnk'
            '{userdesktop}\BP MD RTL Reader.lnk'
            '{commondesktop}\BP MD RTL Reader.lnk'
        ) -join "`n")
    }
    It 'directory set is exactly as specified' {
        ($t.Dirs -join "`n") | Should -Be (@(
            '{userappdata}\bpmdrtlreader'
            '{userappdata}\BP MD RTL Reader'
            '{localappdata}\bpmdrtlreader'
            '{localappdata}\BP MD RTL Reader'
            '{autoprograms}\BP MD RTL Reader'
            '{commonprograms}\BP MD RTL Reader'
        ) -join "`n")
    }
    It 'registry-key set is exactly as specified' {
        ($t.RegKeys -join "`n") | Should -Be (@(
            'HKCU\Software\BP MD RTL Reader'
            'HKLM\Software\BP MD RTL Reader'
            'HKLM\Software\Classes\.md\shell\Open with BP MD RTL Reader'
            'HKCU\Software\Classes\.md\shell\Open with BP MD RTL Reader'
            'HKLM\Software\Classes\.markdown\shell\Open with BP MD RTL Reader'
            'HKCU\Software\Classes\.markdown\shell\Open with BP MD RTL Reader'
            'HKLM\Software\Classes\BP.MD.RTLReader.Markdown'
            'HKCU\Software\Classes\BP.MD.RTLReader.Markdown'
        ) -join "`n")
    }
    It 'registry-value set is exactly the app-owned OpenWithProgids entries' {
        ($t.RegValues -join "`n") | Should -Be (@(
            'HKLM\Software\Classes\.md\OpenWithProgids|BP.MD.RTLReader.Markdown'
            'HKCU\Software\Classes\.md\OpenWithProgids|BP.MD.RTLReader.Markdown'
            'HKLM\Software\Classes\.markdown\OpenWithProgids|BP.MD.RTLReader.Markdown'
            'HKCU\Software\Classes\.markdown\OpenWithProgids|BP.MD.RTLReader.Markdown'
        ) -join "`n")
    }
    It 'no longer references the old product name "Marqam" (rename is complete)' {
        (($t.RegKeys + $t.RegValues + $t.Dirs + $t.Files) -join '|') | Should -Not -Match 'Marqam'
    }
    It 'contains no user-authored Markdown cleanup target' {
        (($t.Dirs + $t.Files) -join '|') | Should -Not -Match '\.(?:md|markdown)(?:$|[|\\])'
    }
    It 'contains no ProgramData or cross-account profile cleanup target' {
        (($t.Dirs + $t.Files) -join '|') | Should -Not -Match '(?i)ProgramData|Users\\\*|ProfileList'
    }
}

Describe 'Post-uninstall machine state' -Skip:(-not $env:BPMDRTL_UNINSTALL_TEST) {
    It 'program directory is gone' {
        Test-Path $env:BPMDRTL_INSTALL_DIR | Should -BeFalse
    }
    It 'roaming app-data is gone (full uninstall)' {
        Test-Path (Join-Path $env:APPDATA 'BP MD RTL Reader') | Should -BeFalse
    }
    It 'actual package-name roaming profile is gone (full uninstall)' {
        Test-Path (Join-Path $env:APPDATA 'bpmdrtlreader') | Should -BeFalse
    }
    It 'local app-data is gone (full uninstall)' {
        Test-Path (Join-Path $env:LOCALAPPDATA 'BP MD RTL Reader') | Should -BeFalse
    }
    It 'package-name local cache alias is gone (full uninstall)' {
        Test-Path (Join-Path $env:LOCALAPPDATA 'bpmdrtlreader') | Should -BeFalse
    }
    It 'ARP/uninstall registry key is gone' {
        Test-Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{32586DF8-1F67-400F-9D8B-6426C3D5B405}_is1' | Should -BeFalse
    }
}
