#Requires -Version 5.1
<#
.SYNOPSIS
  Patch the deployed @deepseek-ai/dsh-host-apiproxy package so the dsh-memory
  settings namespace is served to the DSH Web settings page.

.DESCRIPTION
  The Web configuration client only serves namespaces listed in the hard-coded
  WEB_SETTINGS_NAMESPACES allowlist inside dsh-host-apiproxy/lib/index.js
  (the package comment says exposing a section is a decision made in that
  package). This script inserts "memory" into that list.

  Idempotent: exits 0 without writing when "memory" is already listed. Backs
  up the target file once per day before the first change and re-checks the
  patched file with `node --check` (rolling back on failure).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/patch-web-settings.ps1 -WhatIf
  powershell -ExecutionPolicy Bypass -File scripts/patch-web-settings.ps1
#>
param(
  [string]$TargetFile = (Join-Path $env:USERPROFILE '.dsh\profiles\node_modules\@deepseek-ai\dsh-host-apiproxy\lib\index.js'),
  [string]$NodeExe = 'C:\Program Files\nodejs\node.exe',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $TargetFile -PathType Leaf)) {
  throw "target not found: $TargetFile"
}

$content = [System.IO.File]::ReadAllText($TargetFile)

$anchor = 'const WEB_SETTINGS_NAMESPACES = ['
$anchorIndex = $content.IndexOf($anchor)
if ($anchorIndex -lt 0) {
  throw 'WEB_SETTINGS_NAMESPACES anchor not found; the package layout may have changed.'
}

$closeIndex = $content.IndexOf('];', $anchorIndex)
if ($closeIndex -lt 0) {
  throw 'WEB_SETTINGS_NAMESPACES closing bracket not found.'
}

$arrayBlock = $content.Substring($anchorIndex, $closeIndex - $anchorIndex)

if ($arrayBlock -match '"memory"') {
  Write-Host 'patch already applied: "memory" is listed in WEB_SETTINGS_NAMESPACES.'
  exit 0
}

$entryAnchor = '"web-search-deepseek"'
$entryIndex = $arrayBlock.IndexOf($entryAnchor)
if ($entryIndex -lt 0) {
  throw 'could not locate the "web-search-deepseek" entry inside WEB_SETTINGS_NAMESPACES.'
}

# Split right after the anchor entry; the following content starts with the
# line ending of that entry's line. Extract its indentation from the tail.
$before = $arrayBlock.Substring(0, $entryIndex + $entryAnchor.Length)
$tail = $arrayBlock.Substring($entryIndex + $entryAnchor.Length)

$newlineMatch = [System.Text.RegularExpressions.Regex]::Match($tail, '\r?\n')
if (-not $newlineMatch.Success) {
  throw 'unexpected end of line after "web-search-deepseek" entry.'
}

$lineEnding = $newlineMatch.Value
$afterEntry = $tail.Substring($newlineMatch.Length)

# Indentation of the anchor entry's own line (e.g. a single tab).
$lineStart = $arrayBlock.LastIndexOf("`n", $entryIndex) + 1
$indent = $arrayBlock.Substring($lineStart, $entryIndex - $lineStart)

$newBlock = $before + ',' + $lineEnding + $indent + '"memory"' + $lineEnding + $afterEntry
$newContent = $content.Substring(0, $anchorIndex) + $newBlock + $content.Substring($closeIndex)

if ($WhatIf) {
  Write-Host 'WhatIf: would patch WEB_SETTINGS_NAMESPACES to include "memory".'
  exit 0
}

$backup = "$TargetFile.bak-$(Get-Date -Format 'yyyyMMdd')"
if (-not (Test-Path -LiteralPath $backup)) {
  Copy-Item -LiteralPath $TargetFile -Destination $backup
  Write-Host "backup written: $backup"
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($TargetFile, $newContent, $utf8)

if (Test-Path -LiteralPath $NodeExe) {
  & $NodeExe --check $TargetFile
  if ($LASTEXITCODE -ne 0) {
    Copy-Item -LiteralPath $backup -Destination $TargetFile -Force
    throw 'patched file failed node --check; original restored.'
  }
  Write-Host 'patched file passes node --check.'
} else {
  Write-Host 'node not found; skipping syntax check.'
}

Write-Host 'patch applied: "memory" added to WEB_SETTINGS_NAMESPACES. Restart DSH to take effect.'
exit 0
