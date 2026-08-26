@echo off
title FREDA - Backend (port 8000)
pushd "%~dp0backend"
if exist venv\Scripts\activate.bat call venv\Scripts\activate.bat
pip install -r requirements.txt -q
python -m app.main
pause
