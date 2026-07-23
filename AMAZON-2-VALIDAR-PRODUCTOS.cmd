@echo off
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js no esta instalado o no esta disponible en PATH.
  pause
  exit /b 1
)
call npm run amazon:import:dry
if errorlevel 1 (
  echo.
  echo Hay filas que deben corregirse. Consulta data\catalog\import-reports\amazon-es-last.json
  pause
  exit /b 1
)
echo.
echo Validacion completada sin modificar el catalogo.
pause
