@echo off
title SyncWatch
cd /d "%~dp0"
if not exist node_modules (
  echo Rode primeiro o 1-configurar.bat
  pause
  exit /b 1
)
call npm start
