<#
  Build the x64 Inno installer from a fresh, policy-checked electron-builder tree.

  The build deliberately ignores PATH. ISCC must be the pinned, signed compiler
  installed below Program Files. The Electron payload is built into a unique
  scratch directory, checked against the committed file inventory, copied into
  a clean staging directory, hashed, and only then passed to setup.iss.

  Usage:
    pwsh -File installer/build-installer.ps1
    pwsh -File installer/build-installer.ps1 -IsccPath 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
#>
[CmdletBinding()]
param(
    [string]$Version,
    [string]$IsccPath,
    [string]$Iss = (Join-Path $PSScriptRoot 'setup.iss')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $repoRoot 'dist'
. (Join-Path $PSScriptRoot 'build-policy.ps1')

$toolPolicy = Get-Content (Join-Path $PSScriptRoot 'toolchain-policy.json') -Raw | ConvertFrom-Json
$sourcePolicy = Get-Content (Join-Path $PSScriptRoot 'source-manifest-policy.json') -Raw | ConvertFrom-Json
$package = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $package.version }
if ($Version -ne $package.version) {
    throw "-Version must match package.json ($($package.version)); update the package version before building."
}
if ($sourcePolicy.electronVersion -ne $package.devDependencies.electron) {
    throw "Source manifest policy targets Electron $($sourcePolicy.electronVersion), but package.json pins $($package.devDependencies.electron)."
}

$compiler = Get-TrustedIscc -ExplicitPath $IsccPath -Policy $toolPolicy
Write-Host "ISCC   : $($compiler.Path)" -ForegroundColor Cyan
Write-Host "Version: $Version" -ForegroundColor Cyan

$builder = Join-Path $repoRoot 'node_modules\.bin\electron-builder.cmd'
if (-not (Test-Path -LiteralPath $builder -PathType Leaf)) {
    throw "Pinned local electron-builder not found: $builder. Run 'npm ci' first."
}

New-Item -ItemType Directory -Force -Path $distRoot | Out-Null
$nonce = [Guid]::NewGuid().ToString('N')
$appBuildRoot = Join-Path $distRoot ".inno-app-build-$nonce"
$stagingRoot = Join-Path $distRoot ".inno-staging-$nonce"
$compilerOutputRoot = Join-Path $distRoot ".inno-output-$nonce"
$outFile = Join-Path $distRoot 'BP MD RTL Reader Setup.exe'
$compiledOutFile = Join-Path $compilerOutputRoot 'BP MD RTL Reader Setup.exe'
$manifestFile = Join-Path $distRoot 'BP MD RTL Reader Setup.source-manifest.json'

try {
    Write-Host 'Building a fresh x64 Electron directory...' -ForegroundColor Cyan
    & $builder --dir --win --x64 "--config.directories.output=$appBuildRoot"
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with exit code $LASTEXITCODE" }

    $sourceDir = Join-Path $appBuildRoot 'win-unpacked'
    $payload = Get-PackagedFileManifest -SourceRoot $sourceDir -Policy $sourcePolicy -AppVersion $Version
    New-VerifiedStaging -SourceRoot $sourceDir -StagingRoot $stagingRoot -Files $payload.Files | Out-Null

    $buildRecord = [ordered]@{
        schemaVersion = 1
        createdAtUtc = [DateTime]::UtcNow.ToString('o')
        appVersion = $Version
        electronVersion = $package.devDependencies.electron
        compiler = $compiler
        executable = $payload.Executable
        files = $payload.Files
    }
    $buildRecord | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestFile -Encoding utf8

    New-Item -ItemType Directory -Path $compilerOutputRoot | Out-Null
    $isccArgs = @(
        "/DAppVersion=$Version",
        "/DSourceDir=$stagingRoot",
        '/DVerifiedStaging=1',
        "/O$compilerOutputRoot",
        '/FBP MD RTL Reader Setup',
        $Iss
    )
    Write-Host 'Compiling verified staging tree...' -ForegroundColor Cyan
    & $compiler.Path @isccArgs
    if ($LASTEXITCODE -ne 0) { throw "ISCC failed with exit code $LASTEXITCODE" }

    if (-not (Test-Path -LiteralPath $compiledOutFile -PathType Leaf)) {
        throw "Expected output not produced: $compiledOutFile"
    }
    $size = (Get-Item -LiteralPath $compiledOutFile).Length
    if ($size -lt 10MB) { throw ("Output is suspiciously small ({0:N0} bytes < 10 MB)." -f $size) }
    $hash = (Get-FileHash -LiteralPath $compiledOutFile -Algorithm SHA256).Hash

    if (Test-Path -LiteralPath $outFile) { Remove-Item -LiteralPath $outFile -Force }
    Move-Item -LiteralPath $compiledOutFile -Destination $outFile
    if ((Get-FileHash -LiteralPath $outFile -Algorithm SHA256).Hash -ne $hash) {
        throw 'Published installer hash does not match the verified compiler output.'
    }

    Write-Host ''
    Write-Host '================ BUILD OK ================' -ForegroundColor Green
    Write-Host "Output   : $outFile"
    Write-Host ("Size     : {0:N1} MB" -f ($size / 1MB))
    Write-Host "SHA256   : $hash"
    Write-Host "Manifest : $manifestFile"
    Write-Host '=========================================' -ForegroundColor Green
}
finally {
    Remove-InstallerScratch -Path $compilerOutputRoot -DistRoot $distRoot
    Remove-InstallerScratch -Path $stagingRoot -DistRoot $distRoot
    Remove-InstallerScratch -Path $appBuildRoot -DistRoot $distRoot
}
