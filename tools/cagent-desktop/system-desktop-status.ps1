$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$service = Get-Service -Name CAgentDesktopBroker -ErrorAction SilentlyContinue
$settings = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\CAgent\DesktopBroker' -ErrorAction SilentlyContinue
$proxy = Join-Path $env:ProgramFiles 'CAgentDesktopService\cagent-desktop.exe'
[ordered]@{
  installed = [bool]$service
  running = [bool]($service -and $service.Status -eq 'Running')
  elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  runtimeImagePath = [string]$settings.RuntimeImagePath
  proxyPath = $proxy
  proxyPresent = Test-Path -LiteralPath $proxy -PathType Leaf
} | ConvertTo-Json -Compress
