#Requires -Version 5.1
<#
.SYNOPSIS
  Sync dsh-memory plugin files from the source checkout into a DSH profile
  external-plugin directory, then verify file hashes.

.DESCRIPTION
  Copies runtime + package metadata files only (lib, bin, package.json,
  READMEs). It never touches the memory data directory and does NOT restart
  DeepSeek Harness. A restart is required for DSH to load the new code.

  Default target:
    ~/.dsh/profiles/web/node_modules/@dsh-external/dsh-memory

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/sync-install.ps1 -DryRun
  powershell -ExecutionPolicy Bypass -File scripts/sync-install.ps1 -Backup
#>
param(
  [string]$SourceDir = 'E:\git\github\dsh-Plugin',
  [string]$TargetDir = (Join-Path $env:USERPROFILE '.dsh\profiles\web\node_modules\@dsh-external\dsh-memory'),
  [switch]$DryRun,
  [switch]$Backup
)

$ErrorActionPreference = 'Stop'

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

Write-Host "source: $SourceDir"
Write-Host "target: $TargetDir"

foreach ($relative in $files) {
  $source = Join-Path $SourceDir $relative
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "source file missing: $source"
  }
}

if (-not (Test-Path -LiteralPath $SourceDir -PathType Container)) {
  throw "source directory missing: $SourceDir"
}

if ($DryRun) {
  Write-Host 'dry-run: no files will be changed.'
} else {
  if ($Backup -and (Test-Path -LiteralPath $TargetDir)) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupDir = "$TargetDir.deploy-backup-$stamp"
    Copy-Item -LiteralPath $TargetDir -Destination $backupDir -Recurse -Force
    Write-Host "backup: $backupDir"
  }

  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
  foreach ($relative in $files) {
    $source = Join-Path $SourceDir $relative
    $target = Join-Path $TargetDir $relative
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force
  }
}

$mismatches = @()
foreach ($relative in $files) {
  $source = Join-Path $SourceDir $relative
  $target = Join-Path $TargetDir $relative
  $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    $targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    $state = if ($sourceHash -eq $targetHash) { 'match' } else { 'MISMATCH' }
    if ($state -ne 'match') { $mismatches += $relative }
  } else {
    $targetHash = '<missing>'
    $state = if ($DryRun) { 'would copy' } else { 'MISSING' }
    if (-not $DryRun) { $mismatches += $relative }
  }
  Write-Host ("{0,-28} {1}" -f $relative, $state)
}

if ($mismatches.Count -gt 0) {
  Write-Host 'verification failed; do not restart DSH until resolved.'
  exit 1
}

if ($DryRun) {
  Write-Host 'dry-run complete: files would copy cleanly (source hashes verified).'
} else {
  Write-Host 'sync complete: all target files match the source checkout.'
  Write-Host 'Restart DeepSeek Harness to load the updated plugin. Memory data was not modified.'
}
exit 0
