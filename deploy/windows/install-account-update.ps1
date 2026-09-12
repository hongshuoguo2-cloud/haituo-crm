$ErrorActionPreference = 'Stop'
# Run on the user's cloud server after extracting the release archive.
$haituoApp = 'C:\Haituo'
$haituoData = 'C:\HaituoData'
$haituoTaskName = 'HaituoWeb'
$haituoPayload = Join-Path $PSScriptRoot 'payload'
$haituoManifest = Get-Content (Join-Path $PSScriptRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$haituoIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$haituoIdentity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this installer from an Administrator PowerShell window.' }
if (-not (Test-Path -LiteralPath "$haituoApp\.env")) { throw 'Existing C:\Haituo\.env was not found.' }
if ((Get-Content "$haituoApp\.env" | Where-Object { $_ -match '^PORT=' }) -ne 'PORT=4188') { throw 'Expected PORT=4188. No changes made.' }
$haituoNode = (Get-Command node.exe).Source
function Resolve-HaituoChild([string]$base, [string]$relative) {
    $prefix = [IO.Path]::GetFullPath($base).TrimEnd('\') + '\'
    $result = [IO.Path]::GetFullPath((Join-Path $base $relative))
    if (-not $result.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid release path.' }
    if ($relative -match '(^|[\\/])(\.env[^\\/]*|node_modules|\.git)([\\/]|$)') { throw 'Release must not contain credentials or dependencies.' }
    return $result
}
foreach ($entry in $haituoManifest.files) {
    $source = Resolve-HaituoChild $haituoPayload $entry.path
    $null = Resolve-HaituoChild $haituoApp $entry.path
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256) { throw ('Release verification failed: ' + $entry.path) }
}
$haituoOldTask = Get-ScheduledTask -TaskName $haituoTaskName -ErrorAction SilentlyContinue
if ($haituoOldTask -and (($haituoOldTask.Actions | ForEach-Object { $_.Arguments }) -join ' ') -notlike '*C:\Haituo\scripts\start-haituo-cloud.ps1*') { throw 'A different task already uses the name HaituoWeb. No changes made.' }
$haituoPids = @(Get-NetTCPConnection -State Listen -LocalPort 4188 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($haituoPid in $haituoPids) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$haituoPid"
    $command = ([string]$process.CommandLine).Replace('\','/').Replace('"','').ToLowerInvariant()
    if ($process.Name -ne 'node.exe' -or -not $command.Contains('c:/haituo/.env') -or -not $command.Contains('backend/dist/server.js')) { throw 'Port 4188 belongs to an unexpected process. No changes made.' }
}
$haituoBackup = Join-Path $haituoData ('update-backups\accounts-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $haituoBackup | Out-Null
foreach ($entry in $haituoManifest.files) {
    $target = Resolve-HaituoChild $haituoApp $entry.path
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $backup = Resolve-HaituoChild $haituoBackup $entry.path
        New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
        Copy-Item -LiteralPath $target -Destination $backup
    }
}
if ($haituoOldTask) { Export-ScheduledTask -TaskName $haituoTaskName | Set-Content (Join-Path $haituoBackup 'previous-task.xml') -Encoding UTF8; Stop-ScheduledTask -TaskName $haituoTaskName }
foreach ($haituoPid in $haituoPids) { Stop-Process -Id $haituoPid -Force -ErrorAction SilentlyContinue }
try {
    foreach ($entry in $haituoManifest.files) {
        $target = Resolve-HaituoChild $haituoApp $entry.path
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath (Resolve-HaituoChild $haituoPayload $entry.path) -Destination $target -Force
    }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "C:\Haituo\scripts\start-haituo-cloud.ps1" -NodePath "' + $haituoNode + '"') -WorkingDirectory $haituoApp
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
    Register-ScheduledTask -TaskName $haituoTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $haituoTaskName
    $ready = $false
    for ($i=0; $i -lt 90; $i++) {
        try { $response = Invoke-WebRequest 'http://127.0.0.1:4188/api/health' -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { $ready=$true; break } } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Application health check timed out. See C:\HaituoData\logs.' }
    Write-Host 'Haituo account update installed. Automatic startup is enabled.' -ForegroundColor Green
    Write-Host 'Open https://demo.linqiagent.cn and press Ctrl+F5.'
    Write-Host ('Backup: ' + $haituoBackup)
} catch {
    Stop-ScheduledTask -TaskName $haituoTaskName -ErrorAction SilentlyContinue
    foreach ($entry in $haituoManifest.files) {
        $backup = Resolve-HaituoChild $haituoBackup $entry.path
        if (Test-Path -LiteralPath $backup -PathType Leaf) { Copy-Item -LiteralPath $backup -Destination (Resolve-HaituoChild $haituoApp $entry.path) -Force }
    }
    if ($haituoOldTask) {
        Register-ScheduledTask -TaskName $haituoTaskName -Xml (Get-Content (Join-Path $haituoBackup 'previous-task.xml') -Raw) -Force | Out-Null
        Start-ScheduledTask -TaskName $haituoTaskName
    }
    throw ('Update failed; previous program files restored. Backup: ' + $haituoBackup + '. ' + $_.Exception.Message)
}
