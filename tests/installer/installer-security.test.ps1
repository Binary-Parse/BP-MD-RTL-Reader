<#
  installer-security.test.ps1 — regression tests for SEC-001, SEC-002 and
  DATA-011. These assertions inspect the real installer sources instead of a
  copied command runner so registry-controlled text cannot regain an elevated
  execution sink unnoticed.
#>

BeforeAll {
    $script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $script:Nsis = Get-Content -Raw (Join-Path $RepoRoot 'build\installer\installer.nsh')
    $script:Inno = Get-Content -Raw (Join-Path $RepoRoot 'build\installer\setup.iss')
    $script:Cleanup = Get-Content -Raw (Join-Path $RepoRoot 'build\installer\scripts\cleanup.pas')
    $script:Version = Get-Content -Raw (Join-Path $RepoRoot 'build\installer\scripts\version-check.pas')
    $script:Build = Get-Content -Raw (Join-Path $RepoRoot 'build\installer\build-installer.ps1')
    $script:PascalSelfTest = Get-Content -Raw (Join-Path $RepoRoot 'tests\installer\run-pascal-self-test.ps1')
    $script:ReleaseVm = Get-Content -Raw (Join-Path $RepoRoot 'tests\installer\run-release-vm-tests.ps1')
    $script:Package = Get-Content -Raw (Join-Path $RepoRoot 'package.json') | ConvertFrom-Json
    $script:ToolPolicy = Get-Content -Raw (Join-Path $RepoRoot 'build\installer\toolchain-policy.json') | ConvertFrom-Json
    $script:SourcePolicy = Get-Content -Raw (Join-Path $RepoRoot 'build\installer\source-manifest-policy.json') | ConvertFrom-Json
    . (Join-Path $RepoRoot 'build\installer\build-policy.ps1')
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
        $SourcePolicy.files.Count | Should -Be 75
        @($SourcePolicy.files | Select-Object -Unique).Count | Should -Be 75
        $SourcePolicy.files | Should -Contain 'resources/app.asar'
        $SourcePolicy.files | Should -Contain 'resources/markdown-file-icon.ico'
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

    It 'uses the exact public Inno artifact names' {
        $Build | Should -Match '\$outputBase\s*=\s*"BP-MD-RTL-Reader-\$Version-Windows-Inno-x64"'
        $Build | Should -Match '"\$outputBase\.exe"'
        $Build | Should -Match '"\$outputBase\.source-manifest\.json"'
        $Inno | Should -Match 'OutputBaseFilename=BP-MD-RTL-Reader-\{#AppVersion\}-Windows-Inno-x64'
        $Inno | Should -Match '#define MyAppURL\s+"https://github\.com/Binary-Parse/BP-MD-RTL-Reader"'
    }

    It 'fails closed when release signing inputs or signatures are missing' {
        $Build | Should -Match '\[switch\]\$RequireSigned'
        $Build | Should -Match '\[string\]\$CertificateSha1'
        $Build | Should -Match '\[string\]\$SignToolPath'
        $Build | Should -Match 'Get-PackagedFileManifest[^\r\n]*-RequireSigned:\$RequireSigned'
        $Build | Should -Match 'Get-TrustedSignTool'
        $Build | Should -Match '/DReleaseSigning=1'
        $Build | Should -Match '/Sbpmd='
        $Build | Should -Match 'Assert-ReleaseSignature'
        $Inno | Should -Match '#ifdef ReleaseSigning[\s\S]*SignTool=bpmd[\s\S]*SignedUninstaller=yes[\s\S]*#endif'

        { Assert-ReleaseSignatureMetadata -Status Valid -SignerSubject 'CN=Binary Parse' -Thumbprint ('A' * 40) -ExpectedThumbprint ('A' * 40) -Timestamped $true -ExpectedSigner 'Binary Parse' } | Should -Not -Throw
        { Assert-ReleaseSignatureMetadata -Status NotSigned -SignerSubject '' -Thumbprint '' -ExpectedThumbprint ('A' * 40) -Timestamped $false -ExpectedSigner 'Binary Parse' } | Should -Throw
        { Assert-ReleaseSignatureMetadata -Status Valid -SignerSubject 'CN=Someone Else' -Thumbprint ('A' * 40) -ExpectedThumbprint ('A' * 40) -Timestamped $true -ExpectedSigner 'Binary Parse' } | Should -Throw
        { Assert-ReleaseSignatureMetadata -Status Valid -SignerSubject 'CN=Binary Parse' -Thumbprint ('B' * 40) -ExpectedThumbprint ('A' * 40) -Timestamped $true -ExpectedSigner 'Binary Parse' } | Should -Throw
        { Assert-ReleaseSignatureMetadata -Status Valid -SignerSubject 'CN=Binary Parse' -Thumbprint ('A' * 40) -ExpectedThumbprint ('A' * 40) -Timestamped $false -ExpectedSigner 'Binary Parse' } | Should -Throw
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

    # Inno Setup 6.3.3 -- the pinned compiler -- labels only the non-Cancel
    # buttons. Its own TaskDialogMsgBox example passes two labels for
    # MB_YESNOCANCEL. Supplying a label for Cancel raises, at run time and only
    # once the matching branch is reached:
    #   Runtime error: Internal error: TaskDialogMsgBox: Invalid ButtonLabels.
    # Compiling cannot catch it, so the shape is asserted here instead.
    It 'never labels the Cancel button of an MB_OKCANCEL task dialog' {
        $calls = [regex]::Matches(
            $Inno,
            'TaskDialogMsgBox\((?:[^()]|\([^()]*\))*?MB_OKCANCEL\s*,\s*\[(?<labels>[^\]]*)\]',
            'Singleline')
        $calls.Count | Should -BeGreaterThan 0
        foreach ($call in $calls) {
            $labels = $call.Groups['labels'].Value
            $count = ([regex]::Matches($labels, "'(?:[^']|'')*'")).Count
            $count | Should -Be 1 -Because "MB_OKCANCEL labels only the OK button; got [$labels]"
        }
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
        $Nsis | Should -Not -Match '\$installMode'
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

Describe 'Markdown file association icon' {
    It 'keeps the document icon separate from all application and installer branding' {
        $Package.build.win.icon | Should -Be 'build/icons/icon.ico'
        $Package.build.nsis.installerIcon | Should -Be 'build/icons/icon.ico'
        $Package.build.nsis.uninstallerIcon | Should -Be 'build/icons/icon.ico'
        $Package.build.nsis.installerHeaderIcon | Should -Be 'build/icons/icon.ico'
        @($Package.build.fileAssociations).Count | Should -Be 2
        @($Package.build.fileAssociations | ForEach-Object icon | Select-Object -Unique) | Should -Be @('build/icons/markdown-file-icon.ico')
        $extra = @($Package.build.win.extraResources | Where-Object {
            $_.from -eq 'build/icons/markdown-file-icon.ico' -and $_.to -eq 'markdown-file-icon.ico'
        })
        $extra.Count | Should -Be 1
    }

    It 'registers an opt-in Inno ProgID and icon without replacing either extension default' {
        $Inno | Should -Match '(?m)^ChangesAssociations=yes\s*$'
        $Inno | Should -Match 'Software\\Classes\\BP\.MD\.RTLReader\.Markdown\\DefaultIcon'
        $Inno | Should -Match '\{app\}\\resources\\markdown-file-icon\.ico,0'
        $Inno | Should -Match 'Software\\Classes\\BP\.MD\.RTLReader\.Markdown\\shell\\open\\command'
        $Inno | Should -Match 'Software\\Classes\\\.md\\OpenWithProgids'
        $Inno | Should -Match 'Software\\Classes\\\.markdown\\OpenWithProgids'
        $Inno | Should -Match 'ValueName: "BP\.MD\.RTLReader\.Markdown"'
        $Inno | Should -Match 'Flags: uninsdeletevalue'
        $Inno | Should -Not -Match 'Subkey: "Software\\Classes\\\.(?:md|markdown)"; ValueType: string; ValueName: ""'
    }

    It 'removes only app-owned ProgID and OpenWithProgids entries on uninstall' {
        $Cleanup.Contains("RegDeleteKeyIncludingSubkeys(HKLM, 'Software\Classes\BP.MD.RTLReader.Markdown');") | Should -BeTrue
        $Cleanup.Contains("RegDeleteKeyIncludingSubkeys(HKCU, 'Software\Classes\BP.MD.RTLReader.Markdown');") | Should -BeTrue
        foreach ($hive in @('HKLM', 'HKCU')) {
            foreach ($extension in @('.md', '.markdown')) {
                $line = "RegDeleteValue($hive, 'Software\Classes\$extension\OpenWithProgids', 'BP.MD.RTLReader.Markdown');"
                $Cleanup.Contains($line) | Should -BeTrue
            }
        }
        $Cleanup | Should -Not -Match "RegDeleteKeyIncludingSubkeys\(HK(?:LM|CU), 'Software\\Classes\\\.(?:md|markdown)'\)"
    }
    It 'makes the existing Inno context-menu verb use the document icon' {
        $matches = [regex]::Matches(
            $Inno,
            'Subkey: "Software\\Classes\\\.(?:md|markdown)\\shell\\Open with BP MD RTL Reader"; ValueType: string; ValueName: "Icon"; ValueData: "\{app\}\\resources\\markdown-file-icon\.ico,0"'
        )
        $matches.Count | Should -Be 2
    }

    It 'checks the installed icon and app-owned ProgID in the guarded release VM' {
        $ReleaseVm | Should -Match '\$fileIcon\s*=\s*Join-Path \$installRoot ''resources\\markdown-file-icon\.ico'''
        $ReleaseVm | Should -Match '\$defaultIconKey\s*=\s*if \(\$Kind -eq ''Inno''\)'
        $ReleaseVm | Should -Match 'BP\.MD\.RTLReader\.Markdown\\DefaultIcon'
        $ReleaseVm | Should -Match 'Get-ItemPropertyValue -LiteralPath \$defaultIconKey'
        $ReleaseVm | Should -Match 'Markdown icon registry value does not resolve to the installed file icon'
    }
}
Describe 'Disposable-runner release uninstall gate' {
    It 'is hard-guarded to GitHub-hosted Windows CI and absolute installer inputs' {
        $ReleaseVm | Should -Match '\$env:CI\s*-ne\s*''true'''
        $ReleaseVm | Should -Match '\$env:GITHUB_ACTIONS\s*-ne\s*''true'''
        $ReleaseVm | Should -Match '\$env:RUNNER_ENVIRONMENT\s*-ne\s*''github-hosted'''
        $ReleaseVm | Should -Match '\$env:RUNNER_OS\s*-ne\s*''Windows'''
        $ReleaseVm | Should -Match '\[IO\.Path\]::IsPathFullyQualified\(\$InstallerPath\)'
        $ReleaseVm | Should -Match '\[ValidateSet\(''Inno'', ''NSIS''\)\]'
    }

    It 'exercises preserve and destructive modes without targeting documents' {
        $ReleaseVm | Should -Match 'Invoke-UninstallScenario[^\r\n]*-DeleteUserData:\$false'
        $ReleaseVm | Should -Match 'Invoke-UninstallScenario[^\r\n]*-DeleteUserData:\$true'
        $ReleaseVm | Should -Match '/DELETEUSERDATA'
        $ReleaseVm | Should -Match '\$env:APPDATA, ''bpmdrtlreader'''
        $ReleaseVm | Should -Match '\$env:APPDATA, ''BP MD RTL Reader'''
        $ReleaseVm | Should -Match '\$env:LOCALAPPDATA, ''bpmdrtlreader'''
        $ReleaseVm | Should -Match '\$env:LOCALAPPDATA, ''BP MD RTL Reader'''
        $ReleaseVm | Should -Match 'external\.md'
        $ReleaseVm | Should -Match 'Get-FileHash'
        $ReleaseVm | Should -Match 'Assert-ReleaseSignature'
        $ReleaseVm | Should -Match 'signtool verification failed'
        $ReleaseVm | Should -Not -Match '(?i)Users\\\*|ProfileList|Get-ChildItem[^\r\n]+Users'
    }

    It 'runs every opt-in post-uninstall Pester assertion instead of leaving it skipped' {
        $ReleaseVm | Should -Match 'uninstall-check\.test\.ps1'
        $ReleaseVm | Should -Match '\$env:BPMDRTL_UNINSTALL_TEST\s*=\s*''1'''
        $ReleaseVm | Should -Match '\$env:BPMDRTL_INSTALL_DIR\s*=\s*\$installRoot'
        $ReleaseVm | Should -Match 'Invoke-Pester'
        $ReleaseVm | Should -Match 'SkippedCount\s*-ne\s*0'
    }
}

Describe 'TaskDialogMsgBox button-label arity (Inno Setup 6.3.3)' {
    # Inno renders Cancel/No as TaskDialog COMMON buttons, which never take a custom
    # label. Projects/Src/TaskDialog.pas:130-179 builds ButtonIDs from the Buttons
    # constant and then raises "Invalid ButtonLabels" unless
    # Length(ButtonLabels) = Length(ButtonIDs):
    #   MB_OK / MB_OKCANCEL       -> ButtonIDs = [IDOK]                     -> 0 or 1
    #   MB_YESNO / MB_YESNOCANCEL -> ButtonIDs = [IDYES, IDNO]              -> 0 or 2
    #   MB_RETRYCANCEL            -> ButtonIDs = [IDRETRY]                  -> 0 or 1
    #   MB_ABORTRETRYIGNORE       -> ButtonIDs = [IDRETRY,IDIGNORE,IDABORT] -> 3
    # Shipping two labels with MB_OKCANCEL made Setup die on launch with
    # "Runtime error (at 41:1096): Internal error: TaskDialogMsgBox: Invalid
    # ButtonLabels" on every machine that already had the app installed, because
    # InitializeSetup takes that branch for action='same'.
    BeforeAll {
        $script:LabelArity = @{
            'MB_OK'               = @(0, 1)
            'MB_OKCANCEL'         = @(0, 1)
            'MB_YESNO'            = @(0, 2)
            'MB_YESNOCANCEL'      = @(0, 2)
            'MB_RETRYCANCEL'      = @(0, 1)
            'MB_ABORTRETRYIGNORE' = @(3)
        }
        # Anchor on the MB_ constant so the label array is never confused with a
        # Format() argument array earlier in the same call.
        $rx = 'TaskDialogMsgBox\s*\((?<pre>[^;]*?)(?<btn>MB_[A-Z_]+)\s*,\s*\[(?<labels>[^\]]*)\]'
        $script:DialogCalls = [regex]::Matches($Inno, $rx) | ForEach-Object {
            $raw = $_.Groups['labels'].Value.Trim()
            $n = 0
            if ($raw -ne '') { $n = ([regex]::Matches($raw, "'(?:[^']|'')*'")).Count }
            [pscustomobject]@{
                Buttons = $_.Groups['btn'].Value
                Labels  = $n
                Snippet = ($_.Value -replace '\s+', ' ')
            }
        }
    }

    It 'still finds every TaskDialogMsgBox call in setup.iss' {
        @($DialogCalls).Count | Should -Be 3
    }

    It 'passes a legal label count for each Buttons constant' {
        foreach ($c in $DialogCalls) {
            $LabelArity.ContainsKey($c.Buttons) |
                Should -BeTrue -Because "unrecognised Buttons constant '$($c.Buttons)'"
            $c.Labels | Should -BeIn $LabelArity[$c.Buttons] -Because (
                "$($c.Buttons) with $($c.Labels) label(s) raises 'Invalid ButtonLabels' " +
                "at runtime -- $($c.Snippet)")
        }
    }

    It 'never supplies a label for a common Cancel button' {
        foreach ($c in ($DialogCalls | Where-Object { $_.Buttons -like '*CANCEL' })) {
            $c.Labels | Should -BeLessOrEqual 1 -Because (
                'Cancel is a TDCBF_CANCEL_BUTTON common button and takes the system label')
        }
    }
}
