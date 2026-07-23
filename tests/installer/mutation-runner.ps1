<#
  mutation-runner.ps1 — mutation testing for the installer logic simulation.

  Stryker has no PowerShell runner, so this is the equivalent engine described in
  stryker.config.json. For every swap occurrence in logic-sim.ps1 it produces one
  mutant, copies it + the Pester test files into a temp dir, runs the suites, and
  records the mutant as KILLED (some test failed) or SURVIVED (all tests passed).

  A surviving mutant means the tests cannot tell the mutated logic from the real
  logic -> the same blind spot exists in version-check.pas / dir-validate.pas /
  cleanup.pas, so fix BOTH the test and (if needed) the Pascal.

  Usage:  pwsh -File mutation-runner.ps1            (uses stryker.config.json)
          pwsh -File mutation-runner.ps1 -Config <path>
#>
[CmdletBinding()]
param(
    [string]$Config = (Join-Path $PSScriptRoot 'stryker.config.json')
)

$ErrorActionPreference = 'Stop'

# --- Pester availability ----------------------------------------------------
$pester = Get-Module -ListAvailable -Name Pester |
          Where-Object { $_.Version.Major -ge 5 } |
          Sort-Object Version -Descending | Select-Object -First 1
if (-not $pester) {
    Write-Error "Pester 5+ is required. Install with: Install-Module Pester -Scope CurrentUser -Force -SkipPublisherCheck"
    exit 2
}
Import-Module Pester -MinimumVersion 5.0 -ErrorAction Stop

$cfg     = Get-Content $Config -Raw | ConvertFrom-Json
$srcPath = Join-Path $PSScriptRoot $cfg.mutate[0]
$src     = Get-Content $srcPath -Raw

# An occurrence whose line has a '#' before it is inside a comment -> mutating it
# cannot change behaviour (an "equivalent mutant"), so it is excluded from the
# score by standard mutation-testing practice.
function Test-IsCommentOccurrence {
    param([string]$Text, [int]$Index)
    $head = $Text.Substring(0, $Index)
    $nl = $head.LastIndexOf("`n")
    $prefix = if ($nl -ge 0) { $head.Substring($nl + 1) } else { $head }
    return $prefix.Contains('#')
}

function Get-OccurrenceIndices {
    param([string]$Text, [string]$Find)
    $idx = New-Object System.Collections.Generic.List[int]
    $start = 0
    while ($true) {
        $i = $Text.IndexOf($Find, $start)
        if ($i -lt 0) { break }
        if (-not (Test-IsCommentOccurrence -Text $Text -Index $i)) { $idx.Add($i) }
        $start = $i + $Find.Length
    }
    return $idx
}

function Test-Mutant {
    # Returns $true if the mutant is KILLED (>=1 test failed).
    param([string]$MutatedSource)
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('bpmdrtl-mut-' + [System.IO.Path]::GetRandomFileName())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Set-Content -Path (Join-Path $tmp 'logic-sim.ps1') -Value $MutatedSource -Encoding UTF8
        foreach ($tf in $cfg.testFiles) {
            Copy-Item (Join-Path $PSScriptRoot $tf) (Join-Path $tmp $tf) -Force
        }
        $conf = New-PesterConfiguration
        $conf.Run.Path      = @($cfg.testFiles | ForEach-Object { Join-Path $tmp $_ })
        $conf.Run.PassThru  = $true
        $conf.Output.Verbosity = 'None'
        $res = Invoke-Pester -Configuration $conf
        return ($res.FailedCount -gt 0)
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# --- Sanity gate: the baseline (unmutated) suite must be green --------------
Write-Host 'Baseline test run (must be green)...' -ForegroundColor Cyan
$baseConf = New-PesterConfiguration
$baseConf.Run.Path     = @($cfg.testFiles | ForEach-Object { Join-Path $PSScriptRoot $_ })
$baseConf.Run.PassThru = $true
$baseConf.Output.Verbosity = 'None'
$base = Invoke-Pester -Configuration $baseConf
if ($base.FailedCount -gt 0) {
    Write-Error "Baseline tests fail ($($base.FailedCount) failed). Fix tests before mutation testing."
    exit 3
}
Write-Host "Baseline: $($base.PassedCount) passed." -ForegroundColor Green

# --- Generate + evaluate mutants -------------------------------------------
$total = 0; $killed = 0
$survivors = New-Object System.Collections.Generic.List[string]

function Invoke-SwapMutants {
    param([string]$Name, [string]$From, [string]$To)
    $occ = Get-OccurrenceIndices -Text $src -Find $From
    foreach ($oi in $occ) {
        $mutant = $src.Substring(0, $oi) + $To + $src.Substring($oi + $From.Length)
        $script:total++
        $line = ($src.Substring(0, $oi).Split("`n")).Count
        if (Test-Mutant $mutant) {
            $script:killed++
        } else {
            $script:survivors.Add(("[{0}] '{1}' -> '{2}'  (line ~{3})" -f $Name, $From, $To, $line))
        }
    }
}

foreach ($m in $cfg.mutators) {
    if ($m.PSObject.Properties.Name -contains 'swaps' -and $m.swaps) {
        foreach ($swap in $m.swaps) {
            Invoke-SwapMutants -Name $m.name -From $swap[0] -To $swap[1]
        }
    }
    if ($m.PSObject.Properties.Name -contains 'patterns' -and $m.patterns) {
        # Statement-removal: comment out one matching line per occurrence.
        $lines = $src -split "`n"
        foreach ($pat in $m.patterns) {
            for ($li = 0; $li -lt $lines.Count; $li++) {
                if ($lines[$li].TrimStart().StartsWith('#')) { continue }   # skip comment lines
                if ($lines[$li] -match [regex]::Escape($pat)) {
                    $copy = $lines.Clone()
                    $copy[$li] = '# [mutant-removed] ' + $copy[$li]
                    $total++
                    if (Test-Mutant ($copy -join "`n")) { $killed++ }
                    else { $survivors.Add(("[{0}] removed '{1}' (line {2})" -f $m.name, $pat, ($li + 1))) }
                }
            }
        }
    }
}

# --- Report -----------------------------------------------------------------
$survived = $total - $killed
$score = if ($total -gt 0) { [Math]::Round(100.0 * $killed / $total, 1) } else { 0 }

Write-Host ''
Write-Host ('Mutants: {0}   Killed: {1}   Survived: {2}   Score: {3}%' -f $total, $killed, $survived, $score) -ForegroundColor Cyan
if ($survivors.Count -gt 0) {
    Write-Host 'Surviving mutants:' -ForegroundColor Yellow
    $survivors | ForEach-Object { Write-Host "  SURVIVED  $_" -ForegroundColor Yellow }
}

$break = [double]$cfg.thresholds.break
if ($total -eq 0) {
    Write-Error 'No mutants were generated — check the mutator swaps against logic-sim.ps1.'
    exit 4
}
if ($score -lt $break) {
    Write-Error ("Mutation score {0}% is below the break threshold {1}%." -f $score, $break)
    exit 1
}
Write-Host ("PASS: mutation score {0}% >= break {1}%." -f $score, $break) -ForegroundColor Green
exit 0
