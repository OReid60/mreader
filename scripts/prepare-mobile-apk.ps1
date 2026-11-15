$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$destination=Join-Path $root 'resources/mobile/Mreader-android.apk'
if(-not(Test-Path -LiteralPath $destination)){
 $local=Join-Path $root 'releases/android/Mreader-0.3.9-arm64.apk'
 if(-not(Test-Path -LiteralPath $local)){throw 'Download the signed Mreader 0.3.9 ARM64 APK from the private release into releases/android before building desktop.'}
 New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
 Copy-Item -LiteralPath $local -Destination $destination
}
if((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'd65d8cefb0a37169bf6a43ce768bfc80b1093ef755724ebc3770680cc9cc069b'){throw 'Bundled Android installer hash mismatch'}
