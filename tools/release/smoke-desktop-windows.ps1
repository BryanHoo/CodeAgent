[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath
)

$ErrorActionPreference = "Stop"
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("code-agent-desktop-smoke-" + [guid]::NewGuid())
$bundleRoot = Join-Path $workRoot "bundle"
$desktopProcess = $null
$nativeProcessTimeoutMs = 120000
$shutdownTimeoutMs = 10000

function Resolve-UniqueArtifact {
  param([string]$Directory, [string]$Filter)
  $files = @(Get-ChildItem -LiteralPath $Directory -Filter $Filter -File)
  if ($files.Count -ne 1) {
    throw "Expected one $Filter artifact in $Directory; found $($files.Count)"
  }
  return $files[0]
}

function Invoke-NativeProcess {
  param([string]$FilePath, [string[]]$Arguments, [string]$Description)
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $FilePath
  $startInfo.UseShellExecute = $false
  foreach ($argument in $Arguments) {
    $startInfo.ArgumentList.Add($argument)
  }
  $process = [System.Diagnostics.Process]::Start($startInfo)
  try {
    if (-not $process.WaitForExit($nativeProcessTimeoutMs)) {
      $process.Kill($true)
      $process.WaitForExit($shutdownTimeoutMs) | Out-Null
      throw "$Description exceeded the 120 second timeout"
    }
    if ($process.ExitCode -ne 0) {
      throw "$Description failed with exit code $($process.ExitCode)"
    }
  }
  finally {
    $process.Dispose()
  }
}

function Resolve-ProductExecutable {
  param([string]$Directory)
  $productExecutables = @(
    Get-ChildItem -LiteralPath $Directory -Filter "*.exe" -File -Recurse |
      Where-Object { $_.BaseName -in @("CodeAgent", "code-agent-desktop") }
  )
  if ($productExecutables.Count -ne 1) {
    throw "Expected one installed CodeAgent executable in $Directory; found $($productExecutables.Count)"
  }
  return $productExecutables[0]
}

function Start-CodeAgentAndWait {
  param([System.IO.FileInfo]$Executable, [string]$InstallerType)
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable.FullName
  $startInfo.UseShellExecute = $false
  $script:desktopProcess = [System.Diagnostics.Process]::Start($startInfo)
  try {
    Start-Sleep -Seconds 15
    if ($script:desktopProcess.HasExited) {
      throw "CodeAgent installed by $InstallerType exited during the Windows 10 startup smoke"
    }
    # 走窗口关闭路径，验证 Tauri lifecycle 能释放 Codex 与安装目录文件句柄。
    if (-not $script:desktopProcess.CloseMainWindow()) {
      throw "CodeAgent installed by $InstallerType did not expose a closable main window"
    }
    if (-not $script:desktopProcess.WaitForExit($shutdownTimeoutMs)) {
      throw "CodeAgent installed by $InstallerType did not exit within 10 seconds"
    }
  }
  finally {
    if ($null -ne $script:desktopProcess -and -not $script:desktopProcess.HasExited) {
      $script:desktopProcess.Kill($true)
      $script:desktopProcess.WaitForExit($shutdownTimeoutMs) | Out-Null
    }
    if ($null -ne $script:desktopProcess) {
      $script:desktopProcess.Dispose()
    }
    $script:desktopProcess = $null
  }
}

function Install-MsiArtifact {
  param([System.IO.FileInfo]$Artifact, [string]$InstallRoot)
  Invoke-NativeProcess -FilePath "msiexec.exe" -Arguments @(
    "/i", $Artifact.FullName, "/qn", "/norestart", "INSTALLDIR=$InstallRoot"
  ) -Description "MSI install"
  try {
    Start-CodeAgentAndWait -Executable (Resolve-ProductExecutable $InstallRoot) -InstallerType "MSI"
  }
  finally {
    Invoke-NativeProcess -FilePath "msiexec.exe" -Arguments @(
      "/x", $Artifact.FullName, "/qn", "/norestart"
    ) -Description "MSI uninstall"
  }
}

function Install-NsisArtifact {
  param([System.IO.FileInfo]$Artifact, [string]$InstallRoot)
  Invoke-NativeProcess -FilePath $Artifact.FullName -Arguments @("/S", "/D=$InstallRoot") -Description "NSIS install"
  try {
    Start-CodeAgentAndWait -Executable (Resolve-ProductExecutable $InstallRoot) -InstallerType "NSIS"
  }
  finally {
    $uninstaller = Resolve-UniqueArtifact -Directory $InstallRoot -Filter "uninstall*.exe"
    Invoke-NativeProcess -FilePath $uninstaller.FullName -Arguments @("/S") -Description "NSIS uninstall"
  }
}

try {
  New-Item -ItemType Directory -Path $bundleRoot -Force | Out-Null
  & tar.exe -xzf ([System.IO.Path]::GetFullPath($ArchivePath)) -C $bundleRoot
  if ($LASTEXITCODE -ne 0) { throw "Failed to extract Desktop archive" }

  $nsis = Resolve-UniqueArtifact -Directory (Join-Path $bundleRoot "nsis") -Filter "*.exe"
  $msi = Resolve-UniqueArtifact -Directory (Join-Path $bundleRoot "msi") -Filter "*.msi"
  Install-MsiArtifact -Artifact $msi -InstallRoot (Join-Path $workRoot "installed-msi")
  Install-NsisArtifact -Artifact $nsis -InstallRoot (Join-Path $workRoot "installed-nsis")
  Write-Output "Windows 10 MSI and NSIS Desktop release smoke passed."
}
finally {
  if ($null -ne $desktopProcess -and -not $desktopProcess.HasExited) {
    $desktopProcess.Kill($true)
    $desktopProcess.WaitForExit($shutdownTimeoutMs) | Out-Null
  }
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }
}
