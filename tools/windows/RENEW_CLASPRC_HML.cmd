@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "PROJECT_ID=wmgj-hml-jfn-20260927"
set "PROJECT_NUMBER=299889357292"
set "SCRIPT_ID=1_fQPqaq0EjaugyIF6jyuENDhJ2c2oTFm1kC-wdjmfaDqyRzy_uqwtiSW"
set "REPO=GESTAOWMGJ/automacao-gestao-wmgj"
set "WORK=%LOCALAPPDATA%\Temp\aurora-clasp-cmd"
set "CLASP_HOME=%LOCALAPPDATA%\Temp\aurora-clasp-npm"

echo [AURORA] Renovacao CLASPRC_JSON via CMD - sem administrador

set "GH="
if exist "%USERPROFILE%\aurora-gh\gh.exe" (
  set "GH=%USERPROFILE%\aurora-gh\gh.exe"
  goto :ghfound
)
if exist "%LOCALAPPDATA%\Temp\aurora-gh-portable\extract\bin\gh.exe" (
  set "GH=%LOCALAPPDATA%\Temp\aurora-gh-portable\extract\bin\gh.exe"
  goto :ghfound
)
for /r "%LOCALAPPDATA%\Temp\aurora-gh-portable\extract" %%F in (gh.exe) do (
  if exist "%%~fF" (
    set "GH=%%~fF"
    goto :ghfound
  )
)
:ghfound
if not defined GH (
  echo ERRO_GH_NAO_ENCONTRADO
  exit /b 31
)
echo GH_OK

set "NODE="
for /r "%USERPROFILE%\aurora-node" %%F in (node.exe) do (
  if exist "%%~fF" (
    set "NODE=%%~fF"
    goto :nodefound
  )
)
if not defined NODE (
  for /r "%LOCALAPPDATA%\Temp\aurora-node-portable" %%F in (node.exe) do (
    if exist "%%~fF" (
      set "NODE=%%~fF"
      goto :nodefound
    )
  )
)
:nodefound
if not defined NODE (
  echo ERRO_NODE_NAO_ENCONTRADO
  exit /b 32
)

set "NPM="
for /r "%USERPROFILE%\aurora-node" %%F in (npm.cmd) do (
  if exist "%%~fF" (
    set "NPM=%%~fF"
    goto :npmfound
  )
)
if not defined NPM (
  for /r "%LOCALAPPDATA%\Temp\aurora-node-portable" %%F in (npm.cmd) do (
    if exist "%%~fF" (
      set "NPM=%%~fF"
      goto :npmfound
    )
  )
)
:npmfound
if not defined NPM (
  echo ERRO_NPM_NAO_ENCONTRADO
  exit /b 34
)

set "NODEDIR=%~dp0"
for %%F in ("!NODE!") do set "NODEDIR=%%~dpF"
for %%F in ("!NPM!") do set "NPMDIR=%%~dpF"
set "PATH=!NODEDIR!;!NPMDIR!;%CLASP_HOME%;%APPDATA%\npm;%PATH%"

"!NODE!" --version
if errorlevel 1 exit /b 33
call "!NPM!" --version
if errorlevel 1 exit /b 34

"%GH%" auth status --hostname github.com >nul 2>&1
if errorlevel 1 (
  echo GitHub CLI precisa de autorizacao. Abrindo login...
  "%GH%" auth login --hostname github.com --git-protocol https --web --skip-ssh-key
  "%GH%" auth status --hostname github.com >nul 2>&1
  if errorlevel 1 (
    echo ERRO_GH_AUTH
    exit /b 35
  )
)
echo GH_AUTH_OK

