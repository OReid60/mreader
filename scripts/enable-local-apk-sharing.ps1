param([string]$BinaryPath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'releases/windows/Mreader-portable.exe'))
$ErrorActionPreference='Stop'
$binary=(Resolve-Path -LiteralPath $BinaryPath).Path
if(-not[IO.Path]::GetFileNameWithoutExtension($binary).StartsWith('mreader',[StringComparison]::OrdinalIgnoreCase)){throw 'Select the Mreader desktop executable'}
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Windows requires administrator approval for this one-time local-network rule. Run this script in an administrator PowerShell window when convenient.'}
$hash=[Security.Cryptography.SHA256]::Create()
try{$suffix=([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($binary.ToLowerInvariant())))).Replace('-','').Substring(0,12)}finally{$hash.Dispose()}
$name='Mreader-Local-Apk-'+$suffix
if(Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue){Set-NetFirewallRule -Name $name -Enabled True -Action Allow -Direction Inbound -Profile Private,Public -RemoteAddress LocalSubnet -EdgeTraversalPolicy Block|Out-Null}
else{New-NetFirewallRule -Name $name -DisplayName 'Mreader local APK downloads (local subnet only)' -Direction Inbound -Action Allow -Program $binary -Protocol TCP -Profile Private,Public -RemoteAddress LocalSubnet -EdgeTraversalPolicy Block|Out-Null}
Write-Output "Local-subnet APK sharing allowed for $binary. The app opens the download listener only while a five-minute code is active."
