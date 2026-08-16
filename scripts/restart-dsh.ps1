#Requires -Version 5.1
<#
.SYNOPSIS
  Restart the DeepSeek Harness web process and run post-restart verification.

.DESCRIPTION
  Finds the node processes whose command line contains `@deepseek-ai/dsh`
  (the npx wrapper and the actual dsh web bin), stops them, starts the same
  `npx @deepseek-ai/dsh web` command detached, waits for the web server, then
  runs scripts/verify-after-restart.ps1.

  This closes the running DSH session. Use -WhatIf first:
    powershell -ExecutionPolicy Bypass -File scripts/restart-dsh.ps1 -WhatIf
#>
param(
  [string]$SourceDir = 'E:\git\github\dsh-Plugin',
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [string]$NpxCli = 'C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js',
  [switch]$SkipVerify,
  [switch]$SkipSync,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$targets = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match '@deepseek-ai[\\/]dsh' } |
  Select-Object ProcessId, CommandLine

if ($targets.Count -eq 0) {
  Write-Host 'No @deepseek-ai/dsh node processes found; nothing to stop.'
} else {
  foreach ($target in $targets) {
    Write-Host ("stop PID {0}: {1}" -f $target.ProcessId, $target.CommandLine)
    if (-not $WhatIf) { Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

if ($WhatIf) {
  Write-Host "WhatIf: would start: $NodeExe `"$NpxCli`" @deepseek-ai/dsh web"
  if (-not $SkipSync) { Write-Host 'WhatIf: would run sync-install.ps1 -Backup before starting' }
  if (-not $SkipVerify) { Write-Host "WhatIf: would run verify-after-restart.ps1" }
  exit 0
}

Start-Sleep -Seconds 3

# Sync the installed plugin copy AFTER stopping (the running process locks the
# module files) and BEFORE starting, so the reloaded process runs the latest
# code. This avoids the stale-load loop of restarting before a successful sync.
if (-not $SkipSync) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $SourceDir 'scripts\sync-install.ps1') -Backup -SourceDir $SourceDir
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'sync failed; aborting restart.'
    exit 1
  }
}

Start-Process -FilePath $NodeExe -ArgumentList @("`"$NpxCli`"", '@deepseek-ai/dsh', 'web') -WorkingDirectory $SourceDir
Write-Host 'started @deepseek-ai/dsh web; waiting 20 seconds...'
Start-Sleep -Seconds 20

if (-not $SkipVerify) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $SourceDir 'scripts\verify-after-restart.ps1') -SourceDir $SourceDir
  exit $LASTEXITCODE
}
exit 0
