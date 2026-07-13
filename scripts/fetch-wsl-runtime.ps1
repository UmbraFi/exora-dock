param(
  [string]$LockFile = (Join-Path $PSScriptRoot "..\runtime\wsl-runtime.lock.json"),
  [string]$OutputDir = (Join-Path $PSScriptRoot "..\desktop\resources\wsl")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$lock = Get-Content -Raw -LiteralPath $LockFile | ConvertFrom-Json
if ($lock.architecture -ne "x64") { throw "Only the locked x64 WSL Runtime is supported" }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$target = Join-Path $OutputDir $lock.fileName
if (-not (Test-Path -LiteralPath $target)) {
  Invoke-WebRequest -UseBasicParsing -Uri $lock.url -OutFile $target
}
$info = Get-Item -LiteralPath $target
if ($info.Length -ne [int64]$lock.sizeBytes) { throw "WSL Runtime size mismatch: $($info.Length)" }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
if ($hash -ne $lock.sha256.ToLowerInvariant()) { throw "WSL Runtime SHA-256 mismatch" }
$signature = Get-AuthenticodeSignature -LiteralPath $target
if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch [regex]::Escape($lock.publisherPattern)) {
  throw "WSL Runtime Authenticode signature is not a valid Microsoft signature"
}
Copy-Item -Force -LiteralPath $LockFile -Destination (Join-Path $OutputDir "wsl-runtime.lock.json")
Write-Host "Verified WSL Runtime $($lock.version): $target"
