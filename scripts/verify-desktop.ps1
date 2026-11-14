param([switch]$SkipBuild)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
Set-Location $projectRoot
[System.Diagnostics.Process]::GetCurrentProcess().PriorityClass='BelowNormal'
$env:CARGO_BUILD_JOBS='2'
if (-not $SkipBuild) { powershell -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\desktop.ps1" build; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
$reportPath=Join-Path $projectRoot ('test-artifacts\desktop-verification-'+[Guid]::NewGuid().ToString()+'.json')
$profile=Join-Path $projectRoot ('test-artifacts\ui-profile-'+[Guid]::NewGuid().ToString())
$fixtures=@((Join-Path $projectRoot 'test-artifacts\Reader validation.cbz'),(Join-Path $projectRoot 'test-artifacts\Reader validation.pdf'))
foreach($fixture in $fixtures){if (-not(Test-Path -LiteralPath $fixture)){throw "Missing verification fixture: $fixture"}}
$env:MREADER_DATA_DIR=$profile
$env:MREADER_VERIFY_REPORT=$reportPath
$env:MREADER_VERIFY_FILES=ConvertTo-Json -Compress -InputObject $fixtures
$env:MREADER_DISPLAY='2'
$reader=Start-Process -FilePath (Join-Path $projectRoot 'src-tauri\target\release\mreader.exe') -PassThru
Write-Output ('Verification PID '+$reader.Id+'; no mouse or keyboard input is used.')
$finished=$reader.WaitForExit(240000)
if (-not $finished) { Stop-Process -Id $reader.Id; throw 'Desktop verification timed out.' }
if (-not(Test-Path -LiteralPath $reportPath)){throw 'Desktop verification produced no report.'}
Get-Content -LiteralPath $reportPath
$result=Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
if (-not $result.ok){exit 1}
Write-Output ('Report: '+$reportPath)
