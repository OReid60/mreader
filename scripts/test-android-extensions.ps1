param([string]$Serial='emulator-5580')
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
& src-tauri/gen/android/gradlew.bat -p src-tauri/gen/android :app:assembleUniversalDebug :app:assembleUniversalDebugAndroidTest -x rustBuildUniversalDebug --no-daemon --max-workers=2 --no-configuration-cache
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$adb=Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
& $adb -s $Serial install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$test=Get-ChildItem src-tauri/gen/android/app/build/outputs/apk/androidTest/universal/debug -Filter '*.apk'|Select-Object -First 1
& $adb -s $Serial install -r $test.FullName
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$result=& $adb -s $Serial shell am instrument -w -r -e class app.mreader.desktop.ExtensionHostTest app.mreader.desktop.test/androidx.test.runner.AndroidJUnitRunner
$result | Write-Output
if(($result -join "`n") -notmatch 'OK \(1 test\)'){throw 'The real APK extension smoke test failed.'}
