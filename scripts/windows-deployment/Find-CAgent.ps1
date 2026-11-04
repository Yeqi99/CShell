param([string]$VersionOf, [string]$ShortcutRoot = [Environment]::GetFolderPath('Programs'), [string]$DefaultRoot = (Join-Path $env:LOCALAPPDATA 'Programs\CAgent'))
$ErrorActionPreference = 'Stop'
# Only installed program metadata is read. Never start an executable or inspect user secrets.
if ($VersionOf) {
  $root = [IO.Path]::GetFullPath($VersionOf).TrimEnd('\')
  $launcher = Join-Path $root 'Open CAgent.vbs'
  if (Test-Path -LiteralPath $launcher -PathType Leaf) {
    $text = [IO.File]::ReadAllText($launcher)
    if ($text -match 'Chr\(34\) & "([^"]+\\Cagent\.exe)"') {
      $exe = [IO.Path]::GetFullPath($Matches[1])
      if ($exe.StartsWith($root + '\versions\', [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $exe -PathType Leaf)) {
        [Console]::Out.Write([Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion)
      }
    }
  }
  exit 0
}
$candidates = @()
try { $candidates += (Get-ItemProperty -LiteralPath 'HKCU:\Software\CAgent\Installation' -ErrorAction Stop).InstallLocation } catch {}
try {
  $shortcutPath = Join-Path $ShortcutRoot 'CAgent.lnk'
  if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    if ($shortcut.TargetPath -ieq (Join-Path $env:SystemRoot 'System32\wscript.exe') -and $shortcut.Arguments -match '^"(.+\\Open CAgent\.vbs)"$') {
      $candidates += [IO.Path]::GetDirectoryName($Matches[1])
    }
  }
} catch {}
$candidates += $DefaultRoot
foreach ($candidate in $candidates) {
  if ([string]::IsNullOrWhiteSpace($candidate) -or -not [IO.Path]::IsPathRooted($candidate) -or $candidate -match '[\r\n]') { continue }
  $root = [IO.Path]::GetFullPath($candidate)
  if ((Test-Path -LiteralPath (Join-Path $root 'Open CAgent.vbs') -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $root 'versions') -PathType Container)) {
    [Console]::Out.Write($root)
    exit 0
  }
}
