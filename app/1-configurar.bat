@echo off
title SyncWatch - configuracao (so na primeira vez)
cd /d "%~dp0"

echo.
echo  ===== SyncWatch: configuracao =====
echo.

:: ---------- Node.js ----------
where node >nul 2>nul
if errorlevel 1 (
  echo  [1/4] Node.js nao encontrado. Instale com:
  echo        winget install OpenJS.NodeJS.LTS
  echo        Depois feche esta janela e rode o 1-configurar.bat de novo.
  pause
  exit /b 1
)
echo  [1/4] Instalando o app ^(baixa o Electron com Widevine, pode demorar^)...
call npm install
if errorlevel 1 (
  echo  Falhou ao instalar. Verifique a internet e tente de novo.
  pause
  exit /b 1
)

:: ---------- Python ----------
set PY=
where py >nul 2>nul && set PY=py
if not defined PY (
  python --version >nul 2>nul && set PY=python
)
if not defined PY (
  echo.
  echo  [2/4] Python nao encontrado. Instalando...
  winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
  echo.
  echo  Python instalado. Feche esta janela e rode o 1-configurar.bat de novo.
  pause
  exit /b 0
)
echo  [2/4] Instalando a ferramenta de assinatura da castlabs ^(EVS^)...
%PY% -m pip install --upgrade castlabs-evs
if errorlevel 1 (
  echo  Falhou ao instalar o castlabs-evs.
  pause
  exit /b 1
)

:: ---------- Conta EVS ----------
echo.
echo  [3/4] Conta EVS ^(gratuita^). Ela e necessaria para Netflix, Prime e Disney+ tocarem.
choice /c SN /m "  Voce ja criou sua conta EVS"
if errorlevel 2 (
  echo.
  echo  Vamos criar a conta. Responda as perguntas abaixo.
  echo  Um codigo de confirmacao vai chegar no seu e-mail.
  echo.
  %PY% -m castlabs_evs.account signup
) else (
  %PY% -m castlabs_evs.account reauth
)
if errorlevel 1 (
  echo.
  echo  Algo deu errado com a conta. Se pediram para confirmar o e-mail, rode:
  echo      %PY% -m castlabs_evs.account confirm-signup
  echo  e depois rode este arquivo de novo.
  pause
  exit /b 1
)

:: ---------- Assinar ----------
echo.
echo  [4/4] Assinando o Electron do app...
call npm run assinar-dev
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo  Tudo pronto! Abra o app com o 2-abrir-app.bat
echo.
pause
