@echo off
chcp 65001 >nul
title SyncWatch - servidor
cd /d "%~dp0server"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado.
  echo  Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo Falhou ao instalar. Verifique sua internet.
    pause
    exit /b 1
  )
)

start "" http://localhost:3000
node server.js
pause
