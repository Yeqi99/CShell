$ErrorActionPreference='Stop'
$source=Get-Content (Join-Path $PSScriptRoot 'windows-deployment/Install-CAgent.ps1') -Raw
$start=$source.IndexOf('if (-not $NoShortcuts -or $RefreshExistingShortcuts)')
$end=$source.IndexOf('# User-requested default autostart;', $start)
if($start -lt 0 -or $end -lt 0){throw 'Production shortcut block not found'}
$block=$source.Substring($start,$end-$start)
$original="@([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))"
if(-not $block.Contains($original)){throw 'Folder binding changed; review test'}
$block=$block.Replace($original,'$folders')
$root=Join-Path ([IO.Path]::GetTempPath()) ('cshell-shortcut-fixture-'+[guid]::NewGuid())
$folders=@('owned','removed','foreign') | ForEach-Object {Join-Path $root $_}
$folders | ForEach-Object {New-Item -ItemType Directory -Path $_ -Force | Out-Null}
$launcher=Join-Path $root 'Open CAgent.vbs';$versionRoot=Join-Path $root 'new';$exe=Join-Path $versionRoot 'Cagent.exe'
New-Item -ItemType Directory -Path $versionRoot | Out-Null
function NoLink([string]$Path){if(-not [IO.Path]::GetFullPath($Path).StartsWith($root+[IO.Path]::DirectorySeparatorChar)){throw 'Test escaped fixture'}}
$sh=New-Object -ComObject WScript.Shell
foreach($i in @(0,2)){
 $s=$sh.CreateShortcut((Join-Path $folders[$i] 'CAgent.lnk'))
 $s.TargetPath=Join-Path $env:SystemRoot 'System32/wscript.exe'
 $s.Arguments=if($i -eq 0){'"'+$launcher+'"'}else{'"'+(Join-Path $root 'other.vbs')+'"'}
 $s.IconLocation=(Join-Path $root 'old.exe')+',0';$s.Save()
}
$foreign=Join-Path $folders[2] 'CAgent.lnk';$before=(Get-FileHash $foreign).Hash
$NoShortcuts=$true;$RefreshExistingShortcuts=$true
. ([scriptblock]::Create($block))
$updated=$sh.CreateShortcut((Join-Path $folders[0] 'CAgent.lnk'))
if($updated.IconLocation -ne ($exe+',0') -or $updated.WorkingDirectory -ne $versionRoot){throw 'Owned shortcut not refreshed'}
if(Test-Path (Join-Path $folders[1] 'CAgent.lnk')){throw 'Removed shortcut recreated'}
if((Get-FileHash $foreign).Hash -ne $before){throw 'Other installation shortcut altered'}
Write-Output 'PASS: actual owned .lnk refreshed; deleted shortcut not recreated; other install unchanged'
