param([switch]$Debug,[ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
$appConfig=Get-Content -LiteralPath src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
$appVersion=if($Version){$Version}else{$appConfig.version}
$versionParts=$appVersion.Split('.')
$versionCode=([int]$versionParts[0]*1000000)+([int]$versionParts[1]*1000)+[int]$versionParts[2]
@("tauri.android.versionName=$appVersion","tauri.android.versionCode=$versionCode") | Set-Content -LiteralPath src-tauri/gen/android/app/tauri.properties -Encoding ascii
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass='BelowNormal'
$env:CARGO_BUILD_JOBS='2'
if(Test-Path "$projectRoot\.tools\cargo\bin\cargo.exe") {
  $env:CARGO_HOME="$projectRoot\.tools\cargo"
  $env:RUSTUP_HOME="$projectRoot\.tools\rustup"
  $env:PATH="$env:CARGO_HOME\bin;$env:PATH"
}
if(-not $env:ANDROID_HOME){$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'}
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
if(-not $env:NDK_HOME){
  $ndk=Get-ChildItem (Join-Path $env:ANDROID_HOME 'ndk') -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if(-not $ndk){throw 'Install an Android NDK first.'}
  $env:NDK_HOME=$ndk.FullName
}
if(Test-Path 'C:\Users\V\.jdks\jbr-21.0.11'){ $env:JAVA_HOME='C:\Users\V\.jdks\jbr-21.0.11' }
New-Item -ItemType Directory -Force dist | Out-Null
Copy-Item index.html,app.js,features.js,mobile.js,style.css dist -Force
Copy-Item vendor dist -Recurse -Force
if(-not(Get-Command cargo-ndk -ErrorAction SilentlyContinue)){throw 'Install the project-local helper first: cargo install cargo-ndk --locked'}
$env:TAURI_ANDROID_PROJECT_PATH=Join-Path $projectRoot 'src-tauri/gen/android'
$env:WRY_ANDROID_PACKAGE='app.mreader.desktop'
$env:WRY_ANDROID_LIBRARY='mreader_lib'
$generated=Join-Path $env:TAURI_ANDROID_PROJECT_PATH 'app/src/main/java/app/mreader/desktop/generated'
New-Item -ItemType Directory -Force $generated | Out-Null
$env:WRY_ANDROID_KOTLIN_FILES_OUT_DIR=$generated
$cargoArgs=@('ndk','-t','arm64-v8a','--platform','26','-o','gen/android/app/src/main/jniLibs','rustc','--lib','--crate-type','cdylib')
if(-not $Debug){$cargoArgs+='--release'}
Push-Location src-tauri
try {
  # cargo-ndk copies the library, avoiding Windows symlink privileges.
  & cargo @cargoArgs
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
}finally{Pop-Location}
$variant=if($Debug){'Debug'}else{'Release'}
& src-tauri/gen/android/gradlew.bat -p src-tauri/gen/android "assembleArm64$variant" -x "rustBuildArm64$variant" --no-daemon --max-workers=2
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
New-Item -ItemType Directory -Force releases/android | Out-Null
$apks=Get-ChildItem src-tauri/gen/android/app/build/outputs/apk -Recurse -Filter '*.apk' | Where-Object {$_.FullName -match $(if($Debug){'debug'}else{'release'})}
if(-not $apks){throw 'Gradle completed without producing an APK.'}
if($Debug){
  foreach($apk in $apks){Copy-Item -LiteralPath $apk.FullName -Destination releases/android -Force}
}else{
  # Keep the signing identity across builds. DPAPI protects the password for
  # this Windows user; neither password nor keystore belongs in source control.
  $secretDir=Join-Path $projectRoot '.secrets'
  New-Item -ItemType Directory -Force $secretDir | Out-Null
  $passwordFile=Join-Path $secretDir 'android-signing-password.dpapi'
  $keystore=Join-Path $secretDir 'android-release.p12'
  if(Test-Path $passwordFile){
    $secure=(Get-Content -LiteralPath $passwordFile -Raw).Trim() | ConvertTo-SecureString
    $env:MREADER_SIGNING_PASSWORD=[System.Net.NetworkCredential]::new('', $secure).Password
  }else{
    $random=New-Object byte[] 32
    $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($random)
    $rng.Dispose()
    $env:MREADER_SIGNING_PASSWORD=[Convert]::ToBase64String($random)
    ConvertTo-SecureString $env:MREADER_SIGNING_PASSWORD -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $passwordFile
  }
  try{
    if(-not(Test-Path $keystore)){
      & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -alias mreader -keystore $keystore -storetype PKCS12 -storepass:env MREADER_SIGNING_PASSWORD -keypass:env MREADER_SIGNING_PASSWORD -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Mreader, OU=Local release, O=Mreader'
      if($LASTEXITCODE -ne 0){throw 'Android signing-key creation failed.'}
    }
    $buildTools=Get-ChildItem (Join-Path $env:ANDROID_HOME 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
    foreach($apk in $apks){
      $output=Join-Path $projectRoot "releases/android/Mreader-$appVersion-arm64.apk"
      & (Join-Path $buildTools.FullName 'apksigner.bat') sign --ks $keystore --ks-key-alias mreader --ks-pass env:MREADER_SIGNING_PASSWORD --key-pass env:MREADER_SIGNING_PASSWORD --out $output $apk.FullName
      if($LASTEXITCODE -ne 0){throw 'APK signing failed.'}
      & (Join-Path $buildTools.FullName 'apksigner.bat') verify --verbose $output
      if($LASTEXITCODE -ne 0){throw 'APK signature validation failed.'}
      & python scripts/check-apk-namespaces.py $output
      if($LASTEXITCODE -ne 0){throw 'APK extension namespace isolation failed.'}
    }
  }finally{Remove-Item Env:MREADER_SIGNING_PASSWORD -ErrorAction SilentlyContinue}
}
Get-ChildItem releases/android -Filter '*.apk' | Get-FileHash -Algorithm SHA256 | Select-Object Hash,Path
