param([string]$NodePath)
$ErrorActionPreference = 'Continue'
$haituoApp = Split-Path -Parent $PSScriptRoot
$haituoLogDir = 'C:\HaituoData\logs'
New-Item -ItemType Directory -Path $haituoLogDir -Force | Out-Null
Set-Location -LiteralPath $haituoApp
$haituoNode = if ($NodePath) { $NodePath } else { (Get-Command node.exe -ErrorAction Stop).Source }
$haituoLog = Join-Path $haituoLogDir ('web-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
$env:PORT = '4188'
$env:BACKEND_HOST = '127.0.0.1'
& $haituoNode --env-file="$haituoApp\.env" "$haituoApp\backend\dist\server.js" *> $haituoLog
exit $LASTEXITCODE
