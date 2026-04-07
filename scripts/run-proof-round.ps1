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
    $proc = Start-Process python -ArgumentList @(
        "-u",
        $hostScript,
        "--token",
        $Token
    ) -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WindowStyle Hidden -PassThru

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

function Invoke-PersistentInvestigation {
    $env:WORKBENCH_HOST_TOKEN = $Token
    $env:WORKBENCH_HOST_URL = $HostUrl

    $escapedRepo = ($InvestigationRepo -replace "\\", "/")
    $escapedPackageJson = ((Join-Path $InvestigationRepo "package.json") -replace "\\", "/")
    $searchRoot = ($InvestigationRepo -replace "\\", "/")
    @"
import { ToolRegistry } from "./dist/tools/registry.js";
import { ShellTool } from "./dist/tools/shell-tool.js";
import { WorkbenchSession } from "./dist/runtime/session.js";
import { loadHostShellRunner } from "./dist/host/load-host-runner.js";

const registry = new ToolRegistry();
const shellRunner = await loadHostShellRunner("./src/host/http-shell-host.mjs");
registry.register("shell", new ShellTool(shellRunner));

const session = new WorkbenchSession(process.cwd(), registry);
await session.initialize();

const repoPath = ${([System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($escapedRepo) | ForEach-Object { "'$_'" })};
const packageJsonPath = ${([System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($escapedPackageJson) | ForEach-Object { "'$_'" })};
const searchTerm = ${([System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($InvestigationSearch) | ForEach-Object { "'$_'" })};

await session.evaluator.evaluate(`await setRepo(${JSON.stringify(repoPath)})`);
let scripts = JSON.stringify({ scripts: [] }, null, 2);
try {
  await session.evaluator.evaluate(`globalThis.pkg = await json(${JSON.stringify(packageJsonPath)})`);
  scripts = await session.evaluator.evaluate(`JSON.stringify({ scripts: Object.keys(pkg.scripts || {}) }, null, 2)`);
} catch (error) {
  scripts = JSON.stringify({ scripts: [], packageJsonError: error?.message ?? String(error) }, null, 2);
}
await session.evaluator.evaluate(`globalThis.searchHits = await findText(${JSON.stringify($InvestigationSearch)}, ${JSON.stringify($escapedRepo)})`);
const searchHits = await session.evaluator.evaluate(`JSON.stringify({ hitCount: searchHits.split(/\\r?\\n/).filter(Boolean).length, searchHits }, null, 2)`);
console.log(JSON.stringify({ repoPath, scripts, searchTerm, searchHits }, null, 2));
"@ | node --input-type=module
}

npm run build | Out-Null

$hostProcess = $null
try {
    $hostProcess = Start-HostServer

    $crossRepo = @{}
    foreach ($repo in $Repos) {
        $name = Split-Path $repo -Leaf
        $crossRepo[$name] = [PSCustomObject]@{
            repoAudit = (Invoke-WorkbenchEval -Repo $repo -Expression "JSON.stringify(await repoAudit(), null, 2)") -join "`n"
            testOrExplain = (Invoke-WorkbenchEval -Repo $repo -Expression "JSON.stringify(await testOrExplain(), null, 2)") -join "`n"
        }
    }

    $payload = [PSCustomObject]@{
        generatedAt = [DateTime]::UtcNow.ToString("o")
        hostUrl = $HostUrl
        repos = $Repos
        crossRepo = $crossRepo
        persistentInvestigation = (Invoke-PersistentInvestigation) -join "`n"
    }

    $payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
    Write-Output "Wrote proof round output to $OutputPath"
}
finally {
    Stop-HostServer -Process $hostProcess
}
