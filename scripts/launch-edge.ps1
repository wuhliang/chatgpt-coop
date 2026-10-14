# launch-edge.ps1 - start the debug Edge instance so it PERSISTS (run OUTSIDE sandbox)
#
# CRITICAL lesson (verified 2026-10-13 21:53):
#   Launching msedge.exe directly (CreateProcess / Start-Process / WMI / schtasks)
#   starts a browser that is REAPED as soon as the launching tool call ends.
#   Launching the shortcut THROUGH explorer.exe works and persists, because the
#   parent becomes the always-running desktop shell instead of the ephemeral
#   tool-call process:
#       Start-Process explorer.exe "<path-to-lnk>"
#
# exit 0 = CDP port 9222 is up; exit 1 = still down after the wait window.
# ASCII-only output (PS 5.1 reads .ps1 as ANSI unless UTF-8 BOM).

$LauncherDir = Join-Path $env:USERPROFILE '.agent-browser'
$Launcher    = Join-Path $LauncherDir 'edge-debug.cmd'
$Desktop     = [Environment]::GetFolderPath('Desktop')   # may be redirected, e.g. D:\Users\Desktop
$Lnk         = Join-Path $Desktop 'ChatGPT-Coop.lnk'

function Test-Port9222 {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', 9222); $c.Close(); return $true } catch { }
  try { $c.Close() } catch { }
  return $false
}

if (Test-Port9222) { "CDP 9222: already UP"; exit 0 }

$target = if (Test-Path $Lnk) { $Lnk } else { $Launcher }
"Launching via explorer ShellExecute: $target"
Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $target + '"')

$ok = $false
for ($i = 1; $i -le 15; $i++) {
  Start-Sleep -Seconds 2
  if (Test-Port9222) { $ok = $true; break }
}
if ($ok) { "CDP 9222: UP (after $((15 - $i + 1) * 2)s wait)"; exit 0 }
else     { "CDP 9222: still DOWN after 30s"; exit 1 }
