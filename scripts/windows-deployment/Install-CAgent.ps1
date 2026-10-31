param(
  [string]$Destination = (Join-Path $env:LOCALAPPDATA 'Programs\CAgent'),
  [switch]$NoLaunch,
  [switch]$NoShortcuts,
  [switch]$RefreshExistingShortcuts,
  [switch]$PrepareOnly,
  [string]$ProvisionFile
)
$ErrorActionPreference = 'Stop'
if ($PrepareOnly -and $ProvisionFile) { throw 'PrepareOnly cannot apply initial provisioning' }
Set-StrictMode -Version Latest
function FileSha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose(); $stream.Dispose() }
}
function Within([string]$Base, [string]$Relative) {
  if ([IO.Path]::IsPathRooted($Relative) -or $Relative.Contains(':') -or ($Relative -split '[\\/]' | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' })) { throw 'Invalid bundle path' }
  $root = [IO.Path]::GetFullPath($Base).TrimEnd('\')
  $target = [IO.Path]::GetFullPath((Join-Path $root $Relative))
  if (-not $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped installation directory' }
  return $target
}
function NoLink([string]$Path) {
  $current = [IO.Path]::GetFullPath($Path)
  while (-not [string]::IsNullOrEmpty($current)) {
    $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
    if ($null -ne $item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Installation paths must not contain junctions or symbolic links' }
    $current = [IO.Path]::GetDirectoryName($current)
  }
}
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'deployment.json') -Raw | ConvertFrom-Json
if ($manifest.format -ne 1 -or $manifest.platform -ne 'win32' -or $manifest.arch -ne 'x64' -or $manifest.installId -notmatch '^[0-9A-Za-z._-]{1,100}$') { throw 'Unsupported deployment manifest' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This package requires 64-bit Windows' }
$payload = Join-Path $PSScriptRoot 'payload'
$root = [IO.Path]::GetFullPath($Destination)
NoLink $PSScriptRoot
NoLink $root
$seen = @{}
foreach ($file in $manifest.files) {
  $source = Within $payload $file.path
  NoLink $source
  if ($seen.ContainsKey($file.path.ToLowerInvariant()) -or $file.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid or duplicate bundle entry' }
  $seen[$file.path.ToLowerInvariant()] = $true
  if ((Get-Item -LiteralPath $source).Length -ne $file.bytes -or (FileSha256 $source) -ne $file.sha256) { throw ('Bundle verification failed: ' + $file.path) }
}
if ((Get-ChildItem -LiteralPath $payload -Recurse -File -Force).Count -ne $manifest.files.Count) { throw 'Unexpected bundle files' }
# Side-by-side program files; the existing data directory and running processes are untouched.
$versionRoot = Within $root ('versions\' + $manifest.installId)
New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null
NoLink $versionRoot
foreach ($file in $manifest.files) {
  $target = Within $versionRoot $file.path
  NoLink $target
  if (Test-Path -LiteralPath $target) {
    if ((FileSha256 $target) -ne $file.sha256) { throw 'Existing version directory differs; refusing to overwrite a running installation' }
  } else {
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
    Copy-Item -LiteralPath (Within $payload $file.path) -Destination $target
  }
  if ((FileSha256 $target) -ne $file.sha256) { throw 'Installed file verification failed' }
}
$exe = Join-Path $versionRoot 'Cagent.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Native CAgent launcher missing' }
if ($PrepareOnly) {
  # The running daemon owns the later admission barrier and authenticated
  # handoff. Preparation never changes launchers, shortcuts or live processes.
  $receipt = Join-Path $root 'prepared-update.json'
  NoLink $receipt
  $temporaryReceipt = $receipt + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllText($temporaryReceipt, (@{ format = 1; version = $manifest.version; installId = $manifest.installId; path = $versionRoot } | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporaryReceipt -Destination $receipt -Force
  @{ prepared = $true; version = $manifest.version; path = $versionRoot } | ConvertTo-Json -Compress
  return
}
# Program discovery metadata only; never touches the identity/configuration directory.
New-Item -Path 'HKCU:\Software\CAgent\Installation' -Force | Out-Null
Set-ItemProperty -LiteralPath 'HKCU:\Software\CAgent\Installation' -Name InstallLocation -Value $root
$launcher = Join-Path $root 'Open CAgent.vbs'
NoLink $launcher
$vbs = 'Set sh = CreateObject("WScript.Shell")' + "`r`n" + 'sh.Run Chr(34) & "' + $exe.Replace('"','""') + '" & Chr(34), 1, False' + "`r`n"
[IO.File]::WriteAllText($launcher, $vbs, [Text.Encoding]::Unicode)
if (-not $NoShortcuts -or $RefreshExistingShortcuts) {
  $shell = New-Object -ComObject WScript.Shell
  foreach ($folder in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
    $shortcutPath = Join-Path $folder 'CAgent.lnk'
    NoLink $shortcutPath
    if ($NoShortcuts -and -not (Test-Path -LiteralPath $shortcutPath)) { continue }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    # A silent update may refresh only an existing shortcut to this installation.
    # Do not recreate a shortcut the user removed or take over another install.
    if ($NoShortcuts -and ($shortcut.TargetPath -ine (Join-Path $env:SystemRoot 'System32\wscript.exe') -or $shortcut.Arguments -ine ('"' + $launcher + '"'))) { continue }
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $shortcut.Arguments = '"' + $launcher + '"'
    $shortcut.WorkingDirectory = $versionRoot
    $shortcut.IconLocation = $exe + ',0'
    $shortcut.Description = 'CAgent 本地智能体与远程桌面'
    $shortcut.Save()
    if (-not (Test-Path -LiteralPath $shortcutPath)) { throw 'Shortcut creation failed' }
  }
}
# Provision before launch. Only a file path is passed; no password enters argv.
if ($ProvisionFile) {
  $configPath = (Resolve-Path -LiteralPath $ProvisionFile).Path
  & (Join-Path $versionRoot 'node.exe') (Join-Path $versionRoot 'agent.cjs') provision $configPath --apply
  if ($LASTEXITCODE -ne 0) { throw 'Initial provisioning failed; application was not started' }
}
# User-requested default autostart; preserve an explicit opt-out.
if (-not $NoShortcuts -and -not (Test-Path -LiteralPath (Join-Path $root 'autostart-disabled'))) {
  $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'CAgent.vbs'
  $startupScript = 'Set sh = CreateObject("WScript.Shell")' + "`r`n" + 'sh.Run Chr(34) & "' + $launcher.Replace('"','""') + '" & Chr(34), 0, False' + "`r`n"
  [IO.File]::WriteAllText($startup,$startupScript,[Text.Encoding]::Unicode)
}
# Read-only restricted IPC probe. Never expose its status payload or stop an existing runtime.
$restartNeeded = $null
$probe = New-Object Diagnostics.Process
$probe.StartInfo = New-Object Diagnostics.ProcessStartInfo
$probe.StartInfo.FileName = Join-Path $versionRoot 'node.exe'
$probe.StartInfo.Arguments = '"' + (Join-Path $versionRoot 'agent.cjs') + '" status'
$probe.StartInfo.UseShellExecute = $false
$probe.StartInfo.CreateNoWindow = $true
$probe.StartInfo.RedirectStandardOutput = $true
$probe.StartInfo.RedirectStandardError = $true
try {
  [void]$probe.Start()
  $stdout = $probe.StandardOutput.ReadToEndAsync()
  $stderr = $probe.StandardError.ReadToEndAsync()
  if ($probe.WaitForExit(5000)) {
    if ($probe.ExitCode -eq 0) { $restartNeeded = $true }
    elseif ($stderr.Result -match 'ECONNREFUSED|未运行') { $restartNeeded = $false }
  } else { $probe.Kill() }
} catch { $restartNeeded = $null } finally { $probe.Dispose() }
$launched = $false
if (-not $NoLaunch -and $restartNeeded -eq $false) { Start-Process -FilePath $exe -WorkingDirectory $versionRoot; $launched = $true }
if ($restartNeeded -eq $true) { Write-Host '程序已安装。检测到 CAgent 后台仍在运行；请正常退出 CAgent，再从开始菜单打开。当前会话没有被关闭，新版本尚未生效。' }
elseif ($null -eq $restartNeeded) { Write-Host '程序已安装，但未能确认原后台是否已退出。请检查并正常退出原 CAgent，再从开始菜单打开。' }
@{ programInstalled = $true; restartNeeded = $restartNeeded; installed = $true; version = $manifest.version; path = $versionRoot; launched = $launched; dataPreserved = $true; permissionsChanged = $false; firewallChanged = $false } | ConvertTo-Json -Compress
