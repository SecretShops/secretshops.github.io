@echo off
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js no esta instalado o no esta disponible en PATH.
  pause
  exit /b 1
)
call npm run amazon:links
if errorlevel 1 (
  echo.
  echo No se pudieron generar los enlaces. Revisa los mensajes anteriores.
  pause
  exit /b 1
)
echo.
echo Enlaces generados en data\imports\amazon-es\amazon-links.csv
pause
