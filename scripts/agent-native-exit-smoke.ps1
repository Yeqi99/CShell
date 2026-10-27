param([string]$Source = 'src/agent/native/CagentWindow.cs')
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$framework=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319'
$output=Join-Path $taskRoot 'test-results/native-exit'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$exe=Join-Path $output 'native-exit-test.exe'
$refs=@('WindowsBase','PresentationCore','PresentationFramework')|ForEach-Object {'/r:'+(Join-Path $framework "WPF/$_.dll")}
& (Join-Path $framework 'csc.exe') /nologo /target:exe /main:ExitRegression "/win32icon:$taskRoot/assets/cagent-icon.ico" "/out:$exe" @refs /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Xaml.dll /r:System.Web.Extensions.dll (Join-Path $taskRoot $Source) (Join-Path $taskRoot 'tests/helpers/agent-native-exit.cs')
if($LASTEXITCODE -ne 0){throw 'Native exit fixture compilation failed'}
& $exe (Get-Command node.exe).Source
if($LASTEXITCODE -ne 0){throw 'Native exit regression failed'}
