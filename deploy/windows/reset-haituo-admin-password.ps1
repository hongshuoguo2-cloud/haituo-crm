Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this password reset from an Administrator PowerShell window.'
}

$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$envFile = Join-Path $appRoot '.env'
$resetScript = Join-Path $appRoot 'scripts\reset-haituo-admin-password.mjs'
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw 'C:\Haituo\.env was not found.' }
if (-not (Test-Path -LiteralPath $resetScript -PathType Leaf)) { throw 'The administrator password reset helper was not found.' }

$first = Read-Host 'Enter a new administrator password (12-128 characters)' -AsSecureString
$second = Read-Host 'Enter the same password again' -AsSecureString
$firstPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
$secondPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
try {
    $firstText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($firstPointer)
    $secondText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secondPointer)
    if ($firstText.Length -lt 12 -or $firstText.Length -gt 128) { throw 'Password must contain 12 to 128 characters.' }
    if ($firstText -cne $secondText) { throw 'The two passwords do not match.' }
    $env:HAITUO_NEW_ADMIN_PASSWORD = $firstText
    Push-Location -LiteralPath $appRoot
    try {
        & $node "--env-file=$envFile" $resetScript
        if ($LASTEXITCODE -ne 0) { throw 'The administrator password reset helper failed.' }
    } finally {
        Pop-Location
    }
} finally {
    Remove-Item Env:\HAITUO_NEW_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    if ($null -ne $firstPointer) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($firstPointer) }
    if ($null -ne $secondPointer) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secondPointer) }
    $firstText = $null
    $secondText = $null
}

$taskName = 'HaituoWeb'
if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) { throw 'HaituoWeb scheduled task was not found.' }
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName $taskName
$healthy = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    try {
        if ((Invoke-WebRequest 'http://127.0.0.1:4188/api/health' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 2
}
if (-not $healthy) { throw 'Password changed, but Haituo did not become healthy after restart.' }
Write-Host 'Administrator password changed and Haituo restarted successfully.' -ForegroundColor Green
