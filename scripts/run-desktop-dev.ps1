$ErrorActionPreference = 'Stop'

$desktopRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\desktop'))
$logRoot = Join-Path $desktopRoot 'logs'

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Set-Location -LiteralPath $desktopRoot

$stdout = Join-Path $logRoot 'electron-stable-task.stdout.log'
$stderr = Join-Path $logRoot 'electron-stable-task.stderr.log'

& npm.cmd run dev 1>> $stdout 2>> $stderr
exit $LASTEXITCODE
