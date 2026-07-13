param([string]$OutputDir = (Join-Path $PSScriptRoot "..\artifacts\wsl-images"))
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$context = Join-Path $PSScriptRoot "..\images\wsl"
foreach ($spec in @(
  @{ Id="ubuntu-24.04-cpu-v1"; Dockerfile="Dockerfile.cpu"; Gpu=$false },
  @{ Id="ubuntu-24.04-cuda-12.8-toolkit-v1"; Dockerfile="Dockerfile.cuda"; Gpu=$true }
)) {
  $tag = "exora-wsl-$($spec.Id):build"
  docker build -f (Join-Path $context $spec.Dockerfile) -t $tag $context
  $container = docker create $tag
  try { docker export -o (Join-Path $OutputDir "$($spec.Id).wsl") $container } finally { docker rm $container | Out-Null }
  $artifact = Get-Item (Join-Path $OutputDir "$($spec.Id).wsl")
  $hash = (Get-FileHash -Algorithm SHA256 $artifact.FullName).Hash.ToLowerInvariant()
  $manifest = [ordered]@{ schema="exora.environment_image.v3alpha1"; imageId=$spec.Id; version="1.0.0"; name=($spec.Id -replace '-v1$',''); description="Signed Exora Ubuntu 24.04 WSL environment"; architecture="amd64"; runtimeBackends=@("wsl2"); os=[ordered]@{distribution="ubuntu";version="24.04"}; gpu=[ordered]@{required=$spec.Gpu;vendor=$(if($spec.Gpu){"nvidia"}else{"none"});cudaVersion=$(if($spec.Gpu){"12.8"}else{""})}; artifact=[ordered]@{format="wsl";sizeBytes=$artifact.Length;sha256=$hash} }
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $OutputDir "$($spec.Id).manifest.json")
}
