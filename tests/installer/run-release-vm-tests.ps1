<#
  Destructive release-only installer validation.

  This script intentionally installs and uninstalls the signed public artifact
  twice. It is hard-guarded to a fresh GitHub-hosted Windows runner; ordinary
  local/Pester tests remain non-destructive.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallerPath,
    [Parameter(Mandatory)][ValidateSet('Inno', 'NSIS')][string]$Kind,
    [Parameter(Mandatory)][ValidatePattern('^[0-9A-Fa-f]{40}$')][string]$CertificateSha1,
    [Parameter(Mandatory)][string]$SignToolPath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-DisposableRunner {
    if ($env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true') {
        throw 'Release VM tests require CI=true and GITHUB_ACTIONS=true.'
    }
    if ($env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') {
        throw 'Release VM tests run only on a disposable GitHub-hosted Windows runner.'
    }
    if (-not [IO.Path]::IsPathFullyQualified($InstallerPath)) {
        throw '-InstallerPath must be an absolute path.'
    }
    if (-not [IO.Path]::IsPathFullyQualified($SignToolPath)) {
        throw '-SignToolPath must be an absolute path.'
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Release VM tests require an elevated GitHub-hosted runner process.'
    }
}

Assert-DisposableRunner
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'installer\build-policy.ps1')
$signTool = Get-TrustedSignTool -ExplicitPath $SignToolPath
$CertificateSha1 = $CertificateSha1.ToUpperInvariant()

$installRoot = Join-Path $env:SystemDrive ("bpmd-release-vm-{0}" -f $Kind.ToLowerInvariant())
$appExe = Join-Path $installRoot 'BP MD RTL Reader.exe'
$dataTargets = @(
    (Join-Path $env:APPDATA, 'bpmdrtlreader')
    (Join-Path $env:APPDATA, 'BP MD RTL Reader')
    (Join-Path $env:LOCALAPPDATA, 'bpmdrtlreader')
    (Join-Path $env:LOCALAPPDATA, 'BP MD RTL Reader')
)
$arpKey = if ($Kind -eq 'Inno') {
    'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\{32586DF8-1F67-400F-9D8B-6426C3D5B405}_is1'
} else {
    'Registry::HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Uninstall\4f0623fc-2d71-59f2-b165-b36fb9982268'
}
$associationKey = if ($Kind -eq 'Inno') {
    'Registry::HKEY_LOCAL_MACHINE\Software\Classes\.md\shell\Open with BP MD RTL Reader\command'
} else {
    'Registry::HKEY_LOCAL_MACHINE\Software\Classes\Markdown Document\shell\open\command'
}
$sentinelRoot = Join-Path $env:RUNNER_TEMP ("bpmd-release-vm-sentinel-{0}" -f [Guid]::NewGuid().ToString('N'))
$sentinel = Join-Path $sentinelRoot 'external.md'

function Invoke-CheckedProcess {
    param([Parameter(Mandatory)][string]$FilePath, [Parameter(Mandatory)][string[]]$Arguments)
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        throw "Process failed with exit code $($process.ExitCode): $FilePath $($Arguments -join ' ')"
    }
}

function Assert-SignedFile {
    param([Parameter(Mandatory)][string]$Path)
    Assert-ReleaseSignature -Path $Path -ExpectedThumbprint $CertificateSha1 | Out-Null
    & $signTool.Path verify /pa /all /v $Path
    if ($LASTEXITCODE -ne 0) { throw "signtool verification failed for $Path" }
}

function Get-ShortcutPaths {
    $roots = @(
        (Join-Path $env:PUBLIC 'Desktop'),
        (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
    )
    return @($roots | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
        Get-ChildItem -LiteralPath $_ -Filter 'BP MD RTL Reader*.lnk' -File -Recurse -ErrorAction SilentlyContinue
    })
}

function Get-UninstallerPath {
    $candidate = if ($Kind -eq 'Inno') {
        Get-ChildItem -LiteralPath $installRoot -Filter 'unins*.exe' -File | Select-Object -First 1
    } else {
        Get-ChildItem -LiteralPath $installRoot -Filter 'Uninstall*.exe' -File | Select-Object -First 1
    }
    if (-not $candidate) { throw "Installed uninstaller was not found under $installRoot" }
    return $candidate.FullName
}

function Assert-CleanInitialState {
    if (Test-Path -LiteralPath $installRoot) { throw "Refusing to reuse existing install path: $installRoot" }
    if (Test-Path -LiteralPath $arpKey) { throw "Refusing to overwrite existing ARP key: $arpKey" }
    if (Test-Path -LiteralPath $associationKey) { throw "Refusing to overwrite existing association: $associationKey" }
    if (Get-ShortcutPaths) { throw 'Refusing to overwrite existing BP MD RTL Reader shortcuts.' }
    foreach ($target in $dataTargets) {
        if (Test-Path -LiteralPath $target) { throw "Refusing to overwrite existing app data: $target" }
    }
}

