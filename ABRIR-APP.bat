@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MESHIPPING // TERMINAL - Cotizador
echo ============================================================
echo   MESHIPPING // TERMINAL  -  Cotizador de pintura
echo   Iniciando el sistema en esta PC...
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js en esta PC.
  echo Instala Node 24 o superior desde https://nodejs.org y vuelve a intentar.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Primera vez: instalando dependencias, espera un momento...
  call npm install
  echo.
)

echo Abriendo el navegador en http://localhost:3000 ...
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
echo.
echo  ==========================================================
echo   >>  NO CIERRES esta ventana negra mientras uses la app  <<
echo       Para apagar el sistema, cierra esta ventana.
echo  ==========================================================
echo.

node server.js
pause
