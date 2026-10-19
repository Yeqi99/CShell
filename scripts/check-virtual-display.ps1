param([Parameter(Mandatory=$true)][string]$Archive)
$ErrorActionPreference = 'Stop'
# Read-only release inspection. This does not install a driver, certificate, or device.
$expectedHash = 'e24210692b442b39af763536330ce78b423f19342b7a7792c26de3944e418b3a'
$expectedSigner = '3CF8CF26D8BA266C3A483AB7D26D4A818E317D76'
$resolvedArchive = (Resolve-Path -LiteralPath $Archive).Path
if ((Get-FileHash -LiteralPath $resolvedArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
  throw 'Virtual Display Driver archive digest mismatch. No installation is allowed.'
}
$inspectionDir = Join-Path ([IO.Path]::GetTempPath()) ('cagent-vdd-inspect-' + [guid]::NewGuid().ToString('N'))
try {
  Expand-Archive -LiteralPath $resolvedArchive -DestinationPath $inspectionDir
  $signatures = foreach ($name in @('mttvdd.cat', 'MttVDD.dll')) {
    $file = Join-Path $inspectionDir ('VirtualDisplayDriver\' + $name)
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $expectedSigner) {
      throw "Invalid or unexpected signature: $name. No installation is allowed."
    }
    @{ file=$name; status=[string]$signature.Status; subject=$signature.SignerCertificate.Subject; thumbprint=$signature.SignerCertificate.Thumbprint }
  }
  $os = Get-CimInstance Win32_OperatingSystem
  $candidatePlatform = $env:PROCESSOR_ARCHITECTURE -eq 'AMD64' -and $os.ProductType -eq 1 -and [int]$os.BuildNumber -ge 19041
  [ordered]@{
    application='virtual-display'; version='25.7.23'; checkedAt=[DateTime]::UtcNow.ToString('o')
    url='https://github.com/VirtualDrivers/Virtual-Display-Driver/releases/download/25.7.23/VirtualDisplayDriver-x86.Driver.Only.zip'
    sha256=$expectedHash; signatures=@($signatures); os=$os.Caption; build=$os.BuildNumber
    candidatePlatform=$candidatePlatform; installedByThisCheck=$false; installAllowed=$false
    state='blocked'; reason='Official CLI does not guarantee secondary-only display creation or preserve existing primary/display topology. CAgent topology validation and rollback are not implemented. Server platforms remain experimental.'
  } | ConvertTo-Json -Depth 5
} finally {
  # Delete only the fresh, locally generated inspection directory beneath TEMP.
  if (Test-Path -LiteralPath $inspectionDir) {
    $resolvedInspection = [IO.Path]::GetFullPath($inspectionDir)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (!$resolvedInspection.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        !([IO.Path]::GetFileName($resolvedInspection).StartsWith('cagent-vdd-inspect-'))) { throw 'Unexpected inspection directory' }
    Remove-Item -LiteralPath $resolvedInspection -Recurse -Force
  }
}
