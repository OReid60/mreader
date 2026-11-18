param([ValidateSet('run','build','test','check','live-test','recovery-test','package')][string]$Action = 'run')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
if (Test-Path "$projectRoot\.tools\cargo\bin\cargo.exe") {
    $env:CARGO_HOME = "$projectRoot\.tools\cargo"
    $env:RUSTUP_HOME = "$projectRoot\.tools\rustup"
    $env:PATH = "$env:CARGO_HOME\bin;$env:PATH"
}
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path $vswhere) {
    $vsRoot = & $vswhere -all -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsRoot) {
        $devShell = Join-Path $vsRoot 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll'
        Import-Module $devShell
        Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
    }
}
$sdkRoot = 'C:\Program Files (x86)\Windows Kits\10'
if (Test-Path "$sdkRoot\Lib") {
    $sdkVersion = Get-ChildItem "$sdkRoot\Lib" -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'um\x64\kernel32.lib') } | Sort-Object Name -Descending | Select-Object -First 1 -ExpandProperty Name
    if ($sdkVersion) {
        $env:LIB = "$sdkRoot\Lib\$sdkVersion\um\x64;$sdkRoot\Lib\$sdkVersion\ucrt\x64;$env:LIB"
        $env:INCLUDE = "$sdkRoot\Include\$sdkVersion\ucrt;$sdkRoot\Include\$sdkVersion\shared;$sdkRoot\Include\$sdkVersion\um;$sdkRoot\Include\$sdkVersion\winrt;$env:INCLUDE"
        $env:PATH = "$sdkRoot\bin\$sdkVersion\x64;$env:PATH"
        $env:WindowsSdkDir = "$sdkRoot\"
        $env:WindowsSDKVersion = "$sdkVersion\"
        # Registry discovery can select a stale SDK path even when PATH is valid.
        $resourceCompiler = Join-Path $sdkRoot "bin\$sdkVersion\x64\rc.exe"
        if (Test-Path -LiteralPath $resourceCompiler) {
            $env:RC_x86_64_pc_windows_msvc = $resourceCompiler
        }
    }
}
if($Action-in@('build','package','run')){& (Join-Path $PSScriptRoot 'prepare-mobile-apk.ps1')|Out-Null}
New-Item -ItemType Directory -Force "$projectRoot\dist" | Out-Null
Copy-Item "$projectRoot\index.html","$projectRoot\app.js","$projectRoot\features.js","$projectRoot\style.css" "$projectRoot\dist" -Force
if (Test-Path "$projectRoot\mobile.js") { Copy-Item "$projectRoot\mobile.js" "$projectRoot\dist" -Force }
if (Test-Path "$projectRoot\vendor") { Copy-Item "$projectRoot\vendor" "$projectRoot\dist" -Recurse -Force }
switch ($Action) {
    'run' { & cargo run --release --manifest-path src-tauri/Cargo.toml }
    'build' { & cargo build --release --manifest-path src-tauri/Cargo.toml }
    'package' {
        & npm exec --yes --package=@tauri-apps/cli@2 -- tauri build --bundles nsis
        if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
        $releaseDir=Join-Path $projectRoot 'releases\windows'
        New-Item -ItemType Directory -Force $releaseDir | Out-Null
        Copy-Item -LiteralPath "$projectRoot\src-tauri\target\release\mreader.exe" -Destination "$releaseDir\Mreader-portable.exe" -Force
        Get-ChildItem -LiteralPath "$projectRoot\src-tauri\target\release\bundle\nsis" -Filter '*.exe' | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $releaseDir -Force}
        Get-ChildItem -LiteralPath $releaseDir -Filter '*.exe' | Get-FileHash -Algorithm SHA256 | Select-Object Hash,Path
    }
    'test' { & cargo test --release --manifest-path src-tauri/Cargo.toml }
    'live-test' { & cargo test --release --manifest-path src-tauri/Cargo.toml live_mangadex -- --ignored --nocapture }
    'recovery-test' { for($run=1;$run -le 5;$run++){ & cargo test --release --manifest-path src-tauri/Cargo.toml integration_tests::failed_download_never_becomes_offline_and_cleans_partial_pages -- --exact --quiet; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE} }; Write-Output 'Download recovery: 5 consecutive passes.' }
    'check' { & cargo check --manifest-path src-tauri/Cargo.toml }
}
exit $LASTEXITCODE
