$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$service = Get-Service -Name CAgentDesktopBroker -ErrorAction SilentlyContinue
$settings = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\CAgent\DesktopBroker' -ErrorAction SilentlyContinue
$proxy = Join-Path $env:ProgramFiles 'CAgentDesktopService\cagent-desktop.exe'
$packageMatches = $true
foreach ($name in @('cagent-desktop.exe','cagent-desktop-broker.exe')) {
  $expected = Join-Path $PSScriptRoot ('system-desktop\' + $name)
  $installed = Join-Path $env:ProgramFiles ('CAgentDesktopService\' + $name)
  if (!(Test-Path -LiteralPath $expected -PathType Leaf) -or !(Test-Path -LiteralPath $installed -PathType Leaf)) { $packageMatches = $false; continue }
  try { if ((Get-FileHash -LiteralPath $expected -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash) { $packageMatches = $false } } catch { $packageMatches = $false }
}
[ordered]@{
  packageMatches = $packageMatches
  updateRequired = [bool]($service -and !$packageMatches)
  installed = [bool]$service
  running = [bool]($service -and $service.Status -eq 'Running')
  elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  runtimeImagePath = [string]$settings.RuntimeImagePath
  proxyPath = $proxy
  proxyPresent = Test-Path -LiteralPath $proxy -PathType Leaf
} | ConvertTo-Json -Compress
