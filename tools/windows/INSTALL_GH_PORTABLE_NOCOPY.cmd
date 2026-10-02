@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "GH_VERSION=2.102.0"
set "ROOT=%USERPROFILE%\gh-portable"
set "ZIP=%ROOT%\gh.zip"
set "EXTRACT=%ROOT%\extract"
set "URL=https://github.com/cli/cli/releases/download/v%GH_VERSION%/gh_%GH_VERSION%_windows_amd64.zip"

echo [AURORA] GitHub CLI portatil - sem copia e sem administrador

if exist "%ROOT%" rmdir /s /q "%ROOT%"
mkdir "%ROOT%"
mkdir "%EXTRACT%"

echo [1/4] Download...
curl.exe -fL "%URL%" -o "%ZIP%"
if errorlevel 1 (
  echo ERRO_DOWNLOAD_GH
  exit /b 21
)

for %%F in ("%ZIP%") do if %%~zF LSS 1000000 (
  echo ERRO_ZIP_INCOMPLETO
  exit /b 22
)

echo [2/4] Extracao...
powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%EXTRACT%' -Force"
if errorlevel 1 (
  echo ERRO_EXTRACAO_GH
  exit /b 23
)

echo [3/4] Localizando gh.exe...
set "GH="
for /r "%EXTRACT%" %%F in (gh.exe) do (
  set "GH=%%~fF"
  goto :found
)
:found
if not defined GH (
  echo ERRO_GH_EXE_NAO_ENCONTRADO
  exit /b 24
)

echo [4/4] Verificacao...
"%GH%" --version
if errorlevel 1 (
  echo ERRO_GH_NAO_EXECUTA
  exit /b 27
)

echo GH_PORTABLE_READY=%GH%
echo.
echo Abrindo login GitHub CLI...
"%GH%" auth login --hostname github.com --git-protocol https --web --skip-ssh-key
exit /b %errorlevel%
