param([string]$OutputDirectory=[Environment]::GetFolderPath('DesktopDirectory'))
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if($env:OS -ne 'Windows_NT'){throw 'Windows required'}
if(-not $OutputDirectory -or -not (Test-Path -LiteralPath $OutputDirectory -PathType Container)){throw 'An existing report directory is required'}
$report=[ordered]@{format='cshell-classroom-network-1';createdAt=[DateTime]::UtcNow.ToString('o');readOnly=$true;notes=@('Report contains local IP addresses and executable paths. Review before sharing.','TCP 24443 listening does not prove UDP discovery across VLAN/Wi-Fi isolation.','No tokens, passwords, peer records, process command lines or raw CLI output are included.')}
function Collect([scriptblock]$Action){try{@{state='ok';items=@(& $Action)}}catch{@{state='unavailable';reason='Read unavailable or permission denied';errorType=$_.Exception.GetType().Name}}}
$fileHashes=@{}
function ProcessInfo([int]$OwnerId){
 try{$p=Get-Process -Id $OwnerId -ErrorAction Stop;$path=$p.Path
 if($path -and -not $fileHashes.ContainsKey($path)){try{$fileHashes[$path]=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()}catch{$fileHashes[$path]=$null}}
 @{pid=$OwnerId;name=$p.ProcessName;path=$path;sha256=if($path){$fileHashes[$path]}else{$null};version=if($path){[Diagnostics.FileVersionInfo]::GetVersionInfo($path).FileVersion}else{$null}}}
 catch{@{pid=$OwnerId;path=$null;state='path inaccessible or process exited'}}
}
function SafeStatus($Value){
 $safe=@{}
 foreach($name in @('running','passwordConfigured')){if($Value.PSObject.Properties.Name -contains $name -and $Value.$name -is [bool]){$safe[$name]=$Value.$name}}
 if($Value.PSObject.Properties.Name -contains 'port' -and $Value.port -is [int] -and $Value.port -ge 1 -and $Value.port -le 65535){$safe.port=$Value.port}
 if($Value.PSObject.Properties.Name -contains 'bind' -and $Value.bind -is [string]){$ip=$null;if([Net.IPAddress]::TryParse($Value.bind,[ref]$ip)){$safe.bind=$ip.ToString()}}
 if($Value.PSObject.Properties.Name -contains 'agentVersion' -and $Value.agentVersion -is [string] -and $Value.agentVersion -match '^\d+\.\d+\.\d+[-+.a-zA-Z0-9]*$'){$safe.version=$Value.agentVersion}
 return $safe
}
$report.ipv4=Collect {Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object {
 $prefix=[int]$_.PrefixLength;$mask=for($i=0;$i -lt 4;$i++){$bits=[math]::Max(0,[math]::Min(8,$prefix-$i*8));if($bits -eq 0){0}else{256-[math]::Pow(2,8-$bits)}}
 @{interface=$_.InterfaceAlias;index=$_.InterfaceIndex;address=$_.IPAddress;prefixLength=$prefix;mask=($mask -join '.');state=[string]$_.AddressState}
}}
$report.networkProfiles=Collect {Get-NetConnectionProfile|Select-Object InterfaceAlias,InterfaceIndex,NetworkCategory,IPv4Connectivity,IPv6Connectivity}
$report.tcp24443=Collect {Get-NetTCPConnection -ErrorAction Stop|Where-Object {$_.State -eq 'Listen' -and $_.LocalPort -eq 24443}|ForEach-Object {@{address=$_.LocalAddress;port=$_.LocalPort;process=(ProcessInfo $_.OwningProcess)}}}
$report.udp47884=Collect {Get-NetUDPEndpoint -ErrorAction Stop|Where-Object {$_.LocalPort -eq 47884}|ForEach-Object {@{address=$_.LocalAddress;port=$_.LocalPort;process=(ProcessInfo $_.OwningProcess)}}}
$report.cshell=Collect {Get-Process -ErrorAction Stop|Where-Object {$_.ProcessName -in @('CShell','CShell Pro')}|ForEach-Object {ProcessInfo $_.Id}}
$report.firewallProfiles=Collect {Get-NetFirewallProfile|Select-Object Name,Enabled,DefaultInboundAction,DefaultOutboundAction}
$report.cagent=Collect {
 $candidates=@{}
 # Inspect command lines only to identify bundled runtime, never copy them to report.
 Get-CimInstance Win32_Process|Where-Object {$_.Name -in @('node.exe','CAgent.exe','Cagent.exe')}|ForEach-Object {
  if($_.ExecutablePath -and ($_.Name -ieq 'CAgent.exe' -or $_.CommandLine -match 'agent\.cjs')){
   $dir=Split-Path -Parent $_.ExecutablePath
   if((Test-Path -LiteralPath (Join-Path $dir 'node.exe')) -and (Test-Path -LiteralPath (Join-Path $dir 'agent.cjs'))){$candidates[$dir]=$true}
  }
 }
 foreach($dir in $candidates.Keys){
  $result=@{runtimeDirectory=$dir;probe='unavailable'}
  $probe=New-Object Diagnostics.Process;$probe.StartInfo=New-Object Diagnostics.ProcessStartInfo
  $probe.StartInfo.FileName=Join-Path $dir 'node.exe';$probe.StartInfo.Arguments='"'+(Join-Path $dir 'agent.cjs')+'" status'
  $probe.StartInfo.UseShellExecute=$false;$probe.StartInfo.CreateNoWindow=$true;$probe.StartInfo.RedirectStandardOutput=$true;$probe.StartInfo.RedirectStandardError=$true
  try{
   [void]$probe.Start();$out=$probe.StandardOutput.ReadToEndAsync();$err=$probe.StandardError.ReadToEndAsync()
   if($probe.WaitForExit(7000)){
    if($probe.ExitCode -eq 0 -and $out.Result.Length -lt 1048576){$result.status=SafeStatus ($out.Result|ConvertFrom-Json);$result.probe='ok'}else{$result.probe='status unavailable'}
   }else{$result.probe='status timeout; no service was stopped'}
  }catch{$result.probe='status unavailable'}finally{$probe.Dispose()}
  $result
 }
}
$name='CShell-Network-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6)+'.json'
$file=Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) $name
$report|ConvertTo-Json -Depth 10|Set-Content -LiteralPath $file -Encoding UTF8
Write-Output ('Read-only report saved: '+$file)
Write-Output 'Review local addresses/paths before sharing. No network or firewall settings were changed.'

