@echo off
setlocal
set "AURORA_SCRIPTS=%~dp0..\..\firebase-migration\scripts"
if exist "%~dp0hml_gate_readonly.py" set "AURORA_SCRIPTS=%~dp0"
if /I "%~1"=="login" goto login
if /I "%~1"=="setup" goto setup
if not "%~1"=="" goto usage
goto diagnose
:login
echo Abra o login oficial Google e escolha somente a conta autorizada ao HML.
echo A credencial permanece no SDK local. Perfil: aurora-hml.
python "%AURORA_SCRIPTS%\hml_cli_access.py" --login
if errorlevel 1 exit /b 2
goto diagnose
:setup
python "%AURORA_SCRIPTS%\hml_cli_access.py" --setup
if errorlevel 1 exit /b 2
:diagnose
if not exist "%AURORA_SCRIPTS%\hml_gate_readonly.py" exit /b 2
python "%AURORA_SCRIPTS%\hml_gate_readonly.py" --collect
set "AURORA_RESULT=%ERRORLEVEL%"
if not "%AURORA_RESULT%"=="0" echo Diagnostico pendente. Use setup para reutilizar a conta autenticada; login para autenticar.
exit /b %AURORA_RESULT%
:usage
echo Uso: DIAG_AURORA_HML.cmd [setup^|login]
exit /b 2
