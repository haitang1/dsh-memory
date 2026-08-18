#Requires -Version 5.1
<#
.SYNOPSIS
  Stop the DeepSeek Harness web process and start it with stdout/stderr
  redirected to $DSH_HOME/logs/dsh-<ts>.out.log / .err.log, then wait for
  the web server. Use -WhatIf first.

  Unlike restart-dsh.ps1, this script does NOT sync the dsh-memory plugin
  and does NOT run post-restart verification — it is the diagnostic launch
  path for capturing startup errors.
#>
param(
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [string]$NpxCli = 'C:\Program Files\nodejs\node_modules\npm\bin\npx-cli.js',
  [string]$LogDir = 'E:\CodexData\.dsh\logs',
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

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $LogDir "dsh-$ts.out.log"
$err = Join-Path $LogDir "dsh-$ts.err.log"

if ($WhatIf) {
  Write-Host "WhatIf: would start: $NodeExe `"$NpxCli`" @deepseek-ai/dsh web"
  Write-Host "WhatIf: would redirect stdout -> $out"
  Write-Host "WhatIf: would redirect stderr -> $err"
  exit 0
}

Start-Sleep -Seconds 3
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Start-Process -FilePath $NodeExe -ArgumentList @("`"$NpxCli`"", '@deepseek-ai/dsh', 'web') `
  -RedirectStandardOutput $out -RedirectStandardError $err

Write-Host "started @deepseek-ai/dsh web; stdout -> $out; stderr -> $err"
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3080' -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) {
      Write-Host "web server up (HTTP 200) after $((($i + 1) * 2))s"
      exit 0
    }
  } catch {
    # not up yet
  }
}
Write-Host 'web server did not answer within 60s — check the log files.'
exit 2
