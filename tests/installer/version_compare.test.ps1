<#
  version_compare.test.ps1 — Pester unit tests for the version-comparison logic
  mirrored in logic-sim.ps1 (and in installer/scripts/version_check.pas).
  Run via tests/installer/run-tests.ps1 (or: Invoke-Pester -Path <thisfile>).
#>

BeforeAll {
    . (Join-Path $PSScriptRoot 'logic-sim.ps1')
}

Describe 'CompareVersion — spec cases (symbolic result)' {
    It '1.0.0 < 1.0.1'        { CompareVersion '1.0.0' '1.0.1' | Should -Be '<' }
    It '2.0.0 > 1.9.9'        { CompareVersion '2.0.0' '1.9.9' | Should -Be '>' }
    It '1.0.0 = 1.0.0'        { CompareVersion '1.0.0' '1.0.0' | Should -Be '=' }
    It '1.0.0-beta < 1.0.0'   { CompareVersion '1.0.0-beta' '1.0.0' | Should -Be '<' }
}

Describe 'CompareVersion — leading-v handling (asymmetric)' {
    # These distinguish "strip v" from "do not strip": both sides differ in core.
    It 'v2.0.0 > 1.0.0' { CompareVersion 'v2.0.0' '1.0.0' | Should -Be '>' }
    It 'V2.0.0 > 1.0.0' { CompareVersion 'V2.0.0' '1.0.0' | Should -Be '>' }
    It '1.0.0 < v2.0.0' { CompareVersion '1.0.0' 'v2.0.0' | Should -Be '<' }
}

Describe 'Compare-VersionInt — core numeric comparison' {
    It '1.0.10 > 1.0.9 (numeric, not lexical)' { Compare-VersionInt '1.0.10' '1.0.9' | Should -Be 1 }
    It '1.2 = 1.2.0 (zero-pad)'                { Compare-VersionInt '1.2' '1.2.0'  | Should -Be 0 }
    It 'build metadata ignored'                { Compare-VersionInt '1.0.0+abc' '1.0.0+xyz' | Should -Be 0 }

    It 'is antisymmetric over cores' -ForEach @(
        @{ A = '1.0.0'; B = '1.0.1'; E = -1 }
        @{ A = '2.0.0'; B = '1.9.9'; E =  1 }
        @{ A = '1.0.0'; B = '1.0.0'; E =  0 }
        @{ A = '1.0.10'; B = '1.0.9'; E = 1 }
    ) {
        Compare-VersionInt $A $B | Should -Be $E
        Compare-VersionInt $B $A | Should -Be (-1 * $E)
    }
}

Describe 'Compare-VersionInt — pre-release precedence' {
    It 'release > prerelease' { Compare-VersionInt '1.0.0' '1.0.0-beta' | Should -Be 1 }
    It 'prerelease < release' { Compare-VersionInt '1.0.0-beta' '1.0.0' | Should -Be (-1) }

    # Equal pre-releases must compare equal (pins Compare-PreRelease's final return 0).
    It '1.0.0-alpha = 1.0.0-alpha'     { Compare-VersionInt '1.0.0-alpha' '1.0.0-alpha' | Should -Be 0 }
    It '1.0.0-alpha.1 = 1.0.0-alpha.1' { Compare-VersionInt '1.0.0-alpha.1' '1.0.0-alpha.1' | Should -Be 0 }

    # Antisymmetric across every pre-release rule: ordinal, numeric, field-count,
    # and numeric-vs-alphanumeric. Each pair is checked in BOTH directions.
    It 'is antisymmetric over pre-release identifiers' -ForEach @(
        @{ A = '1.0.0-alpha';   B = '1.0.0-beta';    E = -1 }  # ordinal: alpha < beta
        @{ A = '1.0.0-alpha.1'; B = '1.0.0-alpha.2'; E = -1 }  # numeric: 1 < 2
        @{ A = '1.0.0-alpha';   B = '1.0.0-alpha.1'; E = -1 }  # fewer fields < more
        @{ A = '1.0.0-1';       B = '1.0.0-alpha';   E = -1 }  # numeric < alphanumeric
    ) {
        Compare-VersionInt $A $B | Should -Be $E
        Compare-VersionInt $B $A | Should -Be (-1 * $E)
    }
}

Describe 'Get-InstallAction — version-detection decision' {
    It 'no prior install -> fresh'         { Get-InstallAction ''      '1.0.0' | Should -Be 'fresh' }
    It 'identical version -> same'         { Get-InstallAction '1.0.0' '1.0.0' | Should -Be 'same'  }
    It 'older installed -> older/upgrade'  { Get-InstallAction '0.9.0' '1.0.0' | Should -Be 'older' }
    It 'newer installed -> newer/downgrade'{ Get-InstallAction '2.0.0' '1.0.0' | Should -Be 'newer' }
    It 'whitespace-only treated as fresh'  { Get-InstallAction '   '   '1.0.0' | Should -Be 'fresh' }
}
