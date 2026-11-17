param([string]$JavaHome=$env:JAVA_HOME)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if(-not $JavaHome){$JavaHome=Join-Path $env:USERPROFILE '.jdks/jbr-21.0.11'}
$build=Join-Path (Get-Location) 'test-artifacts/source-session-classes';New-Item -ItemType Directory -Force $build | Out-Null
& (Join-Path $JavaHome 'bin/javac.exe') --release 11 -d $build scripts/java/SourceSessionAgent.java
if($LASTEXITCODE -ne 0){throw 'Source session helper compile failed'}
$source=[IO.File]::ReadAllText((Join-Path (Get-Location) 'scripts/java/SourceSessionAgent.java')).Replace("`r`n","`n")
$sha=[Security.Cryptography.SHA256]::Create();try{$hash=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($source)))).Replace('-','').ToLower()}finally{$sha.Dispose()}
$manifest=Join-Path (Get-Location) 'test-artifacts/source-session-manifest.mf'
[IO.File]::WriteAllText($manifest,"Manifest-Version: 1.0`nPremain-Class: app.mreader.SourceSessionAgent`nSource-SHA256: $hash`n`n")
& (Join-Path $JavaHome 'bin/jar.exe') --create --file resources/runtime/source-session-agent.jar --manifest $manifest -C $build .
if($LASTEXITCODE -ne 0){throw 'Source session helper packaging failed'}
