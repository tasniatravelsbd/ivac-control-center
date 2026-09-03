[CmdletBinding()]
param([ValidateRange(1, 65535)][int]$Port = 4174)

$ErrorActionPreference = 'Stop'
$env:FIXTURE_PORT = "$Port"
Write-Host "Starting local IVAC fixture on http://127.0.0.1:$Port …" -ForegroundColor Cyan
Set-Location (Join-Path $PSScriptRoot 'automation')
npm run fixture:runtime
