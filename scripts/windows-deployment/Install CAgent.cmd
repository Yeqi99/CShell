@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-CAgent.ps1"
if errorlevel 1 (
  echo Installation failed. No access permissions were granted.
  pause
  exit /b 1
)
pause
