$path="HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
Get-ItemProperty $path | Select SoftwareSASGeneration,DisableCAD | ConvertTo-Json
Test-Path "$env:SystemRoot/System32/sas.dll"
