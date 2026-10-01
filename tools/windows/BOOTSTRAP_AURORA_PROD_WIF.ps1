[CmdletBinding()]
param(
  [string]$ProductionProjectId = "aurora-nexus-prod-wmgj",
  [string]$HmlProjectId = "wmgj-hml-jfn-20260927",
  [string]$Repository = "GESTAOWMGJ/automacao-gestao-wmgj",
  [string]$Environment = "firebase-production",
  [string]$Region = "southamerica-east1"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function New-HexSecret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
  return [Convert]::ToHexString($buffer).ToLowerInvariant()
}

function Ensure-Secret([string]$Project, [string]$Name) {
  & gcloud secrets describe $Name --project $Project --format="value(name)" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    & gcloud secrets create $Name --project $Project --replication-policy=automatic --quiet | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not create secret $Name" }
  }
}

Require-Command "gcloud"
Require-Command "gh"

if (-not (& gcloud auth list --filter="status:ACTIVE" --format="value(account)")) {
  & gcloud auth login
  if ($LASTEXITCODE -ne 0) { throw "gcloud login failed" }
}
& gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) {
  & gh auth login --web
  if ($LASTEXITCODE -ne 0) { throw "GitHub CLI login failed" }
}

$billingResource = (& gcloud billing projects describe $HmlProjectId --format="value(billingAccountName)").Trim()
if (-not $billingResource) { throw "Could not resolve billing from HML project" }
$billingId = ($billingResource -split "/")[-1]

& gcloud projects describe $ProductionProjectId --format="value(projectId)" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & gcloud projects create $ProductionProjectId --name="Aurora Nexus Production" --quiet
  if ($LASTEXITCODE -ne 0) { throw "Production project creation failed" }
}
& gcloud billing projects link $ProductionProjectId --billing-account $billingId --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Billing link failed" }

$bootstrapApis = @(
  "iam.googleapis.com",
  "iamcredentials.googleapis.com",
  "sts.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "serviceusage.googleapis.com",
  "secretmanager.googleapis.com"
)
& gcloud services enable @bootstrapApis --project $ProductionProjectId --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Bootstrap API enablement failed" }

$serviceAccountName = "aurora-prod-deploy"
$serviceAccount = "$serviceAccountName@$ProductionProjectId.iam.gserviceaccount.com"
& gcloud iam service-accounts describe $serviceAccount --project $ProductionProjectId 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & gcloud iam service-accounts create $serviceAccountName --display-name="Aurora Nexus Production Deploy" --project $ProductionProjectId --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Production deploy service account creation failed" }
}

$requiredProjectRoles = @(
  "roles/firebase.admin",
  "roles/datastore.owner",
  "roles/secretmanager.viewer",
  "roles/serviceusage.serviceUsageAdmin"
)
$legacyBroadProjectRoles = @(
  "roles/cloudfunctions.admin",
  "roles/run.admin",
  "roles/artifactregistry.admin",
  "roles/secretmanager.admin",
  "roles/cloudscheduler.admin",
  "roles/eventarc.admin",
  "roles/pubsub.admin",
  "roles/iam.serviceAccountUser"
)
foreach ($role in $legacyBroadProjectRoles) {
  & gcloud projects remove-iam-policy-binding $ProductionProjectId --member="serviceAccount:$serviceAccount" --role=$role --condition=None --quiet 2>$null | Out-Null
}
foreach ($role in $requiredProjectRoles) {
  & gcloud projects add-iam-policy-binding $ProductionProjectId --member="serviceAccount:$serviceAccount" --role=$role --condition=None --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "IAM binding failed for $role" }
}

$pool = "aurora-github"
$provider = "github"
& gcloud iam workload-identity-pools describe $pool --project $ProductionProjectId --location global 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & gcloud iam workload-identity-pools create $pool --project $ProductionProjectId --location global --display-name="Aurora GitHub Actions" --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WIF pool creation failed" }
}

$productionWorkflowRef = "$Repository/.github/workflows/aurora-firebase-production.yml@refs/heads/main"
$attributeMapping = "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.environment=assertion.environment,attribute.job_workflow_ref=assertion.job_workflow_ref"
$attributeCondition = "assertion.repository=='$Repository' && assertion.ref=='refs/heads/main' && assertion.environment=='$Environment' && assertion.job_workflow_ref=='$productionWorkflowRef'"

