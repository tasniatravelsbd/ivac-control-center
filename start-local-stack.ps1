[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Write-Host 'Start MySQL first, then this script opens visible terminals for the local stack.' -ForegroundColor Yellow
$scripts = 'start-backend.ps1', 'start-fixture.ps1', 'start-worker.ps1', 'start-frontend.ps1'
foreach ($script in $scripts) {
  Start-Process powershell.exe -ArgumentList '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot $script)
}
