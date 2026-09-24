@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 20 ou superior nao foi encontrado. Instale o Node.js e execute novamente.
  echo Consulte o README para os requisitos.
  echo.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo npm nao foi encontrado. Instale uma distribuicao do Node.js que inclua npm.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo.
  echo Preparando o IPED Investigator pela primeira vez...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run launch
if errorlevel 1 pause
