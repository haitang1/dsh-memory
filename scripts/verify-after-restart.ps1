#Requires -Version 5.1
<#
.SYNOPSIS
  Post-restart verification for a deployed dsh-memory plugin.

.DESCRIPTION
  Verifies every deployed file against the source checkout and runs the
  installed standalone MCP server smoke test. It does not modify anything and
  exits non-zero when a file is missing/mismatched or the smoke test fails.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/verify-after-restart.ps1
#>
param(
  [string]$SourceDir = 'E:\git\github\dsh-Plugin',
  [string]$TargetDir = (Join-Path $env:USERPROFILE '.dsh\profiles\web\node_modules\@dsh-external\dsh-memory'),
  [string]$ApiProxyFile = (Join-Path $env:USERPROFILE '.dsh\profiles\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js'),
  [switch]$SkipMcpSmoke,
  [switch]$SkipWebSettingsCheck
)

$ErrorActionPreference = 'Stop'
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }

$files = @(
  'lib\index.js',
  'lib\store.js',
  'lib\browser.js',
  'lib\client.js',
  'lib\web.js',
  'lib\automation.js',
  'lib\types\index.d.ts',
  'lib\types\client.d.ts',
  'bin\dsh-memory-mcp.mjs',
  'package.json',
  'README.md',
  'README.zh.md',
  'CHANGELOG.md',
  'examples\mcp-config.json'
)

$failed = @()
foreach ($relative in $files) {
  $source = Join-Path $SourceDir $relative
  $target = Join-Path $TargetDir $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "source missing: $source" }
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    $failed += $relative
    Write-Host ("{0,-28} MISSING" -f $relative)
    continue
  }
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
  $state = if ($sourceHash -eq $targetHash) { 'match' } else { 'MISMATCH' }
  if ($state -ne 'match') { $failed += $relative }
  Write-Host ("{0,-28} {1}" -f $relative, $state)
}

if ($failed.Count -gt 0) {
  Write-Host 'verification failed; do not run the plugin until files are re-synced.'
  exit 1
}

Write-Host 'file verification passed.'
Write-Host 'Manual checks after restart: settings namespace `memory`, 14 memory_* tools, memory_stats scopes/lastError.'

if (-not $SkipWebSettingsCheck) {
  $apiProxy = [System.IO.File]::ReadAllText($ApiProxyFile)
  $anchor = $apiProxy.IndexOf('const WEB_SETTINGS_NAMESPACES = [')
  if ($anchor -lt 0) {
    # DSH 0.1.0-rc.7 removed the hard-coded allowlist: the Web settings API
    # serves every registered settings namespace, and the plugin card renders
    # by the namespace key ('memory'). The old patch-web-settings.ps1 no
    # longer applies.
    Write-Host 'web settings allowlist: N/A (rc.7 removed WEB_SETTINGS_NAMESPACES; card keys on the settings namespace).'
  } else {
    $close = $apiProxy.IndexOf('];', $anchor)
    $block = $apiProxy.Substring($anchor, $close - $anchor)
    if ($block -match '"memory"') {
      Write-Host 'web settings allowlist: memory exposed.'
    } else {
      Write-Host 'web settings allowlist: memory NOT exposed; run scripts\patch-web-settings.ps1 and restart DSH.'
      exit 1
    }
  }
}

if (-not $SkipMcpSmoke) {
  $smoke = Join-Path $SourceDir 'scripts\mcp-smoke.mjs'
  & $node $smoke (Join-Path $TargetDir 'bin\dsh-memory-mcp.mjs') 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'MCP smoke test failed.'
    exit 1
  }
  Write-Host 'installed MCP smoke test passed.'
}

exit 0
