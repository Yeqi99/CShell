$ErrorActionPreference='Stop'
$key='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$v=(Get-ItemProperty -LiteralPath $key).SoftwareSASGeneration
if($null -ne $v -and $v -ne 1){throw 'Policy changed since inspection'}
New-ItemProperty -LiteralPath $key -Name SoftwareSASGeneration -PropertyType DWord -Value 1 -Force | Out-Null
(Get-ItemProperty -LiteralPath $key).SoftwareSASGeneration