function Invoke-Install {
    $arguments = if ($Kind -eq 'Inno') {
        @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/ALLUSERS', '/TASKS=desktopicon,associatemd', "/DIR=$installRoot")
    } else {
        @('/S', '/allusers', "/D=$installRoot")
    }
    Invoke-CheckedProcess -FilePath $InstallerPath -Arguments $arguments
}

function Invoke-Uninstall {
    param([Parameter(Mandatory)][string]$Uninstaller, [Parameter(Mandatory)][bool]$DeleteUserData)
    $arguments = if ($Kind -eq 'Inno') {
        @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
    } else {
        @('/S')
    }
    if ($DeleteUserData) { $arguments += '/DELETEUSERDATA' }
    Invoke-CheckedProcess -FilePath $Uninstaller -Arguments $arguments
}

function Seed-AppData {
    foreach ($target in $dataTargets) {
        New-Item -ItemType Directory -Path $target | Out-Null
        Set-Content -LiteralPath (Join-Path $target 'release-vm-marker.txt') -Value 'delete only when explicitly requested'
    }
}

function Remove-SeededAppData {
    foreach ($target in $dataTargets) {
        $parent = Split-Path -Parent $target
        if (-not (Test-PathWithinRoot -Path $target -Root $parent)) {
            throw "Refusing unexpected app-data cleanup target: $target"
        }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}

function Assert-InstalledState {
    if (-not (Test-Path -LiteralPath $appExe -PathType Leaf)) { throw "Installed app is missing: $appExe" }
    if (-not (Test-Path -LiteralPath $arpKey)) { throw "ARP key is missing: $arpKey" }
    if (-not (Test-Path -LiteralPath $associationKey)) { throw "Markdown association is missing: $associationKey" }
    if (-not (Get-ShortcutPaths)) { throw 'Expected installed shortcuts were not found.' }
}

function Assert-UninstalledState {
    if (Test-Path -LiteralPath $installRoot) { throw "Program directory remains: $installRoot" }
    if (Test-Path -LiteralPath $arpKey) { throw "ARP key remains: $arpKey" }
    if (Test-Path -LiteralPath $associationKey) { throw "Markdown association remains: $associationKey" }
    if (Get-ShortcutPaths) { throw 'BP MD RTL Reader shortcuts remain after uninstall.' }
    if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $script:sentinelHash) {
        throw 'External Markdown sentinel changed during uninstall.'
    }
}

function Assert-AppDataState {
    param([Parameter(Mandatory)][bool]$Deleted)
    foreach ($target in $dataTargets) {
        $exists = Test-Path -LiteralPath $target
        if ($Deleted -and $exists) { throw "App data remains after destructive uninstall: $target" }
        if (-not $Deleted -and -not $exists) { throw "App data was removed by preserve-mode uninstall: $target" }
    }
}

function Invoke-UninstallScenario {
    param([Parameter(Mandatory)][bool]$DeleteUserData)
    Invoke-Install
    Assert-InstalledState
    Seed-AppData
    Assert-SignedFile -Path $appExe
    $uninstaller = Get-UninstallerPath
    Assert-SignedFile -Path $uninstaller
    Invoke-Uninstall -Uninstaller $uninstaller -DeleteUserData $DeleteUserData
    Assert-UninstalledState
    Assert-AppDataState -Deleted $DeleteUserData
}

Assert-CleanInitialState
Assert-SignedFile -Path $InstallerPath
New-Item -ItemType Directory -Path $sentinelRoot | Out-Null
Set-Content -LiteralPath $sentinel -Value '# User document outside app data'
$script:sentinelHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash

Invoke-UninstallScenario -DeleteUserData:$false
Remove-SeededAppData
Invoke-UninstallScenario -DeleteUserData:$true

$previousUninstallTest = $env:BPMDRTL_UNINSTALL_TEST
$previousInstallDir = $env:BPMDRTL_INSTALL_DIR
try {
    $env:BPMDRTL_UNINSTALL_TEST = '1'
    $env:BPMDRTL_INSTALL_DIR = $installRoot
    $postUninstallResult = Invoke-Pester -Path (Join-Path $repoRoot 'tests\installer\uninstall_check.test.ps1') -PassThru -Output Detailed
    if ($postUninstallResult.FailedCount -ne 0 -or $postUninstallResult.SkippedCount -ne 0) {
        throw "Post-uninstall Pester gate failed: $($postUninstallResult.FailedCount) failed, $($postUninstallResult.SkippedCount) skipped."
    }
} finally {
    $env:BPMDRTL_UNINSTALL_TEST = $previousUninstallTest
    $env:BPMDRTL_INSTALL_DIR = $previousInstallDir
}

Write-Host "Release uninstall verification passed for $Kind." -ForegroundColor Green
