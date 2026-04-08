param(
    [string[]]$Repos = @(),
    [string]$Token = "workbench-proof-token",
    [string]$HostUrl = "http://127.0.0.1:8777",
    [string]$OutputPath = "",
    [string]$InvestigationRepo = "",
    [string]$InvestigationSearch = "package:nsis"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workbenchRoot = Split-Path -Parent $scriptDir
$hostScript = Join-Path $workbenchRoot "scripts\workbench_shell_host.py"
$nodeHostModule = Join-Path $workbenchRoot "dist\host\node-child-process-runner.js"
$hostModule = Join-Path $workbenchRoot "src\host\http-shell-host.mjs"
$outLog = Join-Path $workbenchRoot "tmp-proof-host.out.log"
$errLog = Join-Path $workbenchRoot "tmp-proof-host.err.log"
$configPath = Join-Path $workbenchRoot "proof-round.config.json"

if (Test-Path -LiteralPath $configPath) {
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
} else {
    $config = $null
}

if ($Repos.Count -eq 0 -and $null -ne $config -and $null -ne $config.repos) {
    $Repos = @($config.repos)
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    if ($null -ne $config -and -not [string]::IsNullOrWhiteSpace($config.outputPath)) {
        $OutputPath = [string]$config.outputPath
    } else {
        $OutputPath = Join-Path $workbenchRoot "proof-round-output.json"
    }
}

if ([string]::IsNullOrWhiteSpace($InvestigationRepo)) {
    if ($null -ne $config -and -not [string]::IsNullOrWhiteSpace($config.investigationRepo)) {
        $InvestigationRepo = [string]$config.investigationRepo
    } elseif ($Repos.Count -gt 0) {
        $InvestigationRepo = [string]$Repos[0]
    }
}

if ($null -ne $config -and -not [string]::IsNullOrWhiteSpace($config.investigationSearch)) {
    $InvestigationSearch = [string]$config.investigationSearch
}

if ($Repos.Count -eq 0) {
    throw "No repos were provided. Pass -Repos or create proof-round.config.json."
}

if ([string]::IsNullOrWhiteSpace($InvestigationRepo)) {
    throw "No investigation repo was resolved. Pass -InvestigationRepo or set it in proof-round.config.json."
}

Set-Location -LiteralPath $workbenchRoot

function Start-HostServer {
    Remove-Item -LiteralPath $outLog, $errLog -ErrorAction SilentlyContinue
    $pythonLaunchers = @(
        [PSCustomObject]@{ FilePath = "python"; Arguments = @("-u", $hostScript, "--token", $Token) },
        [PSCustomObject]@{ FilePath = "py"; Arguments = @("-3", "-u", $hostScript, "--token", $Token) }
    )

    $proc = $null
    $launchErrors = @()
    foreach ($launcher in $pythonLaunchers) {
        try {
            $proc = Start-Process $launcher.FilePath -ArgumentList $launcher.Arguments `
                -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru
            break
        } catch {
            $launchErrors += "$($launcher.FilePath): $($_.Exception.Message)"
        }
    }

    if ($null -eq $proc) {
        throw "Could not start the host server. Launch attempts failed:`n$($launchErrors -join "`n")"
    }

    $headers = @{ "x-workbench-token" = $Token }
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        try {
            $null = Invoke-RestMethod -Headers $headers -Uri "$HostUrl/health"
            return $proc
        } catch {
        }
    }

    $stderr = Get-Content $errLog -ErrorAction SilentlyContinue | Out-String
    throw "Host server did not become healthy. STDERR:`n$stderr"
}

function Stop-HostServer {
    param([System.Diagnostics.Process]$Process)

    try {
        Invoke-RestMethod -Method Post -Headers @{ "x-workbench-token" = $Token } -Uri "$HostUrl/shutdown" | Out-Null
    } catch {
    }

    if ($Process -and (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $Process.Id -Force
    }
}

function Invoke-WorkbenchEval {
    param(
        [string]$Repo,
        [string]$Expression
    )

    $env:WORKBENCH_HOST_TOKEN = $Token
    $env:WORKBENCH_HOST_URL = $HostUrl

    node .\dist\cli\main.js --host $hostModule --repo $Repo eval $Expression
}

function Get-ActiveHostModule {
    $pythonCommand = Get-Command python, py -ErrorAction SilentlyContinue |
        Where-Object {
            $source = [string]$_.Source
            -not [string]::IsNullOrWhiteSpace($source) -and
            $source -notlike "*\WindowsApps\python.exe"
        } |
        Select-Object -First 1
    if ($null -ne $pythonCommand) {
        return $hostModule
    }

    if (Test-Path -LiteralPath $nodeHostModule) {
        return $nodeHostModule
    }

    throw "No usable host module is available. Python launchers were not found, and $nodeHostModule does not exist."
}

function Invoke-WorkbenchProof {
    param(
        [string]$Repo,
        [string]$Search,
        [string]$OutputFile
    )

    $env:WORKBENCH_HOST_TOKEN = $Token
    $env:WORKBENCH_HOST_URL = $HostUrl

    $args = @(
        ".\dist\cli\main.js",
        "--host",
        (Get-ActiveHostModule),
        "proof",
        "--repo",
        $Repo,
        "--output",
        $OutputFile
    )

    if (-not [string]::IsNullOrWhiteSpace($Search)) {
        $args += @("--search", $Search)
    }

    node @args | Out-Null
    return Get-Content -LiteralPath $OutputFile -Raw | ConvertFrom-Json
}

npm run build | Out-Null

$hostProcess = $null
try {
    $activeHostModule = Get-ActiveHostModule
    if ($activeHostModule -eq $hostModule) {
        $hostProcess = Start-HostServer
    }

    $proofDir = Join-Path $env:USERPROFILE ".workbench\proof-rounds"
    New-Item -ItemType Directory -Force -Path $proofDir | Out-Null

    $crossRepo = @{}
    foreach ($repo in $Repos) {
        $name = Split-Path $repo -Leaf
        $safeName = (($name -replace '[^A-Za-z0-9._-]', '_').Trim('_'))
        if ([string]::IsNullOrWhiteSpace($safeName)) {
            $safeName = "repo"
        }
        $proofFile = Join-Path $proofDir "$safeName.proof.json"
        $search = if ($repo -eq $InvestigationRepo) { $InvestigationSearch } else { "" }
        $crossRepo[$name] = Invoke-WorkbenchProof -Repo $repo -Search $search -OutputFile $proofFile
    }

    $payload = [PSCustomObject]@{
        generatedAt = [DateTime]::UtcNow.ToString("o")
        hostUrl = $HostUrl
        repos = $Repos
        crossRepo = $crossRepo
    }

    $payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
    Write-Output "Wrote proof round output to $OutputPath"
}
finally {
    Stop-HostServer -Process $hostProcess
}
