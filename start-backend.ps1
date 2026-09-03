[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Write-Host 'Starting backend API on http://127.0.0.1:4000 …' -ForegroundColor Cyan
Set-Location (Join-Path $root 'server')
npm run dev
