[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$envFile = Join-Path $PSScriptRoot 'automation\.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'automation/.env is required. Copy automation/.env.example and provision a local worker key first.' }
$targetLine = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*IVAC_BASE_URL\s*=' } | Select-Object -First 1
if (-not $targetLine -or $targetLine -notmatch '127\.0\.0\.1|localhost') { throw 'Refusing to start the local worker unless IVAC_BASE_URL is a loopback fixture target.' }
Write-Host 'Starting local worker against the loopback fixture target …' -ForegroundColor Cyan
Set-Location (Join-Path $PSScriptRoot 'automation')
npm run dev
