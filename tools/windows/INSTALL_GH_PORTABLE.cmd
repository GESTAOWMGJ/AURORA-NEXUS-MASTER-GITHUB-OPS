@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "GH_VERSION=2.102.0"
set "BASE=%LOCALAPPDATA%\Programs\GitHubCLI"
set "TMPROOT=%LOCALAPPDATA%\Temp\aurora-gh-portable"
set "ZIP=%TMPROOT%\gh.zip"
set "EXTRACT=%TMPROOT%\extract"
set "GH=%BASE%\gh.exe"
set "URL=https://github.com/cli/cli/releases/download/v%GH_VERSION%/gh_%GH_VERSION%_windows_amd64.zip"

echo [AURORA] Instalacao portatil GitHub CLI - sem administrador

if not exist "%BASE%" mkdir "%BASE%"
if exist "%TMPROOT%" rmdir /s /q "%TMPROOT%"
mkdir "%TMPROOT%"
mkdir "%EXTRACT%"

echo [1/5] Download...
curl.exe -fL "%URL%" -o "%ZIP%"
if errorlevel 1 (
  echo ERRO_DOWNLOAD_GH
  exit /b 21
)

for %%F in ("%ZIP%") do if %%~zF LSS 1000000 (
  echo ERRO_ZIP_INCOMPLETO
  exit /b 22
)

echo [2/5] Extracao...
powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%EXTRACT%' -Force"
if errorlevel 1 (
  echo ERRO_EXTRACAO_GH
  exit /b 23
)

echo [3/5] Localizando gh.exe...
set "SRC="
for /r "%EXTRACT%" %%F in (gh.exe) do (
  set "SRC=%%~fF"
  goto :found
)
:found
if not defined SRC (
  echo ERRO_GH_EXE_NAO_ENCONTRADO
  exit /b 24
)

echo [4/5] Copia...
copy /y "%SRC%" "%GH%" >nul
if errorlevel 1 (
  echo ERRO_COPIA_GH
  exit /b 25
)

if not exist "%GH%" (
  echo ERRO_GH_DESTINO_AUSENTE
  exit /b 26
)

echo [5/5] Verificacao...
"%GH%" --version
if errorlevel 1 (
  echo ERRO_GH_NAO_EXECUTA
  exit /b 27
)

echo GH_PORTABLE_INSTALLED_OK
echo.
echo Abrindo login GitHub CLI...
"%GH%" auth login --hostname github.com --git-protocol https --web --skip-ssh-key
exit /b %errorlevel%
