param(
 [Parameter(Mandatory)][string]$BinaryPath,
 [switch]$Restart
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'windows-lifecycle.psm1') -Force
Add-Type -AssemblyName System.Windows.Forms
$display=@([Windows.Forms.Screen]::AllScreens | Where-Object {$_.DeviceName.EndsWith('DISPLAY2')})
if($display.Count-ne1){throw 'Display 2 is unavailable; refusing to launch on display 1'}
$binary=(Resolve-Path -LiteralPath $BinaryPath).Path
if(-not[IO.Path]::GetFileNameWithoutExtension($binary).StartsWith('mreader',[StringComparison]::OrdinalIgnoreCase)){throw 'Expected a Mreader executable'}
if(-not('MreaderLaunch' -as [type])) {
 Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MreaderLaunch {
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int width,int height,uint flags);
}
'@
}
$foreground=[MreaderLaunch]::GetForegroundWindow()
$existing=@(Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName-like'Mreader*'-and$_.Path-eq$binary})
if($existing.Count-gt1){throw 'Multiple matching readers; refusing an ambiguous restart'}
if($existing.Count-eq1) {
 if(-not$Restart){Get-MreaderWindow -ProcessId $existing[0].Id -ExpectedBinaryPath $binary;return}
 & (Join-Path $PSScriptRoot 'close-desktop.ps1') -ProcessId $existing[0].Id -ExpectedBinaryPath $binary
}
$env:MREADER_DISPLAY='2'
# Direct process creation inherits MREADER_DISPLAY, unlike a brokered shell launch.
# Startup is hidden; Mreader then positions and shows its non-focusable window.
$started=Start-Process -FilePath $binary -WorkingDirectory (Split-Path $PSScriptRoot -Parent) -WindowStyle Hidden -PassThru
$window=$null
for($i=0;$i-lt60;$i++) {
 Start-Sleep -Milliseconds 250
 $apps=@(Get-Process -Id $started.Id -ErrorAction SilentlyContinue | Where-Object {$_.Path-eq$binary})
 if($apps.Count-gt1){throw 'Multiple matching readers after launch'}
 if($apps.Count-eq1-and@([MreaderWindows.Lifecycle]::Find($apps[0].Id)).Count-eq1){
  $window=Get-MreaderWindow -ProcessId $apps[0].Id -ExpectedBinaryPath $binary;break
 }
}
if(-not$window){throw 'Reader window did not appear'}
# The HWND exists before Tauri's queued startup maximize has been processed.
# Wait for it before reading/adjusting placement, so the launcher cannot undo it.
for($i=0;$i-lt30-and-not$window.Maximized;$i++) {
 Start-Sleep -Milliseconds 100
 $window=Get-MreaderWindow -ProcessId $started.Id -ExpectedBinaryPath $binary
}
$bounds=$display[0].WorkingArea
if(-not$window.Minimized-and-not$window.Maximized-and($window.Left-lt$bounds.Left-or$window.Right-gt$bounds.Right-or$window.Top-lt$bounds.Top-or$window.Bottom-gt$bounds.Bottom)) {
 $width=[Math]::Min($window.Right-$window.Left,$bounds.Width-80)
 $height=[Math]::Min($window.Bottom-$window.Top,$bounds.Height-80)
 if(-not[MreaderLaunch]::SetWindowPos([IntPtr]$window.Handle,[IntPtr]::Zero,$bounds.Left+40,$bounds.Top+40,$width,$height,0x14)){throw 'Could not position reader on display 2'}
 $window=Get-MreaderWindow -ProcessId $started.Id -ExpectedBinaryPath $binary
}
[pscustomobject]@{Window=$window;ForegroundUnchanged=($foreground-eq[MreaderLaunch]::GetForegroundWindow())}
