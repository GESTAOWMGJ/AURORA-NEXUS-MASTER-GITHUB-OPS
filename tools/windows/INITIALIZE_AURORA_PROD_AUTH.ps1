param(
  [Parameter(Mandatory=$true)][string]$RepositoryRoot,
  [switch]$ApplyAuthenticatedConfig
)

# Reviewable production Auth repair. Default mode only reads metadata.
# No user creation, credential export, HML copy, DNS update or clinical data.
$ErrorActionPreference = 'Stop'
$project = 'wmgj-prod-jfn-20261005'
$number = '616997609173'
$gcloud = 'C:\Users\Guest\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
$validator = Join-Path $RepositoryRoot 'firebase-migration/scripts/production_project_contract.py'
if (-not (Test-Path $validator)) { throw 'PRODUCTION_CONTRACT_VALIDATOR_REQUIRED' }
& python $validator --approved-project=$project --approved-number=$number --verify-live
if ($LASTEXITCODE -ne 0) { throw 'APPROVED_PRODUCTION_TARGET_NOT_VERIFIED' }

$token = (& $gcloud auth print-access-token 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or -not $token) { throw 'LOCAL_AUTH_TOKEN_UNAVAILABLE' }
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token)
$client.DefaultRequestHeaders.Add('x-goog-user-project', $project)
$token = $null

function Invoke-AuthMetadata([string]$method, [string]$url, [object]$payload=$null) {
  $request = New-Object System.Net.Http.HttpRequestMessage
  $request.Method = New-Object System.Net.Http.HttpMethod($method)
  $request.RequestUri = $url
  if ($null -ne $payload) {
    $json = $payload | ConvertTo-Json -Compress -Depth 10
    $request.Content = New-Object System.Net.Http.StringContent($json, [Text.Encoding]::UTF8, 'application/json')
  }
  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  try {
    $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $body = $null
    if ($text) { try { $body = $text | ConvertFrom-Json } catch { throw 'AUTH_RESPONSE_INVALID' } }
    $errorCode = 'UNCLASSIFIED'
    if ($body.error.message -match '^(CONFIGURATION_NOT_FOUND|PROJECT_NOT_FOUND|PERMISSION_DENIED|SERVICE_DISABLED)$') { $errorCode = $Matches[1] }
    return [pscustomobject]@{status=[int]$response.StatusCode;ok=$response.IsSuccessStatusCode;body=$body;errorCode=$errorCode}
  } finally { $response.Dispose(); $request.Dispose() }
}

function Write-AuthProof([object]$config, [string]$stage) {
  $totp = @($config.mfa.providerConfigs | Where-Object { $_.state -eq 'ENABLED' -and $null -ne $_.totpProviderConfig })
  [pscustomobject]@{
    stage=$stage; observedAt=[DateTime]::UtcNow.ToString('o'); projectId=$project; projectNumber=$number;
    name=$config.name; authorizedDomains=@($config.authorizedDomains); emailSignin=$config.signIn.email.enabled;
    anonymousSignin=$config.signIn.anonymous.enabled; phoneSignin=$config.signIn.phoneNumber.enabled;
    mfaState=$config.mfa.state; totpEnabled=($totp.Count -eq 1); realMfaSessionVerified=$false
  } | ConvertTo-Json -Compress -Depth 5
}

try {
  $url = "https://identitytoolkit.googleapis.com/admin/v2/projects/$project/config"
  $current = Invoke-AuthMetadata 'GET' $url
  if (-not $ApplyAuthenticatedConfig) {
    if ($current.ok) { Write-AuthProof $current.body 'READ_ONLY' }
    else { [pscustomobject]@{stage='READ_ONLY';projectId=$project;http=$current.status;code=$current.errorCode} | ConvertTo-Json -Compress }
    return
  }
  if (-not $current.ok) {
    if ($current.status -ne 404 -or $current.errorCode -ne 'CONFIGURATION_NOT_FOUND') { throw 'AUTH_INITIALIZATION_PRECONDITION_FAILED' }
    # Official initializeAuth requires an empty request body.
    $initialized = Invoke-AuthMetadata 'POST' "https://identitytoolkit.googleapis.com/v2/projects/$project/identityPlatform:initializeAuth"
    if (-not $initialized.ok) { throw 'AUTH_INITIALIZATION_FAILED' }
    $current = Invoke-AuthMetadata 'GET' $url
    if (-not $current.ok) { throw 'AUTH_INITIALIZED_CONFIG_NOT_READABLE' }
  }
  if ($current.body.name -notin @("projects/$project/config", "projects/$number/config")) { throw 'AUTH_TARGET_MISMATCH' }
  $payload = @{
    authorizedDomains=@('auroranexus.com.br')
    signIn=@{email=@{enabled=$true;passwordRequired=$true};anonymous=@{enabled=$false};phoneNumber=@{enabled=$false}}
    mfa=@{state='ENABLED';providerConfigs=@(@{state='ENABLED';totpProviderConfig=@{adjacentIntervals=1}})}
  }
  $mask = 'authorizedDomains,signIn.email,signIn.anonymous,signIn.phoneNumber,mfa'
  $patched = Invoke-AuthMetadata 'PATCH' ($url + '?updateMask=' + $mask) $payload
  if (-not $patched.ok) { throw 'AUTH_CANONICAL_MFA_CONFIG_FAILED' }
  $verified = Invoke-AuthMetadata 'GET' $url
  if (-not $verified.ok) { throw 'AUTH_POSTCONDITION_LOOKUP_FAILED' }
  $config = $verified.body
  $totp = @($config.mfa.providerConfigs | Where-Object { $_.state -eq 'ENABLED' -and $null -ne $_.totpProviderConfig })
  if ($config.name -notin @("projects/$project/config", "projects/$number/config") -or @($config.authorizedDomains).Count -ne 1 -or @($config.authorizedDomains)[0] -ne 'auroranexus.com.br' -or $config.signIn.email.enabled -ne $true -or $config.signIn.email.passwordRequired -ne $true -or $config.signIn.anonymous.enabled -eq $true -or $config.signIn.phoneNumber.enabled -eq $true -or $config.mfa.state -ne 'ENABLED' -or $totp.Count -ne 1 -or $totp[0].totpProviderConfig.adjacentIntervals -ne 1) { throw 'AUTH_CANONICAL_MFA_POSTCONDITION_FAILED' }
  Write-AuthProof $config 'AUTH_CONFIG_VERIFIED'
} finally { $client.Dispose() }
