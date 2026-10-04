[CmdletBinding()]
param([ValidateSet('Open','Status','Verify')][string]$Action='Open')
Set-StrictMode -Version 2.0
$ErrorActionPreference='Stop'
function NoLink([string]$Path) {
    $cursor=[IO.Path]::GetFullPath($Path)
    if($cursor.StartsWith('\\')){throw 'Network client paths are not supported.'}
    while($cursor){
        if(Test-Path -LiteralPath $cursor){if(((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Redirected client path refused.'}}
        $parent=Split-Path -Parent $cursor; if($parent -eq $cursor){break}; $cursor=$parent
    }
}
NoLink $PSScriptRoot
$release=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($release.schemaVersion -ne 1 -or $release.product -cne 'AURORA NEXUS' -or $release.channel -cne 'HOMOLOGATION_BETA' -or $release.portalUrl -cne 'https://wmgj-hml-jfn-20260927.web.app/' -or $release.productionApproved -ne $false -or $release.sourceCommit -notmatch '^[a-f0-9]{40}$'){throw 'Release identity or scope invalid.'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'SHA256SUMS.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach($item in $manifest.files){
    if($item.path -notin @('Client.ps1','Install.ps1','release.json','LEIA-ME.md')){throw 'Unknown payload item.'}
    $file=Join-Path $PSScriptRoot $item.path; NoLink $file
    if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -cne $item.sha256.ToUpperInvariant()){throw ('Integrity mismatch: '+$item.path)}
}
if(@($manifest.files).Count -ne 4 -or @($manifest.files.path | Select-Object -Unique).Count -ne 4){throw 'Incomplete payload.'}
if($Action -eq 'Verify'){
    [ordered]@{status='CLIENT_FILES_VERIFIED';clientVersion=$release.clientVersion;sourceCommit=$release.sourceCommit;cloudSync='NOT_VERIFIED';signed=$false}|ConvertTo-Json
    exit 0
}
if($Action -eq 'Open'){
    $candidates=@((Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Microsoft\Edge\Application\msedge.exe'),(Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Microsoft\Edge\Application\msedge.exe'))
    $edge=$candidates | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | Select-Object -First 1
    if(-not $edge){throw 'Microsoft Edge not found. No browser is installed silently.'}
    NoLink $edge
    $null=Start-Process -FilePath $edge -ArgumentList '--app=https://wmgj-hml-jfn-20260927.web.app/' -PassThru
    Write-Output 'WEB_CLIENT_LAUNCH_REQUESTED; login and authenticated data synchronization require server confirmation.'
    exit 0
}
Add-Type -AssemblyName System.Net.Http
$handler=New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect=$false
$http=New-Object System.Net.Http.HttpClient($handler)
$http.Timeout=[TimeSpan]::FromSeconds(15)
$routes=@()
try{
    foreach($spec in @(@('/__sessionLogin',405,'METHOD_NOT_ALLOWED'),@('/api/bootstrap',401,'AUTH_REQUIRED'),@('/api/native-insight?intent=EXECUTIVE',401,'AUTH_REQUIRED'),@('/api/integration/ping',401,'INVALID_INTEGRATION_KEY'))){
        $resp=$null
        try{
            $resp=$http.GetAsync($release.portalUrl.TrimEnd('/')+$spec[0]).GetAwaiter().GetResult()
            $media=[string]$resp.Content.Headers.ContentType
            $code=$null
            if($media -match '^application/json'){
                $json=$resp.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                if($null -ne $json.PSObject.Properties['code']){$code=[string]$json.code}
            }
            $routes += [ordered]@{path=$spec[0];httpStatus=[int]$resp.StatusCode;code=$code;expectedStatus=$spec[1];guardVerified=([int]$resp.StatusCode -eq $spec[1] -and $code -ceq $spec[2])}
        }catch{$routes += [ordered]@{path=$spec[0];httpStatus=$null;guardVerified=$false;error='TRANSPORT_OR_RESPONSE_NOT_VERIFIED'}}
        finally{if($resp){$resp.Dispose()}}
    }
}finally{$http.Dispose();$handler.Dispose()}
$evidence=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AuroraNexus\client-evidence'
NoLink $evidence
$null=New-Item -ItemType Directory -Path $evidence -Force
$result=[ordered]@{schemaVersion=1;atUtc=[DateTime]::UtcNow.ToString('o');clientVersion=$release.clientVersion;sourceCommit=$release.sourceCommit;portal=$release.portalUrl;probe='ANONYMOUS_GET_ONLY';routes=$routes;transport=($(if(@($routes | Where-Object{-not $_.guardVerified}).Count -eq 0){'AUTH_GUARDS_VERIFIED'}else{'PARTIAL_OR_BLOCKED'}));authenticatedCloudSync='NOT_VERIFIED';realDataUploadedByThisClient=0;physicalReplica='NOT_IMPLEMENTED';productionApproved=$false}
$out=$result|ConvertTo-Json -Depth 6
$path=Join-Path $evidence ('cloud-probe-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'.json')
[IO.File]::WriteAllText($path,$out,(New-Object Text.UTF8Encoding($false)))
Write-Output $out
