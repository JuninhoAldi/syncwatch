@echo off
title SyncWatch - gerando instalador (com log)
cd /d "%~dp0"
echo Gerando o instalador... (o progresso vai para build-log.txt)
del /q build-log.txt build-fim.txt 2>nul
call npm run dist > build-log.txt 2>&1
echo %errorlevel% > build-fim.txt
echo Terminou. Pode fechar esta janela.
