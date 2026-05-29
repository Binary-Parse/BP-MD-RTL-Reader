<#
  registry_mock.test.ps1 — Pester tests that mock the registry read used by
  Get-InstalledVersion (mirror of GetInstalledVersion in version_check.pas) and
  verify the resulting install-action decision.
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'logic-sim.ps1')
}

Describe 'Get-InstalledVersion (mocked HKLM ARP read)' {
    It 'returns DisplayVersion when the uninstall key exists' {
        Mock Get-ItemProperty { [pscustomobject]@{ DisplayVersion = '1.2.3' } }
        Get-InstalledVersion | Should -Be '1.2.3'
    }
    It 'returns empty string when the key is missing' {
        Mock Get-ItemProperty { throw [System.Management.Automation.ItemNotFoundException]::new('missing') }
        Get-InstalledVersion | Should -Be ''
    }
    It 'returns empty string when DisplayVersion value is absent' {
        Mock Get-ItemProperty { [pscustomobject]@{ SomethingElse = 'x' } }
        Get-InstalledVersion | Should -Be ''
    }
    It 'falls back to HKCU when the HKLM key is absent (per-user install)' {
        Mock Get-ItemProperty -ParameterFilter { $Path -like 'HKLM:*' } { throw 'no HKLM key' }
        Mock Get-ItemProperty -ParameterFilter { $Path -like 'HKCU:*' } { [pscustomobject]@{ DisplayVersion = '0.8.0' } }
        Get-InstalledVersion | Should -Be '0.8.0'
    }
    It 'detects the electron-builder NSIS key when the Inno _is1 key is absent' {
        # Default: NOTHING is present (also shields the test from any real
        # uninstall key that happens to exist on the dev machine).
        Mock Get-ItemProperty { throw 'absent (no such uninstall key)' }
        Mock Get-ItemProperty -ParameterFilter { $Path -like '*_is1' }      { throw 'no Inno key' }
        Mock Get-ItemProperty -ParameterFilter { $Path -like '*4f0623fc*' } { [pscustomobject]@{ DisplayVersion = '1.0.0' } }
        Get-InstalledVersion | Should -Be '1.0.0'
    }
}

Describe 'Registry-driven install decision (mock + compare)' {
    It 'missing key -> fresh install' {
        Mock Get-ItemProperty { throw 'not found' }
        Get-InstallAction (Get-InstalledVersion) '1.0.0' | Should -Be 'fresh'
    }
    It 'same version present -> same (Repair/Remove prompt)' {
        Mock Get-ItemProperty { [pscustomobject]@{ DisplayVersion = '1.0.0' } }
        Get-InstallAction (Get-InstalledVersion) '1.0.0' | Should -Be 'same'
    }
    It 'older version present -> older (upgrade)' {
        Mock Get-ItemProperty { [pscustomobject]@{ DisplayVersion = '0.9.0' } }
        Get-InstallAction (Get-InstalledVersion) '1.0.0' | Should -Be 'older'
    }
    It 'newer version present -> newer (downgrade discouraged)' {
        Mock Get-ItemProperty { [pscustomobject]@{ DisplayVersion = '2.5.0' } }
        Get-InstallAction (Get-InstalledVersion) '1.0.0' | Should -Be 'newer'
    }
}
