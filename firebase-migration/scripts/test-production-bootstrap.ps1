$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$bootstrap = Join-Path $repoRoot "tools/windows/BOOTSTRAP_AURORA_PROD_WIF.ps1"
$tokens = $null
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($bootstrap, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw "Production bootstrap syntax invalid: $parseErrors" }

# The checked-in blocked contract must exit before even querying gcloud or gh.
$script:externalCalls = 0
function gcloud { $script:externalCalls++; throw "Unexpected gcloud invocation" }
function gh { $script:externalCalls++; throw "Unexpected gh invocation" }
foreach ($project in @("", "aurora-nexus-prod-wmgj", "wmgj-hml-jfn-20260927", "aurora-test-prod-123")) {
  $blocked = $false
  try {
    & $bootstrap -ProductionProjectId $project -ProductionProjectNumber "123456789012"
  } catch {
    if ($_.Exception.Message -notlike "Production project contract blocked*") { throw }
    $blocked = $true
  }
  if (-not $blocked) { throw "Production bootstrap accepted the pending contract" }
}
if ($script:externalCalls -ne 0) { throw "Blocked bootstrap invoked external tools" }
# Expected native validation failures must not become the test process exit code.
$global:LASTEXITCODE = 0
Write-Host "AURORA_PRODUCTION_BOOTSTRAP_FAIL_CLOSED_OK"
