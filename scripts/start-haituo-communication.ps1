param([string]$NodePath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$haituoApp = Split-Path -Parent $PSScriptRoot
$haituoData = 'C:\HaituoData'
$haituoLogDir = Join-Path $haituoData 'logs'
$haituoMediaDir = Join-Path $haituoData 'communication-media'
New-Item -ItemType Directory -Path $haituoLogDir -Force | Out-Null
New-Item -ItemType Directory -Path $haituoMediaDir -Force | Out-Null
Set-Location -LiteralPath (Join-Path $haituoApp 'whatsapp-plugin')

$haituoNode = if ($NodePath) { $NodePath } else { (Get-Command node.exe -ErrorAction Stop).Source }
$haituoLog = Join-Path $haituoLogDir ('communication-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')

$env:NODE_ENV = 'production'
$env:HOST = '127.0.0.1'
$env:PORT = '3100'
$env:WEB_ORIGIN = 'https://demo.linqiagent.cn'
$env:DATABASE_CLIENT = 'mysql'
$env:AUTO_MIGRATE = 'false'
$env:SEED_DEMO = 'false'
$env:ALLOW_DEMO_PROVIDER = 'false'
$env:WHATSAPP_OFFICIAL_ONLY = 'false'
$env:ALLOW_UNOFFICIAL_WHATSAPP = 'true'
$env:MEDIA_STORAGE_PATH = $haituoMediaDir
$env:CRM_BASE_URL = 'http://127.0.0.1:4188'

& $haituoNode --env-file="$haituoApp\.env" "$haituoApp\whatsapp-plugin\dist-server\server\index.js" *> $haituoLog
exit $LASTEXITCODE
