[CmdletBinding()]
param(
    [switch]$ValidateOnly,
    [string]$Repository = "BryanHoo/CodeAgent",
    [string]$RunnerDirectory = "C:\actions-runner",
    [string]$RunnerName = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"
$requiredLabels = @("self-hosted", "Windows", "X64", "windows-10")

if ($env:OS -ne "Windows_NT") {
    throw "Runner registration requires Windows 10 x64."
}

$operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem
if ($operatingSystem.Caption -notmatch "Windows 10" -or $operatingSystem.ProductType -ne 1) {
    throw "Runner must be a Windows 10 client, got: $($operatingSystem.Caption)"
}
if (-not [Environment]::Is64BitOperatingSystem) {
    throw "Runner must use an x64 operating system."
}

$validation = [ordered]@{
    architecture = "X64"
    labels = $requiredLabels
    name = $RunnerName
    operatingSystem = $operatingSystem.Caption
    repository = $Repository
}
if ($ValidateOnly) {
    $validation | ConvertTo-Json -Depth 3
    exit 0
}

$configPath = Join-Path $RunnerDirectory "config.cmd"
$servicePath = Join-Path $RunnerDirectory "svc.cmd"
if (-not (Test-Path -LiteralPath $configPath) -or -not (Test-Path -LiteralPath $servicePath)) {
    throw "Extract the GitHub Actions runner into $RunnerDirectory before registration."
}
if ($null -eq (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI is required and must already be authenticated."
}

# registration token 只保留在当前进程，脚本不写入磁盘或日志。
$registrationToken = gh api --method POST "repos/$Repository/actions/runners/registration-token" --jq .token
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($registrationToken)) {
    throw "Could not obtain a GitHub runner registration token."
}

Push-Location $RunnerDirectory
try {
    & $configPath --unattended --replace `
        --url "https://github.com/$Repository" `
        --token $registrationToken `
        --name $RunnerName `
        --labels "windows-10" `
        --work "_work"
    if ($LASTEXITCODE -ne 0) { throw "config.cmd failed with exit code $LASTEXITCODE." }

    & $servicePath install
    if ($LASTEXITCODE -ne 0) { throw "svc.cmd install failed with exit code $LASTEXITCODE." }
    & $servicePath start
    if ($LASTEXITCODE -ne 0) { throw "svc.cmd start failed with exit code $LASTEXITCODE." }
} finally {
    $registrationToken = $null
    Pop-Location
}

$validation | ConvertTo-Json -Depth 3
