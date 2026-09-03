[CmdletBinding()]
param(
  [string]$OperatorToken = $env:IVAC_ACCESS_TOKEN,
  [string]$BackendUrl = 'http://127.0.0.1:4000',
  [string]$FrontendUrl = 'http://127.0.0.1:5173',
  [string]$FixtureUrl = 'http://127.0.0.1:4174'
)

$ErrorActionPreference = 'Stop'
function Test-LocalTcpPort([string]$HostName, [int]$Port, [string]$Name) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync($HostName, $Port)
    if (-not $task.Wait(3000) -or -not $client.Connected) { throw "$Name is not reachable at ${HostName}:$Port" }
    Write-Host "PASS  $Name (${HostName}:$Port)" -ForegroundColor Green
  } finally { $client.Dispose() }
}
function Test-Http([string]$Url, [string]$Name, [hashtable]$Headers = @{}) {
  $response = Invoke-WebRequest -Uri $Url -Headers $Headers -TimeoutSec 5
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) { throw "$Name returned HTTP $($response.StatusCode)" }
  Write-Host "PASS  $Name ($Url)" -ForegroundColor Green
  return $response.Content | ConvertFrom-Json
}

Test-LocalTcpPort '127.0.0.1' 3306 'MySQL'
$health = Test-Http "$BackendUrl/health" 'Backend health'
if (-not $health.ok) { throw 'Backend health response was not OK' }
Test-Http $FrontendUrl 'Frontend' | Out-Null
Test-Http "$FixtureUrl/signin" 'Local IVAC fixture' | Out-Null
if ([string]::IsNullOrWhiteSpace($OperatorToken)) {
  Write-Warning 'Worker health skipped. Re-run with -OperatorToken or IVAC_ACCESS_TOKEN to verify the protected worker-health endpoint.'
} else {
  $workers = Test-Http "$BackendUrl/api/workers/health" 'Worker health' @{ Authorization = "Bearer $OperatorToken" }
  if (-not @($workers.data | Where-Object { $_.online }).Count) { throw 'No online worker reported by backend.' }
  Write-Host 'PASS  At least one worker is ONLINE' -ForegroundColor Green
}
