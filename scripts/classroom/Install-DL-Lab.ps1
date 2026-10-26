param(
  [string]$Root=(Join-Path $env:USERPROFILE 'CShell-DL-Lab'),
  [string]$LabRoot=(Join-Path $env:USERPROFILE 'CShell-Lab'),
  [string]$Proxy,
  [switch]$Apply
)
$ErrorActionPreference='Stop';Set-StrictMode -Version Latest
if($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem){throw 'Windows x64 required'}
# Capture the real interactive user's known folder before child HOME isolation.
$desktop=[Environment]::GetFolderPath('DesktopDirectory')
if(-not $desktop -or -not (Test-Path -LiteralPath $desktop)){throw 'Current user Desktop unavailable; run through that student user CAgent, not SYSTEM'}
function SafePath([string]$path){
 if(-not [IO.Path]::IsPathRooted($path)){throw 'Absolute directory required'}
 $full=[IO.Path]::GetFullPath($path).TrimEnd('\','/')
 if($full -match '[%"!^&|<>\r\n]' -or $full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\','/')){throw 'Unsafe deployment directory'}
 for($p=$full;$p;$p=[IO.Path]::GetDirectoryName($p)){if((Test-Path -LiteralPath $p) -and ((Get-Item -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Reparse-point directory refused'}}
 return $full
}
$rootPath=SafePath $Root;$labPath=SafePath $LabRoot
if($rootPath -ieq $labPath -or $rootPath.StartsWith($labPath+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'DL root must be separate from existing lab/base'}
$proxyAddress=$Proxy;if(-not $proxyAddress){$proxyAddress=$env:HTTPS_PROXY};if(-not $proxyAddress){$proxyAddress=$env:HTTP_PROXY}
if($proxyAddress){$u=[uri]$proxyAddress;if($u.Scheme -notin @('http','https') -or $u.UserInfo -or $u.Query -or $u.Fragment){throw 'HTTP(S) proxy without credentials/query/fragment required'}}
$sha='2e0b8e40ec7600793f116250f5c1775c866833bac32d184ad575ecc0d360a88f'
$url='https://repo.anaconda.com/archive/Anaconda3-2025.12-2-Windows-x86_64.exe'
$base=Join-Path $rootPath 'Anaconda3';$bootstrap=$true
$oldMarker=Join-Path $labPath 'lab-deployment.json'
if(Test-Path -LiteralPath $oldMarker){
 $old=Get-Content -LiteralPath $oldMarker -Raw|ConvertFrom-Json
 if($old.format -eq 'cshell-ai-lab-1' -and $old.state -eq 'verified' -and $old.root -ieq $labPath -and $old.anacondaSha256 -eq $sha){
  $candidate=SafePath (Join-Path $labPath 'Anaconda3')
  if((Test-Path -LiteralPath (Join-Path $candidate 'python.exe')) -and (Test-Path -LiteralPath (Join-Path $candidate 'condabin\conda.bat'))){$base=$candidate;$bootstrap=$false}
 }
}
$envPath=Join-Path $rootPath 'envs\dl';$marker=Join-Path $rootPath 'dl-deployment.json'
$packages=@('tensorflow==2.15.1','numpy==1.26.4','pandas==2.2.3','matplotlib==3.9.4','jupyter==1.1.1','jupyterlab==4.3.5','notebook==7.3.2')
$required=if($bootstrap){20}else{8};$drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($rootPath));$available=$drive.AvailableFreeSpace
$plan=@{root=$rootPath;environment='dl';prefix=$envPath;python='3.10';compute='CPU';packages=$packages;base=$base;bootstrap=$bootstrap;availableGiB=[math]::Round($available/1GB,2);requiredGiB=$required;spaceReady=($available -ge $required*1GB);desktop=$desktop;proxyConfigured=[bool]$proxyAddress;baseModified=$false;browserOpenedDuringInstall=$false}
if(Test-Path -LiteralPath $rootPath){
 if(-not (Test-Path -LiteralPath $marker)){throw 'Existing DL directory is not owned; it will not be overwritten'}
 $saved=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
 if($saved.format -ne 'cshell-dl-lab-1' -or $saved.root -ine $rootPath -or $saved.state -ne 'verified' -or -not (Test-Path -LiteralPath (Join-Path $envPath 'python.exe'))){throw 'Existing DL deployment incomplete or unknown; inspect logs, do not overwrite'}
 Write-Output 'Existing verified dl preserved; no reinstall, shortcut overwrite or environment changes.';$plan|ConvertTo-Json -Depth 4;return
}
$plan|ConvertTo-Json -Depth 4
if(-not $plan.spaceReady){throw 'Insufficient space for the displayed DL plan'}
foreach($name in @('dl CMD.lnk','dl Jupyter.lnk')){if(Test-Path -LiteralPath (Join-Path $desktop $name)){throw 'An existing dl desktop shortcut would be overwritten; deployment refused'}}
if(-not $Apply){Write-Output 'Preview only. Add -Apply to create the dedicated dl environment and two desktop shortcuts.';return}
[void][IO.Directory]::CreateDirectory($rootPath)
$logs=Join-Path $rootPath 'logs';$cache=Join-Path $rootPath 'cache';$privateHome=Join-Path $rootPath 'user';$notebooks=Join-Path $rootPath 'notebooks'
foreach($dir in @($logs,$cache,$privateHome,$notebooks,(Join-Path $rootPath 'tmp'))){[void][IO.Directory]::CreateDirectory($dir)}
@{format='cshell-dl-lab-1';root=$rootPath;state='installing'}|ConvertTo-Json|Set-Content -LiteralPath $marker -Encoding UTF8
$previous=@{}
function Env([string]$Name,[string]$Value){if(-not $previous.ContainsKey($Name)){$previous[$Name]=[Environment]::GetEnvironmentVariable($Name,'Process')};[Environment]::SetEnvironmentVariable($Name,$Value,'Process')}
function Run([string]$Exe,[string]$Arguments,[string]$Name){
 $p=Start-Process -FilePath $Exe -ArgumentList $Arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs ($Name+'.out.log')) -RedirectStandardError (Join-Path $logs ($Name+'.err.log'))
 if(-not $p.WaitForExit(2700000)){throw ('Timed out: '+$Name+'. Inspect the owned process/logs; no automatic retry or kill')}
 if($p.ExitCode -ne 0){throw ('Step failed: '+$Name+' ('+$p.ExitCode+'). See private logs')}
}
try{
 Env 'USERPROFILE' $privateHome;Env 'HOME' $privateHome;Env 'APPDATA' (Join-Path $privateHome 'AppData\Roaming');Env 'LOCALAPPDATA' (Join-Path $privateHome 'AppData\Local')
 Env 'TMP' (Join-Path $rootPath 'tmp');Env 'TEMP' (Join-Path $rootPath 'tmp');Env 'PYTHONNOUSERSITE' '1'
 foreach($key in @('PYTHONPATH','PYTHONHOME','PIP_INDEX_URL','PIP_EXTRA_INDEX_URL','PIP_TRUSTED_HOST','PIP_FIND_LINKS','PIP_TARGET','PIP_PREFIX','PIP_USER')){Env $key ''}
 Env 'PIP_CONFIG_FILE' 'NUL';Env 'PIP_CACHE_DIR' (Join-Path $cache 'pip');Env 'CONDARC' (Join-Path $rootPath 'condarc')
 Env 'CONDA_ENVS_PATH' (Join-Path $rootPath 'envs');Env 'CONDA_PKGS_DIRS' (Join-Path $cache 'conda');Env 'CONDA_NO_PLUGINS' 'true'
 Env 'JUPYTER_CONFIG_DIR' (Join-Path $rootPath 'jupyter-config');Env 'MPLCONFIGDIR' (Join-Path $rootPath 'matplotlib')
 if($proxyAddress){Env 'HTTP_PROXY' $proxyAddress;Env 'HTTPS_PROXY' $proxyAddress;Env 'ALL_PROXY' $proxyAddress;Env 'NO_PROXY' ''}
 if($bootstrap){
  $installer=Join-Path $cache 'Anaconda3-2025.12-2-Windows-x86_64.exe'
  $options=@{Uri=$url;OutFile=($installer+'.partial');UseBasicParsing=$true;TimeoutSec=1800};if($proxyAddress){$options.Proxy=$proxyAddress}
  Invoke-WebRequest @options
  if((Get-FileHash -LiteralPath ($installer+'.partial') -Algorithm SHA256).Hash -ine $sha){throw 'Official Anaconda SHA256 mismatch; not executed'}
  Move-Item -LiteralPath ($installer+'.partial') -Destination $installer
  Run $installer ('/S /InstallationType=JustMe /AddToPath=0 /RegisterPython=0 /NoRegistry=1 /NoShortcuts=1 /CheckPathLength=0 /D='+$base) 'bootstrap'
 }
 $basePython=Join-Path $base 'python.exe'
 # Create a new prefix only; never conda install/update into base.
 Run $basePython ('-I -m conda create --yes --solver classic --no-default-packages --override-channels --channel https://repo.anaconda.com/pkgs/main --prefix "'+$envPath+'" python=3.10 pip') 'create-dl'
 $python=Join-Path $envPath 'python.exe'
 Run $python ('-I -m pip install --disable-pip-version-check --only-binary=:all: --index-url https://pypi.org/simple '+($packages -join ' ')) 'packages'
 Run $python '-I -m pip check' 'pip-check'
 $verify=Join-Path $rootPath 'verify-dl.py'
 @'
import sys,json,importlib.metadata as m
import tensorflow as tf,numpy as np,pandas as pd,matplotlib,jupyterlab,notebook
assert sys.version_info[:2]==(3,10),sys.version
assert tf.__version__=='2.15.1'
assert np.__version__=='1.26.4'
assert not tf.config.list_physical_devices('GPU'),'Expected native Windows CPU TensorFlow'
with tf.device('/CPU:0'):
 assert float(tf.reduce_sum(tf.constant([1.,2.,3.])).numpy())==6.
assert pd.DataFrame({'x':[1,2]}).x.sum()==3
matplotlib.use('Agg')
from matplotlib import pyplot as plt
plt.plot([1,2]);plt.close()
print(json.dumps({'python':sys.version,'executable':sys.executable,'versions':{n:m.version(n) for n in ['tensorflow','numpy','pandas','matplotlib','jupyter','jupyterlab','notebook']}},indent=2))
'@|Set-Content -LiteralPath $verify -Encoding UTF8
 Run $python ('-I "'+$verify+'"') 'verification';Run $python '-I -m pip freeze --all' 'installed-packages'
 # CMD activates the exact prefix. UTF-8 batch supports Chinese user directory names.
 $cmd=Join-Path $rootPath 'Start-dl.cmd'
 $cmdText='@echo off'+"`r`n"+'chcp 65001 >nul'+"`r`n"+'call "'+(Join-Path $base 'condabin\conda.bat')+'" activate "'+$envPath+'"'+"`r`n"+'if errorlevel 1 exit /b 1'+"`r`n"+'cd /d "'+$notebooks+'"'
 [IO.File]::WriteAllText($cmd,$cmdText,(New-Object Text.UTF8Encoding($false)))
 $jupyter=Join-Path $rootPath 'Start-dl-Jupyter.ps1'
 @'
$ErrorActionPreference='Stop'
$env:PYTHONNOUSERSITE='1';$env:PYTHONPATH='';$env:PYTHONHOME=''
$env:JUPYTER_CONFIG_DIR=Join-Path $PSScriptRoot 'jupyter-config'
$env:JUPYTER_DATA_DIR=Join-Path $PSScriptRoot 'jupyter-data'
$env:JUPYTER_RUNTIME_DIR=Join-Path $PSScriptRoot 'jupyter-runtime'
$env:JUPYTER_TOKEN=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
$notebookRoot=Join-Path $PSScriptRoot 'notebooks'
& (Join-Path $PSScriptRoot 'envs\dl\python.exe') -I -m jupyterlab --ServerApp.ip=127.0.0.1 --ServerApp.open_browser=True --ServerApp.port=8888 --ServerApp.port_retries=50 --ServerApp.allow_remote_access=False ('--ServerApp.root_dir='+$notebookRoot)
exit $LASTEXITCODE
'@|Set-Content -LiteralPath $jupyter -Encoding UTF8
 $shell=New-Object -ComObject WScript.Shell
 $cmdShortcut=Join-Path $desktop 'dl CMD.lnk';$webShortcut=Join-Path $desktop 'dl Jupyter.lnk'
 # Recheck immediately before creating user-facing shortcuts.
 if((Test-Path -LiteralPath $cmdShortcut) -or (Test-Path -LiteralPath $webShortcut)){throw 'Desktop shortcut appeared during deployment; it will not be overwritten'}
 $link=$shell.CreateShortcut($cmdShortcut);$link.TargetPath=Join-Path $env:SystemRoot 'System32\cmd.exe';$link.Arguments='/D /K ""'+$cmd+'""';$link.WorkingDirectory=$notebooks;$link.Description='Activate private Python 3.10 dl environment';$link.Save()
 $link=$shell.CreateShortcut($webShortcut);$link.TargetPath=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe';$link.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$jupyter+'"';$link.WorkingDirectory=$notebooks;$link.Description='Open private dl Jupyter on localhost with authentication';$link.Save()
 @{format='cshell-dl-lab-1';root=$rootPath;prefix=$envPath;base=$base;state='verified';verifiedAt=[DateTime]::UtcNow.ToString('o');bootstrapSha256=$sha;packages=$packages;desktop=$desktop}|ConvertTo-Json -Depth 4|Set-Content -LiteralPath $marker -Encoding UTF8
 Write-Output 'dl verified. Desktop shortcuts created; neither CMD nor Jupyter/browser was started by deployment. See logs/verification.out.log.'
}finally{foreach($key in $previous.Keys){[Environment]::SetEnvironmentVariable($key,$previous[$key],'Process')}}
