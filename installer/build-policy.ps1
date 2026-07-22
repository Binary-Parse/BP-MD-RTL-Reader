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

function Assert-ReleaseSignatureMetadata {
    param(
        [Parameter(Mandatory)][string]$Status,
        [AllowEmptyString()][string]$SignerSubject,
        [AllowEmptyString()][string]$Thumbprint,
        [Parameter(Mandatory)][string]$ExpectedThumbprint,
        [Parameter(Mandatory)][bool]$Timestamped,
        [Parameter(Mandatory)][string]$ExpectedSigner
    )
    if ($Status -ne 'Valid') { throw "Authenticode signature is $Status, not Valid." }
    if ($SignerSubject -notmatch [regex]::Escape($ExpectedSigner)) {
        throw "Signer '$SignerSubject' does not contain '$ExpectedSigner'."
    }
    if ($Thumbprint -ne $ExpectedThumbprint) {
        throw "Signer certificate thumbprint '$Thumbprint' does not match the release certificate."
    }
    if (-not $Timestamped) { throw 'Authenticode signature has no trusted timestamp.' }
    return $true
}

function Assert-ReleaseSignature {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$ExpectedThumbprint,
        [string]$ExpectedSigner = 'Binary Parse'
    )
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    $thumbprint = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { '' }
    Assert-ReleaseSignatureMetadata `
        -Status ([string]$signature.Status) `
        -SignerSubject $subject `
        -Thumbprint $thumbprint `
        -ExpectedThumbprint $ExpectedThumbprint `
        -Timestamped ($null -ne $signature.TimeStamperCertificate) `
        -ExpectedSigner $ExpectedSigner | Out-Null
    return $signature
}

function Get-TrustedSignTool {
    param([Parameter(Mandatory)][string]$ExplicitPath)
    if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
        throw "signtool.exe was not found: $ExplicitPath"
    }
    $resolved = (Resolve-Path -LiteralPath $ExplicitPath).Path
    if ([IO.Path]::GetFileName($resolved) -ne 'signtool.exe') {
        throw 'The signing tool must be named signtool.exe.'
    }
    $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) |
        Where-Object { $_ } | ForEach-Object { Join-Path $_ 'Windows Kits' }
    if (-not ($roots | Where-Object { Test-PathWithinRoot -Path $resolved -Root $_ })) {
        throw 'signtool.exe is outside the canonical Windows Kits roots.'
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $resolved
    $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    if ([string]$signature.Status -ne 'Valid' -or $subject -notmatch 'Microsoft') {
        throw "signtool.exe is not validly signed by Microsoft (status=$($signature.Status), signer=$subject)."
    }
    return [ordered]@{ path = $resolved; signer = $subject }
}

function Get-NormalizedRelativePath {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Path)
    return [IO.Path]::GetRelativePath($Root, $Path).Replace('\', '/')
}

function Get-PackagedFileManifest {
    param(
        [Parameter(Mandatory)][string]$SourceRoot,
        [Parameter(Mandatory)]$Policy,
        [Parameter(Mandatory)][string]$AppVersion,
        [switch]$RequireSigned,
        [string]$ExpectedThumbprint
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
    $signer = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
    if ($RequireSigned) {
        if (-not $ExpectedThumbprint) { throw 'ExpectedThumbprint is required for a signed payload.' }
        Assert-ReleaseSignature -Path $appExe -ExpectedThumbprint $ExpectedThumbprint -ExpectedSigner ([string]$Policy.executable.signer) | Out-Null
    }
    else {
        if ([string]$signature.Status -notin @('Valid', 'NotSigned')) {
            throw "Packaged executable signature status is $($signature.Status)."
        }
        if ([string]$signature.Status -eq 'Valid' -and $signer -notmatch [regex]::Escape([string]$Policy.executable.signer)) {
            throw "Packaged executable signer '$signer' does not match policy."
        }
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
    if (-not (Test-PathWithinRoot -Path $Path -Root $DistRoot) -or $leaf -notmatch '^\.inno-(app-build|staging|output)-[a-f0-9]{32}$') {
        throw "Refusing to remove unexpected scratch path: $Path"
    }
    Remove-Item -LiteralPath $Path -Recurse -Force
}
