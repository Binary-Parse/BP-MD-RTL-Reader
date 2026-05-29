<#
  Run-PascalSelfTest.ps1 — compile selftest.iss and run the compiled harness,
  which executes the REAL Pascal units (version_check.pas + dir_validate.pas)
  via their *.test.pas assertions. Parses the log for the pass/fail summary.

  Usage:  pwsh -File tests/installer/Run-PascalSelfTest.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'

# locate ISCC
$iscc = $null
$cmd = Get-Command iscc.exe -ErrorAction SilentlyContinue
if ($cmd) { $iscc = $cmd.Source }
if (-not $iscc) {
    foreach ($c in @(
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe')
    )) { if ($c -and (Test-Path $c)) { $iscc = $c; break } }
}
if (-not $iscc) {
    Write-Error "ISCC.exe (Inno Setup 6.3+) not found. Install from https://jrsoftware.org/isdl.php"
    exit 2
}

$iss    = Join-Path $PSScriptRoot 'selftest.iss'
$exe    = Join-Path $PSScriptRoot 'Marqam-SelfTest.exe'
$result = Join-Path $PSScriptRoot 'selftest-result.txt'

Write-Host "Compiling selftest.iss..." -ForegroundColor Cyan
& $iscc $iss
if ($LASTEXITCODE -ne 0) { Write-Error "ISCC failed ($LASTEXITCODE)"; exit $LASTEXITCODE }
if (-not (Test-Path $exe)) { Write-Error "Self-test exe not produced: $exe"; exit 3 }

if (Test-Path $result) { Remove-Item $result -Force }
Write-Host "Running self-test..." -ForegroundColor Cyan
# /VERYSILENT: no UI; harness writes selftest-result.txt next to the exe and cancels.
$p = Start-Process -FilePath $exe -ArgumentList '/VERYSILENT' -Wait -PassThru
Start-Sleep -Milliseconds 200

if (-not (Test-Path $result)) { Write-Error "No result file produced at $result"; exit 4 }
$content = Get-Content $result -Raw
$content -split "`r?`n" | Where-Object { $_ -match 'PASS |FAIL |RESULT:' } | ForEach-Object { Write-Host $_ }

if ($content -match 'RESULT:\s+(\d+)\s+passed,\s+(\d+)\s+failed') {
    $passed = [int]$Matches[1]; $failed = [int]$Matches[2]
    Write-Host ''
    if ($failed -eq 0) {
        Write-Host "Pascal self-test PASS: $passed passed, 0 failed." -ForegroundColor Green
        exit 0
    } else {
        Write-Error "Pascal self-test FAILED: $passed passed, $failed failed."
        exit 1
    }
} else {
    Write-Error "Could not find the RESULT summary in $result"
    exit 5
}
