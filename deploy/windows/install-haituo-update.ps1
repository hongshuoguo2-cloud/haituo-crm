param([string]$ReleaseRoot = $PSScriptRoot)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$haituoApp = 'C:\Haituo'
$haituoData = 'C:\HaituoData'
$haituoTaskName = 'HaituoWeb'
$haituoPayload = Join-Path $ReleaseRoot 'payload'
$haituoManifestPath = Join-Path $ReleaseRoot 'manifest.json'
$haituoReleasePath = Join-Path $ReleaseRoot 'release.json'
$haituoIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$haituoIdentity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this updater from an Administrator PowerShell window.' }
if (-not (Test-Path -LiteralPath "$haituoApp\.env" -PathType Leaf)) { throw 'Existing C:\Haituo\.env was not found.' }
if (-not (Test-Path -LiteralPath $haituoManifestPath -PathType Leaf)) { throw 'Update manifest was not found.' }

$haituoManifest = Get-Content $haituoManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$haituoRelease = Get-Content $haituoReleasePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($haituoManifest.product -ne 'haituo-cloud-windows' -or $haituoRelease.product -ne 'haituo-cloud-windows') { throw 'This is not a Haituo cloud Windows update.' }
if ($haituoManifest.version -ne $haituoRelease.version -or $haituoManifest.version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Update version is invalid.' }
if ($haituoManifest.databaseCompatibility -ne 'backward-compatible') { throw 'This update is not marked as backward-compatible.' }

function Resolve-HaituoChild([string]$Base, [string]$Relative) {
    if ([string]::IsNullOrWhiteSpace($Relative) -or [IO.Path]::IsPathRooted($Relative)) { throw 'Invalid release path.' }
    $prefix = [IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
    $result = [IO.Path]::GetFullPath((Join-Path $Base $Relative))
    if (-not $result.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release path escapes its expected directory.' }
    if ($Relative -match '(^|[\\/])(\.env[^\\/]*|node_modules|\.git|\.svn)([\\/]|$)') { throw 'Release contains a forbidden path.' }
    return $result
}

function Get-HaituoLockChanged([string]$Relative) {
    $source = Resolve-HaituoChild $haituoPayload $Relative
    $target = Resolve-HaituoChild $haituoApp $Relative
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { return $true }
    return (Get-FileHash $source -Algorithm SHA256).Hash -ne (Get-FileHash $target -Algorithm SHA256).Hash
}

function Remove-HaituoDependencyTree([string]$Path, [string]$ExpectedParent) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $parent = [IO.Path]::GetFullPath($ExpectedParent).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($parent, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -ne 'node_modules') { throw 'Refusing to remove an unexpected dependency directory.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}

function Backup-HaituoDatabase([string]$BackupRoot) {
    $databaseLine = Get-Content "$haituoApp\.env" -Encoding UTF8 | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
    if (-not $databaseLine) { throw 'DATABASE_URL was not found; database backup cannot continue.' }
    $databaseUri = [Uri]($databaseLine.Substring('DATABASE_URL='.Length))
    if ($databaseUri.Scheme -ne 'mysql') { throw 'DATABASE_URL is not a MySQL URL.' }
    $databaseName = $databaseUri.AbsolutePath.Trim('/')
    if ($databaseName -notmatch '^[A-Za-z0-9_]+$') { throw 'Database name is unsafe.' }
    $separator = $databaseUri.UserInfo.IndexOf(':')
    if ($separator -lt 1) { throw 'DATABASE_URL credentials are invalid.' }
    $databaseUser = [Uri]::UnescapeDataString($databaseUri.UserInfo.Substring(0, $separator))
    $databasePassword = [Uri]::UnescapeDataString($databaseUri.UserInfo.Substring($separator + 1))
    $databasePort = if ($databaseUri.Port -gt 0) { $databaseUri.Port } else { 3306 }
    $dumpExe = @(
        'C:\mysql\mysql-8.4.9-winx64\bin\mysqldump.exe',
        (Get-Command mysqldump.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
    if (-not $dumpExe) { throw 'mysqldump.exe was not found; update stopped before changing files.' }
    $sqlPath = Join-Path $BackupRoot 'database-before-update.sql'
    $errorPath = Join-Path $BackupRoot 'database-backup.stderr.log'
    $oldPassword = $env:MYSQL_PWD
    try {
        $env:MYSQL_PWD = $databasePassword
        $arguments = @(
            '--single-transaction', '--quick', '--skip-lock-tables', '--no-tablespaces', '--routines', '--events', '--hex-blob',
            '--default-character-set=utf8mb4', "--host=$($databaseUri.Host)", "--port=$databasePort",
            "--user=$databaseUser", $databaseName
        )
        $process = Start-Process -FilePath $dumpExe -ArgumentList $arguments -PassThru -Wait -WindowStyle Hidden -RedirectStandardOutput $sqlPath -RedirectStandardError $errorPath
        if ($process.ExitCode -ne 0 -or -not (Test-Path $sqlPath) -or (Get-Item $sqlPath).Length -lt 256) { throw 'Database backup failed; update stopped before changing files.' }
    } finally {
        $env:MYSQL_PWD = $oldPassword
    }
    $source = [IO.File]::OpenRead($sqlPath)
    $gzipPath = "$sqlPath.gz"
    $target = [IO.File]::Create($gzipPath)
    $gzip = [IO.Compression.GZipStream]::new($target, [IO.Compression.CompressionLevel]::Optimal)
    try { $source.CopyTo($gzip) } finally { $gzip.Dispose(); $target.Dispose(); $source.Dispose() }
    Remove-Item -LiteralPath $sqlPath -Force
    return $gzipPath
}

$required = @('backend/dist/server.js', 'frontend/dist/index.html', 'package-lock.json', 'whatsapp-plugin/package-lock.json', 'scripts/start-haituo-cloud.ps1')
$manifestPaths = @($haituoManifest.files | ForEach-Object { [string]$_.path })
foreach ($item in $required) { if ($manifestPaths -notcontains $item) { throw "Update is missing required file: $item" } }
foreach ($entry in $haituoManifest.files) {
    $source = Resolve-HaituoChild $haituoPayload ([string]$entry.path)
    $null = Resolve-HaituoChild $haituoApp ([string]$entry.path)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Release file is missing: $($entry.path)" }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne ([string]$entry.sha256).ToUpperInvariant()) { throw "Release verification failed: $($entry.path)" }
}

$rootDependenciesChanged = Get-HaituoLockChanged 'package-lock.json'
$pluginDependenciesChanged = Get-HaituoLockChanged 'whatsapp-plugin/package-lock.json'
$haituoNode = (Get-Command node.exe -ErrorAction Stop).Source
$haituoNpm = if ($rootDependenciesChanged -or $pluginDependenciesChanged) { (Get-Command npm.cmd -ErrorAction Stop).Source } else { $null }
function Register-HaituoWebTask {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Haituo\scripts\start-haituo-cloud.ps1" -NodePath "' + $haituoNode + '"') -WorkingDirectory $haituoApp
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable
    Register-ScheduledTask -TaskName $haituoTaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
}
$haituoOldTask = Get-ScheduledTask -TaskName $haituoTaskName -ErrorAction SilentlyContinue
if ($haituoOldTask -and (($haituoOldTask.Actions | ForEach-Object { $_.Arguments }) -join ' ') -notlike '*C:\Haituo\scripts\start-haituo-cloud.ps1*') { throw 'A different task already uses the name HaituoWeb.' }
$haituoPids = @(Get-NetTCPConnection -State Listen -LocalPort 4188 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($haituoPid in $haituoPids) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$haituoPid"
    $command = ([string]$process.CommandLine).Replace('\','/').Replace('"','').ToLowerInvariant()
    if ($process.Name -ne 'node.exe' -or -not $command.Contains('c:/haituo/.env') -or -not $command.Contains('backend/dist/server.js')) { throw 'Port 4188 belongs to an unexpected process.' }
}

$backup = Join-Path $haituoData ('update-backups\v' + $haituoManifest.version + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,6))
New-Item -ItemType Directory -Path $backup | Out-Null
$databaseBackup = Backup-HaituoDatabase $backup
$createdFiles = [Collections.Generic.List[string]]::new()
foreach ($entry in $haituoManifest.files) {
    $target = Resolve-HaituoChild $haituoApp ([string]$entry.path)
    if (Test-Path -LiteralPath $target -PathType Leaf) {
        $backupFile = Resolve-HaituoChild $backup ([string]$entry.path)
        New-Item -ItemType Directory -Path (Split-Path -Parent $backupFile) -Force | Out-Null
        Copy-Item -LiteralPath $target -Destination $backupFile
    } else { $createdFiles.Add($target) }
}
if ($haituoOldTask) { Export-ScheduledTask -TaskName $haituoTaskName | Set-Content (Join-Path $backup 'previous-task.xml') -Encoding UTF8; Stop-ScheduledTask -TaskName $haituoTaskName }
foreach ($haituoPid in $haituoPids) { Stop-Process -Id $haituoPid -Force -ErrorAction SilentlyContinue }

$rootModules = Join-Path $haituoApp 'node_modules'
$pluginModules = Join-Path $haituoApp 'whatsapp-plugin\node_modules'
$rootModulesBackup = Join-Path $backup 'root-node_modules'
$pluginModulesBackup = Join-Path $backup 'plugin-node_modules'
try {
    if ($rootDependenciesChanged -and (Test-Path $rootModules)) { Move-Item -LiteralPath $rootModules -Destination $rootModulesBackup }
    if ($pluginDependenciesChanged -and (Test-Path $pluginModules)) { Move-Item -LiteralPath $pluginModules -Destination $pluginModulesBackup }
    foreach ($entry in $haituoManifest.files) {
        $target = Resolve-HaituoChild $haituoApp ([string]$entry.path)
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath (Resolve-HaituoChild $haituoPayload ([string]$entry.path)) -Destination $target -Force
    }
    if ($rootDependenciesChanged) {
        $env:PUPPETEER_SKIP_DOWNLOAD = 'true'
        $dependencyProcess = Start-Process -FilePath $haituoNpm -ArgumentList @('ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund') -WorkingDirectory $haituoApp -PassThru -Wait -WindowStyle Hidden
        if ($dependencyProcess.ExitCode -ne 0) { throw 'Root production dependency installation failed.' }
    }
    if ($pluginDependenciesChanged) {
        $pluginProcess = Start-Process -FilePath $haituoNpm -ArgumentList @('ci','--omit=dev','--ignore-scripts','--workspaces=false','--no-audit','--no-fund') -WorkingDirectory (Join-Path $haituoApp 'whatsapp-plugin') -PassThru -Wait -WindowStyle Hidden
        if ($pluginProcess.ExitCode -ne 0) { throw 'Communication production dependency installation failed.' }
    }
    Register-HaituoWebTask
    Start-ScheduledTask -TaskName $haituoTaskName
    $ready = $false
    for ($i=0; $i -lt 90; $i++) {
        try { if ((Invoke-WebRequest 'http://127.0.0.1:4188/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready=$true; break } } catch {}
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Application health check timed out.' }
    $stateDir = Join-Path $haituoData 'updater'
    New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    @{ version=[string]$haituoManifest.version; installedAt=[DateTime]::UtcNow.ToString('o'); backup=$backup } | ConvertTo-Json | Set-Content (Join-Path $stateDir 'installed-release.json') -Encoding UTF8
    Write-Host "Haituo v$($haituoManifest.version) installed successfully." -ForegroundColor Green
    Write-Host "Database backup: $databaseBackup"
    Write-Host "File backup: $backup"
} catch {
    Stop-ScheduledTask -TaskName $haituoTaskName -ErrorAction SilentlyContinue
    foreach ($createdFile in $createdFiles) { if (Test-Path -LiteralPath $createdFile -PathType Leaf) { Remove-Item -LiteralPath $createdFile -Force } }
    foreach ($entry in $haituoManifest.files) {
        $backupFile = Resolve-HaituoChild $backup ([string]$entry.path)
        if (Test-Path -LiteralPath $backupFile -PathType Leaf) { Copy-Item -LiteralPath $backupFile -Destination (Resolve-HaituoChild $haituoApp ([string]$entry.path)) -Force }
    }
    if ($rootDependenciesChanged -and (Test-Path $rootModulesBackup)) { Remove-HaituoDependencyTree $rootModules $haituoApp; Move-Item -LiteralPath $rootModulesBackup -Destination $rootModules }
    if ($pluginDependenciesChanged -and (Test-Path $pluginModulesBackup)) { Remove-HaituoDependencyTree $pluginModules (Join-Path $haituoApp 'whatsapp-plugin'); Move-Item -LiteralPath $pluginModulesBackup -Destination $pluginModules }
    if ($haituoOldTask) {
        Register-ScheduledTask -TaskName $haituoTaskName -Xml (Get-Content (Join-Path $backup 'previous-task.xml') -Raw) -Force | Out-Null
    } else {
        $launcherTarget = Join-Path $haituoApp 'scripts\start-haituo-cloud.ps1'
        New-Item -ItemType Directory -Path (Split-Path -Parent $launcherTarget) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $haituoPayload 'scripts\start-haituo-cloud.ps1') -Destination $launcherTarget -Force
        Register-HaituoWebTask
    }
    Start-ScheduledTask -TaskName $haituoTaskName
    throw "Update failed and previous files were restored. Backup: $backup. $($_.Exception.Message)"
}
