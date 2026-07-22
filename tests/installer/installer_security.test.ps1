<#
  installer_security.test.ps1 — regression tests for SEC-001, SEC-002 and
  DATA-011. These assertions inspect the real installer sources instead of a
  copied command runner so registry-controlled text cannot regain an elevated
  execution sink unnoticed.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:Nsis = Get-Content -Raw (Join-Path $RepoRoot 'installer\installer.nsh')
    $script:Inno = Get-Content -Raw (Join-Path $RepoRoot 'installer\setup.iss')
    $script:Cleanup = Get-Content -Raw (Join-Path $RepoRoot 'installer\scripts\cleanup.pas')
    $script:Version = Get-Content -Raw (Join-Path $RepoRoot 'installer\scripts\version_check.pas')
    $script:Build = Get-Content -Raw (Join-Path $RepoRoot 'installer\build-installer.ps1')
    $script:PascalSelfTest = Get-Content -Raw (Join-Path $RepoRoot 'tests\installer\run-pascal-self-test.ps1')
    $script:ToolPolicy = Get-Content -Raw (Join-Path $RepoRoot 'installer\toolchain-policy.json') | ConvertFrom-Json
    $script:SourcePolicy = Get-Content -Raw (Join-Path $RepoRoot 'installer\source-manifest-policy.json') | ConvertFrom-Json
    . (Join-Path $RepoRoot 'installer\build-policy.ps1')
}

Describe 'Verified installer build chain' {
    It 'does not resolve ISCC from PATH and requires the pinned signed compiler' {
        $Build | Should -Not -Match 'Get-Command\s+iscc'
        $ToolPolicy.isccVersion | Should -Be '6.3.3'
        $ToolPolicy.isccSigner | Should -Be 'Open Source Developer, Martijn Laan'
        $ToolPolicy.isccSha256 | Should -Be 'BF65156E415096B4B524EA7A8646D1E5B4FF7817FE8BA5DFC142A637640AE7D3'
        $signer = 'CN=Open Source Developer, Martijn Laan'
        $hash = $ToolPolicy.isccSha256
        { Assert-IsccPolicy -Path 'C:\Program Files\Inno Setup 6\ISCC.exe' -Sha256 $hash -SignatureStatus Valid -SignerSubject $signer -AllowedRoots @('C:\Program Files\Inno Setup 6') -Policy $ToolPolicy } | Should -Not -Throw
        { Assert-IsccPolicy -Path 'C:\Users\me\ISCC.exe' -Sha256 $hash -SignatureStatus Valid -SignerSubject $signer -AllowedRoots @('C:\Program Files\Inno Setup 6') -Policy $ToolPolicy } | Should -Throw
        { Assert-IsccPolicy -Path 'C:\Program Files\Inno Setup 6\ISCC.exe' -Sha256 ('0' * 64) -SignatureStatus Valid -SignerSubject $signer -AllowedRoots @('C:\Program Files\Inno Setup 6') -Policy $ToolPolicy } | Should -Throw
        { Assert-IsccPolicy -Path 'C:\Program Files\Inno Setup 6\ISCC.exe' -Sha256 $hash -SignatureStatus HashMismatch -SignerSubject $signer -AllowedRoots @('C:\Program Files\Inno Setup 6') -Policy $ToolPolicy } | Should -Throw
    }

    It 'uses the same trusted compiler policy for the Pascal self-test harness' {
        $PascalSelfTest | Should -Not -Match 'Get-Command\s+iscc'
        $PascalSelfTest | Should -Not -Match 'LOCALAPPDATA'
        $PascalSelfTest | Should -Match 'Get-TrustedIscc'
        $PascalSelfTest | Should -Match 'toolchain-policy\.json'
    }

    It 'isolates Pascal self-test executables in a nonce-scoped temporary directory' {
        $PascalSelfTest | Should -Match '\$outputRoot\s*=.*BP-MD-RTL-Reader-SelfTest-'
        $PascalSelfTest | Should -Match '"/O\$outputRoot"'
        $PascalSelfTest | Should -Match 'finally\s*\{[\s\S]*Remove-Item -LiteralPath \$outputRoot -Recurse -Force'
    }

    It 'commits an exact Electron payload inventory and blocks direct Inno compilation' {
        $SourcePolicy.electronVersion | Should -Be '42.7.0'
        $SourcePolicy.files.Count | Should -Be 74
        @($SourcePolicy.files | Select-Object -Unique).Count | Should -Be 74
        $SourcePolicy.files | Should -Contain 'resources/app.asar'
        $Inno | Should -Match '#ifndef VerifiedStaging'
        $Build | Should -Match '/DVerifiedStaging=1'
    }

    It 'copies only manifest-listed files into a new staging directory and verifies hashes' {
        $root = Join-Path $TestDrive 'source'
        $stage = Join-Path $TestDrive 'stage'
        New-Item -ItemType Directory -Path (Join-Path $root 'resources') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $root 'one.bin') -Value 'one'
        Set-Content -LiteralPath (Join-Path $root 'resources\two.bin') -Value 'two'
        Set-Content -LiteralPath (Join-Path $root 'unlisted.bin') -Value 'exclude'
        $files = @('one.bin', 'resources/two.bin') | ForEach-Object {
            $item = Get-Item -LiteralPath (Join-Path $root $_)
            [ordered]@{ path = $_; length = $item.Length; sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash }
        }
        $created = New-VerifiedStaging -SourceRoot $root -StagingRoot $stage -Files $files
        $created | Should -Be (Resolve-Path $stage).Path
        Test-Path -LiteralPath (Join-Path $stage 'one.bin') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $stage 'resources\two.bin') | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $stage 'unlisted.bin') | Should -BeFalse
    }

    It 'compiles into nonce-scoped output before publishing the stable installer name' {
        $Build | Should -Match '\$compilerOutputRoot\s*=\s*Join-Path \$distRoot "\.inno-output-\$nonce"'
        $Build | Should -Match '"/O\$compilerOutputRoot"'
        $Build | Should -Match '\$compiledOutFile\s*=\s*Join-Path \$compilerOutputRoot'
        $Build | Should -Match 'Move-Item -LiteralPath \$compiledOutFile -Destination \$outFile'
        $Build | Should -Match 'Remove-InstallerScratch -Path \$compilerOutputRoot'

        $outputScratch = Join-Path $TestDrive ('.inno-output-' + ('a' * 32))
        New-Item -ItemType Directory -Path $outputScratch | Out-Null
        { Remove-InstallerScratch -Path $outputScratch -DistRoot $TestDrive } | Should -Not -Throw
        Test-Path -LiteralPath $outputScratch | Should -BeFalse
    }
}

