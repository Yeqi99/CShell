Get-Process -Name LogonUI,winlogon,cagent-desktop*,LockApp -ErrorAction SilentlyContinue|Select Name,SessionId,Id|Format-Table
Get-WinEvent -FilterHashtable @{LogName='System';StartTime=(Get-Date).AddMinutes(-12)} -ErrorAction SilentlyContinue|Where-Object ProviderName -match 'Winlogon|SAS|Terminal'|Select -First 8 Id,ProviderName,Message|Format-List
Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'|select SoftwareSASGeneration,DisableCAD,EnableLUA
