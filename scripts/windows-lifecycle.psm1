# Process.MainWindowHandle is a heuristic: minimized Tauri apps expose an
# invisible, WS_VISIBLE "Tao Thread Event Target" that it can choose instead.
if (-not ('MreaderWindows.Lifecycle' -as [type])) {
Add-Type @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
namespace MreaderWindows {
 public sealed class ReaderWindow {
  public long Handle {get;set;} public uint ProcessId {get;set;}
  public string ClassName {get;set;} public string Title {get;set;}
  public bool Minimized {get;set;} public bool Maximized {get;set;}
  public int Left {get;set;} public int Top {get;set;} public int Right {get;set;} public int Bottom {get;set;}
 }
 public static class Lifecycle {
  private delegate bool Callback(IntPtr h,IntPtr p);
  [StructLayout(LayoutKind.Sequential)] private struct Rect {public int Left,Top,Right,Bottom;}
  [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback,IntPtr p);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetClassNameW(IntPtr h,StringBuilder s,int size);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr h,StringBuilder s,int size);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h,out Rect rect);
  [DllImport("user32.dll",SetLastError=true)] private static extern bool PostMessageW(IntPtr h,uint msg,UIntPtr w,IntPtr l);
  public static ReaderWindow Describe(long handle) {
   var h=new IntPtr(handle);if(!IsWindow(h))return null;
   uint pid;GetWindowThreadProcessId(h,out pid);var cls=new StringBuilder(256);var title=new StringBuilder(1024);
   GetClassNameW(h,cls,cls.Capacity);GetWindowTextW(h,title,title.Capacity);Rect r;GetWindowRect(h,out r);
   return new ReaderWindow {Handle=handle,ProcessId=pid,ClassName=cls.ToString(),Title=title.ToString(),Minimized=IsIconic(h),Maximized=IsZoomed(h),Left=r.Left,Top=r.Top,Right=r.Right,Bottom=r.Bottom};
  }
  public static ReaderWindow[] Find(uint pid) {
   var result=new List<ReaderWindow>();
   EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);if(owner==pid){var w=Describe(h.ToInt64());if(IsReader(w,pid))result.Add(w);}return true;},IntPtr.Zero);
   return result.ToArray();
  }
  private static bool IsReader(ReaderWindow w,uint pid) {
   return w!=null && w.ProcessId==pid && w.ClassName=="Tauri Window" && w.Title.StartsWith("Mreader",StringComparison.OrdinalIgnoreCase);
  }
  public static void RequestClose(uint pid,long handle) {
   // Revalidate immediately before posting: never close a framework/helper window.
   if(!IsReader(Describe(handle),pid))throw new InvalidOperationException("Refusing to close a non-reader window.");
   if(!PostMessageW(new IntPtr(handle),0x0010,UIntPtr.Zero,IntPtr.Zero))throw new Win32Exception(Marshal.GetLastWin32Error());
  }
 }
}
'@
}
function Get-MreaderWindow {
 [CmdletBinding()] param([Parameter(Mandatory)][int]$ProcessId,[Parameter(Mandatory)][string]$ExpectedBinaryPath)
 $process=Get-Process -Id $ProcessId -ErrorAction Stop
 $expected=[IO.Path]::GetFullPath($ExpectedBinaryPath)
 if(-not[IO.Path]::GetFileNameWithoutExtension($expected).StartsWith('mreader',[StringComparison]::OrdinalIgnoreCase) -or $process.Path-ne$expected){throw 'Reader process identity does not match the expected executable.'}
 $windows=@([MreaderWindows.Lifecycle]::Find([uint32]$ProcessId))
 if($windows.Count-ne1){throw "Expected one reader window for the owned process; found $($windows.Count)."}
 return $windows[0]
}
function Close-MreaderWindow {
 [CmdletBinding()] param([Parameter(Mandatory)][int]$ProcessId,[Parameter(Mandatory)][string]$ExpectedBinaryPath)
 $window=Get-MreaderWindow -ProcessId $ProcessId -ExpectedBinaryPath $ExpectedBinaryPath
 [MreaderWindows.Lifecycle]::RequestClose([uint32]$ProcessId,$window.Handle)
 return $window
}
Export-ModuleMember -Function Get-MreaderWindow,Close-MreaderWindow
