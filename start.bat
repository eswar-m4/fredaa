@echo off
title FREDA - Customer Portal (port 5434)
pushd "%~dp0"
echo.
echo  Starting F.R.E.D.A Customer Portal...
echo  http://localhost:5434
echo.
call npm install
call npm run dev
pause
