param(
 [Parameter(Mandatory)][int]$ProcessId,
 [Parameter(Mandatory)][string]$ExpectedBinaryPath,
 [int]$TimeoutSeconds=15
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'windows-lifecycle.psm1') -Force
$process=Get-Process -Id $ProcessId -ErrorAction Stop
$window=Close-MreaderWindow -ProcessId $ProcessId -ExpectedBinaryPath $ExpectedBinaryPath
if(-not $process.WaitForExit($TimeoutSeconds*1000)) {
 throw 'Mreader remains running (active downloads minimize the reader). No process was killed and no replacement was launched.'
}
$window | Select-Object ProcessId,ClassName,Title,Minimized
