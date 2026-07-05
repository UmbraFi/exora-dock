param(
  [string]$ImageTag = $(if ($env:EXORA_DOCK_IMAGE) { $env:EXORA_DOCK_IMAGE } else { "exora-dock:local" }),
  [string]$Configuration = "release",
  [switch]$SkipTests,
  [switch]$BuildDockerImage,
  [switch]$SkipDockerBuild,
  [switch]$SkipInstaller
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DesktopDir = Join-Path $Root "desktop"
$ResourcesDir = Join-Path $DesktopDir "resources\docker"
$BinariesDir = Join-Path $DesktopDir "binaries"
$ImageTar = Join-Path $ResourcesDir "exora-dock-image.tar"
$HelperPath = Join-Path $BinariesDir "exora-dockd.exe"
$ShouldBuildDockerImage = $BuildDockerImage -and -not $SkipDockerBuild

function Add-ProcessPath([string]$Path) {
  if ((Test-Path $Path) -and (($env:Path -split ';') -notcontains $Path)) {
    $env:Path = "$Path;$env:Path"
  }
}

Add-ProcessPath "C:\Program Files\Go\bin"
Add-ProcessPath (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links")

function Resolve-Go {
  $cmd = Get-Command go -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $default = "C:\Program Files\Go\bin\go.exe"
  if (Test-Path $default) { return $default }
  throw "Go 1.22+ was not found on PATH or at $default"
}

function Resolve-Npm {
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "npm was not found on PATH"
}

function Invoke-Step([string]$Name, [scriptblock]$Body) {
  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan
  & $Body
}

$Go = Resolve-Go
$Npm = Resolve-Npm

if ($ShouldBuildDockerImage) {
  Invoke-Step "Checking Docker" {
    docker version | Out-Host
  }
}

if (-not $SkipTests) {
  Invoke-Step "Running Go tests" {
    Push-Location $Root
    try {
      & $Go test ./...
    } finally {
      Pop-Location
    }
  }
}

New-Item -ItemType Directory -Force -Path $BinariesDir | Out-Null
if ($ShouldBuildDockerImage) {
  New-Item -ItemType Directory -Force -Path $ResourcesDir | Out-Null
}

if ($ShouldBuildDockerImage) {
  Invoke-Step "Building Docker image $ImageTag" {
    Push-Location $Root
    try {
      docker build -t $ImageTag .
    } finally {
      Pop-Location
    }
  }

  Invoke-Step "Saving Docker image tar" {
    docker save -o $ImageTar $ImageTag
    Write-Host "Saved $ImageTar"
  }
}

Invoke-Step "Building Windows MCP/CLI helper" {
  Push-Location $Root
  $OldCgoEnabled = [Environment]::GetEnvironmentVariable("CGO_ENABLED", "Process")
  $OldGoos = [Environment]::GetEnvironmentVariable("GOOS", "Process")
  $OldGoarch = [Environment]::GetEnvironmentVariable("GOARCH", "Process")
  try {
    $env:CGO_ENABLED = "0"
    $env:GOOS = "windows"
    $env:GOARCH = "amd64"
    & $Go build -o $HelperPath ./cmd/exora-dock/
  } finally {
    if ($null -eq $OldCgoEnabled) { Remove-Item Env:\CGO_ENABLED -ErrorAction SilentlyContinue } else { $env:CGO_ENABLED = $OldCgoEnabled }
    if ($null -eq $OldGoos) { Remove-Item Env:\GOOS -ErrorAction SilentlyContinue } else { $env:GOOS = $OldGoos }
    if ($null -eq $OldGoarch) { Remove-Item Env:\GOARCH -ErrorAction SilentlyContinue } else { $env:GOARCH = $OldGoarch }
    Pop-Location
  }
}

Invoke-Step "Installing desktop dependencies" {
  Push-Location $DesktopDir
  try {
    & $Npm install
  } finally {
    Pop-Location
  }
}

Invoke-Step "Building frontend" {
  Push-Location $DesktopDir
  try {
    & $Npm run build:frontend
  } finally {
    Pop-Location
  }
}

Invoke-Step "Checking Electron shell" {
  Push-Location $DesktopDir
  try {
    & $Npm run build:electron
  } finally {
    Pop-Location
  }
}

if (-not $SkipInstaller) {
  Invoke-Step "Building NSIS installer" {
    Push-Location $DesktopDir
    try {
      & $Npm run build:exe
    } finally {
      Pop-Location
    }
  }
}

Write-Host ""
Write-Host "Windows native desktop build complete." -ForegroundColor Green
if ($ShouldBuildDockerImage) {
  Write-Host "Image tar: $ImageTar"
}
Write-Host "Helper:    $HelperPath"
Write-Host "Installer: $DesktopDir\release"
