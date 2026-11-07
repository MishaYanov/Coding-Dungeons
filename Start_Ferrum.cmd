@echo off
cd /d "%~dp0"
node --env-file-if-exists=.env server.mjs
if errorlevel 1 pause
