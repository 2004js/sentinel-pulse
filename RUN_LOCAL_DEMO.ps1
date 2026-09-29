$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host 'SENTINEL PULSE — LOCAL SIH DEMO' -ForegroundColor Cyan
Write-Host 'Starting backend and frontend in separate PowerShell windows...' -ForegroundColor Gray
Write-Host ''

if (-not (Test-Path .venv)) {
  Write-Host 'Creating Python virtual environment...' -ForegroundColor Yellow
  python -m venv .venv
}

Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File',"$PSScriptRoot\start-backend.ps1"
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList '-NoExit','-ExecutionPolicy','Bypass','-File',"$PSScriptRoot\start-frontend.ps1"

Write-Host 'Backend:  http://127.0.0.1:8000/health' -ForegroundColor Green
Write-Host 'Frontend: http://localhost:5173' -ForegroundColor Green
Write-Host 'Wait for both terminals to show their startup messages.' -ForegroundColor Gray
