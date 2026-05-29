<#
  build-installer.ps1 — compile the Marqam installer with Inno Setup 6.3+.

  Steps:
    1. locate ISCC.exe (PATH or default install locations)
    2. read the app version from package.json (override with -Version)
    3. verify the packaged app exists (dist\win-unpacked\Marqam.exe)
    4. compile installer\setup.iss
    5. verify dist\Marqam-Setup-x64.exe exists and is > 10 MB
    6. print the SHA256 hash

  Usage:
    pwsh -File installer\build-installer.ps1
    pwsh -File installer\build-installer.ps1 -Version 1.0.1
    pwsh -File installer\build-installer.ps1 -SourceDir dist\win-unpacked
#>
[CmdletBinding()]
param(
    [string]$Version,
    [string]$SourceDir,
    [string]$Iss = (Join-Path $PSScriptRoot 'setup.iss')
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot          # installer\ -> repo root

# 1. locate ISCC.exe ---------------------------------------------------------
$iscc = $null
$cmd = Get-Command iscc.exe -ErrorAction SilentlyContinue
if ($cmd) { $iscc = $cmd.Source }
if (-not $iscc) {
    foreach ($c in @(
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe')
    )) {
        if ($c -and (Test-Path $c)) { $iscc = $c; break }
    }
}
if (-not $iscc) {
    Write-Error "ISCC.exe (Inno Setup 6.3+) not found in PATH or the default install folders. Install from https://jrsoftware.org/isdl.php"
    exit 2
}
Write-Host "ISCC : $iscc" -ForegroundColor Cyan

# 2. version -----------------------------------------------------------------
if (-not $Version) {
    $pkg = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
    $Version = $pkg.version
}
Write-Host "Version: $Version" -ForegroundColor Cyan

# 3. packaged app source -----------------------------------------------------
if (-not $SourceDir) { $SourceDir = Join-Path $repoRoot 'dist\win-unpacked' }
elseif (-not [System.IO.Path]::IsPathRooted($SourceDir)) { $SourceDir = Join-Path $repoRoot $SourceDir }
$appExe = Join-Path $SourceDir 'Marqam.exe'
if (-not (Test-Path $appExe)) {
    Write-Error "Packaged app not found: $appExe`nRun the app build first (e.g. 'npx electron-builder --dir' or 'npm run dist')."
    exit 3
}
Write-Host "Source : $SourceDir" -ForegroundColor Cyan

# 4. compile -----------------------------------------------------------------
$outDir  = Join-Path $repoRoot 'dist'
$outFile = Join-Path $outDir 'Marqam-Setup-x64.exe'
if (Test-Path $outFile) { Remove-Item $outFile -Force }

$isccArgs = @(
    "/DAppVersion=$Version",
    "/DSourceDir=$SourceDir",
    "/O$outDir",
    '/FMarqam-Setup-x64',
    $Iss
)
Write-Host "Compiling..." -ForegroundColor Cyan
& $iscc @isccArgs
if ($LASTEXITCODE -ne 0) {
    Write-Error "ISCC failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

# 5. verify output -----------------------------------------------------------
if (-not (Test-Path $outFile)) {
    Write-Error "Expected output not produced: $outFile"
    exit 4
}
$size = (Get-Item $outFile).Length
if ($size -lt 10MB) {
    Write-Error ("Output is suspiciously small ({0:N0} bytes < 10 MB)." -f $size)
    exit 5
}

# 6. hash --------------------------------------------------------------------
$hash = (Get-FileHash $outFile -Algorithm SHA256).Hash
Write-Host ''
Write-Host '================ BUILD OK ================' -ForegroundColor Green
Write-Host ("Output : {0}" -f $outFile)
Write-Host ("Size   : {0:N1} MB" -f ($size / 1MB))
Write-Host ("SHA256 : {0}" -f $hash)
Write-Host '=========================================' -ForegroundColor Green
exit 0
