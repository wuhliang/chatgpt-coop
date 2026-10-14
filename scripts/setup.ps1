# setup.ps1 - chatgpt-coop environment bootstrap (run OUTSIDE sandbox)
#   powershell.exe -ExecutionPolicy Bypass -File <this file>
#
# Does:
#   1. locate Microsoft Edge
#   2. probe the local proxy port (v2rayN/Clash/... typical ports)
#   3. write/refresh  ~\.agent-browser\edge-debug.cmd
#   4. create a desktop shortcut on the REAL desktop
#      ([Environment]::GetFolderPath('Desktop') - it may be redirected, e.g. D:\Users\Desktop)
#   5. report whether the CDP debug port 9222 is already up
#   6. print a usage card
#
# ASCII-only output: PowerShell 5.1 reads .ps1 as ANSI unless it has a UTF-8 BOM,
# so non-ASCII literals get mangled and can break syntax.

$ErrorActionPreference = 'Continue'
$LauncherDir = Join-Path $env:USERPROFILE '.agent-browser'
$Launcher    = Join-Path $LauncherDir 'edge-debug.cmd'
$ProfileDir  = Join-Path $LauncherDir 'edge-profile'

function Test-Port($p) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $p); if ($c.Connected) { $c.Close(); return $true } }
  catch { }
  try { $c.Close() } catch { }
  return $false
}

"=== chatgpt-coop bootstrap ==="

# 1. Edge
$edge = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { "FAIL: Microsoft Edge not found"; exit 1 }
"Edge      : $edge"

# 2. proxy
$proxy = $null
foreach ($p in @(10808, 10809, 7890, 7891, 1080, 8080, 20171)) {
  if (Test-Port $p) { $proxy = $p; break }
}
if ($proxy) { "Proxy     : socks5://127.0.0.1:$proxy" } else { "Proxy     : none detected (launcher will omit --proxy-server)" }

# 3. launcher
if (-not (Test-Path $LauncherDir)) { New-Item -ItemType Directory -Path $LauncherDir -Force | Out-Null }
$proxyArg = if ($proxy) { " --proxy-server=`"socks5://127.0.0.1:$proxy`"" } else { "" }
$cmd = "@echo off`r`n" +
       "start `"`" `"$edge`" --remote-debugging-port=9222 --user-data-dir=`"$ProfileDir`"" +
       "$proxyArg --no-first-run --no-default-browser-check `"https://chatgpt.com/`"`r`n"
[System.IO.File]::WriteAllText($Launcher, $cmd, [System.Text.Encoding]::ASCII)
"Launcher  : $Launcher (written)"

# 4. desktop shortcut (use the REAL desktop - it can be redirected)
$desktop = [Environment]::GetFolderPath('Desktop')
"Desktop   : $desktop"
$lnk = Join-Path $desktop 'ChatGPT-Coop.lnk'
$made = $false
try {
  $sh = New-Object -ComObject WScript.Shell
  $sc = $sh.CreateShortcut($lnk)
  $sc.TargetPath       = $Launcher
  $sc.WorkingDirectory = $LauncherDir
  $sc.Description      = 'Start Edge with remote debugging port 9222 and open ChatGPT'
  $sc.IconLocation     = "$edge,0"
  $sc.Save()
  $made = $true
} catch { }
if ($made -and (Test-Path $lnk)) {
  "Shortcut  : $lnk"
} else {
  # COM unavailable (blocked) -> fall back to a plain double-clickable .cmd
  $alt = Join-Path $desktop 'ChatGPT-Coop.cmd'
  Copy-Item $Launcher $alt -Force
  "Shortcut  : COM blocked -> fallback $alt"
}

# 5. CDP status
if (Test-Port 9222) { "CDP 9222  : RUNNING (Edge debug instance is up)" }
else                { "CDP 9222  : NOT RUNNING (double-click the desktop shortcut to start)" }

# 6. usage card
""
"============================================================"
" chatgpt-coop is deployed. How to use it:"
"   1. Double-click desktop shortcut: ChatGPT-Coop"
"      (launches Edge with debug port 9222, profile persists -> login once)"
"   2. Log in to ChatGPT in that window (only needed the first time)"
"   3. Tell me: start ChatGPT collaboration"
"      -> I split-screen, send the identity card, then run the loop"
"   Say 'stop' any time to disarm the loop."
"============================================================"
