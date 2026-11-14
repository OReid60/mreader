param([string]$Serial='emulator-5580',[string]$ReleaseApk)
$ErrorActionPreference='Stop'
if($Serial -notmatch '^emulator-\d+$'){throw 'Use a dedicated emulator; this test does not install onto personal devices.'}
Set-Location (Split-Path $PSScriptRoot -Parent)
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass='BelowNormal'
if(-not $env:ANDROID_HOME){$env:ANDROID_HOME='C:/Users/V/AppData/Local/Android/Sdk'}
if(-not $env:JAVA_HOME){$env:JAVA_HOME='C:/Users/V/.jdks/jbr-21.0.11'}
$assets='src-tauri/gen/android/app/src/androidTest/assets'
New-Item -ItemType Directory -Force $assets | Out-Null
$fixtures=@(
  @{Package='eu.kanade.tachiyomi.extension.all.mangadex';Url='[user-supplied repository URL]'},
  @{Package='eu.kanade.tachiyomi.extension.all.mangaplus';Url='[user-supplied repository URL]'}
)
foreach($fixture in $fixtures){
  $file=Join-Path $assets ($fixture.Package+'.apk')
  if(-not(Test-Path $file)){Invoke-WebRequest $fixture.Url -OutFile $file -TimeoutSec 90}
}
# The actual APK signer, package and version are verified inside Android by the test.
$tasks=@(':app:assembleArm64DebugAndroidTest')
if(-not $ReleaseApk){$tasks+=':app:assembleArm64Debug'}
& src-tauri/gen/android/gradlew.bat -p src-tauri/gen/android @tasks -x rustBuildArm64Debug --no-daemon --max-workers=2 --no-configuration-cache
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$adb=Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
$test=Get-ChildItem src-tauri/gen/android/app/build/outputs/apk/androidTest/arm64/debug -Filter '*.apk'|Select-Object -First 1
if($ReleaseApk){
  $secure=(Get-Content .secrets/android-signing-password.dpapi -Raw).Trim()|ConvertTo-SecureString
  $env:MREADER_SIGNING_PASSWORD=[System.Net.NetworkCredential]::new('', $secure).Password
  try {
    $signedTest=Join-Path (Get-Location) 'test-artifacts/extensions-release-instrumentation.apk'
    & (Join-Path $env:ANDROID_HOME 'build-tools/36.0.0/apksigner.bat') sign --ks .secrets/android-release.p12 --ks-key-alias mreader --ks-pass env:MREADER_SIGNING_PASSWORD --key-pass env:MREADER_SIGNING_PASSWORD --out $signedTest $test.FullName
    if($LASTEXITCODE-ne0){throw 'Test APK signing failed'}
  }finally{Remove-Item Env:MREADER_SIGNING_PASSWORD -ErrorAction SilentlyContinue}
  # Only the dedicated emulator's test app is reset to change signing identities.
  & $adb -s $Serial uninstall app.mreader.desktop.test | Out-Null
  & $adb -s $Serial uninstall app.mreader.desktop | Out-Null
  $appApk=$ReleaseApk
  $testApk=$signedTest
}else{
  $appApk='src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk'
  $testApk=$test.FullName
}
& $adb -s $Serial install --no-streaming -r --abi arm64-v8a $appApk
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
& $adb -s $Serial install --no-streaming -r $testApk
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$result=& $adb -s $Serial shell am instrument -w -r -e class app.mreader.desktop.ExtensionHostTest app.mreader.desktop.test/androidx.test.runner.AndroidJUnitRunner
$result | Write-Output
if(($result -join "`n") -notmatch 'OK \(2 tests\)'){throw 'The real APK extension smoke tests failed.'}
