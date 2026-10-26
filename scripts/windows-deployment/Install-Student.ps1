param(
  [Parameter(Mandatory=$true)][string]$CShellInstaller,
  [Parameter(Mandatory=$true)][string]$CShellSha256,
  [Parameter(Mandatory=$true)][string]$CShellExecutable,
  [Parameter(Mandatory=$true)][string]$CShellConfig,
  [string]$CShellDestination,
  [string]$CAgentBundle,
  [string]$CAgentConfig,
  [string]$CAgentInstallerSha256,
  [string]$CAgentDestination = (Join-Path $env:LOCALAPPDATA 'Programs\CAgent'),
  [switch]$Apply
)
# Run as the student's normal Windows account. No elevation, remote execution,
# password arguments, automatic firewall changes, or automatic screen sharing.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function NormalizedVersion([string]$Text) {
  if ($Text -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { throw 'Invalid application version' }
  $value = [version]$Text
  return [version]::new($value.Major, $value.Minor, $value.Build, [Math]::Max(0, $value.Revision))
}
$installer = (Resolve-Path -LiteralPath $CShellInstaller).Path
if ($CShellSha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ine $CShellSha256) { throw 'CShell installer checksum mismatch' }
$installerInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($installer)
if ($installerInfo.ProductName -notin @('CShell', 'CShell Pro')) { throw 'Expected a CShell or CShell Pro installer' }
if ($installerInfo.ProductVersion -notmatch '^\d+\.\d+\.\d+(\.\d+)?$' -or [version]$installerInfo.ProductVersion -lt [version]'0.8.11') { throw 'Student deployment requires CShell 0.8.11 or newer' }
$expectedExe = [IO.Path]::GetFullPath($CShellExecutable)
if (-not $CShellDestination) { $CShellDestination = [IO.Path]::GetDirectoryName($expectedExe) }
$destination = [IO.Path]::GetFullPath($CShellDestination).TrimEnd('\', '/')
if ($destination -match '["\r\n]' -or $destination -eq [IO.Path]::GetPathRoot($destination).TrimEnd('\', '/')) { throw 'Choose a dedicated application installation directory' }
if ($expectedExe -ine (Join-Path $destination ($installerInfo.ProductName + '.exe'))) { throw 'CShellExecutable must match the selected installer edition and destination' }
# NSIS /D must be the final argument and is deliberately not quoted, even with spaces.
$installerArguments = '/S /D=' + $destination
$config = (Resolve-Path -LiteralPath $CShellConfig).Path
if (($CAgentBundle -and -not $CAgentConfig) -or ($CAgentConfig -and -not $CAgentBundle)) { throw 'CAgentBundle and CAgentConfig must be supplied together' }
if ($CAgentBundle) {
  $bundle = (Resolve-Path -LiteralPath $CAgentBundle).Path
  $agentInstaller = Join-Path $bundle 'Install-CAgent.ps1'
  if ($CAgentInstallerSha256 -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $agentInstaller -Algorithm SHA256).Hash -ine $CAgentInstallerSha256) { throw 'CAgent installer script checksum mismatch' }
}
if (-not $Apply) { Write-Output 'Validated CShell installer digest. Re-run with -Apply to install and apply initial configuration. Existing data is preserved. No installation performed.'; return }
if (Get-Process -Name 'CShell', 'CShell Pro' -ErrorAction SilentlyContinue) { throw 'CShell or CShell Pro is running. Exit it normally before student deployment; no process was stopped.' }
$process = Start-Process -FilePath $installer -ArgumentList $installerArguments -PassThru -WindowStyle Hidden
if (-not $process.WaitForExit(300000)) { throw 'Installer exceeded 5 minutes. No process was terminated. Check installation before retrying.' }
if ($process.ExitCode -ne 0) { throw 'CShell installation failed' }
$exe = (Resolve-Path -LiteralPath $CShellExecutable).Path
if ($exe -ine $expectedExe) { throw 'Installed executable path does not match deployment target' }
$installedInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
if ($installedInfo.ProductName -cne $installerInfo.ProductName -or $installedInfo.ProductVersion -notmatch '^\d+\.\d+\.\d+(\.\d+)?$' -or (NormalizedVersion $installedInfo.ProductVersion) -ne (NormalizedVersion $installerInfo.ProductVersion)) { throw 'Installed product/version does not match the verified installer; initial configuration was not applied' }
if (Get-Process -Name 'CShell', 'CShell Pro' -ErrorAction SilentlyContinue) { throw 'An application instance started during installation; initial configuration was not applied. Exit it normally before retrying.' }
$provision = Start-Process -FilePath $exe -ArgumentList @('--provision-file', ('"' + $config + '"'), '--apply', '--provision-only') -PassThru -WindowStyle Hidden
if (-not $provision.WaitForExit(60000)) { throw 'Initial configuration exceeded 60 seconds. Use a build supporting --provision-only. No process was terminated; inspect the application before retrying.' }
if ($provision.ExitCode -ne 0) { throw 'CShell initial configuration failed' }
if ($CAgentBundle) {
  # Use an extracted, separately verified official deployment bundle. Its installer
  # verifies every payload file before copying and never closes an existing Agent.
  & (Join-Path $bundle 'Install-CAgent.ps1') -Destination $CAgentDestination -ProvisionFile $CAgentConfig -NoLaunch
}
Write-Output 'Installation finished. Open CShell / CAgent normally. Screen sharing and capability execution require their own explicit authorization.'
