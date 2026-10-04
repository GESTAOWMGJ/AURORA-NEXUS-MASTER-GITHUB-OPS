[CmdletBinding()]
param([switch]$RegisterTrigger)
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
$release=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($release.clientVersion -notmatch '^0\.3\.0-beta\.20261004\.1$'){throw 'Unknown installer version.'}
$ps=Join-Path ([Environment]::GetFolderPath('Windows')) 'System32\WindowsPowerShell\v1.0\powershell.exe'
& $ps -NoProfile -ExecutionPolicy RemoteSigned -File (Join-Path $PSScriptRoot 'Client.ps1') -Action Verify
if($LASTEXITCODE -ne 0){throw 'Source verification failed.'}
function NoLink([string]$Path){
    $cursor=[IO.Path]::GetFullPath($Path); if($cursor.StartsWith('\\')){throw 'Network path refused.'}
    while($cursor){if(Test-Path -LiteralPath $cursor){if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected path refused.'}}; $next=Split-Path -Parent $cursor;if($next -eq $cursor){break};$cursor=$next}
}
$base=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\AuroraNexusHML'
$target=Join-Path $base $release.clientVersion
NoLink $base; NoLink $target
$null=New-Item -ItemType Directory -Path $base -Force
$lock=Join-Path $base '.beta-install.lock'
$handle=[IO.File]::Open($lock,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try{
    if(Test-Path -LiteralPath $target){
        foreach($name in @('Client.ps1','Install.ps1','release.json','LEIA-ME.md','SHA256SUMS.json')){
            if(-not(Test-Path -LiteralPath (Join-Path $target $name)) -or (Get-FileHash (Join-Path $target $name)).Hash -ne (Get-FileHash (Join-Path $PSScriptRoot $name)).Hash){throw 'Existing version differs: refusing overwrite.'}
        }
    }else{
        $stage=Join-Path $base ('.stage-'+[guid]::NewGuid().ToString('N'))
        $null=New-Item -ItemType Directory -Path $stage
        foreach($name in @('Client.ps1','Install.ps1','release.json','LEIA-ME.md','SHA256SUMS.json')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage $name)}
        [IO.Directory]::Move($stage,$target)
    }
    $shell=New-Object -ComObject WScript.Shell
    $client=Join-Path $target 'Client.ps1'
    $shortcutArgs='-NoProfile -ExecutionPolicy RemoteSigned -File "'+$client+'" -Action Open'
    $links=@((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Aurora Nexus - BETA HML.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) ('Aurora Nexus HML '+$release.clientVersion+'.lnk')))
    foreach($link in $links){
        NoLink $link
        $s=$shell.CreateShortcut($link)
        if((Test-Path -LiteralPath $link) -and ($s.TargetPath -ine $ps -or $s.Arguments -cne $shortcutArgs)){throw 'Existing shortcut belongs to another version; refusing overwrite.'}
        $s.TargetPath=$ps; $s.Arguments=$shortcutArgs; $s.WorkingDirectory=$target
        $s.Description='Aurora Nexus | beta HML web client | server login required | no local replica';$s.WindowStyle=7;$s.Save()
    }
    $triggerState='NOT_REQUESTED'
    if($RegisterTrigger){
        $file=Join-Path ([Environment]::GetFolderPath('UserProfile')) '.TRIGGERcmdData\commands.json'; NoLink $file
        if(-not(Test-Path -LiteralPath $file)){throw 'TRIGGERcmd configuration not found; no replacement configuration created.'}
        $before=(Get-FileHash -LiteralPath $file).Hash
        $commands=@(Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json)
        $wanted=@(@('AURORA NEXUS Abrir Beta','Open','aurora abrir beta'),@('AURORA NEXUS Verificar Cloud','Status','aurora verificar cloud'))
        foreach($item in $wanted){
            $cmd='"'+$ps+'" -NoProfile -ExecutionPolicy RemoteSigned -File "'+$client+'" -Action '+$item[1]
            $existing=@($commands|Where-Object{$_.trigger -ceq $item[0]})
            if($existing.Count -gt 1){throw 'Duplicate trigger names; no write performed.'}
            if($existing.Count -eq 1){if($existing[0].command -cne $cmd){throw 'Existing trigger is different; refusing overwrite.'}}else{
                $commands += [pscustomobject]@{trigger=$item[0];command=$cmd;ground='foreground';voice=$item[2];allowParams='false';mcpToolDescription='Fixed Aurora beta client action. No arbitrary shell parameters or data upload.'}
            }
        }
        $temp=$file+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
        $backup=$file+'.aurora-beta-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'.backup'
        [IO.File]::WriteAllText($temp,(ConvertTo-Json -InputObject @($commands) -Depth 20),(New-Object Text.UTF8Encoding($false)))
        if((Get-FileHash -LiteralPath $file).Hash -ne $before){Remove-Item -LiteralPath $temp;throw 'TRIGGERcmd changed concurrently; retry after review.'}
        [IO.File]::Replace($temp,$file,$backup)
        $triggerState='CONFIG_WRITTEN_AGENT_RELOAD_NOT_YET_PROVED'
    }
    & $ps -NoProfile -ExecutionPolicy RemoteSigned -File $client -Action Verify
    if($LASTEXITCODE -ne 0){throw 'Installed payload verification failed.'}
    $proof=[ordered]@{atUtc=[DateTime]::UtcNow.ToString('o');status='WINDOWS_WEB_CLIENT_INSTALLED';clientVersion=$release.clientVersion;productVersion=$release.productVersion;sourceCommit=$release.sourceCommit;installRoot=$target;desktopShortcut=$links[0];trigger=$triggerState;nativeBinary=$false;cloudSync='NOT_VERIFIED';databaseMigration=$false;productionApproved=$false}
    $proofDir=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AuroraNexus\client-evidence';NoLink $proofDir;$null=New-Item -ItemType Directory -Path $proofDir -Force
    $output=$proof|ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText((Join-Path $proofDir 'beta-installation.json'),$output,(New-Object Text.UTF8Encoding($false)))
    Write-Output $output
}finally{$handle.Dispose()}
