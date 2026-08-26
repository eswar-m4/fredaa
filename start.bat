@echo off
echo.
echo  Starting F.R.E.D.A Market...
echo  Backend  ^>  http://localhost:8000
echo  Frontend ^>  http://localhost:5433
echo.
start "FREDA Backend"  "%~dp0_backend.bat"
timeout /t 4 /nobreak >nul
start "FREDA Frontend" "%~dp0_frontend.bat"
