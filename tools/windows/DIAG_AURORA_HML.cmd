@echo off
setlocal
set "AURORA_DIAG=%~dp0..\..\firebase-migration\scripts\hml_gate_readonly.py"
if exist "%~dp0hml_gate_readonly.py" set "AURORA_DIAG=%~dp0hml_gate_readonly.py"
if /I "%~1"=="login" goto login
if not "%~1"=="" goto usage
goto diagnose
:login
echo Abra o login oficial Google e escolha somente a conta autorizada ao HML.
echo Este comando nao concede permissoes nem executa deploy.
set "AURORA_GCLOUD="
for %%G in (gcloud.cmd) do set "AURORA_GCLOUD=%%~$PATH:G"
if not defined AURORA_GCLOUD if exist "%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" set "AURORA_GCLOUD=%LOCALAPPDATA%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if not defined AURORA_GCLOUD if exist "%ProgramFiles%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" set "AURORA_GCLOUD=%ProgramFiles%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if not defined AURORA_GCLOUD if exist "%ProgramFiles(x86)%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" set "AURORA_GCLOUD=%ProgramFiles(x86)%\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if not defined AURORA_GCLOUD exit /b 2
call "%AURORA_GCLOUD%" auth login --brief
if errorlevel 1 exit /b 2
:diagnose
if not exist "%AURORA_DIAG%" exit /b 2
python "%AURORA_DIAG%" --collect
set "AURORA_RESULT=%ERRORLEVEL%"
if not "%AURORA_RESULT%"=="0" echo Diagnostico pendente. Se AUTH_LOGIN_REQUIRED, execute este comando com o argumento login.
exit /b %AURORA_RESULT%
:usage
echo Uso: DIAG_AURORA_HML.cmd [login]
exit /b 2
