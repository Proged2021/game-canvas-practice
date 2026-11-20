param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$cfg = Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw | ConvertFrom-Json
$url = 'http://' + $cfg.meshIp + ':' + $cfg.dashboardPort
if (-not (Get-NetIPAddress -IPAddress $cfg.meshIp -ErrorAction SilentlyContinue)) { $url = 'http://127.0.0.1:' + $cfg.dashboardPort }
$node = Join-Path $root 'runtime\node.exe'
$script = Join-Path $root 'server.cjs'
$statePath = Join-Path $root 'state\controller.json'
$mutex = New-Object Threading.Mutex($false, 'Local\AI_ControlPanel_Launcher')
$locked = $false
try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked) { exit 0 }
    $existing = $null
    if (Test-Path -LiteralPath $statePath) {
        $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        $candidate = Get-Process -Id ([int]$state.processId) -ErrorAction SilentlyContinue
        if ($candidate -and $candidate.Path -eq $node -and $candidate.StartTime.ToUniversalTime().Ticks.ToString() -eq [string]$state.startTimeUtcTicks) { $existing = $candidate }
    }
    if (-not $existing) {
        # Workspace relay only needs outbound HTTPS; loopback works without Meshnet.
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $server = Start-Process -FilePath $node -ArgumentList ('"' + $script + '"') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root ('logs\control-' + $stamp + '.out.log')) -RedirectStandardError (Join-Path $root ('logs\control-' + $stamp + '.err.log')) -PassThru
        [ordered]@{processId=$server.Id;startTimeUtcTicks=$server.StartTime.ToUniversalTime().Ticks.ToString();executable=$node} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    }
    $ready = $false
    for ($i=0; $i -lt 15; $i++) {
        try { $response = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $cfg.dashboardPort + '/api/status') -TimeoutSec 3; if ($response.meshIp -eq $cfg.meshIp) { $ready = $true; break } } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Control panel did not start. See the logs folder.' }
    Write-Output ('READY ' + $url)
    if (-not $NoBrowser) { Start-Process $url }
} catch {
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $root 'logs\launcher-error.txt') -Encoding UTF8
    throw
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
