@echo off
title FREDA - Frontend (port 5433)
pushd "%~dp0frontend"
call npm install
call npm run dev
pause
