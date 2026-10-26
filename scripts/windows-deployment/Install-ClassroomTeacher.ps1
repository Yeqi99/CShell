param(
  [string]$BundleDirectory = $PSScriptRoot,
  [string]$CShellDestination,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$bundle = (Resolve-Path -LiteralPath $BundleDirectory).Path
$manifest = Get-Content -LiteralPath (Join-Path $bundle 'teacher-deployment.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 'cshell-teacher-bundle-1' -or $manifest.productName -notin @('CShell', 'CShell Pro')) { throw 'Invalid teacher deployment manifest' }
function VerifiedPath($Entry) {
  if ($Entry.file -notmatch '^[a-zA-Z0-9_. -]+$' -or $Entry.file -in @('.', '..') -or $Entry.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid teacher bundle entry' }
  $path = Join-Path $bundle $Entry.file
  if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Teacher bundle must contain regular files' }
  if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $Entry.sha256) { throw 'Teacher bundle checksum mismatch' }
  return $path
}
$installer = VerifiedPath $manifest.installer
$script = VerifiedPath $manifest.script
$config = VerifiedPath $manifest.config
if (-not $CShellDestination) { $CShellDestination = Join-Path (Join-Path $env:LOCALAPPDATA 'Programs') $manifest.productName }
# Reuse the same verified product/version/path checks and existing-data guard.
# No CAgent bundle, credential, listener, startup or screen-share action is passed.
& $script -CShellInstaller $installer -CShellSha256 $manifest.installer.sha256 -CShellExecutable (Join-Path $CShellDestination ($manifest.productName + '.exe')) -CShellDestination $CShellDestination -CShellConfig $config -Apply:$Apply
if ($Apply) { Write-Output 'Teacher installation finished. Open CShell > Extensions > Classroom. Existing configuration is preserved; CAgent was not installed or configured.' }
else { Write-Output 'Teacher preview passed. Only CShell and initial classroom/agent extension selection will be installed. No CAgent runtime or credentials are included.' }
