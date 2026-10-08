param([Parameter(Mandatory=$true)][string]$RepositoryRoot,[switch]$Apply)
$ErrorActionPreference='Stop'
$taskProject='wmgj-prod-jfn-20261005'
$taskNumber='616997609173'
$taskRuntime="aurora-prod-runtime@$taskProject.iam.gserviceaccount.com"
$taskDeploy="aurora-prod-deploy@$taskProject.iam.gserviceaccount.com"
$taskBuild="$taskNumber-compute@developer.gserviceaccount.com"
$taskGc='C:\Users\Guest\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
function Read-GcJson([string[]]$Arguments) {
  $taskPreviousPreference=$ErrorActionPreference
  try {$ErrorActionPreference='Continue'; $taskOutput=& $taskGc @Arguments --format=json 2>$null; $taskExit=$LASTEXITCODE}
  finally {$ErrorActionPreference=$taskPreviousPreference}
  if($taskExit -ne 0){throw 'AURORA_RUNTIME_PROVIDER_READ_FAILED'}
  return ($taskOutput -join "`n"|ConvertFrom-Json)
}
function Apply-Gc([string[]]$Arguments) {
  $taskPreviousPreference=$ErrorActionPreference
  try {$ErrorActionPreference='Continue'; $taskOutput=& $taskGc @Arguments --quiet --format=json 2>$null; $taskExit=$LASTEXITCODE}
  finally {$ErrorActionPreference=$taskPreviousPreference}
  if($taskExit -ne 0){throw 'AURORA_RUNTIME_PROVIDER_WRITE_FAILED'}
}
$taskRequest=Get-Content (Join-Path $RepositoryRoot '.github/requests/aurora-firebase-production.json') -Raw|ConvertFrom-Json
if($taskRequest.projectId -ne $taskProject -or [string]$taskRequest.projectNumber -ne $taskNumber -or $taskRequest.confirmation -ne 'PROVISION_EXISTING_PRODUCTION_PROJECT'){throw 'AURORA_PRODUCTION_CONTRACT_MISMATCH'}
$taskLive=Read-GcJson @('projects','describe',$taskProject)
if([string]$taskLive.projectNumber -ne $taskNumber -or $taskLive.lifecycleState -ne 'ACTIVE'){throw 'AURORA_PRODUCTION_PROJECT_MISMATCH'}
$taskAccounts=@(Read-GcJson @('iam','service-accounts','list',"--project=$taskProject"))
if(!($taskAccounts|Where-Object {$_.email -eq $taskDeploy -and !$_.disabled})){throw 'AURORA_DEPLOY_IDENTITY_REQUIRED'}
$taskRoles=@(Read-GcJson @('iam','roles','list',"--project=$taskProject"))
$taskAuthPermissions=@('firebaseauth.users.get','firebaseauth.users.createSession','firebaseauth.users.create','firebaseauth.users.update')
$taskReadPermissions=@('iam.serviceAccounts.get','iam.roles.get')
foreach($taskRoleSpec in @(@{id='auroraRuntimeAuth';permissions=$taskAuthPermissions},@{id='auroraProductionIdentityReader';permissions=$taskReadPermissions})) {
  $taskRoleName="projects/$taskProject/roles/$($taskRoleSpec.id)"
  $taskRole=$taskRoles|Where-Object {$_.name -eq $taskRoleName}
  if($taskRole){
    $taskRole=Read-GcJson @('iam','roles','describe',$taskRoleSpec.id,"--project=$taskProject")
    if($taskRole.deleted -or $taskRole.stage -ne 'GA' -or @(Compare-Object @($taskRoleSpec.permissions|Sort-Object) @($taskRole.includedPermissions|Sort-Object)).Count -ne 0){throw 'AURORA_EXISTING_CUSTOM_ROLE_MISMATCH'}
  }
}
foreach($taskSecret in @('AURORA_NEXUS_ALLOWED_EMAILS','AURORA_NEXUS_CSRF_HMAC_KEY','WMGJ_INGEST_HMAC_KEYRING')){
  $null=Read-GcJson @('secrets','describe',$taskSecret,"--project=$taskProject")
}
if($Apply){
  if(!($taskAccounts|Where-Object {$_.email -eq $taskRuntime})){
    Apply-Gc @('iam','service-accounts','create','aurora-prod-runtime',"--project=$taskProject",'--display-name=Aurora reviewed production runtime')
  }
  foreach($taskRoleSpec in @(@{id='auroraRuntimeAuth';permissions=$taskAuthPermissions},@{id='auroraProductionIdentityReader';permissions=$taskReadPermissions})){
    if(!($taskRoles|Where-Object {$_.name -eq "projects/$taskProject/roles/$($taskRoleSpec.id)"})){
      Apply-Gc @('iam','roles','create',$taskRoleSpec.id,"--project=$taskProject",'--stage=GA',"--title=$($taskRoleSpec.id)","--permissions=$($taskRoleSpec.permissions -join ',')")
    }
  }
  Apply-Gc @('projects','add-iam-policy-binding',$taskProject,"--member=serviceAccount:$taskRuntime","--role=projects/$taskProject/roles/auroraRuntimeAuth",'--condition=None')
  Apply-Gc @('projects','add-iam-policy-binding',$taskProject,"--member=serviceAccount:$taskRuntime",'--role=roles/datastore.user',"--condition=expression=resource.name=='projects/$taskProject/databases/(default)',title=AURORA_DEFAULT_DATABASE_ONLY")
  Apply-Gc @('projects','add-iam-policy-binding',$taskProject,"--member=serviceAccount:$taskDeploy","--role=projects/$taskProject/roles/auroraProductionIdentityReader",'--condition=None')
  foreach($taskSecret in @('AURORA_NEXUS_ALLOWED_EMAILS','AURORA_NEXUS_CSRF_HMAC_KEY','WMGJ_INGEST_HMAC_KEYRING')){
    Apply-Gc @('secrets','add-iam-policy-binding',$taskSecret,"--project=$taskProject","--member=serviceAccount:$taskRuntime",'--role=roles/secretmanager.secretAccessor','--condition=None')
  }
  foreach($taskAccount in @($taskRuntime,$taskBuild)){
    Apply-Gc @('iam','service-accounts','add-iam-policy-binding',$taskAccount,"--project=$taskProject","--member=serviceAccount:$taskDeploy",'--role=roles/iam.serviceAccountUser','--condition=None')
  }
}
$taskRuntimeAccount=Read-GcJson @('iam','service-accounts','describe',$taskRuntime,"--project=$taskProject")
if($taskRuntimeAccount.disabled){throw 'AURORA_RUNTIME_IDENTITY_DISABLED'}
$taskPolicy=Read-GcJson @('projects','get-iam-policy',$taskProject)
$taskBindings=@($taskPolicy.bindings|Where-Object {$_.members -contains "serviceAccount:$taskRuntime"})
if($taskBindings.Count -ne 2 -or !($taskBindings|Where-Object {$_.role -eq "projects/$taskProject/roles/auroraRuntimeAuth" -and !$_.condition}) -or !($taskBindings|Where-Object {$_.role -eq 'roles/datastore.user' -and $_.condition.expression -eq "resource.name=='projects/$taskProject/databases/(default)'"})){throw 'AURORA_RUNTIME_GRANTS_MISMATCH'}
foreach($taskSecret in @('AURORA_NEXUS_ALLOWED_EMAILS','AURORA_NEXUS_CSRF_HMAC_KEY','WMGJ_INGEST_HMAC_KEYRING')){
  $taskSecretPolicy=Read-GcJson @('secrets','get-iam-policy',$taskSecret,"--project=$taskProject")
  if(!($taskSecretPolicy.bindings|Where-Object {$_.role -eq 'roles/secretmanager.secretAccessor' -and !$_.condition -and $_.members -contains "serviceAccount:$taskRuntime"})){throw 'AURORA_RUNTIME_SECRET_GRANT_MISSING'}
}
foreach($taskAccount in @($taskRuntime,$taskBuild)){
  $taskAccountPolicy=Read-GcJson @('iam','service-accounts','get-iam-policy',$taskAccount,"--project=$taskProject")
  if(!($taskAccountPolicy.bindings|Where-Object {$_.role -eq 'roles/iam.serviceAccountUser' -and !$_.condition -and $_.members -contains "serviceAccount:$taskDeploy"})){throw 'AURORA_DEPLOY_ACT_AS_MISSING'}
}
@{stage='RUNTIME_IDENTITY_VERIFIED';projectId=$taskProject;projectNumber=$taskNumber;runtime=$taskRuntime;runtimeProjectBindings=$taskBindings.Count;databaseScoped=$true;secretResources=3;buildRolesChanged=$false;deployed=$false;observedAt=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress
