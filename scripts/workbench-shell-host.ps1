param(
    [string]$Prefix = "http://127.0.0.1:8777/",
    [string]$Token = "",
    [string]$LogPath = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Token)) {
    throw "Token is required."
}

if ([string]::IsNullOrWhiteSpace($LogPath)) {
    $LogPath = Join-Path $env:TEMP "workbench-shell-host.log"
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add($Prefix)
$listener.Start()

function Write-Log {
    param([string]$Message)
    $line = "{0} {1}" -f ([DateTime]::UtcNow.ToString("o")), $Message
    Add-Content -LiteralPath $LogPath -Value $line
}

function Send-Json {
    param(
        [Parameter(Mandatory=$true)] $Context,
        [int]$StatusCode = 200,
        [Parameter(Mandatory=$true)] $Body
    )
    $json = $Body | ConvertTo-Json -Depth 8
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = "application/json"
    $Context.Response.ContentEncoding = [System.Text.Encoding]::UTF8
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}

function Invoke-WorkbenchCommand {
    param(
        [string]$Command,
        [string]$Cwd
    )

    $stdout = ""
    $stderr = ""
    $exitCode = 0

    $oldLocation = Get-Location
    try {
        if (-not [string]::IsNullOrWhiteSpace($Cwd)) {
            Set-Location -LiteralPath $Cwd
        }

        $output = Invoke-Expression $Command 2>&1
        if ($null -ne $output) {
            $stdout = ($output | Out-String).TrimEnd()
        }

        if ($LASTEXITCODE) {
            $exitCode = [int]$LASTEXITCODE
        }
    } catch {
        $stderr = ($_ | Out-String).TrimEnd()
        $exitCode = 1
    } finally {
        Set-Location -LiteralPath $oldLocation
    }

    return @{
        exitCode = $exitCode
        stdout = $stdout
        stderr = $stderr
        combined = (@($stdout, $stderr) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join "`n"
    }
}

Write-Log "shell host started prefix=$Prefix pid=$PID"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $tokenHeader = $request.Headers["x-workbench-token"]

        if ($tokenHeader -ne $Token) {
            Send-Json -Context $context -StatusCode 401 -Body @{ error = "unauthorized" }
            continue
        }

        $path = $request.Url.AbsolutePath
        if ($request.HttpMethod -eq "GET" -and $path -eq "/health") {
            Send-Json -Context $context -Body @{
                ok = $true
                pid = $PID
                prefix = $Prefix
            }
            continue
        }

        if ($request.HttpMethod -eq "POST" -and $path -eq "/shutdown") {
            Send-Json -Context $context -Body @{
                ok = $true
                shuttingDown = $true
            }
            break
        }

        if ($request.HttpMethod -eq "POST" -and $path -eq "/run") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
            $bodyText = $reader.ReadToEnd()
            $payload = $bodyText | ConvertFrom-Json
            $result = Invoke-WorkbenchCommand -Command $payload.command -Cwd $payload.cwd
            Send-Json -Context $context -Body $result
            continue
        }

        Send-Json -Context $context -StatusCode 404 -Body @{ error = "not_found"; path = $path }
    }
} finally {
    Write-Log "shell host stopping pid=$PID"
    $listener.Stop()
    $listener.Close()
}
