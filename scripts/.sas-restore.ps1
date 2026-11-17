$ErrorActionPreference='Stop'
$dir=Join-Path $env:ProgramFiles CAgentDesktopService
$r=Get-ItemProperty HKLM:\SOFTWARE\CAgent\DesktopBroker
if($r.OwnerSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'Owner mismatch'}
$bundle=Join-Path (Split-Path $r.RuntimeImagePath) system-desktop/cagent-desktop-broker.exe
$installed=Join-Path $dir cagent-desktop-broker.exe
$save=Join-Path $env:ProgramFiles CAgentDesktopBackup-1117/broker-before-sas.exe
$src=Join-Path $env:LOCALAPPDATA CAgent-Offline-Packages/headless-check-1117/sas-broker.exe
$old='5D80F0891A647460113F291BB3BC3ED52090898C4F020CA7F730ED0865BE2451'
function check($p,$h){if((Get-FileHash $p).Hash -ne $h){throw "Hash mismatch $p"}}
function installBroker($p,$h){check $p $h;Stop-Service CAgentDesktopBroker;foreach($dest in @($bundle,$installed)){Copy-Item $p $dest -Force;check $dest $h};Start-Service CAgentDesktopBroker}

installBroker $save $old
