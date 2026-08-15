[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$ArtifactPath
)

$ErrorActionPreference = "Stop"
$requiredSettings = @(
  "ARTIFACT_SIGNING_TOOL_ROOT",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "AZURE_ARTIFACT_SIGNING_ACCOUNT",
  "AZURE_ARTIFACT_SIGNING_PROFILE"
)

foreach ($setting in $requiredSettings) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($setting))) {
    throw "Missing required Windows signing setting: $setting"
  }
}

$resolvedArtifact = [System.IO.Path]::GetFullPath($ArtifactPath)
if (-not [System.IO.File]::Exists($resolvedArtifact)) {
  throw "Windows signing artifact does not exist: $resolvedArtifact"
}

function Resolve-UniqueX64Tool {
  param([Parameter(Mandatory = $true)][string]$FileName)

  $matches = @(
    Get-ChildItem -LiteralPath $env:ARTIFACT_SIGNING_TOOL_ROOT -Filter $FileName -File -Recurse |
      Where-Object { $_.FullName -match "[\\/]x64[\\/]" }
  )
  if ($matches.Count -ne 1) {
    throw "Expected one x64 $FileName under $env:ARTIFACT_SIGNING_TOOL_ROOT; found $($matches.Count)"
  }
  return $matches[0].FullName
}

$signTool = Resolve-UniqueX64Tool -FileName "signtool.exe"
$artifactSigningDlib = Resolve-UniqueX64Tool -FileName "Azure.CodeSigning.Dlib.dll"
$metadataPath = Join-Path ([System.IO.Path]::GetTempPath()) ("code-agent-signing-" + [guid]::NewGuid() + ".json")
$metadata = [ordered]@{
  Endpoint = $env:AZURE_ARTIFACT_SIGNING_ENDPOINT
  CodeSigningAccountName = $env:AZURE_ARTIFACT_SIGNING_ACCOUNT
  CertificateProfileName = $env:AZURE_ARTIFACT_SIGNING_PROFILE
  # 仅启用 EnvironmentCredential，避免 CI 中等待交互式认证。
  ExcludeCredentials = @(
    "ManagedIdentityCredential",
    "WorkloadIdentityCredential",
    "SharedTokenCacheCredential",
    "VisualStudioCredential",
    "VisualStudioCodeCredential",
    "AzureCliCredential",
    "AzurePowerShellCredential",
    "AzureDeveloperCliCredential",
    "InteractiveBrowserCredential"
  )
}
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 3), $utf8WithoutBom)

# 参数数组避免工具路径、metadata 或 artifact 路径被 PowerShell 再次解释。
$signingArguments = @(
  "sign",
  "/v",
  "/fd", "SHA256",
  "/tr", "http://timestamp.acs.microsoft.com/",
  "/td", "SHA256",
  "/dlib", $artifactSigningDlib,
  "/dmdf", $metadataPath,
  $resolvedArtifact
)
try {
  & $signTool @signingArguments
  $signingExitCode = $LASTEXITCODE
}
finally {
  Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
}
if ($signingExitCode -ne 0) {
  throw "signtool.exe failed with exit code $signingExitCode"
}
