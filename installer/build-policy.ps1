Set-StrictMode -Version Latest

function Test-PathWithinRoot {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Root)
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $allowed = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    return $candidate.Equals($allowed, [StringComparison]::OrdinalIgnoreCase) -or
        $candidate.StartsWith($allowed + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-IsccPolicy {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Sha256,
        [Parameter(Mandatory)][string]$SignatureStatus,
        [Parameter(Mandatory)][string]$SignerSubject,
        [Parameter(Mandatory)][string[]]$AllowedRoots,
        [Parameter(Mandatory)]$Policy
    )
    if ([IO.Path]::GetFileName($Path) -ne 'ISCC.exe') { throw 'Compiler must be named ISCC.exe.' }
    if (-not ($AllowedRoots | Where-Object { Test-PathWithinRoot -Path $Path -Root $_ })) {
        throw 'ISCC.exe is outside the canonical Program Files installation roots.'
    }
    if ($Sha256 -ne [string]$Policy.isccSha256) {
        throw "ISCC SHA-256 does not match pinned Inno Setup $($Policy.isccVersion) compiler."
    }
    if ($SignatureStatus -ne 'Valid') { throw "ISCC Authenticode signature is $SignatureStatus, not Valid." }
    if ($SignerSubject -notmatch [regex]::Escape([string]$Policy.isccSigner)) {
        throw "ISCC signer '$SignerSubject' does not match '$($Policy.isccSigner)'."
    }
    return $true
}

function Get-TrustedIscc {
    param([string]$ExplicitPath, [Parameter(Mandatory)]$Policy)
    $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) |
        Where-Object { $_ } | ForEach-Object { Join-Path $_ 'Inno Setup 6' }
    $candidates = if ($ExplicitPath) { @($ExplicitPath) } else {
        @($roots | ForEach-Object { Join-Path $_ 'ISCC.exe' })
    }
    $found = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $found) {
        throw "Pinned Inno Setup $($Policy.isccVersion) ISCC.exe was not found in Program Files."
    }
    $resolved = (Resolve-Path -LiteralPath $found).Path
    $signature = Get-AuthenticodeSignature -LiteralPath $resolved
    $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    $sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
    Assert-IsccPolicy -Path $resolved -Sha256 $sha256 -SignatureStatus ([string]$signature.Status) -SignerSubject $subject -AllowedRoots $roots -Policy $Policy | Out-Null
    return [ordered]@{
        path = $resolved
        version = [string]$Policy.isccVersion
        signer = $subject
        sha256 = $sha256
    }
}

function Get-NormalizedRelativePath {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Path)
    return [IO.Path]::GetRelativePath($Root, $Path).Replace('\', '/')
}

function Get-PackagedFileManifest {
    param(
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)]$Policy,
        [Parameter(Mandatory)][string]$AppVersion
    )
    $root = (Resolve-Path -LiteralPath $SourceRoot).Path
    $reparse = Get-ChildItem -LiteralPath $root -Recurse -Force |
        Where-Object { ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 }
    if ($reparse) { throw "Packaged source contains a reparse point: $($reparse[0].FullName)" }

    $items = Get-ChildItem -LiteralPath $root -Recurse -File -Force
    $actual = @($items | ForEach-Object { Get-NormalizedRelativePath -Root $root -Path $_.FullName } | Sort-Object)
    $expected = @($Policy.files | Sort-Object)
    $difference = Compare-Object -ReferenceObject $expected -DifferenceObject $actual -CaseSensitive
    if ($difference) {
        $detail = ($difference | ForEach-Object { "$($_.SideIndicator) $($_.InputObject)" }) -join '; '
        throw "Packaged source does not match committed manifest policy: $detail"
    }

    $appExe = Join-Path $root $Policy.executable.path
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($appExe)
    if ($info.FileVersion -ne $AppVersion -or $info.ProductName -ne $Policy.executable.productName -or $info.CompanyName -ne $Policy.executable.companyName) {
        throw "Packaged executable metadata does not match version/product policy."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $appExe
    if ([string]$signature.Status -notin @('Valid', 'NotSigned')) {
        throw "Packaged executable signature status is $($signature.Status)."
    }
    $signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    if ([string]$signature.Status -eq 'Valid' -and $signer -notmatch [regex]::Escape([string]$Policy.executable.signer)) {
        throw "Packaged executable signer '$signer' does not match policy."
    }

    $files = @($items | ForEach-Object {
        [ordered]@{
            path = Get-NormalizedRelativePath -Root $root -Path $_.FullName
            length = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        }
    } | Sort-Object path)
    return [ordered]@{
        Executable = [ordered]@{ fileVersion = $info.FileVersion; productName = $info.ProductName; companyName = $info.CompanyName; signatureStatus = [string]$signature.Status; signer = $signer }
        Files = $files
    }
}

function New-VerifiedStaging {
    param(
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)][string]$StagingRoot,
        [Parameter(Mandatory)][array]$Files
    )
    if (Test-Path -LiteralPath $StagingRoot) { throw "Staging path already exists: $StagingRoot" }
    New-Item -ItemType Directory -Path $StagingRoot | Out-Null
    foreach ($file in $Files) {
        $relative = [string]$file.path
        $source = Join-Path $SourceRoot $relative
        $target = Join-Path $StagingRoot $relative
        $parent = Split-Path -Parent $target
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
        Copy-Item -LiteralPath $source -Destination $target
        $copiedHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
        if ($copiedHash -ne $file.sha256) { throw "Staging hash mismatch: $relative" }
    }
    $staged = @(Get-ChildItem -LiteralPath $StagingRoot -Recurse -File | ForEach-Object {
        Get-NormalizedRelativePath -Root $StagingRoot -Path $_.FullName
    } | Sort-Object)
    $expected = @($Files.path | Sort-Object)
    if (Compare-Object -ReferenceObject $expected -DifferenceObject $staged -CaseSensitive) {
        throw 'Staging tree differs from the verified file manifest.'
    }
    return (Resolve-Path -LiteralPath $StagingRoot).Path
}

function Remove-InstallerScratch {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$DistRoot)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $leaf = Split-Path -Leaf $Path
    if (-not (Test-PathWithinRoot -Path $Path -Root $DistRoot) -or $leaf -notmatch '^\.inno-(app-build|staging)-[a-f0-9]{32}$') {
        throw "Refusing to remove unexpected scratch path: $Path"
    }
    Remove-Item -LiteralPath $Path -Recurse -Force
}
