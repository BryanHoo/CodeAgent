[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath
)

$ErrorActionPreference = "Stop"
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("code-agent-desktop-smoke-" + [guid]::NewGuid())
$bundleRoot = Join-Path $workRoot "bundle"
$installRoot = Join-Path $workRoot "installed"
$desktopProcess = $null

function Resolve-UniqueArtifact {
  param([string]$Directory, [string]$Filter)
  $files = @(Get-ChildItem -LiteralPath $Directory -Filter $Filter -File)
  if ($files.Count -ne 1) {
    throw "Expected one $Filter artifact in $Directory; found $($files.Count)"
  }
  return $files[0]
}

try {
  New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
  & tar.exe -xzf ([System.IO.Path]::GetFullPath($ArchivePath)) -C $bundleRoot
  if ($LASTEXITCODE -ne 0) { throw "Failed to extract Desktop archive" }

  $nsis = Resolve-UniqueArtifact -Directory (Join-Path $bundleRoot "nsis") -Filter "*.exe"
  Resolve-UniqueArtifact -Directory (Join-Path $bundleRoot "msi") -Filter "*.msi" | Out-Null
  $installer = Start-Process -FilePath $nsis.FullName -ArgumentList @("/S", "/D=$installRoot") -Wait -PassThru
  if ($installer.ExitCode -ne 0) { throw "NSIS install failed with exit code $($installer.ExitCode)" }

  $productExecutables = @(
    Get-ChildItem -LiteralPath $installRoot -Filter "*.exe" -File |
      Where-Object { $_.BaseName -in @("CodeAgent", "code-agent-desktop") }
  )
  if ($productExecutables.Count -ne 1) {
    throw "Expected one installed CodeAgent executable; found $($productExecutables.Count)"
  }

  # 未签名 Preview 版本仍必须通过最低系统的安装与有界启动验证。
  $desktopProcess = Start-Process -FilePath $productExecutables[0].FullName -PassThru
  Start-Sleep -Seconds 15
  if ($desktopProcess.HasExited) {
    throw "CodeAgent exited during the Windows 10 startup smoke"
  }
  Stop-Process -Id $desktopProcess.Id
  $desktopProcess.WaitForExit()
  $desktopProcess = $null

  $uninstaller = Resolve-UniqueArtifact -Directory $installRoot -Filter "uninstall*.exe"
  $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru
  if ($uninstall.ExitCode -ne 0) { throw "NSIS uninstall failed with exit code $($uninstall.ExitCode)" }
  Write-Output "Windows 10 Desktop release smoke passed."
}
finally {
  if ($null -ne $desktopProcess -and -not $desktopProcess.HasExited) {
    Stop-Process -Id $desktopProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }
}
