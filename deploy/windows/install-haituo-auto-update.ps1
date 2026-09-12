param(
    [Parameter(Mandatory=$true)][string]$Repository,
    [ValidateRange(5,1440)][int]$IntervalMinutes = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this installer from an Administrator PowerShell window.' }
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Repository must use owner/name format.' }
$script = 'C:\Haituo\deploy\windows\check-haituo-update.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'Install the latest Haituo application update before enabling auto-update.' }
$updaterRoot = 'C:\HaituoData\updater'
New-Item -ItemType Directory -Path $updaterRoot -Force | Out-Null
$configPath = Join-Path $updaterRoot 'config.json'
$temporaryConfig = "$configPath.$([guid]::NewGuid().ToString('N')).tmp"
@{ repository=$Repository; channel='stable'; intervalMinutes=$IntervalMinutes; configuredAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content $temporaryConfig -Encoding UTF8
Move-Item -LiteralPath $temporaryConfig -Destination $configPath -Force

$taskName = 'HaituoAutoUpdate'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and (($existing.Actions | ForEach-Object { $_.Arguments }) -join ' ') -notlike '*C:\Haituo\deploy\windows\check-haituo-update.ps1*') { throw 'A different task already uses the name HaituoAutoUpdate.' }
$arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Haituo\deploy\windows\check-haituo-update.ps1"'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory 'C:\Haituo'
$startup = New-ScheduledTaskTrigger -AtStartup
$repeated = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($startup,$repeated) -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Haituo auto-update enabled for $Repository every $IntervalMinutes minutes." -ForegroundColor Green
Write-Host "Logs: C:\HaituoData\updater\logs"
