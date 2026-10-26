@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test-Classroom-Network.ps1"
if errorlevel 1 echo Unable to finish diagnostics. No settings were changed.
pause
