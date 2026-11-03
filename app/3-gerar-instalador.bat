@echo off
title SyncWatch - gerando instalador
cd /d "%~dp0"
if not exist node_modules (
  echo Rode primeiro o 1-configurar.bat
  pause
  exit /b 1
)
echo Gerando o instalador ^(ja assinado com o EVS^)...
call npm run dist
if errorlevel 1 (
  echo.
  echo Falhou. Se o erro falar de EVS ou de sessao expirada, rode:
  echo     py -m castlabs_evs.account reauth
  echo e tente de novo.
  pause
  exit /b 1
)
echo.
echo Pronto! O instalador esta na pasta "dist". Mande o arquivo .exe para seu amigo.
start "" "%~dp0dist"
pause
