param(
    [string]$FixturesRoot = ""
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workbenchRoot = Split-Path -Parent $scriptDir

if ([string]::IsNullOrWhiteSpace($FixturesRoot)) {
    $FixturesRoot = Join-Path $workbenchRoot "examples\fixture-repos"
}

$fixtureRepos = Get-ChildItem -LiteralPath $FixturesRoot -Directory
foreach ($fixture in $fixtureRepos) {
    $gitDir = Join-Path $fixture.FullName ".git"
    if (-not (Test-Path -LiteralPath $gitDir)) {
        git -C $fixture.FullName init | Out-Null
        git -C $fixture.FullName config user.name "Workbench Fixture" | Out-Null
        git -C $fixture.FullName config user.email "fixture@example.com" | Out-Null
    }

    $status = git -C $fixture.FullName status --short
    if (-not [string]::IsNullOrWhiteSpace(($status -join "").Trim())) {
        git -C $fixture.FullName add .
        git -C $fixture.FullName commit -m "Initialize fixture repo" | Out-Null
    } elseif (-not (git -C $fixture.FullName rev-parse --verify HEAD 2>$null)) {
        git -C $fixture.FullName add .
        git -C $fixture.FullName commit -m "Initialize fixture repo" | Out-Null
    }
}

Write-Output "Fixture repos are initialized under $FixturesRoot"
