<#
  run-pascal-self-test.ps1 — compile selftest.iss and run the compiled harness,
  which executes the REAL Pascal units (version_check.pas + dir_validate.pas)
  via their *.test.pas assertions. Parses the log for the pass/fail summary.

  Usage:  pwsh -File tests/installer/run-pascal-self-test.ps1
#>
[CmdletBinding()]
param([string]$IsccPath)
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'installer\build-policy.ps1')
$toolPolicy = Get-Content (Join-Path $repoRoot 'installer\toolchain-policy.json') -Raw | ConvertFrom-Json
$compiler = Get-TrustedIscc -ExplicitPath $IsccPath -Policy $toolPolicy
$iscc = $compiler.Path

$iss = Join-Path $PSScriptRoot 'selftest.iss'
$outputRoot = Join-Path ([IO.Path]::GetTempPath()) ("BP-MD-RTL-Reader-SelfTest-" + [Guid]::NewGuid().ToString('N'))
$exe = Join-Path $outputRoot 'BP-MD-RTL-Reader-SelfTest.exe'
$result = Join-Path $outputRoot 'selftest-result.txt'

New-Item -ItemType Directory -Path $outputRoot | Out-Null
try {
    Write-Host "Compiling selftest.iss..." -ForegroundColor Cyan
    & $iscc "/O$outputRoot" $iss
    if ($LASTEXITCODE -ne 0) { Write-Error "ISCC failed ($LASTEXITCODE)" }
    if (-not (Test-Path -LiteralPath $exe)) { Write-Error "Self-test exe not produced: $exe" }

    Write-Host "Running self-test..." -ForegroundColor Cyan
    # /VERYSILENT: no UI; harness writes selftest-result.txt next to the exe and cancels.
    $null = Start-Process -FilePath $exe -ArgumentList '/VERYSILENT' -Wait -PassThru
    Start-Sleep -Milliseconds 200

    if (-not (Test-Path -LiteralPath $result)) { Write-Error "No result file produced at $result" }
    $content = Get-Content -LiteralPath $result -Raw
    $content -split "`r?`n" | Where-Object { $_ -match 'PASS |FAIL |RESULT:' } | ForEach-Object { Write-Host $_ }

    if ($content -notmatch 'RESULT:\s+(\d+)\s+passed,\s+(\d+)\s+failed') {
        Write-Error "Could not find the RESULT summary in $result"
    }

    $passed = [int]$Matches[1]
    $failed = [int]$Matches[2]
    Write-Host ''
    if ($failed -ne 0) {
        Write-Error "Pascal self-test FAILED: $passed passed, $failed failed."
    }
    Write-Host "Pascal self-test PASS: $passed passed, 0 failed." -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $outputRoot) {
        Remove-Item -LiteralPath $outputRoot -Recurse -Force
    }
}
