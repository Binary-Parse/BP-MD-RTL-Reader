<#
  run-tests.ps1 — one-shot driver for the installer test suite.
    1. ensures Pester 5+ is available (installs to CurrentUser if missing)
    2. runs the Pester unit tests
    3. runs the mutation engine (mutation-runner.ps1)
  Exit code is non-zero if either stage fails.

  Usage:  pwsh -File tests/installer/run-tests.ps1
          pwsh -File tests/installer/run-tests.ps1 -SkipMutation
#>
[CmdletBinding()]
param(
    [switch]$SkipMutation,
    [switch]$InstallPester
)
$ErrorActionPreference = 'Stop'

function Ensure-Pester {
    $have = Get-Module -ListAvailable -Name Pester | Where-Object { $_.Version.Major -ge 5 }
    if ($have) { return $true }
    if (-not $InstallPester) {
        Write-Warning 'Pester 5+ not found. Re-run with -InstallPester, or: Install-Module Pester -Scope CurrentUser -Force -SkipPublisherCheck'
        return $false
    }
    Write-Host 'Installing Pester 5+ (CurrentUser)...' -ForegroundColor Cyan
    Install-Module Pester -Scope CurrentUser -Force -SkipPublisherCheck -MinimumVersion 5.0
    return $true
}

if (-not (Ensure-Pester)) { exit 2 }
Import-Module Pester -MinimumVersion 5.0

$testFiles = @(
    'version-compare.test.ps1'
    'path-validate.test.ps1'
    'registry-mock.test.ps1'
    'uninstall-check.test.ps1'
    'installer-security.test.ps1'
) | ForEach-Object { Join-Path $PSScriptRoot $_ }

Write-Host '== Unit tests ==' -ForegroundColor Cyan
$conf = New-PesterConfiguration
$conf.Run.Path     = $testFiles
$conf.Run.PassThru = $true
$conf.Output.Verbosity = 'Detailed'
$r = Invoke-Pester -Configuration $conf
if ($r.FailedCount -gt 0) {
    Write-Error "Unit tests failed: $($r.FailedCount) failed, $($r.PassedCount) passed."
    exit 1
}
Write-Host "Unit tests: $($r.PassedCount) passed, $($r.SkippedCount) skipped." -ForegroundColor Green

if ($SkipMutation) { exit 0 }

Write-Host ''
Write-Host '== Mutation testing ==' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'mutation-runner.ps1')
exit $LASTEXITCODE
