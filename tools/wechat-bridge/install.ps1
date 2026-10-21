param([Parameter(Mandatory=$true)][string]$Python)
$ErrorActionPreference = 'Stop'
& $Python "$PSScriptRoot/verify-package.py"
if ($LASTEXITCODE -ne 0) { throw 'Package verification failed' }
& $Python -c 'import sys,struct; assert sys.platform=="win32" and struct.calcsize("P")==8 and sys.version_info[:2] == (3,12)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 for Windows x64 is required' }
$installRoot = Join-Path $env:LOCALAPPDATA 'CShell/tools/wechat-bridge'
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
$environmentPath = Join-Path $installRoot 'venv'
if (-not (Test-Path -LiteralPath "$environmentPath/Scripts/python.exe")) {
    & $Python -m venv $environmentPath
    if ($LASTEXITCODE -ne 0) { throw 'Virtual environment creation failed' }
}
& "$environmentPath/Scripts/python.exe" -m pip install --force-reinstall --no-index --find-links "$PSScriptRoot/wheels" 'cshell-wechat-bridge[maintenance]==0.1.5'
if ($LASTEXITCODE -ne 0) { throw 'Offline installation failed' }
'{}' | & "$environmentPath/Scripts/cshell-wechat.exe" capabilities
if ($LASTEXITCODE -ne 0) { throw 'Installed tool check failed' }
Copy-Item -LiteralPath "$PSScriptRoot/maintenance" -Destination $installRoot -Recurse -Force
foreach ($document in @('README.md','UPGRADE.md','THIRD_PARTY_NOTICES.md','LICENSE')) {
    Copy-Item -LiteralPath "$PSScriptRoot/$document" -Destination $installRoot -Force
}
Write-Output "Installed at $installRoot. Live messaging remains quarantined; no permissions were enabled."
