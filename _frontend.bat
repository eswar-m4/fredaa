@echo off
title FREDA - Frontend (port 5433)
pushd "%~dp0frontend"
npm install
npm run dev
pause
