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

Describe 'Modern uninstall choices and complete current-account cleanup' {
    It 'Inno uses a labeled custom choice form instead of a Yes/No task dialog' {
        $Inno | Should -Not -Match 'CmdLineParamExists'
        $Inno | Should -Match 'function HasCommandLineParam'
        $Inno | Should -Match 'for I := 1 to ParamCount'
        $Inno | Should -Match 'CompareText\(ParamStr\(I\), Expected\)'
        $Inno | Should -Match 'function ShowUninstallChoiceForm:\s*Boolean'
        $Inno | Should -Match 'CreateCustomForm\(\)'
        $Inno | Should -Match "Caption\s*:=\s*'Choose what to remove'"
        $Inno | Should -Match "Caption\s*:=\s*'Remove app only'"
        $Inno | Should -Match "Caption\s*:=\s*'Remove app and all app data'"
        $Inno | Should -Match 'gAppOnlyRadio\.Checked\s*:=\s*True'
        $Inno | Should -Not -Match "TaskDialogMsgBox\(\s*'Choose how to uninstall BP MD RTL Reader'"
    }

    It 'NSIS uses a labeled custom choice page instead of a Yes/No message box' {
        $Nsis | Should -Match '!include\s+"nsDialogs\.nsh"'
        $Nsis | Should -Match '!macro customUnWelcomePage'
        $Nsis | Should -Match 'UninstPage custom un\.BpmdChoicePageCreate un\.BpmdChoicePageLeave'
        $Nsis | Should -Match '\$\{NSD_CreateRadioButton\}'
        $Nsis | Should -Match 'Choose what to remove'
        $Nsis | Should -Match 'Remove app only'
        $Nsis | Should -Match 'Remove app and all app data'
        $Nsis | Should -Match 'Your Markdown documents are never deleted\.'
        $Nsis | Should -Not -Match 'MessageBox\s+MB_YES'
    }

    It 'uses the stable unclipped Uninstall primary caption in both installer families' {
        $Inno | Should -Match "gActionButton\.Caption\s*:=\s*'Uninstall'"
        $Inno | Should -Not -Match "gActionButton\.Caption\s*:=\s*'Uninstall app only'"
        $Inno | Should -Not -Match "gActionButton\.Caption\s*:=\s*'Uninstall and delete app data'"
        $Nsis | Should -Match 'SendMessage\s+\$R1\s+\$\{WM_SETTEXT\}\s+0\s+"STR:Uninstall"'
        $Nsis | Should -Not -Match 'STR:Uninstall app only'
        $Nsis | Should -Not -Match 'STR:Uninstall and delete app data'
    }

    It 'keeps silent removal safe and makes both destructive switches comprehensive' {
        $Inno | Should -Match "gKeepUserData\s*:=\s*not HasCommandLineParam\('/DELETEUSERDATA'\)"
        $Nsis | Should -Match '/DELETEUSERDATA'
        $Nsis | Should -Match '--delete-app-data'
        $Nsis | Should -Match '\$\{If\}\s+\$\{Silent\}'
    }

    It 'targets the actual Electron profile plus all supported aliases under current shell context' {
        $Nsis | Should -Match 'SetShellVarContext current[\s\S]*RMDir /r "\$APPDATA\\bpmdrtlreader"'
        $Nsis | Should -Match 'RMDir /r "\$APPDATA\\BP MD RTL Reader"'
        $Nsis | Should -Match 'RMDir /r "\$LOCALAPPDATA\\bpmdrtlreader"'
        $Nsis | Should -Match 'RMDir /r "\$LOCALAPPDATA\\BP MD RTL Reader"'
        $Nsis | Should -Match 'RMDir /r "\$LOCALAPPDATA\\BP MD RTL Reader"[\s\S]*SetShellVarContext all'
        $Cleanup | Should -Match "ExpandConstant\('\{userappdata\}\\bpmdrtlreader'\)"
        $Cleanup | Should -Match "ExpandConstant\('\{userappdata\}\\BP MD RTL Reader'\)"
        $Cleanup | Should -Match "ExpandConstant\('\{localappdata\}\\bpmdrtlreader'\)"
        $Cleanup | Should -Match "ExpandConstant\('\{localappdata\}\\BP MD RTL Reader'\)"
        $Nsis | Should -Not -Match '(?i)ProgramData|ProfileList'
    }

    It 'detects and reports incomplete destructive cleanup instead of claiming success' {
        $Nsis | Should -Match 'Var BpmdCleanupFailures'
        $Nsis | Should -Match '!macro customUninstallPage'
        $Nsis | Should -Match 'UninstPage custom un\.BpmdCleanupResultPageCreate'
        $Nsis | Should -Match 'IfFileExists.*BpmdCleanupFailures'
        $Cleanup | Should -Match 'function DeleteUserData\(KeepUserData: Boolean\): string'
        $Cleanup | Should -Match 'DirExists\(Path\)'
        $Inno | Should -Match 'gCleanupFailures\s*:=\s*DeleteUserData\(gKeepUserData\)'
        $Inno | Should -Match 'procedure ShowCleanupIncompleteForm'
    }

    It 'never derives cleanup targets from stored grants or Markdown paths' {
        $Nsis | Should -Not -Match '(?m)^\s*(?:RMDir|Delete)\b[^\r\n]*(?:capabilities\.json|\.(?:md|markdown)\b)'
        $Cleanup | Should -Not -Match '(?m)^\s*(?:CU_DelTree|CU_DelFile)\([^\r\n]*(?:capabilities\.json|\.(?:md|markdown)\b)'
        ($Nsis + $Cleanup) | Should -Not -Match '(?i)Users\\\*|ProfileList|FindFirst.*Users'
    }
}
