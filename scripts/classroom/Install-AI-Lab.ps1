param(
  [string]$Root = (Join-Path $env:USERPROFILE 'CShell-Lab'),
  [ValidateSet('CPU','CUDA')][string]$Compute = 'CPU',
  [ValidateSet('cu126','cu128')][string]$CudaIndex = 'cu128',
  [string]$Proxy,
  [switch]$Apply
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if(-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT'){throw 'Windows x64 is required'}
if(-not [IO.Path]::IsPathRooted($Root)){throw 'Lab directory must be an absolute path'}
$rootPath=[IO.Path]::GetFullPath($Root).TrimEnd('\','/')
if($rootPath -match '["\r\n]' -or $rootPath -eq [IO.Path]::GetPathRoot($rootPath).TrimEnd('\','/')){throw 'Choose a dedicated lab directory'}
for($p=$rootPath;$p;$p=[IO.Path]::GetDirectoryName($p)){
  if((Test-Path -LiteralPath $p) -and ((Get-Item -Force -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Lab path cannot traverse reparse points'}
}
$effectiveProxy=$Proxy
if(-not $effectiveProxy){$effectiveProxy=$env:HTTPS_PROXY}
if(-not $effectiveProxy){$effectiveProxy=$env:HTTP_PROXY}
if($effectiveProxy){$proxyUri=[uri]$effectiveProxy;if($proxyUri.Scheme -notin @('http','https') -or $proxyUri.UserInfo -or $proxyUri.Fragment -or $proxyUri.Query){throw 'Proxy must be an HTTP(S) address without credentials/query/fragment'}}
$anacondaName='Anaconda3-2025.12-2-Windows-x86_64.exe'
$anacondaUrl='https://repo.anaconda.com/archive/'+$anacondaName
$anacondaSha='2e0b8e40ec7600793f116250f5c1775c866833bac32d184ad575ecc0d360a88f'
$codeUrl='https://vscode.download.prss.microsoft.com/dbazure/download/stable/e646868227c3e3a9e3f24277c8c7220be42c0be7/VSCode-win32-x64-1.143.1.zip'
$codeSha='b4f9643b8a549ca2c85a1bbc9063fc76f1e08fc0036a7f6a1a181cdc05235eca'
$condaPath=Join-Path $rootPath 'Anaconda3'
$codePath=Join-Path $rootPath 'VSCode'
$marker=Join-Path $rootPath 'lab-deployment.json'
$mode=if($Compute -eq 'CPU'){'cpu'}else{$CudaIndex}
$torchIndex='https://download.pytorch.org/whl/'+$mode
$plan=@{root=$rootPath;anaconda='2025.12-2';basePython='3.13';vscode='1.143.1 portable';compute=$Compute;torchIndex=$torchIndex;packages=@('torch','transformers','datasets','huggingface_hub','opencv-python');proxyConfigured=[bool]$effectiveProxy;systemPathChanged=$false;registryChanged=$false;oldCondaChanged=$false}
if(Test-Path -LiteralPath $rootPath){
  if(-not (Test-Path -LiteralPath $marker)){throw 'Existing directory is not owned by this deployment; choose a new directory'}
  $saved=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
  if($saved.format -ne 'cshell-ai-lab-1' -or $saved.root -ine $rootPath -or $saved.compute -ne $Compute -or $saved.torchIndex -ne $torchIndex){throw 'Existing lab has different settings; it will not be overwritten'}
  if($saved.state -ne 'verified'){throw 'Previous deployment is incomplete. Inspect its logs; use a new directory rather than overwriting uncertain state'}
  Write-Output 'Existing verified lab preserved. Use its verification report and private launchers.'
  $plan|ConvertTo-Json -Depth 4
  return
}
$drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot($rootPath))
$minimum=if($Compute -eq 'CUDA'){30GB}else{20GB}
$available=$drive.AvailableFreeSpace
$plan.availableGiB=[math]::Round($available/1GB,2)
$plan.requiredGiB=$minimum/1GB
$plan.spaceReady=$available -ge $minimum
if(-not $plan.spaceReady){$plan|ConvertTo-Json -Depth 4;throw ('Insufficient free space: available '+$plan.availableGiB+' GiB; required '+$plan.requiredGiB+' GiB for private Anaconda, downloads and packages')}
if(-not $Apply){$plan|ConvertTo-Json -Depth 4;Write-Output 'Preview only. Add -Apply to download, verify and install in the dedicated directory. CUDA also requires a compatible existing NVIDIA driver; no driver is installed.';return}
if($Compute -eq 'CUDA'){
  $smi=Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
  if(-not $smi){throw 'CUDA was selected but nvidia-smi is unavailable; no CPU fallback will be used'}
  & $smi.Source --query-gpu=name,driver_version --format=csv,noheader
  if($LASTEXITCODE -ne 0){throw 'NVIDIA driver preflight failed'}
}
[void][IO.Directory]::CreateDirectory($rootPath)
$cache=Join-Path $rootPath 'cache';$logs=Join-Path $rootPath 'logs';$privateHome=Join-Path $rootPath 'user'
foreach($dir in @($cache,$logs,$privateHome,(Join-Path $rootPath 'tmp'))){[void][IO.Directory]::CreateDirectory($dir)}
@{format='cshell-ai-lab-1';root=$rootPath;compute=$Compute;torchIndex=$torchIndex;state='installing'}|ConvertTo-Json|Set-Content -LiteralPath $marker -Encoding UTF8
$original=@{}
function ProcessEnv([string]$Name,[string]$Value){if(-not $original.ContainsKey($Name)){$original[$Name]=[Environment]::GetEnvironmentVariable($Name,'Process')};[Environment]::SetEnvironmentVariable($Name,$Value,'Process')}
function Download([string]$Url,[string]$Path,[string]$Sha){
  $options=@{Uri=$Url;OutFile=($Path+'.partial');UseBasicParsing=$true;TimeoutSec=1800}
  if($effectiveProxy){$options.Proxy=$effectiveProxy}
  Write-Output ('Downloading verified distribution: '+[IO.Path]::GetFileName($Path))
  Invoke-WebRequest @options
  if((Get-FileHash -LiteralPath ($Path+'.partial') -Algorithm SHA256).Hash -ine $Sha){throw 'Downloaded distribution SHA256 mismatch; file not executed'}
  Move-Item -LiteralPath ($Path+'.partial') -Destination $Path
}
function Run([string]$Exe,[string]$Arguments,[string]$Name){
  $out=Join-Path $logs ($Name+'.out.log');$err=Join-Path $logs ($Name+'.err.log')
  $p=Start-Process -FilePath $Exe -ArgumentList $Arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
  if(-not $p.WaitForExit(2700000)){throw ('Step timed out; inspect the private logs and process before retrying: '+$Name)}
  if($p.ExitCode -ne 0){throw ('Step failed ('+$p.ExitCode+'); private log: '+$err)}
}
try{
  ProcessEnv 'USERPROFILE' $privateHome;ProcessEnv 'HOME' $privateHome
  ProcessEnv 'APPDATA' (Join-Path $privateHome 'AppData\Roaming');ProcessEnv 'LOCALAPPDATA' (Join-Path $privateHome 'AppData\Local')
  ProcessEnv 'TMP' (Join-Path $rootPath 'tmp');ProcessEnv 'TEMP' (Join-Path $rootPath 'tmp')
  ProcessEnv 'PYTHONNOUSERSITE' '1';ProcessEnv 'PYTHONPATH' '';ProcessEnv 'PYTHONHOME' ''
  ProcessEnv 'PIP_CONFIG_FILE' 'NUL';ProcessEnv 'PIP_CACHE_DIR' (Join-Path $cache 'pip');ProcessEnv 'HF_HOME' (Join-Path $cache 'huggingface')
  foreach($name in @('PIP_INDEX_URL','PIP_EXTRA_INDEX_URL','PIP_TRUSTED_HOST','PIP_FIND_LINKS','PIP_TARGET','PIP_PREFIX','PIP_USER')){ProcessEnv $name ''}
  ProcessEnv 'CONDARC' (Join-Path $rootPath 'condarc');ProcessEnv 'CONDA_ENVS_PATH' (Join-Path $rootPath 'envs');ProcessEnv 'CONDA_PKGS_DIRS' (Join-Path $cache 'conda')
  if($effectiveProxy){ProcessEnv 'HTTP_PROXY' $effectiveProxy;ProcessEnv 'HTTPS_PROXY' $effectiveProxy;ProcessEnv 'ALL_PROXY' $effectiveProxy;ProcessEnv 'NO_PROXY' ''}
  $installer=Join-Path $cache $anacondaName;Download $anacondaUrl $installer $anacondaSha
  # No registry/PATH/default-Python/shortcuts, and never target an existing conda.
  Run $installer ('/S /InstallationType=JustMe /AddToPath=0 /RegisterPython=0 /NoRegistry=1 /NoShortcuts=1 /CheckPathLength=0 /D='+$condaPath) 'anaconda'
  $python=Join-Path $condaPath 'python.exe'
  if(-not (Test-Path -LiteralPath $python)){throw 'Private Anaconda Python missing'}
  Run $python '-I -c "import sys; assert sys.version_info[:2] == (3,13), sys.version"' 'python-version'
  # TLS and official package indexes remain enabled; source builds are forbidden.
  Run $python ('-I -m pip install --disable-pip-version-check --only-binary=:all: --index-url '+$torchIndex+' torch') 'pytorch'
  Run $python '-I -m pip install --disable-pip-version-check --only-binary=:all: --index-url https://pypi.org/simple transformers datasets huggingface_hub opencv-python' 'python-libraries'
  Run $python '-I -m pip check' 'pip-check'
  $codeZip=Join-Path $cache 'VSCode-win32-x64-1.143.1.zip';Download $codeUrl $codeZip $codeSha
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($codeZip)
  try{foreach($entry in $zip.Entries){$target=[IO.Path]::GetFullPath((Join-Path $codePath $entry.FullName));if(-not $target.StartsWith($codePath+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe VSCode archive path'}}}finally{$zip.Dispose()}
  [IO.Compression.ZipFile]::ExtractToDirectory($codeZip,$codePath)
  $codeExe=Join-Path $codePath 'Code.exe';$signature=Get-AuthenticodeSignature -LiteralPath $codeExe
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation'){throw 'VSCode Microsoft signature validation failed'}
  [void][IO.Directory]::CreateDirectory((Join-Path $codePath 'data'))
  $verify=Join-Path $rootPath 'verify.py'
  @'
import json,sys,torch,transformers,datasets,huggingface_hub,cv2
assert sys.version_info[:2] == (3,13), sys.version
assert torch.tensor([1,2,3]).sum().item() == 6
mode=sys.argv[1]
if mode == 'CUDA':
 assert torch.cuda.is_available(), 'Selected CUDA is not usable; no CPU fallback'
 assert torch.tensor([1,2],device='cuda').sum().item() == 3
else:
 assert torch.version.cuda is None, 'Expected CPU build'
print(json.dumps(dict(python=sys.version,executable=sys.executable,torch=torch.__version__,transformers=transformers.__version__,datasets=datasets.__version__,huggingface_hub=huggingface_hub.__version__,opencv=cv2.__version__,cuda=torch.version.cuda,cuda_available=torch.cuda.is_available()),indent=2))
'@|Set-Content -LiteralPath $verify -Encoding UTF8
  Run $python ('-I "'+$verify+'" '+$Compute) 'verification'
  Run $python '-I -m pip freeze --all' 'installed-packages'
  $workspace=@{folders=@(@{path='.'});settings=@{'python.defaultInterpreterPath'=$python;'terminal.integrated.env.windows'=@{'PYTHONNOUSERSITE'='1';'HF_HOME'=(Join-Path $cache 'huggingface')}}}
  $workspace|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $rootPath 'Classroom.code-workspace') -Encoding UTF8
  "& (Join-Path `$PSScriptRoot 'VSCode\Code.exe') (Join-Path `$PSScriptRoot 'Classroom.code-workspace')"|Set-Content -LiteralPath (Join-Path $rootPath 'Open-VSCode.ps1') -Encoding UTF8
  "`$env:PYTHONNOUSERSITE='1'; & (Join-Path `$PSScriptRoot 'Anaconda3\python.exe') @args"|Set-Content -LiteralPath (Join-Path $rootPath 'Python.ps1') -Encoding UTF8
  @{format='cshell-ai-lab-1';root=$rootPath;compute=$Compute;torchIndex=$torchIndex;state='verified';verifiedAt=[DateTime]::UtcNow.ToString('o');anacondaSha256=$anacondaSha;vscodeSha256=$codeSha}|ConvertTo-Json|Set-Content -LiteralPath $marker -Encoding UTF8
  Write-Output ('Verified private lab: '+$rootPath+'. Package versions and checks are in logs/verification.out.log. Existing Python and conda were not selected or reset.')
}finally{foreach($name in $original.Keys){[Environment]::SetEnvironmentVariable($name,$original[$name],'Process')}}
