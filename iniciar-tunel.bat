@echo off
chcp 65001 >nul
title SyncWatch - link para o amigo

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Instalando o cloudflared ^(gratuito, da Cloudflare^)...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo.
  echo  Instalado. Feche esta janela e abra o iniciar-tunel.bat de novo.
  pause
  exit /b 0
)

echo.
echo  Procure abaixo um link terminado em  .trycloudflare.com
echo  Esse e o endereco que voce manda para o seu amigo.
echo  ^(Deixe esta janela aberta enquanto estiverem assistindo^)
echo.
cloudflared tunnel --url http://localhost:3000
pause
