$ErrorActionPreference = 'Stop'

$dockRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$cloudRoot = (Resolve-Path (Join-Path $dockRoot '..\exora-cloud')).Path

Write-Host 'Running deterministic buyer/seller transaction simulation...'
Push-Location $cloudRoot
try {
  go run ./cmd/exora-supervisor-sim
} finally {
  Pop-Location
}

Write-Host 'Running two real Codex threads with restart/resume...'
Push-Location $dockRoot
try {
  go run ./cmd/exora-codex-dual-accept
} finally {
  Pop-Location
}
