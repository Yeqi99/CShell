param([string]$Root=(Join-Path $env:USERPROFILE 'CShell-DL-Lab'),[switch]$Preview)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem){throw 'Windows x64 required'}
if(-not [IO.Path]::IsPathRooted($Root)){throw 'Root must be absolute'}
$Root=[IO.Path]::GetFullPath($Root)
$drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($Root))
if($drive.AvailableFreeSpace -lt 22GB){throw 'At least 22 GiB free is required. Use -Root D:\CShell-DL-Lab for another disk.'}
if(Get-Process -Name 'CShell','CShell Pro' -ErrorAction SilentlyContinue){throw 'Please close CShell normally first. No process was stopped.'}
$base='https://shell.canp.ai/downloads/classroom/0.8.11'
$zipName='CShell-Classroom-0.8.11-win-x64.zip'
$zipHash='549e84dabfef5021d3088a70b4729efca70ddc4c9cec7eac25cc3a85ac32db9d'
$dlName='Install-DL-Lab-1.ps1'
$dlHash='cc0d1db8d613a3506c5e5f5e336e73d2a714a4185d078a8b37907fa126f16793'
Write-Output ('Plan: install CShell + CAgent classroom preset, then Python 3.10 dl at '+$Root)
Write-Output 'Includes TensorFlow 2.15.1 CPU, Jupyter, pandas, numpy, matplotlib and two desktop shortcuts. Existing base and identities are preserved.'
if($Preview){Write-Output 'Preview only; nothing downloaded or installed.';return}
$work=Join-Path $env:LOCALAPPDATA ('CShell-ClassroomSetup\'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($work)
$log=Join-Path $work 'setup.log'
Start-Transcript -Path $log | Out-Null
function GetVerified([string]$Url,[string]$File,[string]$Hash){
 $local=Join-Path $PSScriptRoot ([IO.Path]::GetFileName($File))
 if(Test-Path -LiteralPath $local){
  if((Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash -ine $Hash){throw 'Bundled file checksum failed'}
  Copy-Item -LiteralPath $local -Destination $File
  return
 }
 $options=@{Uri=$Url;OutFile=$File;UseBasicParsing=$true;TimeoutSec=1800}
 $proxy=$env:HTTPS_PROXY;if(-not $proxy){$proxy=$env:HTTP_PROXY}
 if($proxy){$u=[uri]$proxy;if($u.Scheme -notin @('http','https') -or $u.UserInfo){throw 'Proxy must be HTTP(S) without credentials'};$options.Proxy=$proxy}
 [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
 Invoke-WebRequest @options
 if((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash -ine $Hash){throw 'Download checksum failed; nothing from that file was executed'}
}
try {
 $zip=Join-Path $work $zipName;$dl=Join-Path $work $dlName
 Write-Output '[1/4] Downloading verified student installer and environment task...'
 GetVerified ($base+'/'+$zipName) $zip $zipHash
 GetVerified ($base+'/'+$dlName) $dl $dlHash
 # Real environment preflight before installing applications.
 & $dl -Root $Root
 Write-Output '[2/4] Installing CShell and CAgent...'
 $bundle=Join-Path $work 'student'
 Expand-Archive -LiteralPath $zip -DestinationPath $bundle
 $setup=Join-Path $bundle 'Install-ClassroomStudent.ps1'
 if(-not (Test-Path -LiteralPath $setup)){throw 'Student bundle entry point missing'}
 & $setup -Apply
 Write-Output '[3/4] Installing and checking dl environment. This may take a long time; keep this window open...'
 & $dl -Root $Root -Apply
 Write-Output '[4/4] Complete. Desktop: dl CMD and dl Jupyter. CAgent is running; the teacher may discover and pair this machine.'
 Write-Output ('Environment verification: '+(Join-Path $Root 'logs\verification.out.log'))
} catch {
 Write-Output ('Installation stopped. Earlier completed steps are retained. Log: '+$log)
 throw
} finally {Stop-Transcript | Out-Null}
