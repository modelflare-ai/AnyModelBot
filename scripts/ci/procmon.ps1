# CI helper (Windows): log process starts and visible console windows as JSON lines until -StopFile exists.
# Used by scripts/e2e-agent.mjs --procmon to check that the app opens no console windows.
param([Parameter(Mandatory = $true)][string]$Out, [Parameter(Mandatory = $true)][string]$StopFile)
$ErrorActionPreference = 'Continue'

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class AmbWin {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<string> Consoles() {
    var r = new List<string>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(256);
      GetClassName(h, c, 256);
      var cls = c.ToString();
      if (cls == "ConsoleWindowClass" || cls == "CASCADIA_HOSTING_WINDOW_CLASS" || cls == "PseudoConsoleWindow") {
        var t = new StringBuilder(512);
        GetWindowText(h, t, 512);
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        r.Add(h.ToInt64() + "|" + pid + "|" + cls + "|" + t.ToString());
      }
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@

function Log($obj) {
  $obj['t'] = (Get-Date).ToString('HH:mm:ss.fff')
  Add-Content -Path $Out -Value ($obj | ConvertTo-Json -Compress -Depth 3)
}

$wmi = $true
try {
  Register-CimIndicationEvent -ClassName Win32_ProcessStartTrace -SourceIdentifier ambStart -ErrorAction Stop | Out-Null
  Register-CimIndicationEvent -ClassName Win32_ProcessStopTrace -SourceIdentifier ambStop -ErrorAction Stop | Out-Null
} catch {
  $wmi = $false
  Log @{ kind = 'error'; message = "WMI trace unavailable: $($_.Exception.Message)" }
}
Log @{ kind = 'ready'; wmi = $wmi }

# Visible consoles that already exist (the runner's own) are reported once with kind=console-preexisting.
$seen = @{}
foreach ($w in [AmbWin]::Consoles()) { $seen[$w] = 1; Log @{ kind = 'console-preexisting'; window = $w } }

while (-not (Test-Path $StopFile)) {
  if ($wmi) {
    foreach ($e in @(Get-Event -SourceIdentifier ambStart -ErrorAction SilentlyContinue)) {
      $n = $e.SourceEventArgs.NewEvent
      $cmd = $null
      try { $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($n.ProcessID)" -ErrorAction Stop).CommandLine } catch {}
      Log @{ kind = 'start'; pid = [int]$n.ProcessID; ppid = [int]$n.ParentProcessID; name = [string]$n.ProcessName; cmd = $cmd }
      Remove-Event -EventIdentifier $e.EventIdentifier
    }
    foreach ($e in @(Get-Event -SourceIdentifier ambStop -ErrorAction SilentlyContinue)) {
      $n = $e.SourceEventArgs.NewEvent
      Log @{ kind = 'stop'; pid = [int]$n.ProcessID; name = [string]$n.ProcessName; exit = [int64]$n.ExitStatus }
      Remove-Event -EventIdentifier $e.EventIdentifier
    }
  }
  foreach ($w in [AmbWin]::Consoles()) {
    if (-not $seen.ContainsKey($w)) { $seen[$w] = 1; Log @{ kind = 'console-window'; window = $w } }
  }
  Start-Sleep -Milliseconds 150
}
Log @{ kind = 'done' }
