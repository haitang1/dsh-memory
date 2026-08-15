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
  [switch]$SkipMcpSmoke
)

$ErrorActionPreference = 'Stop'
$node = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }

$files = @(
  'lib\index.js',
  'lib\store.js',
  'lib\browser.js',
  'lib\types\index.d.ts',
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
