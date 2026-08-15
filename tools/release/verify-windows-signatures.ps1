[CmdletBinding()]
param(
  [string]$BundleRoot = "target/release/bundle",
  [string]$ProductExecutable = "target/release/code-agent-desktop.exe"
)

$ErrorActionPreference = "Stop"

function Resolve-UniqueArtifact {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Directory,
    [Parameter(Mandatory = $true)]
    [string]$Filter
  )

  $artifacts = @(Get-ChildItem -LiteralPath $Directory -Filter $Filter -File)
  if ($artifacts.Count -ne 1) {
    throw "Expected one $Filter artifact in $Directory; found $($artifacts.Count)"
  }
  return $artifacts[0].FullName
}

$resolvedExecutable = [System.IO.Path]::GetFullPath($ProductExecutable)
if (-not [System.IO.File]::Exists($resolvedExecutable)) {
  throw "CodeAgent executable does not exist: $resolvedExecutable"
}

$resolvedBundleRoot = [System.IO.Path]::GetFullPath($BundleRoot)
$artifacts = @(
  $resolvedExecutable,
  (Resolve-UniqueArtifact -Directory (Join-Path $resolvedBundleRoot "nsis") -Filter "*.exe"),
  (Resolve-UniqueArtifact -Directory (Join-Path $resolvedBundleRoot "msi") -Filter "*.msi")
)

foreach ($artifact in $artifacts) {
  $signature = Get-AuthenticodeSignature -LiteralPath $artifact
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Invalid Authenticode signature for $artifact`: $($signature.StatusMessage)"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Authenticode signature is missing a timestamp: $artifact"
  }
}

Write-Output "Windows Authenticode signatures verified."