Describe 'Elevated installer command boundaries' {
    It 'NSIS never executes an uninstall command or install location read from the registry' {
        $Nsis | Should -Not -Match '(?m)^\s*ExecWait\b'
        $Nsis | Should -Not -Match 'QuietUninstallString'
        $Nsis | Should -Not -Match 'InstallLocation'
        $Nsis | Should -Not -Match 'RemovePreviousInstall'
    }

    It 'Inno detects versions but exposes no registry-command execution path' {
        $Inno | Should -Not -Match 'gExistingUninstaller'
        $Inno | Should -Not -Match 'RunExistingUninstaller'
        $Inno | Should -Not -Match '\bSplitCommand\s*\('
        $Inno | Should -Not -Match '\bExec\s*\(Exe\s*,'
        $Version | Should -Not -Match 'QuietUninstallString'
        $Version | Should -Not -Match 'UninstallString'
    }

    It 'same-version setup offers repair or cancel without an elevated Remove action' {
        $Inno | Should -Match 'Repair.*reinstall the current version'
        $Inno | Should -Not -Match 'Remove.*uninstall BP MD RTL Reader from this PC'
        $Inno | Should -Not -Match "\['&Repair',\s*'Re&move'"
    }
}

Describe 'Profile-preserving uninstall defaults' {
    It 'Inno exposes app-only, full-cleanup, and cancel actions with a safe default' {
        $Inno | Should -Not -Match 'CmdLineParamExists'
        $Inno | Should -Match 'function HasCommandLineParam'
        $Inno | Should -Match 'for I := 1 to ParamCount'
        $Inno | Should -Match 'CompareText\(ParamStr\(I\), Expected\)'
        $Inno | Should -Match "gKeepUserData\s*:=\s*not HasCommandLineParam\('/DELETEUSERDATA'\)"
        $Inno | Should -Match 'MB_YESNOCANCEL'
        $Inno | Should -Match 'MB_YESNOCANCEL,[^\r\n]*\['
        $Inno | Should -Match "'&Uninstall app only'"
        $Inno | Should -Match "'Uninstall and &delete app data'"
        $Inno | Should -Match 'IDYES:\s*gKeepUserData\s*:=\s*True'
        $Inno | Should -Match 'IDNO:\s*gKeepUserData\s*:=\s*False'
        $Inno | Should -Match 'IDCANCEL:\s*Result\s*:=\s*False'
    }

    It 'NSIS exposes app-only, full-cleanup, and cancel actions with a safe default' {
        $Nsis | Should -Match 'MB_YESNOCANCEL'
        $Nsis | Should -Match '/SD IDYES'
        $Nsis | Should -Match '/DELETEUSERDATA'
        $Nsis | Should -Match 'IDYES\s+keep_user_data'
        $Nsis | Should -Match 'IDNO\s+delete_user_data'
        $Nsis | Should -Not -Match 'IDCANCEL\s+cancel_uninstall'
        $Nsis | Should -Match 'IDYES\s+keep_user_data\s+IDNO\s+delete_user_data\s+Goto cancel_uninstall'
    }

    It 'full cleanup targets both app-data roots while app-only preserves both' {
        $Nsis | Should -Match 'RMDir /r "\$APPDATA\\BP MD RTL Reader"'
        $Nsis | Should -Match 'RMDir /r "\$LOCALAPPDATA\\BP MD RTL Reader"'
        $Cleanup | Should -Match 'if not KeepUserData then\s*begin\s*CU_DelTree\(RoamDir\);\s*CU_DelTree\(LocalDir\);'
    }

    It 'never derives cleanup targets from stored grants or Markdown paths' {
        $Nsis | Should -Not -Match '(?m)^\s*(?:RMDir|Delete)\b[^\r\n]*(?:capabilities\.json|\.(?:md|markdown)\b)'
        $Cleanup | Should -Not -Match '(?m)^\s*(?:CU_DelTree|CU_DelFile)\([^\r\n]*(?:capabilities\.json|\.(?:md|markdown)\b)'
    }
}
