param([Parameter(Mandatory=$true)][string]$Stage)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$stagePath=(Resolve-Path -LiteralPath $Stage).Path
$exe=Join-Path $stagePath 'Cagent.exe'
if(!(Test-Path -LiteralPath $exe)){throw 'Missing staged native window'}
$data=Join-Path ([IO.Path]::GetTempPath()) ('native-ui-acceptance-data-reconnect-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $data|Out-Null
$report=Join-Path $data 'reconnect-result.json'
$previous=$env:CSHELL_AGENT_DATA
try {
  $env:CSHELL_AGENT_DATA=$data
  $p=Start-Process -FilePath $exe -ArgumentList @('--verify-host-reconnect',('"'+$report+'"')) -WindowStyle Hidden -PassThru
  if(!$p.WaitForExit(60000)){throw 'Isolated native reconnect test timed out; process retained for diagnosis'}
  $result=Get-Content -LiteralPath $report -Raw|ConvertFrom-Json
  if($result.failure){throw $result.failure}
  foreach($key in @('readReconnected','mutationNotReplayed','connectionSettingsPreserved','singleReplacement','sharedRuntimePreserved','unauthorizedNotRetried')){if($result.$key -ne $true){throw ('Missing assertion: '+$key)}}
  $result|ConvertTo-Json -Compress
} finally {
  if($null -eq $previous){Remove-Item Env:CSHELL_AGENT_DATA -ErrorAction SilentlyContinue}else{$env:CSHELL_AGENT_DATA=$previous}
}
