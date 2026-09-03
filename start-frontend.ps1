[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Write-Host 'Starting Vite frontend on http://127.0.0.1:5173 …' -ForegroundColor Cyan
Set-Location $PSScriptRoot
npm run dev
