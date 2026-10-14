# backup-skill.ps1 - repackage this skill into a dated zip for safekeeping
# Usage:  powershell.exe -ExecutionPolicy Bypass -File <this file>
# Optional: -Dest "<folder>"         (default: <user>\Documents\SkillBackup)
# Concept: 1----------------------------------------------------------------------
#   Skills live in C:\Users\<user>\.workbuddy\skills\<name>\ which is LOST on a
#   clean OS install. Copy the zip to a cloud-synced folder (OneDrive/Dropbox) or your
#   library so it survives. Runtime leftovers (inbox.json, state.json,
#   screenshot-insert.jpg, msg-*.txt) are excluded - they regenerate on every run.
# -------------------------------------------------------------------------------
param([string]$Dest = (Join-Path $env:USERPROFILE 'Documents\SkillBackup'))

$ErrorActionPreference = 'Stop'
$src    = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$name   = Split-Path -Path $src -Leaf
$stamp  = Get-Date -Format 'yyyyMMdd-HHmm'
$files  = @('SKILL.md','RESTORE.md')
$scripts = @('cdp.js','send.js','watch.js','status.js','setup.ps1','launch-edge.ps1','split-screen.ps1','identity-card.txt')

if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }

$stage = Join-Path $env:TEMP ("$name-stage-" + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
foreach ($f in $files)   { if (Test-Path (Join-Path $src $f)) { Copy-Item (Join-Path $src $f) $stage -Force } }
foreach ($f in $scripts) {
  $p = Join-Path $src "scripts\$f"
  if (Test-Path $p) { Copy-Item $p (Join-Path $stage 'scripts') -Force }
  else { Write-Output "WARN: missing $f" }
}

$zip = Join-Path $Dest "$name-$stamp.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal -ErrorAction Stop 2>$null
Remove-Item $stage -Recurse -Force

$kb = [math]::Round((Get-Item $zip).Length / 1KB, 1)
""
"OK   : $zip  ($kb KB)"
"Tip  : this folder must be cloud-synced (OneDrive), otherwise it is not a real backup."
"Restore: unzip into C:\Users\<user>\.workbuddy\skills\, then run scripts\setup.ps1"
