param([string]$Version)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if(-not$Version){$Version=(Get-Content (Join-Path $root 'src-tauri/tauri.conf.json') -Raw|ConvertFrom-Json).version}
$destination=Join-Path $root 'resources/mobile/Mreader-android.apk'
$source=Join-Path $root "releases/android/Mreader-$Version-arm64.apk"
$marker=Join-Path $root 'resources/mobile/apk-version.txt'
New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force|Out-Null
if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination $destination -Force;[IO.File]::WriteAllText($marker,$Version)}
elseif(-not(Test-Path -LiteralPath $destination)-or-not(Test-Path -LiteralPath $marker)-or[IO.File]::ReadAllText($marker).Trim()-ne$Version){throw "Build or obtain the signed Mreader-$Version-arm64.apk in releases/android before packaging desktop."}
if((Get-Item -LiteralPath $destination).Length-lt1000000){throw 'Bundled APK is incomplete'}
Get-FileHash -LiteralPath $destination -Algorithm SHA256|Select-Object Hash,Path
