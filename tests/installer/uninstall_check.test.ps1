<#
  uninstall_check.test.ps1
    Part 1 (always): logic tests for the keep-notes rule and the cleanup target
                     set (mirror of cleanup.pas).
    Part 2 (opt-in): real post-uninstall filesystem/registry verification. These
                     run only when $env:MARQAM_UNINSTALL_TEST is set (after an
                     actual install+uninstall on a Windows machine/VM), and they
                     read $env:MARQAM_INSTALL_DIR for the program path.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'logic-sim.ps1')
}

Describe 'User-data cleanup plan (Get-CleanupPlan)' {
    It 'KeepUserData=$true keeps roaming data, deletes only the local cache' {
        $p = Get-CleanupPlan -KeepUserData $true
        $p.Preserve | Should -Contain '{userappdata}\Marqam'
        $p.Delete   | Should -Contain '{localappdata}\Marqam'
        $p.Delete   | Should -Not -Contain '{userappdata}\Marqam'
    }
    It 'KeepUserData=$false deletes both roaming and local' {
        $p = Get-CleanupPlan -KeepUserData $false
        $p.Delete   | Should -Contain '{userappdata}\Marqam'
        $p.Delete   | Should -Contain '{localappdata}\Marqam'
        $p.Preserve | Should -BeNullOrEmpty
    }
}

Describe 'Cleanup target set (Get-UninstallTargets)' {
    BeforeAll { $script:t = Get-UninstallTargets }

    # Exact, ordered set assertions — every single path/key is pinned, so any
    # mutation of any one entry is caught (not just the "spot-checked" ones).
    It 'shortcut file set is exactly as specified' {
        ($t.Files -join "`n") | Should -Be (@(
            '{userstartup}\Marqam.lnk'
            '{commonstartup}\Marqam.lnk'
            '{userdesktop}\Marqam.lnk'
            '{commondesktop}\Marqam.lnk'
        ) -join "`n")
    }
    It 'directory set is exactly as specified' {
        ($t.Dirs -join "`n") | Should -Be (@(
            '{userappdata}\Marqam'
            '{localappdata}\Marqam'
            '{autoprograms}\Marqam'
            '{commonprograms}\Marqam'
        ) -join "`n")
    }
    It 'registry-key set is exactly as specified' {
        ($t.RegKeys -join "`n") | Should -Be (@(
            'HKCU\Software\Marqam'
            'HKLM\Software\Marqam'
            'HKLM\Software\Classes\.md\shell\Open with Marqam'
            'HKCU\Software\Classes\.md\shell\Open with Marqam'
            'HKLM\Software\Classes\.markdown\shell\Open with Marqam'
            'HKCU\Software\Classes\.markdown\shell\Open with Marqam'
        ) -join "`n")
    }
    It 'never references the misspelling "Margam"' {
        (($t.RegKeys + $t.Dirs + $t.Files) -join '|') | Should -Not -Match 'Margam'
    }
}

Describe 'Post-uninstall machine state' -Skip:(-not $env:MARQAM_UNINSTALL_TEST) {
    It 'program directory is gone' {
        Test-Path $env:MARQAM_INSTALL_DIR | Should -BeFalse
    }
    It 'roaming app-data is gone (full uninstall)' {
        Test-Path (Join-Path $env:APPDATA 'Marqam') | Should -BeFalse
    }
    It 'local app-data is gone (full uninstall)' {
        Test-Path (Join-Path $env:LOCALAPPDATA 'Marqam') | Should -BeFalse
    }
    It 'ARP/uninstall registry key is gone' {
        Test-Path 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{32586DF8-1F67-400F-9D8B-6426C3D5B405}_is1' | Should -BeFalse
    }
}
