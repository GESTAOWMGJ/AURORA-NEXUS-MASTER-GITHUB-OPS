param(
  [string]$ClientSecretPath = ""
)

$ErrorActionPreference = "Stop"
$ProjectId = "wmgj-hml-jfn-20260927"
$ProjectNumber = "299889357292"
$ScriptId = "1_fQPqaq0EjaugyIF6jyuENDhJ2c2oTFm1kC-wdjmfaDqyRzy_uqwtiSW"
$Repo = "GESTAOWMGJ/automacao-gestao-wmgj"
$Root = Join-Path $env:TEMP ("aurora-clasp-renew-" + [guid]::NewGuid().ToString("N"))
$Backup = $null

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando ausente: $Name"
  }
}

function Find-DesktopClientSecret {
  $downloads = Join-Path $HOME "Downloads"
  if (-not (Test-Path $downloads)) { return $null }
  $candidates = Get-ChildItem $downloads -File -Filter "*.json" |
    Where-Object { $_.Name -match '^(client_secret|credentials).*\.json$' } |
    Sort-Object LastWriteTime -Descending
  foreach ($file in $candidates) {
    try {
      $json = Get-Content -Raw $file.FullName | ConvertFrom-Json
      $installed = $json.installed
      if ($installed.client_id -and $installed.client_secret -and
          ($installed.redirect_uris | Where-Object { $_ -match '^http://localhost' })) {
        return $file.FullName
      }
    } catch {}
  }
  return $null
}

Require-Command "gcloud"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeRoot = Join-Path $env:LOCALAPPDATA "Temp\aurora-node-portable"
  if (Test-Path $nodeRoot) {
    $nodeExe = Get-ChildItem $nodeRoot -Filter "node.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nodeExe) {
      $nodeDir = Split-Path $nodeExe.FullName
      $env:PATH = "$nodeDir;$env:PATH"
    }
  }
}
Require-Command "node"
Require-Command "npm"
Require-Command "npx"

$npmUserBin = Join-Path $env:APPDATA "npm"
if (Test-Path $npmUserBin) {
  $env:PATH = "$npmUserBin;$env:PATH"
}

$Gh = $null
$ghCommand = Get-Command gh -ErrorAction SilentlyContinue
if ($ghCommand) {
  $Gh = $ghCommand.Source
} else {
  $portableGh = Join-Path $env:LOCALAPPDATA "Programs\GitHubCLI\gh.exe"
  if (Test-Path $portableGh) {
    $Gh = $portableGh
  } else {
    $extractRoot = Join-Path $env:LOCALAPPDATA "Temp\aurora-gh-portable\extract"
    if (Test-Path $extractRoot) {
      $foundGh = Get-ChildItem $extractRoot -Filter "gh.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($foundGh) { $Gh = $foundGh.FullName }
    }
  }
}
if (-not $Gh) {
  throw "GitHub CLI ausente. Instale ou use a versao portatil em %LOCALAPPDATA%\Programs\GitHubCLI\gh.exe."
}

& $Gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Autorizando GitHub CLI no navegador..."
  & $Gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key
  if ($LASTEXITCODE -ne 0) { throw "GitHub CLI nao autenticado." }
}

Write-Host "AURORA RC1.1 - renovacao CLASPRC_JSON"
Write-Host "Projeto GCP: $ProjectId"
Write-Host "Project number esperado no Apps Script: $ProjectNumber"
Write-Host "Script ID: $ScriptId"

& gcloud services enable script.googleapis.com drive.googleapis.com serviceusage.googleapis.com logging.googleapis.com --project $ProjectId --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Falha ao habilitar APIs do projeto HML." }

if (-not $ClientSecretPath) {
  $ClientSecretPath = Find-DesktopClientSecret
}
if (-not $ClientSecretPath -or -not (Test-Path $ClientSecretPath)) {
  Start-Process "https://script.google.com/home/projects/$ScriptId/edit"
  Start-Process "https://console.cloud.google.com/apis/credentials?project=$ProjectId"
  throw "OAuth Client Desktop nao encontrado. No Apps Script, vincule Google Cloud Project ao numero $ProjectNumber. No Cloud Console, crie OAuth Client ID do tipo Desktop app e baixe o JSON para Downloads; depois execute novamente."
}

$client = Get-Content -Raw $ClientSecretPath | ConvertFrom-Json
if (-not $client.installed.client_id -or -not $client.installed.client_secret) {
  throw "O JSON selecionado nao e um OAuth Client Desktop valido."
}
if (-not ($client.installed.redirect_uris | Where-Object { $_ -match '^http://localhost' })) {
  throw "OAuth Client sem redirect URI localhost."
}

New-Item -ItemType Directory -Force -Path $Root | Out-Null
try {
  Invoke-WebRequest -Uri "https://raw.githubusercontent.com/GESTAOWMGJ/automacao-gestao-wmgj/main/appsscript.json" -OutFile (Join-Path $Root "appsscript.json") -UseBasicParsing

  @{
    scriptId = $ScriptId
    projectId = $ProjectId
    rootDir = "."
  } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Root ".clasp.json")

  & npm install -g "@google/clasp@3.4.1" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar clasp 3.4.1." }

  $clasprc = Join-Path $HOME ".clasprc.json"
  if (Test-Path $clasprc) {
    $Backup = "$clasprc.bak.$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
    Copy-Item $clasprc $Backup -Force
  }

  Push-Location $Root
  try {
    Write-Host "O navegador sera aberto para autorizacao Google."
    & clasp login --use-project-scopes --include-clasp-scopes --creds $ClientSecretPath
    if ($LASTEXITCODE -ne 0) { throw "clasp login falhou." }

    $whoRaw = & clasp show-authorized-user --json
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel confirmar o usuario autorizado." }
    $who = $whoRaw | ConvertFrom-Json
    if (-not $who.email) { throw "Usuario OAuth nao identificado." }

    $statusRaw = & clasp run obterStatusWMGJ --nondev --json
    if ($LASTEXITCODE -ne 0) { throw "clasp run obterStatusWMGJ falhou." }
    $status = $statusRaw | ConvertFrom-Json
    if (-not $status.response.ok -or $status.response.status -ne "ONLINE" -or $status.response.sistema -ne "WMGJ") {
      throw "Execution API respondeu, mas o status WMGJ nao foi validado."
    }
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $clasprc)) { throw ".clasprc.json nao foi gerado." }
  $credential = Get-Content -Raw $clasprc | ConvertFrom-Json
  if (-not $credential.tokens.default.refresh_token -or -not $credential.tokens.default.client_id) {
    throw "Credencial clasp nova incompleta."
  }

  Get-Content -Raw $clasprc | & $Gh secret set CLASPRC_JSON --repo $Repo
  if ($LASTEXITCODE -ne 0) { throw "Falha ao atualizar GitHub Secret CLASPRC_JSON." }

  Write-Host "CLASPRC_JSON_ROTATED_AND_EXECUTION_API_VERIFIED"
  Write-Host "Segredo atualizado no GitHub sem imprimir material OAuth sensivel."
} catch {
  if ($Backup -and (Test-Path $Backup)) {
    Copy-Item $Backup (Join-Path $HOME ".clasprc.json") -Force
  }
  throw
} finally {
  Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
}
