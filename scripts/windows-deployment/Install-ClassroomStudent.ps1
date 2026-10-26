param(
  [string]$BundleDirectory = $PSScriptRoot,
  [string]$CShellDestination,
  [string]$CAgentDestination = (Join-Path $env:LOCALAPPDATA 'Programs\CAgent'),
  [int]$Port = 24443,
  [string]$Room = '机房',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Port must be 1024..65535' }
if ($Room.Length -gt 60 -or $Room -match '[\x00-\x1f]') { throw 'Invalid classroom name' }
$bundle = (Resolve-Path -LiteralPath $BundleDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $bundle 'classroom-deployment.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 'cshell-classroom-bundle-1') { throw 'Unsupported classroom deployment bundle' }
if ($manifest.cshell.productName -notin @('CShell', 'CShell Pro')) { throw 'Unsupported CShell edition' }
if (-not $CShellDestination) { $CShellDestination = Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') $manifest.cshell.productName }
function BundlePath([string]$Relative) {
  if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)|:') { throw 'Invalid bundle path' }
  return Join-Path $bundle $Relative
}
$installer = BundlePath $manifest.cshell.file
$agentBundle = BundlePath $manifest.cagent.directory
$studentScript = BundlePath $manifest.studentScript.file
foreach ($entry in @(@{path=$installer;sha=$manifest.cshell.sha256}, @{path=(Join-Path $agentBundle 'Install-CAgent.ps1');sha=$manifest.cagent.installerSha256}, @{path=$studentScript;sha=$manifest.studentScript.sha256})) {
  if ($entry.sha -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $entry.path -Algorithm SHA256).Hash -ine $entry.sha) { throw 'Classroom bundle checksum mismatch' }
}
if (-not $Apply) { Write-Output 'Classroom plan verified: install CShell classroom extension and CAgent; initialize fresh CAgent with classroom credentials, authenticated desktop control and LAN listener; launch and enable sign-in startup. Existing data and startup opt-outs are preserved. No firewall changes. Add -Apply to install.'; return }
$privateDirectory = Join-Path ([IO.Path]::GetTempPath()) ('cshell-classroom-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($privateDirectory)
try {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($sid)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $privateDirectory -AclObject $acl
  # Explicit classroom preset only. Never pass this value through argv or logs.
  [IO.File]::WriteAllText((Join-Path $privateDirectory 'password.txt'), '123456', (New-Object Text.UTF8Encoding($false)))
  $agentConfig = @{format='cshell-deployment-1';target='cagent';preset='classroom-student';passwordFile='password.txt';bind='0.0.0.0';port=$Port;listenOnLaunch=$true;shells=@('powershell');permissions=@{manage=$true;http=$false;hosting=$false;relay=$false};packages=@()}
  $agentConfig.lanDiscovery = @{enabled=$true;name=[Environment]::MachineName;room=$Room}
  $shellConfig = @{format='cshell-deployment-1';target='cshell';extensions=@(@{id='cshell.classroom';enabled=$true},@{id='cshell.agent';enabled=$true});packages=@()}
  $agentPath = Join-Path $privateDirectory 'cagent.json'
  $shellPath = Join-Path $privateDirectory 'cshell.json'
  $agentConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $agentPath -Encoding UTF8
  $shellConfig | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $shellPath -Encoding UTF8
  & $studentScript -CShellInstaller $installer -CShellSha256 $manifest.cshell.sha256 -CShellExecutable (Join-Path $CShellDestination ($manifest.cshell.productName + '.exe')) -CShellDestination $CShellDestination -CShellConfig $shellPath -CAgentBundle $agentBundle -CAgentConfig $agentPath -CAgentInstallerSha256 $manifest.cagent.installerSha256 -CAgentDestination $CAgentDestination -StartCAgent -Apply
} finally {
  # Remove only this invocation's fixed, freshly generated temp directory.
  $resolved = [IO.Path]::GetFullPath($privateDirectory)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^cshell-classroom-[a-f0-9]{32}$') { throw 'Refusing unsafe temporary cleanup' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
