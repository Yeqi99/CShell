param(
  [ValidateSet('Install','Status')][string]$Action='Install',
  [string]$RuntimeImagePath,
  [string]$SourceDirectory,
  [ValidatePattern('^S-1-5-21-[0-9-]+$')][string]$OwnerSid,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$WorkerSha256,
  [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$BrokerSha256
)
$ErrorActionPreference='Stop'
$destination=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'CAgentDesktopService'
$registry='HKLM:\SOFTWARE\CAgent\DesktopBroker'
if($Action -eq 'Status'){
  $installedService=Get-Service -Name CAgentDesktopBroker -ErrorAction SilentlyContinue
  $configuration=Get-ItemProperty -LiteralPath $registry -ErrorAction SilentlyContinue
  [ordered]@{installed=[bool]($installedService -and (Test-Path -LiteralPath (Join-Path $destination 'cagent-desktop.exe')));running=[bool]($installedService -and $installedService.Status -eq 'Running');runtimeImagePath=$(if($configuration -and $configuration.RuntimeImagePath){$configuration.RuntimeImagePath}else{''});proxyPath=(Join-Path $destination 'cagent-desktop.exe');requiresElevation=$true;protocol=1}|ConvertTo-Json -Compress
  exit 0
}
foreach($required in @($SourceDirectory,$OwnerSid,$WorkerSha256,$BrokerSha256,$RuntimeImagePath)){if([string]::IsNullOrWhiteSpace($required)){throw 'Install requires source, owner SID, both digests, and RuntimeImagePath'}}
$runtime=(Resolve-Path -LiteralPath $RuntimeImagePath).Path
if(-not (Test-Path -LiteralPath $runtime -PathType Leaf)){throw 'CAgent runtime image does not exist'}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Administrator elevation is required to install the desktop system service.'}
$source=(Resolve-Path -LiteralPath $SourceDirectory).Path
$destination=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'CAgentDesktopService'
if(Test-Path -LiteralPath $destination){
  $existing=Get-Item -LiteralPath $destination
  if($existing.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Service folder cannot be a reparse point'}
}
foreach($entry in @(@('cagent-desktop.exe',$WorkerSha256),@('cagent-desktop-broker.exe',$BrokerSha256))){
  if((Get-FileHash -LiteralPath (Join-Path $source $entry[0]) -Algorithm SHA256).Hash -ne $entry[1]){throw 'Desktop service source digest mismatch'}
}
$service=Get-Service -Name CAgentDesktopBroker -ErrorAction SilentlyContinue
if($service){Stop-Service -Name CAgentDesktopBroker -Force; $service.WaitForStatus('Stopped',[TimeSpan]::FromSeconds(15))}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @('S-1-5-18','S-1-5-32-544','S-1-5-32-545')){
  $rights=if($sid -eq 'S-1-5-32-545'){'ReadAndExecute'}else{'FullControl'}
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),$rights,'ContainerInherit,ObjectInherit','None','Allow'))
}
$acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
Set-Acl -LiteralPath $destination -AclObject $acl
# Do not preserve attacker-planted DLLs or explicit-ACL files from an old folder.
# These standalone static binaries require no private DLLs in the service folder.
foreach($existingEntry in @(Get-ChildItem -LiteralPath $destination -Force)){
  if($existingEntry.PSIsContainer -or $existingEntry.Name -notin @('cagent-desktop.exe','cagent-desktop-broker.exe')){throw 'Unexpected content in desktop service folder; inspect it before reinstalling'}
}
foreach($entry in @(@('cagent-desktop.exe',$WorkerSha256),@('cagent-desktop-broker.exe',$BrokerSha256))){
  $target=Join-Path $destination $entry[0]
  if(Test-Path -LiteralPath $target){if((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Service binary cannot be a reparse point'};Remove-Item -LiteralPath $target -Force}
  Copy-Item -LiteralPath (Join-Path $source $entry[0]) -Destination $target
  if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $entry[1]){throw 'Installed service digest mismatch'}
}
$registry='HKLM:\SOFTWARE\CAgent\DesktopBroker'
New-Item -Path $registry -Force | Out-Null
$registryAcl=[Security.AccessControl.RegistrySecurity]::new()
$registryAcl.SetAccessRuleProtection($true,$false)
foreach($sid in @('S-1-5-18','S-1-5-32-544','S-1-5-32-545')){
  $rights=if($sid -eq 'S-1-5-32-545'){'ReadKey'}else{'FullControl'}
  $registryAcl.AddAccessRule([Security.AccessControl.RegistryAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),$rights,'ContainerInherit','None','Allow'))
}
$registryAcl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
Set-Acl -LiteralPath $registry -AclObject $registryAcl
Set-ItemProperty -LiteralPath $registry -Name OwnerSid -Value $OwnerSid
Set-ItemProperty -LiteralPath $registry -Name RuntimeImagePath -Value $runtime
$binary='"'+(Join-Path $destination 'cagent-desktop-broker.exe')+'"'
if($service){& "$env:SystemRoot/System32/sc.exe" config CAgentDesktopBroker binPath= $binary start= auto obj= LocalSystem | Out-Null;if($LASTEXITCODE){throw 'Service update failed'}}
else{New-Service -Name CAgentDesktopBroker -BinaryPathName $binary -DisplayName 'CAgent Desktop Session Broker' -Description 'Local authenticated desktop worker broker; no network listener. Windows sign-in authentication remains required.' -StartupType Automatic | Out-Null}
# Reset an existing service's DACL too: old weak SCM permissions must not survive.
& "$env:SystemRoot/System32/sc.exe" sdset CAgentDesktopBroker 'D:P(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLORC;;;AU)' | Out-Null
if($LASTEXITCODE){throw 'Desktop service permissions update failed'}
Start-Service -Name CAgentDesktopBroker
(Get-Service -Name CAgentDesktopBroker).WaitForStatus('Running',[TimeSpan]::FromSeconds(15))
Write-Output 'CAgent desktop system service installed. Start CAgent as administrator to use system desktop capture. No firewall, RDP, sign-in or SAS policy settings changed.'
