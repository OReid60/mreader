# Native-window regression; creates only hidden fixtures, never user input.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot '../scripts/windows-lifecycle.psm1') -Force
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LifecycleFixture {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] private struct WC {
  public uint style;public IntPtr proc;public int clsExtra,wndExtra;public IntPtr instance,icon,cursor,background;
  public string menu,name;
 }
 private delegate IntPtr WndProc(IntPtr h,uint msg,IntPtr w,IntPtr l);
 private static WndProc callback=DefWindowProcW;
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern ushort RegisterClassW(ref WC c);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern IntPtr CreateWindowExW(uint ex,string cls,string title,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll")] private static extern IntPtr DefWindowProcW(IntPtr h,uint msg,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
 public static IntPtr Create(string cls,string title) {
  var c=new WC {name=cls,proc=Marshal.GetFunctionPointerForDelegate(callback)};
  if(RegisterClassW(ref c)==0)throw new Exception("Could not register fixture class");
  var h=CreateWindowExW(0,cls,title,0,0,0,0,0,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
  if(h==IntPtr.Zero)throw new Exception("Could not create hidden fixture");return h;
 }
}
'@
$reader=[IntPtr]::Zero;$helper=[IntPtr]::Zero
try {
 $helper=[LifecycleFixture]::Create('Tao Thread Event Target','')
 $reader=[LifecycleFixture]::Create('Tauri Window','Mreader lifecycle fixture')
 $found=@([MreaderWindows.Lifecycle]::Find([uint32]$PID))
 if($found.Count-ne1-or$found[0].Handle-ne$reader.ToInt64()){throw 'Reader selector chose the wrong window'}
 $rejected=$false
 try{[MreaderWindows.Lifecycle]::RequestClose([uint32]$PID,$helper.ToInt64())}catch{$rejected=$true}
 if(-not$rejected){throw 'Framework helper close was not rejected'}
 $rejected=$false
 try{[MreaderWindows.Lifecycle]::RequestClose([uint32]($PID+1),$reader.ToInt64())}catch{$rejected=$true}
 if(-not$rejected){throw 'Wrong process owner was not rejected'}
 [MreaderWindows.Lifecycle]::RequestClose([uint32]$PID,$reader.ToInt64())
 'PASS: reader selected, framework helper and wrong owner rejected, actual reader close accepted.'
}finally{
 if($reader-ne[IntPtr]::Zero){[void][LifecycleFixture]::DestroyWindow($reader)}
 if($helper-ne[IntPtr]::Zero){[void][LifecycleFixture]::DestroyWindow($helper)}
}
