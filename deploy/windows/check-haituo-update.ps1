param([string]$ConfigPath = 'C:\HaituoData\updater\config.json')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$updaterRoot = [IO.Path]::GetFullPath((Split-Path -Parent $ConfigPath))
$downloadsRoot = Join-Path $updaterRoot 'downloads'
$logRoot = Join-Path $updaterRoot 'logs'
New-Item -ItemType Directory -Path $downloadsRoot, $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot ('auto-update-' + (Get-Date -Format 'yyyyMMdd') + '.log')
$mutex = [Threading.Mutex]::new($false, 'Global\HaituoAutoUpdate')
if (-not $mutex.WaitOne(0)) { exit 0 }

function Write-HaituoUpdateLog([string]$Message) {
    Add-Content -LiteralPath $logPath -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message) -Encoding UTF8
}
function Remove-HaituoDownloadTree([string]$Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($downloadsRoot).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove an unexpected download path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
try {
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw 'Auto-update config was not found.' }
    $config = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $repository = [string]$config.repository
    if ($repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Configured GitHub repository is invalid.' }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $headers = @{ Accept='application/vnd.github+json'; 'User-Agent'='Haituo-Windows-Auto-Updater/1.0'; 'X-GitHub-Api-Version'='2022-11-28' }
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases/latest" -Headers $headers -TimeoutSec 30
    if ($release.draft -or $release.prerelease) { throw 'Latest release is not a stable release.' }
    $tag = [string]$release.tag_name
    if ($tag -notmatch '^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Latest release tag is invalid.' }
    $zipName = "haituo-cloud-windows-$tag.zip"
    $hashName = "$zipName.sha256"
    $zipAsset = @($release.assets | Where-Object { $_.name -eq $zipName }) | Select-Object -First 1
    $hashAsset = @($release.assets | Where-Object { $_.name -eq $hashName }) | Select-Object -First 1
    if (-not $zipAsset -or -not $hashAsset) { throw "Release $tag does not contain the Windows cloud update assets." }
    $statePath = Join-Path $updaterRoot 'installed-release.json'
    $state = if (Test-Path $statePath) { Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $stateReleaseId = if ($state -and $state.PSObject.Properties['releaseId']) { [string]$state.releaseId } else { '' }
    if ($state -and ($stateReleaseId -eq [string]$release.id -or (-not $stateReleaseId -and [string]$state.version -eq $tag.Substring(1)))) {
        if (-not $stateReleaseId) {
            $state | Add-Member -NotePropertyName releaseId -NotePropertyValue ([string]$release.id) -Force
            $state | Add-Member -NotePropertyName repository -NotePropertyValue $repository -Force
            $temporaryState = "$statePath.$([guid]::NewGuid().ToString('N')).tmp"
            $state | ConvertTo-Json | Set-Content $temporaryState -Encoding UTF8
            Move-Item -LiteralPath $temporaryState -Destination $statePath -Force
        }
        Write-HaituoUpdateLog "Already current: $tag"
        exit 0
    }

    $jobRoot = Join-Path $downloadsRoot ($tag + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $jobRoot | Out-Null
    $zipPath = Join-Path $jobRoot $zipName
    $hashPath = Join-Path $jobRoot $hashName
    Write-HaituoUpdateLog "Downloading $tag"
    Invoke-WebRequest -Uri $zipAsset.browser_download_url -Headers $headers -OutFile $zipPath -UseBasicParsing -TimeoutSec 900
    Invoke-WebRequest -Uri $hashAsset.browser_download_url -Headers $headers -OutFile $hashPath -UseBasicParsing -TimeoutSec 60
    $expected = (Get-Content $hashPath -Raw -Encoding UTF8).Trim()
    if ($expected -notmatch '^([a-fA-F0-9]{64})\s+\*?([^\\/]+)$' -or $Matches[2] -ne $zipName) { throw 'Release checksum file is invalid.' }
    if ((Get-FileHash $zipPath -Algorithm SHA256).Hash -ne $Matches[1].ToUpperInvariant()) { throw 'Downloaded update checksum does not match.' }
    if ((Get-Item $zipPath).Length -gt 536870912) { throw 'Downloaded update is unexpectedly large.' }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        if ($archive.Entries.Count -gt 20000) { throw 'Update archive contains too many entries.' }
        [long]$expandedSize = 0
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName.Replace('\','/')
            if ([IO.Path]::IsPathRooted($name) -or $name -match '(^|/)\.\.(/|$)') { throw 'Update archive contains an unsafe path.' }
            $expandedSize += $entry.Length
            if ($expandedSize -gt 1073741824) { throw 'Update archive expands beyond the safety limit.' }
        }
    } finally { $archive.Dispose() }
    $extractRoot = Join-Path $jobRoot 'release'
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot
    $installer = Join-Path $extractRoot 'install-haituo-update.ps1'
    if (-not (Test-Path $installer -PathType Leaf)) { throw 'Update installer is missing.' }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -ReleaseRoot $extractRoot 2>&1 | ForEach-Object { Write-HaituoUpdateLog ([string]$_) }
    if ($LASTEXITCODE -ne 0) { throw "Update installer exited with code $LASTEXITCODE." }
    $newState = @{ version=$tag.Substring(1); releaseId=[string]$release.id; installedAt=[DateTime]::UtcNow.ToString('o'); repository=$repository }
    $temporaryState = "$statePath.$([guid]::NewGuid().ToString('N')).tmp"
    $newState | ConvertTo-Json | Set-Content $temporaryState -Encoding UTF8
    Move-Item -LiteralPath $temporaryState -Destination $statePath -Force
    Write-HaituoUpdateLog "Installed $tag successfully"
    Remove-HaituoDownloadTree $jobRoot
} catch {
    Write-HaituoUpdateLog ('ERROR: ' + $_.Exception.Message)
    exit 1
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
