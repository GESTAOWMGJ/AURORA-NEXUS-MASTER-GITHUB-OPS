# Native parser validation, called by a bash wrapper for the repository-wide shell gate.
[CmdletBinding()]
param()
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$beta=Join-Path $repo 'desktop\beta'
$scripts=@(Get-Item -LiteralPath $PSCommandPath)+@(Get-ChildItem -LiteralPath $beta -Filter '*.ps1')
foreach($file in $scripts){
    $tokens=$null; $errors=$null
    $null=[System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
    if($errors){throw ($errors | Out-String)}
}
$ps=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $ps -NoProfile -ExecutionPolicy RemoteSigned -File (Join-Path $beta 'Client.ps1') -Action Verify
if($LASTEXITCODE -ne 0){throw 'Client integrity failed.'}
Write-Output 'WINDOWS_NATIVE_PARSER_AND_HASH_PASS; no installation or cloud access executed.'
