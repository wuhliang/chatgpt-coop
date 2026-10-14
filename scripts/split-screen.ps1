# split-screen.ps1 - pixel-perfect left/right split (run OUTSIDE sandbox)
#   ChatGPT Edge window -> RIGHT half,  WorkBuddy -> LEFT half
#
# Root cause of "not as perfect as Windows snap" (found 2026-10-13):
#   1) DPI mismatch. Screen is 2560x1440 @150%. A non-DPI-aware PowerShell gets
#      Screen.WorkingArea in LOGICAL px (1707x920) while GetWindowRect returns
#      PHYSICAL px (2560x1380). Feeding logical targets to SetWindowPos misplaces
#      everything. Fix: declare DPI awareness first so all APIs agree.
#   2) Invisible resize border. Windows 10/11 resizable windows carry a ~7px
#      transparent border; GetWindowRect/SetWindowPos use the OUTER rect including
#      it, so outer=half-screen leaves a visible gap. Fix: measure the real border
#      via DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS=9) and compensate,
#      exactly like the OS snap does.
#   3) A self-correcting loop re-measures and re-applies until the VISIBLE rect
#      matches the target within 2px.
#
# All measurement/positioning lives in the C# helper returning plain int[], because
# PowerShell's [ref] marshaling of `out RECT` structs is unreliable (it produced
# self-inconsistent numbers). ASCII-only output: PS 5.1 reads .ps1 as ANSI unless
# it has a UTF-8 BOM, so non-ASCII literals get mangled and can break syntax.
#
# Usage: powershell.exe -ExecutionPolicy Bypass -File <this file>

Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;
public class SnapLib {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int X, int Y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int  DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int cb);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(int ctx);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int  GetDpiForWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  private const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
  // SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) | SWP_FRAMECHANGED(0x20):
  // resize + force frame recalc, but do NOT steal focus or change Z-order
  private const uint FLAGS = 0x0034;

  // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
  public static int InitDpi() {
    bool ok = false;
    try { ok = SetProcessDpiAwarenessContext(-4); } catch { ok = false; }
    if (!ok) { try { ok = SetProcessDPIAware(); } catch { ok = false; } }
    return ok ? 1 : 0;
  }

  public static int DpiOf(IntPtr h) {
    try { return GetDpiForWindow(h); } catch { return 0; }
  }

  private static int Clamp(int v) { return (v < 0) ? 0 : (v > 40 ? 40 : v); }

  // returns [converged, visibleX, visibleY, visibleW, visibleH, attempts]
  public static int[] SnapTo(IntPtr h, int tx, int ty, int tw, int th) {
    ShowWindow(h, 9);                       // SW_RESTORE: un-maximize / un-minimize
    System.Threading.Thread.Sleep(220);

    int[] res = new int[] { 0, 0, 0, 0, 0, 0 };
    for (int i = 1; i <= 4; i++) {
      RECT o; GetWindowRect(h, out o);
      RECT v; int hr = DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out v, 16);

      int bl = 0, bt = 0, br = 0, bb = 0;
      if (hr == 0 && (v.Right - v.Left) > 0) {
        bl = Clamp(v.Left    - o.Left);
        bt = Clamp(v.Top     - o.Top);
        br = Clamp(o.Right   - v.Right);
        bb = Clamp(o.Bottom  - v.Bottom);
      }
      SetWindowPos(h, IntPtr.Zero, tx - bl, ty - bt, tw + bl + br, th + bt + bb, FLAGS);
      System.Threading.Thread.Sleep(200);

      RECT o2; GetWindowRect(h, out o2);
      RECT v2; int hr2 = DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out v2, 16);
      if (hr2 != 0) v2 = o2;
      int vx = v2.Left, vy = v2.Top, vw = v2.Right - v2.Left, vh = v2.Bottom - v2.Top;
      res = new int[] { 0, vx, vy, vw, vh, i };

      if (Math.Abs(vx - tx) <= 2 && Math.Abs(vy - ty) <= 2 &&
          Math.Abs(vw - tw) <= 2 && Math.Abs(vh - th) <= 2) { res[0] = 1; break; }
    }
    return res;
  }
}
"@

$dpiOk = [SnapLib]::InitDpi()
"DPI awareness set: $dpiOk"

Add-Type -AssemblyName System.Windows.Forms
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$half = [int]($area.Width / 2)
$rightW = $area.Width - $half
"WorkArea (physical px): $($area.Width)x$($area.Height) @ ($($area.X),$($area.Y))"
"Target  : LEFT  X=$($area.X) W=$($half)   |   RIGHT X=$($area.X + $half) W=$($rightW)"
"---"

$edge = Get-Process msedge -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like '*ChatGPT*' } | Select-Object -First 1
$wb = Get-Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ProcessName -eq 'WorkBuddy' -and $_.MainWindowTitle -ne '' } | Select-Object -First 1

foreach ($pair in @(@($edge, 'RIGHT', $half, $rightW), @($wb, 'LEFT', 0, $half))) {
  $p = $pair[0]; $side = $pair[1]; $tx = $area.X + $pair[2]; $tw = $pair[3]
  if (-not $p) { "MISSING: $side window"; continue }
  $r = [SnapLib]::SnapTo($p.MainWindowHandle, $tx, $area.Y, $tw, $area.Height)
  $st = if ($r[0] -eq 1) { 'EXACT' } else { 'OFF-TARGET' }
  "$($p.ProcessName) PID$($p.Id) [$side] dpi=$([SnapLib]::DpiOf($p.MainWindowHandle)) -> $st visible: X=$($r[1]) Y=$($r[2]) $($r[3])x$($r[4]) (passes=$($r[5]))"
}
