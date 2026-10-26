@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-ClassroomTeacher.ps1" -Apply
if errorlevel 1 pause