& gcloud iam workload-identity-pools providers describe $provider --project $ProductionProjectId --location global --workload-identity-pool $pool 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  & gcloud iam workload-identity-pools providers create-oidc $provider `
    --project $ProductionProjectId `
    --location global `
    --workload-identity-pool $pool `
    --display-name="GitHub GESTAOWMGJ Aurora Production" `
    --issuer-uri="https://token.actions.githubusercontent.com" `
    --attribute-mapping=$attributeMapping `
    --attribute-condition=$attributeCondition `
    --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WIF provider creation failed" }
} else {
  & gcloud iam workload-identity-pools providers update-oidc $provider `
    --project $ProductionProjectId `
    --location global `
    --workload-identity-pool $pool `
    --issuer-uri="https://token.actions.githubusercontent.com" `
    --attribute-mapping=$attributeMapping `
    --attribute-condition=$attributeCondition `
    --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WIF provider hardening failed" }
}

$providerResource = (& gcloud iam workload-identity-pools providers describe $provider --project $ProductionProjectId --location global --workload-identity-pool $pool --format="value(name)").Trim()
$projectNumber = (& gcloud projects describe $ProductionProjectId --format="value(projectNumber)").Trim()
if ($providerResource -notmatch "^projects/[0-9]+/locations/global/workloadIdentityPools/") { throw "Invalid WIF provider resource" }
if ($projectNumber -notmatch "^[0-9]+$") { throw "Invalid production project number" }

$principal = "principalSet://iam.googleapis.com/projects/$projectNumber/locations/global/workloadIdentityPools/$pool/attribute.environment/$Environment"
& gcloud iam service-accounts add-iam-policy-binding $serviceAccount --project $ProductionProjectId --role="roles/iam.workloadIdentityUser" --member=$principal --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw "WIF service account binding failed" }

$secretDir = Join-Path $env:TEMP ("aurora-prod-bootstrap-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $secretDir | Out-Null
try {
  Ensure-Secret $ProductionProjectId "AURORA_NEXUS_ALLOWED_EMAILS"
  Ensure-Secret $ProductionProjectId "AURORA_NEXUS_CSRF_HMAC_KEY"
  Ensure-Secret $ProductionProjectId "WMGJ_INGEST_HMAC_KEYRING"

  $allowedFile = Join-Path $secretDir "allowed-emails.txt"
  & gcloud secrets versions access latest --secret="AURORA_NEXUS_ALLOWED_EMAILS" --project $HmlProjectId --out-file=$allowedFile | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $allowedFile)) { throw "Could not copy allowed-email policy from HML" }
  & gcloud secrets versions add "AURORA_NEXUS_ALLOWED_EMAILS" --project $ProductionProjectId --data-file=$allowedFile --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Allowed-email secret version failed" }

  $csrfFile = Join-Path $secretDir "csrf.txt"
  Set-Content -Path $csrfFile -Value (New-HexSecret 32) -NoNewline -Encoding ascii
  & gcloud secrets versions add "AURORA_NEXUS_CSRF_HMAC_KEY" --project $ProductionProjectId --data-file=$csrfFile --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "CSRF secret version failed" }

  $hmacFile = Join-Path $secretDir "hmac-keyring.json"
  $keyring = @{
    "apps-script-prod-cold-20261001" = @{
      active = $false
      secret = (New-HexSecret 32)
      orgIds = @("wmgj")
      entityTypes = @("sourceDocument","invoice","bankTransaction","gloss","reconciliation")
    }
  } | ConvertTo-Json -Depth 6 -Compress
  Set-Content -Path $hmacFile -Value $keyring -NoNewline -Encoding ascii
  & gcloud secrets versions add "WMGJ_INGEST_HMAC_KEYRING" --project $ProductionProjectId --data-file=$hmacFile --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Ingest keyring secret version failed" }
}
finally {
  if (Test-Path $secretDir) { Remove-Item -Path $secretDir -Recurse -Force }
}

$reviewerId = (& gh api user --jq ".id").Trim()
if ($reviewerId -notmatch "^[0-9]+$") { throw "Could not resolve GitHub reviewer id" }
$environmentPayload = @{
  wait_timer = 0
  prevent_self_review = $true
  reviewers = @(@{ type = "User"; id = [int64]$reviewerId })
} | ConvertTo-Json -Depth 6
$environmentPayload | & gh api --method PUT "repos/$Repository/environments/$Environment" --input - | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not create protected GitHub production environment" }

& gh variable set FIREBASE_PROD_PROJECT_ID --env $Environment --body $ProductionProjectId --repo $Repository
& gh variable set GCP_PROD_WIF_PROVIDER --env $Environment --body $providerResource --repo $Repository
& gh variable set GCP_PROD_DEPLOY_SERVICE_ACCOUNT --env $Environment --body $serviceAccount --repo $Repository
if ($LASTEXITCODE -ne 0) { throw "Could not write GitHub production variables" }

Write-Host "AURORA_PROD_BOOTSTRAP_OK"
Write-Host "Project: $ProductionProjectId"
Write-Host "Environment: $Environment"
Write-Host "Production deploy service account configured."
Write-Host "No service-account JSON key was created."
Write-Host "Run the protected production workflow from GitHub Actions after reviewing the environment gate."