set "CLIENT_JSON="
for /f "delims=" %%F in ('dir /b /a-d /o-d "%USERPROFILE%\Downloads\*.json" 2^>nul') do (
  set "CAND=%USERPROFILE%\Downloads\%%F"
  node -e "const fs=require('fs');try{const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const x=j.installed;if(x&&x.client_id&&x.client_secret&&Array.isArray(x.redirect_uris)&&x.redirect_uris.some(u=>/^http:\/\/localhost/.test(u)))process.exit(0)}catch(e){}process.exit(1)" "!CAND!"
  if !errorlevel! equ 0 (
    set "CLIENT_JSON=!CAND!"
    goto :clientfound
  )
)
:clientfound
if not defined CLIENT_JSON (
  echo ERRO_OAUTH_DESKTOP_JSON_NAO_ENCONTRADO
  echo Baixe novamente o OAuth Client ID do tipo Desktop App para Downloads.
  exit /b 36
)
echo OAUTH_DESKTOP_JSON_OK

gcloud services enable script.googleapis.com drive.googleapis.com serviceusage.googleapis.com logging.googleapis.com --project "%PROJECT_ID%" --quiet
if errorlevel 1 (
  echo ERRO_APIS_GCP
  exit /b 37
)

if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"
curl.exe -fL https://raw.githubusercontent.com/GESTAOWMGJ/automacao-gestao-wmgj/main/appsscript.json -o "%WORK%\appsscript.json"
if errorlevel 1 exit /b 38

> "%WORK%\.clasp.json" echo {
>>"%WORK%\.clasp.json" echo   "scriptId": "%SCRIPT_ID%",
>>"%WORK%\.clasp.json" echo   "projectId": "%PROJECT_ID%",
>>"%WORK%\.clasp.json" echo   "rootDir": "."
>>"%WORK%\.clasp.json" echo }

if exist "%CLASP_HOME%" rmdir /s /q "%CLASP_HOME%"
mkdir "%CLASP_HOME%"
call "!NPM!" install --prefix "%CLASP_HOME%" @google/clasp@3.4.1
if errorlevel 1 (
  echo ERRO_INSTALACAO_CLASP
  exit /b 39
)

set "CLASP=%CLASP_HOME%\node_modules\.bin\clasp.cmd"
if not exist "%CLASP%" (
  echo ERRO_CLASP_CMD_NAO_ENCONTRADO
  exit /b 40
)

pushd "%WORK%"
echo Abrindo autorizacao Google para clasp...
call "%CLASP%" login --use-project-scopes --include-clasp-scopes --creds "%CLIENT_JSON%"
if errorlevel 1 (
  popd
  echo ERRO_CLASP_LOGIN
  exit /b 41
)

call "%CLASP%" show-authorized-user --json
if errorlevel 1 (
  popd
  echo ERRO_CLASP_USUARIO
  exit /b 42
)

call "%CLASP%" run obterStatusWMGJ --nondev --json > "%WORK%\status.json"
if errorlevel 1 (
  popd
  echo ERRO_CLASP_RUN
  exit /b 43
)

node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));if(!(j&&j.response&&j.response.ok===true&&j.response.status==='ONLINE'&&j.response.sistema==='WMGJ'))process.exit(1)" "%WORK%\status.json"
if errorlevel 1 (
  popd
  echo ERRO_EXECUTION_API_STATUS
  exit /b 44
)
popd

if not exist "%USERPROFILE%\.clasprc.json" (
  echo ERRO_CLASPRC_NAO_GERADO
  exit /b 45
)

type "%USERPROFILE%\.clasprc.json" | "%GH%" secret set CLASPRC_JSON --repo "%REPO%"
if errorlevel 1 (
  echo ERRO_GITHUB_SECRET
  exit /b 46
)

"%GH%" issue comment 46 --repo "%REPO%" --body "CLASPRC_JSON_ROTATED_AND_EXECUTION_API_VERIFIED"
if errorlevel 1 (
  echo ERRO_GITHUB_EVIDENCE_MARKER
  exit /b 47
)

echo CLASPRC_JSON_ROTATED_AND_EXECUTION_API_VERIFIED
exit /b 0
