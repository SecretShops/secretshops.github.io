@echo off
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js no esta instalado o no esta disponible en PATH.
  pause
  exit /b 1
)
call npm run amazon:import
if errorlevel 1 (
  echo.
  echo La importacion o alguna prueba ha fallado. Revisa los mensajes anteriores.
  pause
  exit /b 1
)
echo.
echo Productos Amazon importados y catalogo validado.
pause
